-- 分班表：退课与按讲次调班。历史考勤、冻结名单和原班报名身份保持可追溯。
create table public.session_student_transfers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  membership_id uuid not null references public.enrollments(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  from_session_id uuid not null references public.class_sessions(id) on delete restrict,
  to_session_id uuid not null references public.class_sessions(id) on delete restrict,
  target_seat integer not null check(target_seat between 1 and 60),
  note text not null default '' check(char_length(note)<=2000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  check(from_session_id<>to_session_id),
  check((cancelled_at is null)=(cancelled_by is null))
);
create unique index session_student_transfers_source on public.session_student_transfers(from_session_id,student_id) where cancelled_at is null;
create unique index session_student_transfers_target on public.session_student_transfers(to_session_id,student_id) where cancelled_at is null;
create unique index session_student_transfers_seat on public.session_student_transfers(to_session_id,target_seat) where cancelled_at is null;
alter table public.session_student_transfers enable row level security;
revoke all on public.session_student_transfers from public,anon,authenticated;

create table mathin_internal.enrollment_placement_receipts (
  request_id uuid primary key, actor_id uuid not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on mathin_internal.enrollment_placement_receipts from public,anon,authenticated;

-- active_only 用于待冻结的课堂名单；考勤读取已冻结名单或历史成员有效期。
create function mathin_internal.session_students(p_session_id uuid,p_active_only boolean)
returns table(student_id uuid,name text,user_id uuid,seat_position smallint,joined_at timestamptz)
language sql security definer stable set search_path=public,pg_temp as $$
  with session_row as (select * from public.class_sessions where id=p_session_id and deleted_at is null),
  transfers as (
    select t.* from public.session_student_transfers t,session_row s
    where (t.from_session_id=s.id or t.to_session_id=s.id)
      and (t.cancelled_at is null or (s.started_at is not null and s.started_at<t.cancelled_at))
  ), base as (
    select distinct on(m.student_id) m.student_id,st.name,st.user_id,se.position,m.joined_at
    from session_row s join public.enrollments m on m.classroom_id=s.classroom_id
    join public.students st on st.id=m.student_id
    left join public.classroom_student_seat_order se on se.classroom_id=s.classroom_id and se.student_id=st.id
    where (p_active_only or s.roster_revision=0)
      and case when p_active_only or coalesce(s.started_at,s.scheduled_at) is null then m.status='active' and m.left_at is null
        else m.joined_at<=coalesce(s.started_at,s.scheduled_at) and (m.left_at is null or m.left_at>coalesce(s.started_at,s.scheduled_at)) end
      and not exists(select 1 from transfers t where t.from_session_id=s.id and t.student_id=m.student_id)
    order by m.student_id,m.joined_at desc,m.id
  )
  select b.student_id,b.name,b.user_id,b.position,b.joined_at from base b
  union all
  select t.student_id,st.name,st.user_id,null::smallint,t.created_at
    from session_row s join transfers t on t.to_session_id=s.id join public.students st on st.id=t.student_id
    where (p_active_only or s.roster_revision=0) and not exists(select 1 from base b where b.student_id=t.student_id)
  union all
  select r.student_id,r.name,r.user_id,r.seat_position,s.roster_frozen_at
    from session_row s join public.session_roster_entries r on r.session_id=s.id and r.revision=s.roster_revision
    where not p_active_only and s.roster_revision>0;
$$;
revoke all on function mathin_internal.session_students(uuid,boolean) from public,anon,authenticated;
grant execute on function mathin_internal.session_students(uuid,boolean) to postgres;

create or replace function public.current_session_roster_source(p_session_id uuid)
returns table(student_id uuid,name text,seat_position smallint,user_id uuid,roster_order integer)
language sql security definer stable set search_path=public,pg_temp as $$
  select s.student_id,coalesce(nullif(trim(s.name),''),'—'),s.seat_position,s.user_id,
    (row_number() over(order by s.seat_position nulls last,s.joined_at,s.student_id)-1)::integer
  from mathin_internal.session_students(p_session_id,true) s;
$$;

create or replace function public.can_insert_session_attendance_v2(p_session_id uuid,p_student_id uuid)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select public.can_mark_session_attendance_v2(p_session_id)
    and exists(select 1 from mathin_internal.session_students(p_session_id,false) s where s.student_id=p_student_id);
$$;

-- 保留考勤读取的合并与历史差异逻辑，只替换 expected_students 名单来源。
do $patch$ declare body text; previous text; replacement text;
begin
  body:=pg_get_functiondef('public.get_session_attendance_roster_v2(uuid)'::regprocedure);
  previous:=substring(body from 'with expected_students as \([\s\S]*?\), attendance_rows as \(');
  if previous is null then raise exception 'ATTENDANCE_ROSTER_PATCH_DRIFT'; end if;
  replacement:='with expected_students as (select s.student_id,s.name,s.user_id from mathin_internal.session_students(p_session_id,false) s), attendance_rows as (';
  execute replace(body,previous,replacement);
end $patch$;

-- 学生与既有监护人的课表使用同一讲次名单，补课记录继续按原投影保留。
do $patch$ declare body text; previous text;
begin
  body:=pg_get_functiondef('public.get_my_schedule(timestamptz,timestamptz)'::regprocedure);
  previous:=substring(body from 'join public.enrollments enrollment_row[\s\S]*?join public.students student_row on student_row.id = enrollment_row.student_id');
  if previous is null then raise exception 'FAMILY_SCHEDULE_PATCH_DRIFT'; end if;
  execute replace(body,previous,'join mathin_internal.session_students(session_row.id,true) roster_student on true join public.students student_row on student_row.id=roster_student.student_id');
end $patch$;

create or replace function public.is_session_member(sid uuid,uid uuid)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.class_sessions s
    left join public.classroom_members m on m.classroom_id=s.classroom_id and m.user_id=uid
    left join public.profiles substitute on substitute.id=uid and substitute.is_active
    where s.id=sid and (
      (m.user_id is not null and (m.role<>'student' or not exists(
        select 1 from public.session_student_transfers t join public.students st on st.id=t.student_id
        where t.from_session_id=s.id and st.user_id=uid
          and (t.cancelled_at is null or (s.started_at is not null and s.started_at<t.cancelled_at)))))
      or (s.teacher_override=uid and substitute.id is not null)
      or exists(select 1 from public.session_student_transfers t join public.students st on st.id=t.student_id
        where t.to_session_id=s.id and st.user_id=uid and s.deleted_at is null
          and (t.cancelled_at is null or (s.started_at is not null and s.started_at<t.cancelled_at)))
    ));
$$;

create function public.has_temporary_classroom_access(p_classroom_id uuid)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.session_student_transfers t
    join public.class_sessions s on s.id=t.to_session_id join public.students st on st.id=t.student_id
    where s.classroom_id=p_classroom_id and st.user_id=auth.uid() and s.deleted_at is null
      and (t.cancelled_at is null or (s.started_at is not null and s.started_at<t.cancelled_at)));
$$;
revoke all on function public.has_temporary_classroom_access(uuid) from public,anon,authenticated;
grant execute on function public.has_temporary_classroom_access(uuid) to authenticated;
create policy classrooms_select_temporary_student on public.classrooms for select to authenticated
  using(public.has_temporary_classroom_access(id));

create function public.preview_enrollment_session_transfer(p_membership_id uuid,p_to_classroom_id uuid,p_seat integer)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare m public.enrollments%rowtype; c public.classrooms%rowtype; origin public.classrooms%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  select * into m from public.enrollments where id=p_membership_id;
  if not found or m.status<>'active' then raise exception 'PLACEMENT_CHANGED'; end if;
  if not public.can_manage_classroom(m.classroom_id,auth.uid()) or not public.can_manage_classroom(p_to_classroom_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into c from public.classrooms where id=p_to_classroom_id;
  select * into origin from public.classrooms where id=m.classroom_id;
  if c.id is null or c.id=origin.id or c.course_id is distinct from origin.course_id or c.term_id is distinct from origin.term_id
    or m.term_id is distinct from c.term_id then raise exception 'CLASS_TARGET_MISMATCH'; end if;
  if c.trashed_at is not null or c.archived_at is not null or origin.trashed_at is not null or origin.archived_at is not null
    or c.purpose<>'production' or c.offering_type<>'long_term_formal' or c.operational_status not in('planning','active') then raise exception 'CLASS_NOT_AVAILABLE'; end if;
  if p_seat is null or p_seat<1 or p_seat>least(coalesce(c.capacity,60),60) then raise exception 'INVALID_SEAT'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId',target.id,'sourceSessionId',source.id,'lectureNo',target.lecture_no,'title',target.title,
    'scheduledAt',target.scheduled_at,'sourceScheduledAt',source.scheduled_at,
    'version',md5(jsonb_build_array(to_jsonb(m),to_jsonb(c),to_jsonb(origin),to_jsonb(target),to_jsonb(source),
      public.session_roster_source_hash(target.id),public.session_roster_source_hash(source.id),p_seat)::text),
    'blocked',case
      when source.id is null then 'SOURCE_SESSION_MISSING'
      when source.matches<>1 then 'SOURCE_SESSION_AMBIGUOUS'
      when source.started_at is not null or source.ended_at is not null or source.roster_revision>0 or target.roster_revision>0 then 'SESSION_LOCKED'
      when exists(select 1 from public.session_attendance a where a.session_id in(source.id,target.id) and a.student_id=m.student_id) then 'SESSION_LOCKED'
      when exists(select 1 from public.session_student_transfers t where t.cancelled_at is null and t.student_id=m.student_id
        and (t.from_session_id in(source.id,target.id) or t.to_session_id in(source.id,target.id))) then 'SESSION_TRANSFER_EXISTS'
      when exists(select 1 from public.enrollments e where e.classroom_id=c.id and e.status='active' and (e.student_id=m.student_id or e.placement_seat=p_seat))
        or exists(select 1 from public.session_student_transfers t where t.to_session_id=target.id and t.target_seat=p_seat and t.cancelled_at is null) then 'SEAT_OCCUPIED'
      when (select count(*) from public.current_session_roster_source(target.id))>=least(coalesce(c.capacity,60),60) then 'CLASS_FULL'
      else null end
  ) order by target.lecture_no nulls last,target.scheduled_at nulls last,target.id),'[]'::jsonb) into result
  from public.class_sessions target
  left join lateral (
    select s.*,count(*) over() matches from public.class_sessions s
    where s.classroom_id=m.classroom_id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
      and ((target.lecture_id is not null and s.lecture_id=target.lecture_id)
        or (target.lecture_id is null and target.lecture_no is not null and s.lecture_no=target.lecture_no))
    order by s.id limit 1
  ) source on true
  where target.classroom_id=c.id and target.deleted_at is null and target.cancelled_by is null and target.voided_at is null
    and target.started_at is null and target.ended_at is null;
  return result;
end $$;

-- 展示实际尚待上课的临时安排，原班长期座位仍由 enrollments 持有。
create function public.get_enrollment_session_transfers()
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'membershipId',t.membership_id,'studentId',t.student_id,'name',st.name,
    'fromClassroomId',s.classroom_id,'toClassroomId',d.classroom_id,'classroomName',c.name,'seat',t.target_seat,
    'lectureNo',d.lecture_no,'title',d.title,'scheduledAt',d.scheduled_at) order by d.scheduled_at nulls last,d.lecture_no,t.id),'[]'::jsonb)
    from public.session_student_transfers t join public.students st on st.id=t.student_id
    join public.class_sessions s on s.id=t.from_session_id join public.class_sessions d on d.id=t.to_session_id
    join public.classrooms c on c.id=d.classroom_id
    where t.cancelled_at is null and d.ended_at is null and d.deleted_at is null
      and public.can_manage_classroom(s.classroom_id,auth.uid()) and public.can_manage_classroom(d.classroom_id,auth.uid()));
end $$;

create function mathin_internal.cancel_pending_session_transfers(p_membership_id uuid,p_transfer_id uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.class_sessions s where s.id in(
    select from_session_id from public.session_student_transfers where membership_id=p_membership_id and cancelled_at is null and (p_transfer_id is null or id=p_transfer_id)
    union select to_session_id from public.session_student_transfers where membership_id=p_membership_id and cancelled_at is null and (p_transfer_id is null or id=p_transfer_id)
  ) order by s.id for update;
  if exists(select 1 from public.session_student_transfers t join public.class_sessions s on s.id in(t.from_session_id,t.to_session_id)
    where t.membership_id=p_membership_id and t.cancelled_at is null and (p_transfer_id is null or t.id=p_transfer_id)
      and s.started_at is null and s.roster_revision>0) then raise exception 'SESSION_LOCKED'; end if;
  update public.session_student_transfers set cancelled_at=clock_timestamp(),cancelled_by=auth.uid()
    where membership_id=p_membership_id and cancelled_at is null and (p_transfer_id is null or id=p_transfer_id);
end $$;
revoke all on function mathin_internal.cancel_pending_session_transfers(uuid,uuid) from public,anon,authenticated;

create function public.change_enrollment_placement(p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); mode text:=p_input->>'mode'; reason text:=btrim(coalesce(p_input->>'reason',''));
  member_id uuid:=(p_input->>'membershipId')::uuid; enrollment_id uuid:=(p_input->>'enrollmentId')::uuid;
  from_id uuid:=(p_input->>'fromClassroomId')::uuid; to_id uuid:=(p_input->>'toClassroomId')::uuid;
  seat integer:=(p_input->>'seat')::integer; m public.enrollments%rowtype; receipt mathin_internal.enrollment_placement_receipts%rowtype;
  c uuid; option jsonb; chosen jsonb; preview jsonb; result jsonb; ids uuid[]; transfer_id uuid:=(p_input->>'transferId')::uuid;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor,'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or mode is null or mode not in('permanent','temporary','withdraw','cancel_temporary') or char_length(reason)>2000
    or (mode='withdraw' and reason='') or (member_id is null and enrollment_id is null) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('placement-request:'||p_request_id::text,0));
  select * into receipt from mathin_internal.enrollment_placement_receipts where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor or receipt.payload<>p_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return receipt.result;
  end if;
  for c in select distinct x from unnest(array[from_id,to_id]) x where x is not null order by x loop
    if not public.can_manage_classroom(c,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||c::text,0));
  end loop;
  if member_id is not null then
    select * into m from public.enrollments where id=member_id for update;
    if not found or m.status<>'active' or m.classroom_id is distinct from from_id or m.placement_seat is distinct from (p_input->>'expectedSeat')::integer then raise exception 'PLACEMENT_CHANGED'; end if;
    if not public.can_manage_classroom(m.classroom_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end if;
  if member_id is null and enrollment_id is not null and not exists(select 1 from public.course_enrollments e
    where e.id=enrollment_id and public.can_access_student(e.student_id,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if mode='temporary' then
    if member_id is null or coalesce(jsonb_typeof(p_input->'sessions'),'null')<>'array' or jsonb_array_length(p_input->'sessions') not between 1 and 100 then raise exception 'VALIDATION'; end if;
    preview:=public.preview_enrollment_session_transfer(member_id,to_id,seat);
    select array_agg(distinct x) into ids from (
      select (o->>'sessionId')::uuid x from jsonb_array_elements(preview) o where o->>'sessionId' in(select e->>'sessionId' from jsonb_array_elements(p_input->'sessions') e)
      union select (o->>'sourceSessionId')::uuid from jsonb_array_elements(preview) o where o->>'sessionId' in(select e->>'sessionId' from jsonb_array_elements(p_input->'sessions') e)
    ) matched where x is not null;
    perform 1 from public.class_sessions where id=any(ids) order by id for update;
    preview:=public.preview_enrollment_session_transfer(member_id,to_id,seat);
    if (select count(distinct e->>'sessionId') from jsonb_array_elements(p_input->'sessions') e)<>jsonb_array_length(p_input->'sessions') then raise exception 'VALIDATION'; end if;
    if (select count(distinct o->>'sourceSessionId') from jsonb_array_elements(preview) o
      where o->>'sessionId' in(select e->>'sessionId' from jsonb_array_elements(p_input->'sessions') e))<>jsonb_array_length(p_input->'sessions') then raise exception 'SOURCE_SESSION_AMBIGUOUS'; end if;
    for chosen in select value from jsonb_array_elements(p_input->'sessions') loop
      select o into option from jsonb_array_elements(preview) o where o->>'sessionId'=chosen->>'sessionId';
      if option is null or option->>'version' is distinct from chosen->>'version' then raise exception 'PLACEMENT_CHANGED'; end if;
      if option->>'blocked' is not null then raise exception '%',option->>'blocked'; end if;
      insert into public.session_student_transfers(request_id,membership_id,student_id,from_session_id,to_session_id,target_seat,note,created_by)
        values(p_request_id,member_id,m.student_id,(option->>'sourceSessionId')::uuid,(option->>'sessionId')::uuid,seat,reason,actor);
    end loop;
  elsif mode='cancel_temporary' then
    if transfer_id is null or not exists(select 1 from public.session_student_transfers t join public.class_sessions s on s.id=t.to_session_id
      where t.id=transfer_id and t.membership_id=member_id and public.can_manage_classroom(s.classroom_id,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform mathin_internal.cancel_pending_session_transfers(member_id,transfer_id);
  elsif mode='withdraw' then
    if member_id is not null then
      perform mathin_internal.cancel_pending_session_transfers(member_id);
      if enrollment_id is null then select course_enrollment_id into enrollment_id from public.course_enrollment_assignments where classroom_membership_id=member_id and status='active'; end if;
      if enrollment_id is not null and not exists(select 1 from public.course_enrollment_assignments where classroom_membership_id=member_id and course_enrollment_id=enrollment_id and status='active') then raise exception 'PLACEMENT_CHANGED'; end if;
      perform public.withdraw_student(member_id,reason);
    elsif from_id is not null or exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=enrollment_id and status='active') then raise exception 'PLACEMENT_CHANGED'; end if;
    if enrollment_id is not null then perform public.cancel_course_enrollment(enrollment_id,reason,clock_timestamp()); end if;
  else
    if from_id is null or to_id is null or from_id=to_id or member_id is null then raise exception 'VALIDATION'; end if;
    perform mathin_internal.cancel_pending_session_transfers(member_id);
    enrollment_id:=public.move_enrollment_to_seat(enrollment_id,member_id,from_id,to_id,seat,(p_input->>'expectedSeat')::integer);
  end if;
  result:=jsonb_build_object('requestId',p_request_id,'mode',mode,'enrollmentId',enrollment_id);
  insert into mathin_internal.enrollment_placement_receipts(request_id,actor_id,payload,result) values(p_request_id,actor,p_input,result);
  perform public.emit_domain_event('enrollment.placement.'||mode,'enrollment',coalesce(member_id,enrollment_id),
    jsonb_build_object('requestId',p_request_id,'fromClassroomId',from_id,'toClassroomId',to_id,'reason',reason,'sessions',p_input->'sessions','transferId',transfer_id),null,'/dashboard/followups/enrollments');
  return result;
end $$;

-- 后续常规分班同样尊重未上课讲次已预约的目标座位。
create function public.guard_temporary_placement_seat()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||new.classroom_id::text,0));
  if new.status='active' and exists(select 1 from public.session_student_transfers t
    join public.class_sessions s on s.id=t.to_session_id
    where s.classroom_id=new.classroom_id and t.target_seat=new.placement_seat and t.student_id<>new.student_id
      and t.cancelled_at is null and s.ended_at is null and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null)
    then raise exception 'TEMPORARY_SEAT_RESERVED'; end if;
  return new;
end $$;
revoke all on function public.guard_temporary_placement_seat() from public,anon,authenticated;
create trigger enrollment_temporary_seat_guard after insert or update of classroom_id,status,placement_seat on public.enrollments
  for each row execute function public.guard_temporary_placement_seat();

create or replace function public.default_enrollment_placement_seat() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='active' and new.placement_seat is null then
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||new.classroom_id::text,0));
    select slot into new.placement_seat from generate_series(1,greatest(60,
      (select coalesce(max(placement_seat),0)+1 from public.enrollments where classroom_id=new.classroom_id and status='active'))) slot
    where not exists(select 1 from public.enrollments where classroom_id=new.classroom_id and status='active' and placement_seat=slot)
      and not exists(select 1 from public.session_student_transfers t join public.class_sessions s on s.id=t.to_session_id
        where s.classroom_id=new.classroom_id and t.target_seat=slot and t.cancelled_at is null and s.ended_at is null and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null)
    order by slot limit 1;
  end if;
  return new;
end $$;

create function public.close_membership_session_transfers()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='active' and new.status<>'active' then perform mathin_internal.cancel_pending_session_transfers(old.id); end if;
  return new;
end $$;
revoke all on function public.close_membership_session_transfers() from public,anon,authenticated;
create trigger enrollment_close_session_transfers before update of status on public.enrollments
  for each row execute function public.close_membership_session_transfers();

-- 档案合并继续按既有唯一键冲突检查处理临时调班，原请求收据保留原始身份。
do $patch$ declare body text;
begin
  body:=pg_get_functiondef('mathin_internal.student_merge_relations()'::regprocedure);
  if position('(''student_merge_audits'',''kept_id''' in body)=0 then raise exception 'MERGE_RELATIONS_PATCH_DRIFT'; end if;
  execute replace(body,'(''student_merge_audits'',''kept_id''','(''session_student_transfers'',''student_id'',''teaching'',''move'',147), (''student_merge_audits'',''kept_id''');
end $patch$;

revoke all on function public.preview_enrollment_session_transfer(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.get_enrollment_session_transfers() from public,anon,authenticated;
revoke all on function public.change_enrollment_placement(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.preview_enrollment_session_transfer(uuid,uuid,integer) to authenticated;
grant execute on function public.get_enrollment_session_transfers() to authenticated;
grant execute on function public.change_enrollment_placement(uuid,jsonb) to authenticated;
select pg_notify('pgrst','reload schema');
