-- 作业题目和逐生登记独立于登录账号、在线提交；复用课堂六档学情。
create table public.assignment_questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  position integer not null check (position between 0 and 59),
  title text not null check (length(btrim(title)) between 1 and 100),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(assignment_id, position)
);

create table public.assignment_question_results (
  question_id uuid not null references public.assignment_questions(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  status text not null check (status in ('explained','independent','prompted','imitated','incomplete','unchecked')),
  note text not null default '' check (length(note) <= 2000),
  version integer not null check (version > 0),
  marked_by uuid not null references public.profiles(id) on delete restrict,
  marked_at timestamptz not null default now(),
  primary key(question_id, student_id)
);

create table public.assignment_question_revisions (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.assignment_questions(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  version integer not null,
  before_value jsonb,
  after_value jsonb not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(question_id, student_id, version)
);

create function public.can_read_assignment_questions(p_assignment_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_uid is not null and public.is_staff(p_uid) and exists (
    select 1 from public.assignments a join public.classrooms c on c.id=a.classroom_id
      left join public.class_sessions s on s.id=a.session_id
    where a.id=p_assignment_id and c.archived_at is null and c.trashed_at is null
      and (a.session_id is null or s.deleted_at is null and s.voided_at is null)
      and (public.has_perm(p_uid,'class.view.all') or public.has_perm(p_uid,'class.view.mine') and (
        s.teacher_override=p_uid or exists(select 1 from public.classroom_staff_assignments staff
          where staff.classroom_id=c.id and staff.user_id=p_uid and (staff.responsibility='assistant_teacher'
            or staff.responsibility='primary_teacher' and s.teacher_override is null))
      ))
  )
$$;
create function public.can_write_assignment_questions(p_assignment_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.can_read_assignment_questions(p_assignment_id,p_uid) and public.has_perm(p_uid,'review.write')
    and exists(select 1 from public.assignments a left join public.class_sessions s on s.id=a.session_id where a.id=p_assignment_id and (
      public.is_admin(p_uid) or s.teacher_override=p_uid
      or exists(select 1 from public.classroom_staff_assignments staff where staff.classroom_id=a.classroom_id and staff.user_id=p_uid
        and (staff.responsibility='assistant_teacher' or staff.responsibility='primary_teacher' and s.teacher_override is null))
    ))
$$;

-- 私有来源函数只供已授权 RPC 调用；课次作业沿用当时的冻结花名册。
create function public.assignment_question_roster(p_assignment_id uuid)
returns table(student_id uuid, name text, roster_order integer)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.student_id,r.name,r.roster_order::integer from public.assignments a
    join public.class_sessions s on s.id=a.session_id
    join public.session_roster_entries r on r.session_id=s.id and r.revision=s.roster_revision
    where a.id=p_assignment_id and s.roster_revision>0
  union all
  select r.student_id,r.name,r.roster_order::integer from public.assignments a
    join public.class_sessions s on s.id=a.session_id
    cross join lateral public.current_session_roster_source(s.id) r
    where a.id=p_assignment_id and s.roster_revision=0
  union all
  select student.id,student.name,(row_number() over(order by student.name,student.id)-1)::integer
    from public.assignments a join public.enrollments e on e.classroom_id=a.classroom_id and e.status='active'
    join public.students student on student.id=e.student_id and student.deleted_at is null
    where a.id=p_assignment_id and a.session_id is null
$$;

alter table public.assignment_questions enable row level security;
alter table public.assignment_question_results enable row level security;
alter table public.assignment_question_revisions enable row level security;
create policy assignment_questions_read on public.assignment_questions for select to authenticated
  using(public.can_read_assignment_questions(assignment_id,(select auth.uid())));
create policy assignment_question_results_read on public.assignment_question_results for select to authenticated
  using(exists(select 1 from public.assignment_questions q where q.id=question_id and public.can_read_assignment_questions(q.assignment_id,(select auth.uid()))));
create policy assignment_question_revisions_read on public.assignment_question_revisions for select to authenticated
  using(exists(select 1 from public.assignment_questions q where q.id=question_id and public.can_read_assignment_questions(q.assignment_id,(select auth.uid()))));
revoke all on public.assignment_questions,public.assignment_question_results,public.assignment_question_revisions from anon,authenticated;
grant select on public.assignment_questions,public.assignment_question_results,public.assignment_question_revisions to authenticated;

create function public.get_assignment_question_workbook(p_assignment_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_read_assignment_questions(p_assignment_id,uid) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('assignment',jsonb_build_object('id',a.id,'title',a.title,'classroomName',c.name,'sessionId',a.session_id),
    'canWrite',public.can_write_assignment_questions(a.id,uid),
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'title',q.title,'position',q.position) order by q.position) from public.assignment_questions q where q.assignment_id=a.id),'[]'),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',r.student_id,'name',r.name) order by r.roster_order,r.student_id) from public.assignment_question_roster(a.id) r),'[]'),
    'results',coalesce((select jsonb_agg(jsonb_build_object('questionId',r.question_id,'studentId',r.student_id,'status',r.status,'note',r.note,'version',r.version,'markedAt',r.marked_at,'author',p.display_name))
      from public.assignment_question_results r join public.assignment_questions q on q.id=r.question_id
      join public.assignment_question_roster(a.id) roster on roster.student_id=r.student_id
      left join public.profiles p on p.id=r.marked_by where q.assignment_id=a.id),'[]')) into result
    from public.assignments a join public.classrooms c on c.id=a.classroom_id where a.id=p_assignment_id;
  return result;
end $$;

create function public.add_assignment_questions(p_assignment_id uuid,p_titles jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); item jsonb; next_position integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_write_assignment_questions(p_assignment_id,uid) then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.assignments where id=p_assignment_id for update;
  if p_titles is null or jsonb_typeof(p_titles)<>'array' or jsonb_array_length(p_titles) not between 1 and 60 then raise exception 'VALIDATION'; end if;
  select coalesce(max(position)+1,0) into next_position from public.assignment_questions where assignment_id=p_assignment_id;
  if next_position+jsonb_array_length(p_titles)>60 then raise exception 'QUESTION_LIMIT'; end if;
  for item in select value from jsonb_array_elements(p_titles) loop
    if jsonb_typeof(item)<>'string' or length(btrim(item #>> '{}')) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    insert into public.assignment_questions(assignment_id,position,title,created_by) values(p_assignment_id,next_position,btrim(item #>> '{}'),uid);
    next_position:=next_position+1;
  end loop;
  return public.get_assignment_question_workbook(p_assignment_id);
end $$;

create function public.save_assignment_question_results(p_assignment_id uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); item jsonb; qid uuid; sid uuid; expected integer; next_status text; next_note text;
  previous public.assignment_question_results%rowtype; saved public.assignment_question_results%rowtype;
  output jsonb:='[]'; author_name text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_write_assignment_questions(p_assignment_id,uid) then raise exception 'FORBIDDEN'; end if;
  -- 同一作业串行核对版本，批量登记与撤销均为全成或全败。
  perform 1 from public.assignments where id=p_assignment_id for update;
  if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 200 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_array_elements(p_changes) e group by e->>'questionId',e->>'studentId' having count(*)>1) then raise exception 'VALIDATION'; end if;
  select display_name into author_name from public.profiles where id=uid;
  for item in select value from jsonb_array_elements(p_changes) loop
    begin
      qid:=(item->>'questionId')::uuid; sid:=(item->>'studentId')::uuid; expected:=(item->>'expectedVersion')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALIDATION'; end;
    next_status:=item->>'status'; next_note:=coalesce(item->>'note','');
    if qid is null or sid is null or expected is null or expected<0 or next_status is null or next_status not in ('explained','independent','prompted','imitated','incomplete','unchecked')
      or jsonb_typeof(item->'note') is distinct from 'string' or length(next_note)>2000 then raise exception 'VALIDATION'; end if;
    if not exists(select 1 from public.assignment_questions where id=qid and assignment_id=p_assignment_id)
      or not exists(select 1 from public.assignment_question_roster(p_assignment_id) where student_id=sid) then raise exception 'FORBIDDEN'; end if;
    select * into previous from public.assignment_question_results where question_id=qid and student_id=sid;
    if coalesce(previous.version,0)<>expected then raise exception 'CONFLICT'; end if;
    insert into public.assignment_question_results(question_id,student_id,status,note,version,marked_by,marked_at)
      values(qid,sid,next_status,next_note,expected+1,uid,clock_timestamp())
      on conflict(question_id,student_id) do update set status=excluded.status,note=excluded.note,version=excluded.version,marked_by=excluded.marked_by,marked_at=excluded.marked_at
      returning * into saved;
    insert into public.assignment_question_revisions(question_id,student_id,version,before_value,after_value,actor_id)
      values(qid,sid,saved.version,case when previous.version is null then null else jsonb_build_object('status',previous.status,'note',previous.note) end,
        jsonb_build_object('status',saved.status,'note',saved.note),uid);
    output:=output||jsonb_build_array(jsonb_build_object('questionId',qid,'studentId',sid,'status',saved.status,'note',saved.note,'version',saved.version,'markedAt',saved.marked_at,'author',author_name));
  end loop;
  return output;
end $$;

-- 按课次读取作业结果供教学详情使用；仍逐份检查真实任课／主管权限。
create function public.get_session_assignment_question_workbooks(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare aid uuid; output jsonb:='[]'; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
    where s.id=p_session_id and s.deleted_at is null and s.voided_at is null and c.archived_at is null and c.trashed_at is null
      and (public.has_perm(uid,'class.view.all') or public.has_perm(uid,'class.view.mine') and (
        s.teacher_override=uid or exists(select 1 from public.classroom_staff_assignments a where a.classroom_id=s.classroom_id and a.user_id=uid
          and (a.responsibility='assistant_teacher' or a.responsibility='primary_teacher' and s.teacher_override is null))
      ))) then raise exception 'FORBIDDEN'; end if;
  for aid in select id from public.assignments where session_id=p_session_id order by created_at,id loop
    output:=output||jsonb_build_array(public.get_assignment_question_workbook(aid));
  end loop;
  return output;
end $$;

revoke all on function public.assignment_question_roster(uuid) from public,anon,authenticated;
revoke all on function public.can_read_assignment_questions(uuid,uuid),public.can_write_assignment_questions(uuid,uuid),
  public.get_assignment_question_workbook(uuid),public.add_assignment_questions(uuid,jsonb),
  public.save_assignment_question_results(uuid,jsonb),public.get_session_assignment_question_workbooks(uuid) from public,anon,authenticated;
grant execute on function public.can_read_assignment_questions(uuid,uuid),public.can_write_assignment_questions(uuid,uuid),
  public.get_assignment_question_workbook(uuid),public.add_assignment_questions(uuid,jsonb),
  public.save_assignment_question_results(uuid,jsonb),public.get_session_assignment_question_workbooks(uuid) to authenticated;

comment on table public.assignment_question_results is '作业逐题教师登记；以学生档案 ID 关联，在线提交与教师观察分别留存，未检查不计为未完成。';
comment on table public.assignment_question_revisions is '逐题状态与备注的版本留痕，清除／撤销也保留记录。';
