-- 课后修订沿用原检查点 ID，保存前核对读取版本，并保留修改前后的学情事实。
create function public.can_amend_session_learning(p_session_id uuid,p_uid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_uid is not null and public.has_perm(p_uid,'attendance.mark') and exists(
    select 1 from public.class_sessions s where s.id=p_session_id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
      and (public.is_admin(p_uid) or s.teacher_override=p_uid or exists(select 1 from public.classroom_staff_assignments a
        where a.classroom_id=s.classroom_id and a.user_id=p_uid and (a.responsibility='assistant_teacher' or a.responsibility='primary_teacher' and s.teacher_override is null)))
  )
$$;
revoke all on function public.can_amend_session_learning(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_amend_session_learning(uuid,uuid) to authenticated;
create table public.session_learning_amendments (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.class_sessions(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  before_value jsonb not null,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.session_learning_amendments enable row level security;
create policy session_learning_amendments_read on public.session_learning_amendments for select to authenticated
  using (public.can_amend_session_learning(session_id,auth.uid()));
revoke all on public.session_learning_amendments from anon,authenticated;
grant select on public.session_learning_amendments to authenticated;

create function public.get_session_learning_edit(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; ids uuid[];
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_amend_session_learning(p_session_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.class_sessions where id=p_session_id and deleted_at is null and cancelled_by is null and voided_at is null) then raise exception 'SESSION_NOT_FOUND'; end if;
  ids:=public.session_communication_student_ids(p_session_id);
  select jsonb_build_object(
    'checks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'position',position,'updatedAt',updated_at) order by position) from public.session_learning_checks where session_id=p_session_id),'[]'),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.students where id=any(ids)),'[]'),
    'results',coalesce((select jsonb_agg(jsonb_build_object('checkId',r.check_id,'studentId',r.student_id,'status',r.status,'markedAt',r.marked_at) order by r.check_id,r.student_id) from public.session_learning_check_results r join public.session_learning_checks c on c.id=r.check_id where c.session_id=p_session_id and r.student_id=any(ids)),'[]'),
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('studentId',s.id,'studentName',s.name,'entryScore',r.entry_score,'exitScore',r.exit_score,'focus',r.focus,'participation',r.participation,'mastery',r.mastery,'comment',coalesce(r.comment,''),'updatedAt',r.updated_at) order by s.id) from public.students s left join public.session_reviews r on r.student_id=s.id and r.session_id=p_session_id where s.id=any(ids)),'[]')
  ) into result;
  return result||jsonb_build_object('revision',md5(result::text));
end $$;

create function public.save_session_learning_edit(p_session_id uuid,p_revision text,p_checks jsonb,p_changes jsonb,p_reviews jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous jsonb; saved jsonb; item jsonb; check_id_value uuid; student_id_value uuid; next_position integer; ids uuid[]; previous_result jsonb;
begin
  -- 所有修订锁定课次；现有单格写入仍由原权限与记录行锁约束。
  perform 1 from public.class_sessions where id=p_session_id for update;
  perform 1 from public.session_learning_checks where session_id=p_session_id order by id for update;
  perform 1 from public.session_learning_check_results where check_id in (select id from public.session_learning_checks where session_id=p_session_id) order by check_id,student_id for update;
  perform 1 from public.session_reviews where session_id=p_session_id order by student_id for update;
  previous:=public.get_session_learning_edit(p_session_id);
  if previous->>'revision' is distinct from p_revision then raise exception 'CONFLICT'; end if;
  if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks)>30
    or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>1800
    or jsonb_typeof(p_reviews) is distinct from 'array' or jsonb_array_length(p_reviews)>200 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_array_elements(p_checks) e group by e->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_changes) e group by e->>'checkId',e->>'studentId' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_reviews) e group by e->>'studentId' having count(*)>1) then raise exception 'VALIDATION'; end if;
  if exists(select 1 from public.session_learning_checks c where c.session_id=p_session_id and not exists(select 1 from jsonb_array_elements(p_checks) e where e->>'id'=c.id::text)) then raise exception 'VALIDATION'; end if;
  ids:=public.session_communication_student_ids(p_session_id);
  select coalesce(max(position)+1,0) into next_position from public.session_learning_checks where session_id=p_session_id;
  for item in select value from jsonb_array_elements(p_checks) loop
    check_id_value:=(item->>'id')::uuid;
    if check_id_value is null or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    if exists(select 1 from public.session_learning_checks where id=check_id_value) then
      if not exists(select 1 from public.session_learning_checks where id=check_id_value and session_id=p_session_id) then raise exception 'FORBIDDEN'; end if;
      update public.session_learning_checks set title=btrim(item->>'title') where id=check_id_value and title<>btrim(item->>'title');
    else
      if next_position>=30 then raise exception 'VALIDATION'; end if;
      insert into public.session_learning_checks(id,session_id,position,title,created_by) values(check_id_value,p_session_id,next_position,btrim(item->>'title'),auth.uid());
      next_position:=next_position+1;
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_changes) loop
    check_id_value:=(item->>'checkId')::uuid; student_id_value:=(item->>'studentId')::uuid;
    if check_id_value is null or student_id_value is null or not (student_id_value=any(ids)) or not exists(select 1 from public.session_learning_checks where id=check_id_value and session_id=p_session_id) then raise exception 'FORBIDDEN'; end if;
    if item->>'status' is null or item->>'status' not in ('unchecked','explained','independent','prompted','imitated','incomplete') then raise exception 'VALIDATION'; end if;
    select e into previous_result from jsonb_array_elements(previous->'results') e where e->>'checkId'=check_id_value::text and e->>'studentId'=student_id_value::text;
    if previous_result is null then
      if item->>'status'<>'unchecked' then
        insert into public.session_learning_check_results(check_id,student_id,status,marked_by,marked_at) values(check_id_value,student_id_value,item->>'status',auth.uid(),clock_timestamp());
      end if;
    elsif item->>'status'='unchecked' then
      delete from public.session_learning_check_results where check_id=check_id_value and student_id=student_id_value and marked_at=(previous_result->>'markedAt')::timestamptz;
      if not found then raise exception 'CONFLICT'; end if;
    else
      update public.session_learning_check_results set status=item->>'status',marked_by=auth.uid(),marked_at=clock_timestamp()
        where check_id=check_id_value and student_id=student_id_value and marked_at=(previous_result->>'markedAt')::timestamptz;
      if not found then raise exception 'CONFLICT'; end if;
    end if;
  end loop;
  if jsonb_array_length(p_reviews)>0 then
    if not public.has_perm(auth.uid(),'review.write') then raise exception 'FORBIDDEN'; end if;
    for item in select value from jsonb_array_elements(p_reviews) loop
      student_id_value:=(item->>'studentId')::uuid;
      if student_id_value is null or not (student_id_value=any(ids)) then raise exception 'FORBIDDEN'; end if;
      if exists(select 1 from jsonb_array_elements(previous->'reviews') e where e->>'studentId'=student_id_value::text and e->>'updatedAt' is null) then
        insert into public.session_reviews(session_id,student_id,created_by) values(p_session_id,student_id_value,auth.uid());
      end if;
    end loop;
    perform public.save_session_reviews_v2(p_session_id,p_reviews);
  end if;
  update public.class_sessions set learning_checks_configured_at=coalesce(learning_checks_configured_at,now()) where id=p_session_id;
  saved:=public.get_session_learning_edit(p_session_id);
  if saved is distinct from previous then
    insert into public.session_learning_amendments(session_id,actor_id,before_value,after_value) values(p_session_id,auth.uid(),previous,saved);
  end if;
  return saved;
exception when unique_violation then raise exception 'CONFLICT';
end $$;
revoke all on function public.get_session_learning_edit(uuid),public.save_session_learning_edit(uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_session_learning_edit(uuid),public.save_session_learning_edit(uuid,text,jsonb,jsonb,jsonb) to authenticated;
