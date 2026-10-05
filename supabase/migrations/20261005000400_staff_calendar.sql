-- 内部日历保留独立事实；仅组织者和受邀人可读取详情。
create table public.staff_calendar_events (
  id uuid primary key,
  kind text not null check (kind in ('meeting','task','preparation')),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description)<=8000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '' check (length(location)<=300),
  campus_id uuid references public.campuses(id) on delete restrict,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  organizer_id uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint staff_calendar_event_time_check check (isfinite(starts_at) and isfinite(ends_at)
    and ends_at>starts_at and ends_at<=starts_at+interval '31 days')
);
create table public.staff_calendar_attendees (
  event_id uuid not null references public.staff_calendar_events(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  response text not null default 'pending' check (response in ('pending','accepted','declined')),
  completed_at timestamptz,
  responded_at timestamptz,
  primary key(event_id,user_id),
  check (completed_at is null or response='accepted')
);
create index staff_calendar_events_organizer_time_idx on public.staff_calendar_events(organizer_id,starts_at,ends_at);
create index staff_calendar_events_busy_time_idx on public.staff_calendar_events(starts_at,ends_at) where status='scheduled' and kind<>'task';
create index staff_calendar_attendees_user_idx on public.staff_calendar_attendees(user_id,event_id);

create function public.staff_calendar_can_view(p_event_id uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.is_staff(auth.uid()) and exists(select 1 from public.staff_calendar_events e
    where e.id=p_event_id and (e.organizer_id=auth.uid()
      or exists(select 1 from public.staff_calendar_attendees a where a.event_id=e.id and a.user_id=auth.uid())));
$$;
alter table public.staff_calendar_events enable row level security;
alter table public.staff_calendar_attendees enable row level security;
revoke all on public.staff_calendar_events,public.staff_calendar_attendees from public,anon,authenticated;
grant select on public.staff_calendar_events,public.staff_calendar_attendees to authenticated;
create policy staff_calendar_events_select on public.staff_calendar_events for select to authenticated
  using(public.staff_calendar_can_view(id));
create policy staff_calendar_attendees_select on public.staff_calendar_attendees for select to authenticated
  using(public.staff_calendar_can_view(event_id));

-- 所有占用入口共用 assessment-teacher 锁。VOLATILE 让等待锁后的检查看到新提交。
create function public.staff_calendar_internal_busy(p_user uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_except_event uuid default null)
returns boolean language sql security definer volatile set search_path=public,pg_temp as $$
  select exists(select 1 from public.staff_calendar_events e
    where e.id is distinct from p_except_event and e.status='scheduled' and e.kind<>'task'
      and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
      and (e.organizer_id=p_user or exists(select 1 from public.staff_calendar_attendees a
        where a.event_id=e.id and a.user_id=p_user and a.response<>'declined')));
$$;

-- 代课替换主讲；助教仍是这节课的实际参与者。无主讲关系时沿用班级负责人。
create function public.staff_calendar_session_teachers(p_classroom uuid,p_override uuid)
returns setof uuid language sql security definer volatile set search_path=public,pg_temp as $$
  select distinct teacher_id from (
    select coalesce(p_override,(select user_id from public.classroom_staff_assignments
      where classroom_id=p_classroom and responsibility='primary_teacher' order by created_at,user_id limit 1),
      (select owner_id from public.classrooms where id=p_classroom)) teacher_id
    union all select user_id from public.classroom_staff_assignments
      where classroom_id=p_classroom and responsibility='assistant_teacher'
  ) teachers where teacher_id is not null;
$$;

create function public.staff_calendar_time_busy(p_user uuid,p_starts_at timestamptz,p_ends_at timestamptz,
  p_except_invitation uuid default null,p_except_event uuid default null,p_include_sessions boolean default true)
returns boolean language sql security definer volatile set search_path=public,pg_temp as $$
  select public.staff_calendar_internal_busy(p_user,p_starts_at,p_ends_at,p_except_event)
    or exists(select 1 from public.lead_invitation_threads t left join public.assessment_slots s on s.id=t.assessment_slot_id
      where t.assessor_id=p_user and t.kind='assessment_1v1' and t.scheduled_at is not null
        and t.state in ('awaiting_parent','confirmed','completed') and t.id is distinct from p_except_invitation
        and tstzrange(t.scheduled_at,coalesce(s.ends_at,t.scheduled_at+interval '40 minutes'),'[)') && tstzrange(p_starts_at,p_ends_at,'[)'))
    or (p_include_sessions and exists(select 1 from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
      where s.deleted_at is null and s.cancelled_by is null and s.voided_at is null and c.trashed_at is null
        and s.scheduled_at is not null and s.duration_min>0
        and tstzrange(s.scheduled_at,s.scheduled_at+make_interval(mins=>s.duration_min),'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
        and p_user in(select public.staff_calendar_session_teachers(s.classroom_id,s.teacher_override))));
$$;
create or replace function public.assessment_teacher_time_busy(p_teacher uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_except_invitation uuid default null)
returns boolean language sql security definer volatile set search_path=public,pg_temp as $$
  select public.staff_calendar_time_busy(p_teacher,p_starts_at,p_ends_at,p_except_invitation);
$$;

-- 旧协调邀约也检查内部安排和课次；继续保留已有两条旧邀约的兼容语义。
create or replace function public.guard_assessment_slot_booking() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_slot public.assessment_slots%rowtype; v_teacher uuid; v_end timestamptz;
begin
  if tg_op='UPDATE' and old.assessment_slot_id is not null
    and (new.assessment_slot_id,new.assessor_id,new.scheduled_at,new.kind,new.lead_id,new.location_text)
      is distinct from (old.assessment_slot_id,old.assessor_id,old.scheduled_at,old.kind,old.lead_id,old.location_text)
    then raise exception 'SLOT_BOOKING_IMMUTABLE'; end if;
  for v_teacher in select distinct id from unnest(array[new.assessor_id,case when tg_op='UPDATE' then old.assessor_id end]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  if new.assessment_slot_id is not null then
    select * into v_slot from public.assessment_slots where id=new.assessment_slot_id for share;
    if v_slot.id is null or new.assessor_id is distinct from v_slot.teacher_id or new.scheduled_at is distinct from v_slot.starts_at
      or new.parent_request_payload->>'assessorId' is distinct from v_slot.teacher_id::text
      or (new.parent_request_payload->>'endsAt')::timestamptz is distinct from v_slot.ends_at
      or new.parent_request_payload#>>'{campus,id}' is distinct from v_slot.campus_id::text
      then raise exception 'SLOT_BOOKING_IMMUTABLE'; end if;
    if tg_op='INSERT' and (not v_slot.enabled or v_slot.starts_at<=now()) then raise exception 'SLOT_UNAVAILABLE'; end if;
    v_end:=v_slot.ends_at;
  else v_end:=new.scheduled_at+interval '40 minutes'; end if;
  if new.kind='assessment_1v1' and new.scheduled_at is not null and new.state in ('awaiting_parent','confirmed','completed') then
    if new.assessment_slot_id is not null then
      if public.assessment_teacher_time_busy(new.assessor_id,new.scheduled_at,v_end,new.id) then raise exception 'TIME_UNAVAILABLE'; end if;
    elsif public.staff_calendar_internal_busy(new.assessor_id,new.scheduled_at,v_end)
      or exists(select 1 from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
        where s.deleted_at is null and s.cancelled_by is null and s.voided_at is null and c.trashed_at is null
          and s.scheduled_at is not null and s.duration_min>0
          and tstzrange(s.scheduled_at,s.scheduled_at+make_interval(mins=>s.duration_min),'[)') && tstzrange(new.scheduled_at,v_end,'[)')
          and new.assessor_id in(select public.staff_calendar_session_teachers(s.classroom_id,s.teacher_override)))
      or exists(select 1 from public.lead_invitation_threads t join public.assessment_slots s on s.id=t.assessment_slot_id
        where t.id<>new.id and t.assessor_id=new.assessor_id and t.state<>'cancelled'
          and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.scheduled_at,v_end,'[)'))
      then raise exception 'TIME_UNAVAILABLE'; end if;
  end if;
  return new;
end $$;

-- 反向入口：排课/改期与预约、会议等待同一教师锁，不能先读到空闲后同时写入。
create function public.guard_staff_calendar_session_time() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_teacher uuid;
begin
  if tg_op='UPDATE' and (new.classroom_id,new.teacher_override,new.scheduled_at,new.duration_min,new.deleted_at,new.cancelled_by,new.voided_at)
    is not distinct from (old.classroom_id,old.teacher_override,old.scheduled_at,old.duration_min,old.deleted_at,old.cancelled_by,old.voided_at) then return new; end if;
  for v_teacher in select distinct teacher from (
    select public.staff_calendar_session_teachers(new.classroom_id,new.teacher_override) teacher
    union all select public.staff_calendar_session_teachers(old.classroom_id,old.teacher_override) where tg_op='UPDATE'
  ) ids order by teacher loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  if new.deleted_at is null and new.cancelled_by is null and new.voided_at is null and new.scheduled_at is not null and new.duration_min>0
    and exists(select 1 from public.classrooms where id=new.classroom_id and trashed_at is null) then
    for v_teacher in select public.staff_calendar_session_teachers(new.classroom_id,new.teacher_override) loop
      if public.staff_calendar_time_busy(v_teacher,new.scheduled_at,new.scheduled_at+make_interval(mins=>new.duration_min),null,null,false)
        then raise exception 'TIME_UNAVAILABLE'; end if;
    end loop;
  end if;
  return new;
end $$;
create trigger class_sessions_staff_calendar_guard before insert or update of classroom_id,teacher_override,scheduled_at,duration_min,deleted_at,cancelled_by,voided_at
  on public.class_sessions for each row execute function public.guard_staff_calendar_session_time();

-- 换主讲、助教或恢复班级同样会改变未来课次占用；在关系事务内检查实际教师。
create function public.guard_staff_calendar_classroom_teachers() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_classes uuid[]; v_people uuid[]; v_previous uuid[]; v_teacher uuid; v_session public.class_sessions%rowtype;
begin
  if tg_table_name='classrooms' then
    if (new.owner_id,new.trashed_at) is not distinct from (old.owner_id,old.trashed_at) then return null; end if;
    v_classes:=array[new.id]; v_people:=array[new.owner_id,old.owner_id];
  else
    if tg_op='UPDATE' and (new.classroom_id,new.user_id,new.responsibility) is not distinct from (old.classroom_id,old.user_id,old.responsibility) then return null; end if;
    if (tg_op='INSERT' and new.responsibility='learning_support') or (tg_op='DELETE' and old.responsibility='learning_support')
      or (tg_op='UPDATE' and new.responsibility='learning_support' and old.responsibility='learning_support') then return null; end if;
    v_classes:=array[case when tg_op<>'DELETE' then new.classroom_id end,case when tg_op<>'INSERT' then old.classroom_id end];
    v_people:=array[case when tg_op<>'DELETE' then new.user_id end,case when tg_op<>'INSERT' then old.user_id end];
  end if;
  for v_teacher in select distinct person from (
    select unnest(v_people) person union all
    select public.staff_calendar_session_teachers(s.classroom_id,s.teacher_override) from public.class_sessions s
      where s.classroom_id=any(v_classes) and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
        and s.scheduled_at is not null and s.duration_min>0 and s.scheduled_at+make_interval(mins=>s.duration_min)>now()
  ) people where person is not null order by person loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  for v_session in select s.* from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
    where s.classroom_id=any(v_classes) and c.trashed_at is null and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
      and s.scheduled_at is not null and s.duration_min>0 and s.scheduled_at+make_interval(mins=>s.duration_min)>now() loop
    -- 只校验这次关系变更新增的实际参与人，既有课次/教师保持原业务事实。
    if tg_table_name='classrooms' then
      if old.trashed_at is not null then v_previous:='{}';
      else
        v_previous:=array(select distinct person from (
          select coalesce(v_session.teacher_override,(select user_id from public.classroom_staff_assignments
            where classroom_id=v_session.classroom_id and responsibility='primary_teacher' order by created_at,user_id limit 1),old.owner_id) person
          union all select user_id from public.classroom_staff_assignments where classroom_id=v_session.classroom_id and responsibility='assistant_teacher'
        ) previous_people);
      end if;
    else
      with previous_assignments as (
        select a.user_id,a.responsibility,a.created_at from public.classroom_staff_assignments a where a.classroom_id=v_session.classroom_id
          and not (tg_op<>'DELETE' and (a.classroom_id,a.user_id,a.responsibility)=(new.classroom_id,new.user_id,new.responsibility))
        union all select old.user_id,old.responsibility,old.created_at where tg_op<>'INSERT' and old.classroom_id=v_session.classroom_id
      ), previous_people as (
        select coalesce(v_session.teacher_override,(select user_id from previous_assignments where responsibility='primary_teacher' order by created_at,user_id limit 1),
          (select owner_id from public.classrooms where id=v_session.classroom_id)) person
        union all select user_id from previous_assignments where responsibility='assistant_teacher'
      ) select array_agg(distinct person) into v_previous from previous_people where person is not null;
    end if;
    for v_teacher in select person from public.staff_calendar_session_teachers(v_session.classroom_id,v_session.teacher_override) person
      where not person=any(coalesce(v_previous,'{}')) loop
      if public.staff_calendar_time_busy(v_teacher,v_session.scheduled_at,v_session.scheduled_at+make_interval(mins=>v_session.duration_min),null,null,false)
        then raise exception 'TIME_UNAVAILABLE'; end if;
    end loop;
  end loop;
  return null;
end $$;
create trigger classroom_assignments_staff_calendar_guard after insert or update or delete
  on public.classroom_staff_assignments for each row execute function public.guard_staff_calendar_classroom_teachers();
create trigger classroom_owner_staff_calendar_guard after update of owner_id,trashed_at
  on public.classrooms for each row execute function public.guard_staff_calendar_classroom_teachers();

create function public.staff_calendar_event_projection(p_id uuid) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'description',e.description,
    'startsAt',e.starts_at,'endsAt',e.ends_at,'location',e.location,'campusId',e.campus_id,'status',e.status,
    'organizerId',e.organizer_id,'organizerName',p.display_name,'updatedAt',e.updated_at,'canEdit',e.organizer_id=auth.uid(),
    'canComplete',e.status='scheduled' and e.kind='task' and exists(select 1 from public.staff_calendar_attendees a
      where a.event_id=e.id and a.user_id=auth.uid() and a.response<>'declined' and a.completed_at is null),
    'myCompletedAt',(select completed_at from public.staff_calendar_attendees where event_id=e.id and user_id=auth.uid()),
    'attendees',coalesce((select jsonb_agg(jsonb_build_object('userId',a.user_id,'displayName',p2.display_name,
      'response',a.response,'completedAt',a.completed_at) order by p2.display_name,a.user_id)
      from public.staff_calendar_attendees a join public.profiles p2 on p2.id=a.user_id where a.event_id=e.id),'[]'))
  from public.staff_calendar_events e join public.profiles p on p.id=e.organizer_id where e.id=p_id and public.staff_calendar_can_view(e.id);
$$;
create function public.get_calendar_workspace(p_from timestamptz,p_to timestamptz) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to>p_from+interval '370 days'
    then raise exception 'VALIDATION'; end if;
  return jsonb_build_object('currentUserId',v_uid,'canCreate',true,
    'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',display_name) order by display_name,id),'[]')
      from public.profiles where public.is_staff(id)),
    'events',(select coalesce(jsonb_agg(public.staff_calendar_event_projection(e.id) order by e.starts_at,e.id),'[]')
      from public.staff_calendar_events e where e.starts_at<p_to and e.ends_at>p_from and public.staff_calendar_can_view(e.id)));
end $$;

create function public.save_calendar_event(p_id uuid,p_kind text,p_title text,p_description text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_location text,p_attendee_ids uuid[],p_campus_id uuid default null,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_event public.staff_calendar_events%rowtype; v_attendees uuid[]; v_previous uuid[]; v_person uuid; v_reset boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_kind is null or p_kind not in ('meeting','task','preparation') or p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_description is null or length(p_description)>8000 or p_location is null or length(btrim(p_location))>300
    or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '31 days' or p_attendee_ids is null or cardinality(p_attendee_ids)>100
    or (cardinality(p_attendee_ids)>0 and array_ndims(p_attendee_ids)<>1) or array_position(p_attendee_ids,null) is not null
    then raise exception 'VALIDATION'; end if;
  v_attendees:=array(select distinct unnest(p_attendee_ids) order by 1);
  if cardinality(v_attendees)<>cardinality(p_attendee_ids) then raise exception 'VALIDATION'; end if;
  if p_kind='task' and cardinality(v_attendees)=0 then v_attendees:=array[v_uid]; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-calendar-event:'||p_id::text,0));
  select * into v_event from public.staff_calendar_events where id=p_id for update;
  if v_event.id is not null and v_event.organizer_id<>v_uid then raise exception 'FORBIDDEN'; end if;
  v_previous:=array(select user_id from public.staff_calendar_attendees where event_id=p_id order by user_id);
  if v_event.id is not null then
    if (p_expected_updated_at=v_event.updated_at or p_expected_updated_at is null)
      and (v_event.kind,v_event.title,v_event.description,v_event.starts_at,v_event.ends_at,v_event.location,v_event.campus_id,v_previous)
        is not distinct from (p_kind,btrim(p_title),p_description,p_starts_at,p_ends_at,btrim(p_location),p_campus_id,v_attendees)
      then return public.staff_calendar_event_projection(p_id); end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_event.updated_at then raise exception 'CONFLICT'; end if;
    if v_event.status<>'scheduled' then raise exception 'EVENT_CLOSED'; end if;
  elsif p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from unnest(v_attendees) person where not public.is_staff(person)) then raise exception 'ATTENDEE_UNAVAILABLE'; end if;
  if p_campus_id is not null and not exists(select 1 from public.campuses where id=p_campus_id and status='active') then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  for v_person in select distinct person from unnest(v_attendees||v_previous||array[v_uid]) person order by person loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_person::text,0));
  end loop;
  v_reset:=v_event.id is null or (v_event.kind,v_event.starts_at,v_event.ends_at,v_event.location,v_event.campus_id)
    is distinct from (p_kind,p_starts_at,p_ends_at,btrim(p_location),p_campus_id);
  if p_kind<>'task' then
    for v_person in select distinct person from unnest(v_attendees||array[v_uid]) person
      where person=v_uid or v_reset or not exists(select 1 from public.staff_calendar_attendees where event_id=p_id and user_id=person and response='declined') loop
      if public.staff_calendar_time_busy(v_person,p_starts_at,p_ends_at,null,p_id) then raise exception 'TIME_UNAVAILABLE'; end if;
    end loop;
  end if;
  if v_event.id is null then
    insert into public.staff_calendar_events(id,kind,title,description,starts_at,ends_at,location,campus_id,organizer_id,updated_by)
      values(p_id,p_kind,btrim(p_title),p_description,p_starts_at,p_ends_at,btrim(p_location),p_campus_id,v_uid,v_uid);
  else
    update public.staff_calendar_events set kind=p_kind,title=btrim(p_title),description=p_description,starts_at=p_starts_at,ends_at=p_ends_at,
      location=btrim(p_location),campus_id=p_campus_id,updated_by=v_uid,updated_at=clock_timestamp() where id=p_id;
  end if;
  delete from public.staff_calendar_attendees where event_id=p_id and not user_id=any(v_attendees);
  insert into public.staff_calendar_attendees(event_id,user_id,response) select p_id,person,case when person=v_uid then 'accepted' else 'pending' end from unnest(v_attendees) person
    on conflict(event_id,user_id) do update set
      response=case when v_reset then excluded.response else staff_calendar_attendees.response end,
      completed_at=case when v_reset then null else staff_calendar_attendees.completed_at end,
      responded_at=case when v_reset then null else staff_calendar_attendees.responded_at end;
  if p_kind='task' and exists(select 1 from public.staff_calendar_attendees where event_id=p_id and response<>'declined')
    and not exists(select 1 from public.staff_calendar_attendees where event_id=p_id and response<>'declined' and completed_at is null) then
    update public.staff_calendar_events set status='completed' where id=p_id;
  end if;
  return public.staff_calendar_event_projection(p_id);
end $$;

create function public.change_calendar_event_status(p_id uuid,p_status text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_event public.staff_calendar_events%rowtype; v_person uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_status is null or p_status not in ('scheduled','completed','cancelled') or p_expected_updated_at is null then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-calendar-event:'||p_id::text,0));
  select * into v_event from public.staff_calendar_events where id=p_id for update;
  if v_event.id is null then raise exception 'NOT_FOUND'; end if;
  if v_event.organizer_id<>v_uid and not (v_event.kind='task' and p_status in ('completed','scheduled')
    and exists(select 1 from public.staff_calendar_attendees where event_id=p_id and user_id=v_uid and response<>'declined')) then raise exception 'FORBIDDEN'; end if;
  if p_expected_updated_at is distinct from v_event.updated_at then raise exception 'CONFLICT'; end if;
  for v_person in select distinct person from (
    select v_event.organizer_id person union all select user_id from public.staff_calendar_attendees where event_id=p_id
  ) persons order by person loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_person::text,0));
  end loop;
  if v_event.kind='task' and p_status='completed' then
    if v_event.status='cancelled' then raise exception 'EVENT_CLOSED'; end if;
    if not exists(select 1 from public.staff_calendar_attendees where event_id=p_id and user_id=v_uid and response<>'declined') then raise exception 'FORBIDDEN'; end if;
    update public.staff_calendar_attendees set response='accepted',responded_at=coalesce(responded_at,clock_timestamp()),completed_at=coalesce(completed_at,clock_timestamp())
      where event_id=p_id and user_id=v_uid;
    p_status:=case when exists(select 1 from public.staff_calendar_attendees where event_id=p_id and response<>'declined' and completed_at is null) then 'scheduled' else 'completed' end;
  elsif v_event.kind='task' and p_status='scheduled' then
    if v_event.organizer_id<>v_uid and v_event.status='cancelled' then raise exception 'FORBIDDEN'; end if;
    update public.staff_calendar_attendees set completed_at=null where event_id=p_id and (v_event.organizer_id=v_uid or user_id=v_uid);
  elsif p_status='scheduled' then
    for v_person in select distinct person from (
      select v_event.organizer_id person union all select user_id from public.staff_calendar_attendees where event_id=p_id and response<>'declined'
    ) persons loop
      if public.staff_calendar_time_busy(v_person,v_event.starts_at,v_event.ends_at,null,p_id) then raise exception 'TIME_UNAVAILABLE'; end if;
    end loop;
  end if;
  update public.staff_calendar_events set status=p_status,updated_by=v_uid,updated_at=clock_timestamp() where id=p_id;
  return public.staff_calendar_event_projection(p_id);
end $$;

create function public.respond_calendar_invitation(p_id uuid,p_response text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_event public.staff_calendar_events%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_response is null or p_response not in ('accepted','declined') then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-calendar-event:'||p_id::text,0));
  select * into v_event from public.staff_calendar_events where id=p_id for update;
  if v_event.id is null then raise exception 'NOT_FOUND'; end if;
  if v_event.organizer_id=v_uid or not exists(select 1 from public.staff_calendar_attendees where event_id=p_id and user_id=v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_event.status<>'scheduled' then raise exception 'EVENT_CLOSED'; end if;
  if exists(select 1 from public.staff_calendar_attendees where event_id=p_id and user_id=v_uid and response=p_response) then return public.staff_calendar_event_projection(p_id); end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_uid::text,0));
  if p_response='accepted' and v_event.kind<>'task' and public.staff_calendar_time_busy(v_uid,v_event.starts_at,v_event.ends_at,null,p_id) then raise exception 'TIME_UNAVAILABLE'; end if;
  update public.staff_calendar_attendees set response=p_response,responded_at=clock_timestamp(),completed_at=null where event_id=p_id and user_id=v_uid;
  update public.staff_calendar_events set updated_by=v_uid,updated_at=clock_timestamp(),status=case
    when kind='task' and exists(select 1 from public.staff_calendar_attendees where event_id=p_id and response<>'declined')
      and not exists(select 1 from public.staff_calendar_attendees where event_id=p_id and response<>'declined' and completed_at is null) then 'completed'
    else status end where id=p_id;
  return public.staff_calendar_event_projection(p_id);
end $$;

-- 管理列表解释被内部安排/课次占用的已发布时间；家长投影沿用 available，不泄露内部详情。
create or replace function public.assessment_slot_projection(p_slot public.assessment_slots) returns jsonb
language sql security definer volatile set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_slot.id,'teacherId',p_slot.teacher_id,'campusId',p_slot.campus_id,
    'subjects',p_slot.subjects,'grades',p_slot.grades,'startsAt',p_slot.starts_at,'endsAt',p_slot.ends_at,
    'enabled',p_slot.enabled,'booked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id),
    'activeBooked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled'),
    'blocked',public.assessment_teacher_time_busy(p_slot.teacher_id,p_slot.starts_at,p_slot.ends_at,
      (select id from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled' limit 1)),
    'updatedAt',p_slot.updated_at);
$$;

revoke all on function public.staff_calendar_can_view(uuid),public.staff_calendar_internal_busy(uuid,timestamptz,timestamptz,uuid),
  public.staff_calendar_session_teachers(uuid,uuid),public.staff_calendar_time_busy(uuid,timestamptz,timestamptz,uuid,uuid,boolean),
  public.guard_staff_calendar_session_time(),public.guard_staff_calendar_classroom_teachers(),public.staff_calendar_event_projection(uuid),public.get_calendar_workspace(timestamptz,timestamptz),
  public.save_calendar_event(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz),
  public.change_calendar_event_status(uuid,text,timestamptz),public.respond_calendar_invitation(uuid,text)
  from public,anon,authenticated;
grant execute on function public.staff_calendar_can_view(uuid),public.get_calendar_workspace(timestamptz,timestamptz),
  public.save_calendar_event(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz),
  public.change_calendar_event_status(uuid,text,timestamptz),public.respond_calendar_invitation(uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');
