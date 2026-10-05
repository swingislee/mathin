-- 年度规划与重复安排继续沿用参与人范围；规划和里程碑只表达计划，不占用教师。
alter table public.staff_calendar_events drop constraint staff_calendar_events_kind_check;
alter table public.staff_calendar_events add constraint staff_calendar_events_kind_check
  check (kind in ('meeting','task','preparation','strategy','milestone'));
alter table public.staff_calendar_events drop constraint staff_calendar_event_time_check;
alter table public.staff_calendar_events add constraint staff_calendar_event_time_check check (
  isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at
  and ends_at<=starts_at+case when kind='strategy' then interval '370 days' else interval '31 days' end
  and (kind<>'milestone' or ends_at=starts_at+interval '30 minutes')
);
alter table public.staff_calendar_events
  add column series_id uuid references public.staff_calendar_events(id) on delete restrict,
  add column recurrence jsonb,
  add constraint staff_calendar_events_series_check check (
    (series_id is null and recurrence is null)
    or (series_id is not null and jsonb_typeof(recurrence)='object')
  );
create index staff_calendar_events_series_idx on public.staff_calendar_events(series_id,starts_at) where series_id is not null;
drop index public.staff_calendar_events_busy_time_idx;
create index staff_calendar_events_busy_time_idx on public.staff_calendar_events(starts_at,ends_at)
  where status='scheduled' and kind in ('meeting','preparation');

create or replace function public.staff_calendar_internal_busy(p_user uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_except_event uuid default null)
returns boolean language sql security definer volatile set search_path=public,pg_temp as $$
  select exists(select 1 from public.staff_calendar_events e
    where e.id is distinct from p_except_event and e.status='scheduled' and e.kind in ('meeting','preparation')
      and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
      and (e.organizer_id=p_user or exists(select 1 from public.staff_calendar_attendees a
        where a.event_id=e.id and a.user_id=p_user and a.response<>'declined')));
$$;

-- 以首个本地日期为锚点，月末自动钳位；跨夏令时仍保持该时区的本地时刻。
create function public.staff_calendar_recurrence_starts(p_starts_at timestamptz,p_recurrence jsonb)
returns setof timestamptz language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_frequency text; v_interval int; v_until date; v_zone text; v_anchor timestamp; v_next timestamp; v_index int:=0;
begin
  if p_starts_at is null or not isfinite(p_starts_at) then raise exception 'VALIDATION'; end if;
  if p_recurrence is null then return next p_starts_at; return; end if;
  if jsonb_typeof(p_recurrence) is distinct from 'object' then raise exception 'VALIDATION'; end if;
  if not p_recurrence ?& array['frequency','interval','until','timeZone']
    or (select count(*) from jsonb_object_keys(p_recurrence))<>4
    or jsonb_typeof(p_recurrence->'frequency') is distinct from 'string'
    or jsonb_typeof(p_recurrence->'interval') is distinct from 'number'
    or jsonb_typeof(p_recurrence->'until') is distinct from 'string'
    or jsonb_typeof(p_recurrence->'timeZone') is distinct from 'string' then raise exception 'VALIDATION'; end if;
  v_frequency:=p_recurrence->>'frequency'; v_zone:=p_recurrence->>'timeZone';
  if v_frequency not in ('daily','weekly','monthly')
    or (p_recurrence->>'interval')::numeric not between 1 and 12
    or (p_recurrence->>'interval')::numeric<>trunc((p_recurrence->>'interval')::numeric)
    or p_recurrence->>'until' !~ '^\d{4}-\d{2}-\d{2}$'
    or not exists(select 1 from pg_timezone_names where name=v_zone) then raise exception 'VALIDATION'; end if;
  v_interval:=(p_recurrence->>'interval')::int;
  begin v_until:=(p_recurrence->>'until')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
  v_anchor:=p_starts_at at time zone v_zone;
  if v_until<v_anchor::date or v_until>v_anchor::date+370 then raise exception 'VALIDATION'; end if;
  loop
    v_next:=v_anchor+case v_frequency
      when 'daily' then make_interval(days=>v_index*v_interval)
      when 'weekly' then make_interval(days=>v_index*v_interval*7)
      else make_interval(months=>v_index*v_interval) end;
    exit when v_next::date>v_until;
    if v_index>=400 then raise exception 'VALIDATION'; end if;
    -- Preserve the exact first instant in an ambiguous DST hour.
    return next case when v_index=0 then p_starts_at else v_next at time zone v_zone end;
    v_index:=v_index+1;
  end loop;
end $$;

create function public.staff_calendar_school_windows_valid(p_windows jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare v_window jsonb;
begin
  if jsonb_typeof(p_windows) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_windows)>70 then return false; end if;
  for v_window in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(v_window) is distinct from 'object' then return false; end if;
    if not v_window ?& array['weekday','startMinute','endMinute']
      or (select count(*) from jsonb_object_keys(v_window))<>3
      or jsonb_typeof(v_window->'weekday') is distinct from 'number'
      or jsonb_typeof(v_window->'startMinute') is distinct from 'number'
      or jsonb_typeof(v_window->'endMinute') is distinct from 'number' then return false; end if;
    if (v_window->>'weekday')::numeric not between 0 and 6
      or (v_window->>'startMinute')::numeric not between 0 and 1439
      or (v_window->>'endMinute')::numeric not between 1 and 1440
      or (v_window->>'weekday')::numeric<>trunc((v_window->>'weekday')::numeric)
      or (v_window->>'startMinute')::numeric<>trunc((v_window->>'startMinute')::numeric)
      or (v_window->>'endMinute')::numeric<>trunc((v_window->>'endMinute')::numeric)
      or (v_window->>'endMinute')::numeric<=(v_window->>'startMinute')::numeric then return false; end if;
  end loop;
  return not exists(select 1 from jsonb_array_elements(p_windows) with ordinality a(item,position)
    join jsonb_array_elements(p_windows) with ordinality b(item,position) on b.position>a.position
    where (a.item->>'weekday')::int=(b.item->>'weekday')::int
      and (a.item->>'startMinute')::int<(b.item->>'endMinute')::int
      and (b.item->>'startMinute')::int<(a.item->>'endMinute')::int);
end $$;

create table public.staff_calendar_settings (
  singleton_key smallint primary key default 1 check(singleton_key=1),
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  school_windows jsonb not null default '[]' check(public.staff_calendar_school_windows_valid(school_windows)),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id) on delete restrict
);
insert into public.staff_calendar_settings(singleton_key,organization_id)
  select 1,id from public.organizations where singleton_key=1;
alter table public.staff_calendar_settings enable row level security;
revoke all on public.staff_calendar_settings from public,anon,authenticated;
grant select on public.staff_calendar_settings to authenticated;
create function public.staff_calendar_settings_can_view(p_organization_id uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.is_staff(auth.uid()) and exists(select 1 from public.organizations
    where singleton_key=1 and id=p_organization_id);
$$;
create policy staff_calendar_settings_select on public.staff_calendar_settings for select to authenticated
  using(public.staff_calendar_settings_can_view(organization_id));

create function public.save_calendar_school_windows(p_school_windows jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_settings public.staff_calendar_settings%rowtype; v_windows jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) or not public.has_perm(v_uid,'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if not public.staff_calendar_school_windows_valid(p_school_windows) then raise exception 'VALIDATION'; end if;
  select coalesce(jsonb_agg(item order by (item->>'weekday')::int,(item->>'startMinute')::int,(item->>'endMinute')::int),'[]')
    into v_windows from jsonb_array_elements(p_school_windows) item;
  select * into v_settings from public.staff_calendar_settings where singleton_key=1
    and organization_id=(select id from public.organizations where singleton_key=1) for update;
  if v_settings.singleton_key is null then raise exception 'NOT_FOUND'; end if;
  if v_settings.school_windows is not distinct from v_windows then
    return jsonb_build_object('schoolWindows',v_settings.school_windows,'updatedAt',v_settings.updated_at);
  end if;
  if p_expected_updated_at is distinct from v_settings.updated_at and not (p_expected_updated_at is null and v_settings.updated_by is null)
    then raise exception 'CONFLICT'; end if;
  update public.staff_calendar_settings set school_windows=v_windows,updated_by=v_uid,updated_at=clock_timestamp()
    where singleton_key=1 returning * into v_settings;
  return jsonb_build_object('schoolWindows',v_settings.school_windows,'updatedAt',v_settings.updated_at);
end $$;

create or replace function public.staff_calendar_event_projection(p_id uuid) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'description',e.description,
    'startsAt',e.starts_at,'endsAt',e.ends_at,'location',e.location,'campusId',e.campus_id,'status',e.status,
    'organizerId',e.organizer_id,'organizerName',p.display_name,'updatedAt',e.updated_at,'canEdit',e.organizer_id=auth.uid(),
    'seriesId',e.series_id,'recurrence',e.recurrence,
    'canComplete',e.status='scheduled' and e.kind='task' and exists(select 1 from public.staff_calendar_attendees a
      where a.event_id=e.id and a.user_id=auth.uid() and a.response<>'declined' and a.completed_at is null),
    'myCompletedAt',(select completed_at from public.staff_calendar_attendees where event_id=e.id and user_id=auth.uid()),
    'attendees',coalesce((select jsonb_agg(jsonb_build_object('userId',a.user_id,'displayName',p2.display_name,
      'response',a.response,'completedAt',a.completed_at) order by p2.display_name,a.user_id)
      from public.staff_calendar_attendees a join public.profiles p2 on p2.id=a.user_id where a.event_id=e.id),'[]'))
  from public.staff_calendar_events e join public.profiles p on p.id=e.organizer_id where e.id=p_id and public.staff_calendar_can_view(e.id);
$$;

create or replace function public.get_calendar_workspace(p_from timestamptz,p_to timestamptz) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_settings public.staff_calendar_settings%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to>p_from+interval '370 days'
    then raise exception 'VALIDATION'; end if;
  select * into v_settings from public.staff_calendar_settings where singleton_key=1
    and organization_id=(select id from public.organizations where singleton_key=1);
  return jsonb_build_object('currentUserId',v_uid,'canCreate',true,
    'schoolWindows',coalesce(v_settings.school_windows,'[]'),'settingsUpdatedAt',v_settings.updated_at,
    'canManageSettings',public.has_perm(v_uid,'schedule.manage'),
    'teachingCalendar',public.list_teaching_calendar_entries_v2(),
    'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',display_name) order by display_name,id),'[]')
      from public.profiles where public.is_staff(id)),
    'events',(select coalesce(jsonb_agg(public.staff_calendar_event_projection(e.id) order by e.starts_at,e.id),'[]')
      from public.staff_calendar_events e where e.starts_at<p_to and e.ends_at>p_from and public.staff_calendar_can_view(e.id)));
end $$;

-- 一个实例的写入保留原参与人、乐观锁、任务完成语义以及共用教师锁。
create function public.staff_calendar_save_occurrence(p_id uuid,p_kind text,p_title text,p_description text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_location text,p_attendee_ids uuid[],p_campus_id uuid,p_expected_updated_at timestamptz,p_series_id uuid,p_recurrence jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_event public.staff_calendar_events%rowtype; v_attendees uuid[]; v_previous uuid[]; v_person uuid; v_reset boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_kind is null or p_kind not in ('meeting','task','preparation','strategy','milestone') or p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_description is null or length(p_description)>8000 or p_location is null or length(btrim(p_location))>300
    or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+(case when p_kind='strategy' then interval '370 days' else interval '31 days' end)
    or (p_kind='milestone' and p_ends_at<>p_starts_at+interval '30 minutes')
    or p_attendee_ids is null or cardinality(p_attendee_ids)>100
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
  if p_kind in ('meeting','preparation') then
    for v_person in select distinct person from unnest(v_attendees||array[v_uid]) person
      where person=v_uid or v_reset or not exists(select 1 from public.staff_calendar_attendees where event_id=p_id and user_id=person and response='declined') loop
      if public.staff_calendar_time_busy(v_person,p_starts_at,p_ends_at,null,p_id) then raise exception 'TIME_UNAVAILABLE'; end if;
    end loop;
  end if;
  if v_event.id is null then
    insert into public.staff_calendar_events(id,kind,title,description,starts_at,ends_at,location,campus_id,organizer_id,updated_by,series_id,recurrence)
      values(p_id,p_kind,btrim(p_title),p_description,p_starts_at,p_ends_at,btrim(p_location),p_campus_id,v_uid,v_uid,p_series_id,p_recurrence);
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

drop function public.save_calendar_event(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz);
create function public.save_calendar_event(p_id uuid,p_kind text,p_title text,p_description text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_location text,p_attendee_ids uuid[],p_campus_id uuid default null,p_expected_updated_at timestamptz default null,p_recurrence jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_event public.staff_calendar_events%rowtype; v_start timestamptz; v_starts timestamptz[]; v_person uuid; v_id uuid; v_result jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-calendar-event:'||p_id::text,0));
  select * into v_event from public.staff_calendar_events where id=p_id for update;
  if v_event.id is not null then
    if v_event.organizer_id<>v_uid then raise exception 'FORBIDDEN'; end if;
    if p_recurrence is not null and (p_expected_updated_at is not null or v_event.series_id is distinct from p_id or v_event.recurrence is distinct from p_recurrence)
      then raise exception 'CONFLICT'; end if;
    return public.staff_calendar_save_occurrence(p_id,p_kind,p_title,p_description,p_starts_at,p_ends_at,p_location,p_attendee_ids,
      p_campus_id,p_expected_updated_at,v_event.series_id,v_event.recurrence);
  end if;
  if p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
  select array_agg(occurrence order by occurrence) into v_starts from public.staff_calendar_recurrence_starts(p_starts_at,p_recurrence) occurrence;
  for v_person in select distinct person from unnest(coalesce(p_attendee_ids,'{}')||array[v_uid]) person where person is not null order by person loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_person::text,0));
  end loop;
  foreach v_start in array v_starts loop
    v_id:=case when v_result is null then p_id else gen_random_uuid() end;
    perform public.staff_calendar_save_occurrence(v_id,p_kind,p_title,p_description,v_start,v_start+(p_ends_at-p_starts_at),p_location,p_attendee_ids,
      p_campus_id,null,case when p_recurrence is not null then p_id end,p_recurrence);
    if v_result is null then v_result:=public.staff_calendar_event_projection(p_id); end if;
  end loop;
  return v_result;
end $$;

-- 发布可约时段复用既有单次 RPC 的权限、预约不可改规则与教师锁。
create table public.staff_calendar_slot_series (
  request_id uuid primary key references public.assessment_slots(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  request_payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.staff_calendar_slot_series enable row level security;
revoke all on public.staff_calendar_slot_series from public,anon,authenticated;

create function public.save_assessment_slot_series(p_slot_id uuid,p_teacher_id uuid,p_campus_id uuid,p_subjects text[],p_grades integer[],
  p_starts_at timestamptz,p_ends_at timestamptz,p_enabled boolean,p_recurrence jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_series public.staff_calendar_slot_series%rowtype; v_payload jsonb; v_slot public.assessment_slots%rowtype;
  v_starts timestamptz[]; v_start timestamptz; v_id uuid; v_result jsonb; v_saved jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_slot_id is null or p_recurrence is null or p_expected_updated_at is not null then raise exception 'VALIDATION'; end if;
  select array_agg(occurrence order by occurrence) into v_starts from public.staff_calendar_recurrence_starts(p_starts_at,p_recurrence) occurrence;
  v_payload:=jsonb_build_object('teacherId',p_teacher_id,'campusId',p_campus_id,'subjects',array(select unnest(p_subjects) order by 1),
    'grades',array(select unnest(p_grades) order by 1),'startsAt',p_starts_at,'endsAt',p_ends_at,'enabled',p_enabled,'recurrence',p_recurrence);
  perform pg_advisory_xact_lock(hashtextextended('assessment-slot-save:'||p_slot_id::text,0));
  select * into v_series from public.staff_calendar_slot_series where request_id=p_slot_id;
  if v_series.request_id is not null then
    if v_series.created_by<>v_uid then raise exception 'FORBIDDEN'; end if;
    if v_series.request_payload is distinct from v_payload then raise exception 'CONFLICT'; end if;
    select * into v_slot from public.assessment_slots where id=p_slot_id;
    if not public.assessment_slots_can_manage(v_uid,v_slot.teacher_id) then raise exception 'FORBIDDEN'; end if;
    return public.assessment_slot_projection(v_slot);
  end if;
  if exists(select 1 from public.assessment_slots where id=p_slot_id) then raise exception 'CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||p_teacher_id::text,0));
  foreach v_start in array v_starts loop
    v_id:=case when v_result is null then p_slot_id else gen_random_uuid() end;
    v_saved:=public.save_assessment_slot(v_id,p_teacher_id,p_campus_id,p_subjects,p_grades,v_start,v_start+(p_ends_at-p_starts_at),p_enabled);
    if v_result is null then v_result:=v_saved; end if;
  end loop;
  insert into public.staff_calendar_slot_series(request_id,created_by,request_payload) values(p_slot_id,v_uid,v_payload);
  return v_result;
end $$;

-- 闭校日优先采用该校区的例外，再采用学校校历；不改变已经确认的预约与课次。
create function public.staff_calendar_campus_closed(p_campus_id uuid,p_starts_at timestamptz,p_ends_at timestamptz) returns boolean
language plpgsql security definer volatile set search_path=public,pg_temp as $$
declare v_organization uuid; v_zone text;
begin
  if p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at) or p_ends_at<=p_starts_at then return true; end if;
  select id,timezone into v_organization,v_zone from public.organizations where singleton_key=1;
  if v_organization is null then return true; end if;
  return exists(select 1 from generate_series((p_starts_at at time zone v_zone)::date::timestamp,
    ((p_ends_at-interval '1 microsecond') at time zone v_zone)::date::timestamp,interval '1 day') day
    cross join lateral (select kind from public.school_holidays entry
      where entry.organization_id=v_organization and entry.archived_at is null
        and (entry.campus_id is null or entry.campus_id=p_campus_id)
        and entry.starts_on<=day::date and entry.ends_on>=day::date
      order by entry.campus_id nulls last,entry.id limit 1) effective
    where effective.kind='closed');
end $$;

create or replace function public.assessment_slot_projection(p_slot public.assessment_slots) returns jsonb
language sql security definer volatile set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_slot.id,'teacherId',p_slot.teacher_id,'campusId',p_slot.campus_id,
    'subjects',p_slot.subjects,'grades',p_slot.grades,'startsAt',p_slot.starts_at,'endsAt',p_slot.ends_at,
    'enabled',p_slot.enabled,'booked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id),
    'activeBooked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled'),
    'blocked',public.staff_calendar_campus_closed(p_slot.campus_id,p_slot.starts_at,p_slot.ends_at)
      or public.assessment_teacher_time_busy(p_slot.teacher_id,p_slot.starts_at,p_slot.ends_at,
        (select id from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled' limit 1)),
    'updatedAt',p_slot.updated_at);
$$;

do $closed_slots$
declare v_definition text; v_needle text;
begin
  v_definition:=pg_get_functiondef('public.save_assessment_slot(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz)'::regprocedure);
  v_needle:='if p_enabled and public.assessment_teacher_time_busy(p_teacher_id,p_starts_at,p_ends_at,';
  if position(v_needle in v_definition)=0 then raise exception 'CALENDAR_SLOT_SAVE_ANCHOR_MISSING'; end if;
  execute replace(v_definition,v_needle,'if p_enabled and public.staff_calendar_campus_closed(p_campus_id,p_starts_at,p_ends_at) then raise exception ''TIME_UNAVAILABLE''; end if; '||v_needle);

  v_definition:=pg_get_functiondef('public.parent_assessment_availability(uuid,text[],integer)'::regprocedure);
  v_needle:='''available'',not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)';
  if position(v_needle in v_definition)=0 then raise exception 'CALENDAR_PARENT_AVAILABILITY_ANCHOR_MISSING'; end if;
  execute replace(v_definition,v_needle,v_needle||' and not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at)');

  v_definition:=pg_get_functiondef('public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)'::regprocedure);
  v_needle:='if public.assessment_teacher_time_busy(v_teacher,v_slot.starts_at,v_slot.ends_at) then';
  if position(v_needle in v_definition)=0 then raise exception 'CALENDAR_PARENT_BOOKING_ANCHOR_MISSING'; end if;
  execute replace(v_definition,v_needle,'if public.staff_calendar_campus_closed(v_slot.campus_id,v_slot.starts_at,v_slot.ends_at) then raise exception ''SLOT_UNAVAILABLE''; end if; '||v_needle);

  v_definition:=pg_get_functiondef('public.guard_assessment_slot_booking()'::regprocedure);
  v_needle:='if tg_op=''INSERT'' and (not v_slot.enabled or v_slot.starts_at<=now()) then';
  if position(v_needle in v_definition)=0 then raise exception 'CALENDAR_BOOKING_GUARD_ANCHOR_MISSING'; end if;
  execute replace(v_definition,v_needle,'if tg_op=''INSERT'' and (not v_slot.enabled or v_slot.starts_at<=now() or public.staff_calendar_campus_closed(v_slot.campus_id,v_slot.starts_at,v_slot.ends_at)) then');
end $closed_slots$;

-- Status/invitation reactivation applies busy checks only to occupying event kinds.
do $nonblocking$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.change_calendar_event_status(uuid,text,timestamptz)'::regprocedure);
  if position('elsif p_status=''scheduled'' then' in v_definition)=0 then raise exception 'CALENDAR_STATUS_ANCHOR_MISSING'; end if;
  execute replace(v_definition,'elsif p_status=''scheduled'' then','elsif p_status=''scheduled'' and v_event.kind in (''meeting'',''preparation'') then');
  v_definition:=pg_get_functiondef('public.respond_calendar_invitation(uuid,text)'::regprocedure);
  if position('v_event.kind<>''task''' in v_definition)=0 then raise exception 'CALENDAR_RESPONSE_ANCHOR_MISSING'; end if;
  execute replace(v_definition,'v_event.kind<>''task''','v_event.kind in (''meeting'',''preparation'')');
end $nonblocking$;

revoke all on function public.staff_calendar_recurrence_starts(timestamptz,jsonb),public.staff_calendar_school_windows_valid(jsonb),
  public.staff_calendar_settings_can_view(uuid),
  public.staff_calendar_campus_closed(uuid,timestamptz,timestamptz),
  public.staff_calendar_save_occurrence(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz,uuid,jsonb),
  public.save_calendar_event(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz,jsonb),
  public.save_calendar_school_windows(jsonb,timestamptz),
  public.save_assessment_slot_series(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.save_calendar_event(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz,jsonb),
  public.staff_calendar_settings_can_view(uuid),
  public.save_calendar_school_windows(jsonb,timestamptz),
  public.save_assessment_slot_series(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,jsonb,timestamptz) to authenticated;
select pg_notify('pgrst','reload schema');
