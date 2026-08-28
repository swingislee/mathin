\set ON_ERROR_STOP on
-- DEV-ORG-1: organization academic axis, calendar precedence and closed-day confirmation.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as term_id from public.school_terms order by is_current desc, starts_on desc nulls last, created_at desc limit 1 \gset
select (current_date + 40)::text as closed_day,
       (current_date + 41)::text as closed_day_two,
       (current_date + 50)::text as manual_day \gset

do $$
declare failures text[] := '{}';
begin
  if not exists(select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'school_years_start_year_org_unique_idx') then
    failures := array_append(failures, 'organization school year unique index missing');
  end if;
  if not exists(select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'school_terms_one_current_org_idx') then
    failures := array_append(failures, 'organization current period index missing');
  end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.school_holidays'::regclass
    and tgname = 'school_holidays_validate_v2') then
    failures := array_append(failures, 'calendar overlap trigger missing');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'DEV-ORG-1 academic/calendar structure failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

select (
  public.current_school_year_id() is not distinct from public.current_school_year_id(gen_random_uuid())
  and public.current_school_term_id() is not distinct from public.current_school_term_id(gen_random_uuid())
) as campus_argument_ignored \gset
\if :campus_argument_ignored
\else
  \echo DEV-ORG-1 academic axis still depends on campus
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  begin
    perform public.create_teaching_calendar_entry_v2(
      null, 'Teacher forbidden', 'closed', current_date + 40, current_date + 40, null, null
    );
    raise exception 'TEACHER_CALENDAR_WRITE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_campus_v2('Calendar Campus A', null) as campus_a_id \gset
select public.create_campus_v2('Calendar Campus B', null) as campus_b_id \gset
select public.create_campus_room_v2(:'campus_a_id'::uuid, 'Calendar Room A', 20) as room_a_id \gset
select public.create_campus_room_v2(:'campus_b_id'::uuid, 'Calendar Room B', 20) as room_b_id \gset
select public.create_teaching_calendar_entry_v2(
  null, 'Organization closed range', 'closed', :'closed_day'::date, :'closed_day_two'::date, null, null
) as org_closed_id \gset
select public.create_teaching_calendar_entry_v2(
  :'campus_a_id'::uuid, 'Campus mapped teaching day', 'teaching',
  :'closed_day'::date, :'closed_day'::date, 'mapped', extract(dow from :'closed_day'::date)::smallint
) as campus_teaching_id \gset
select public.create_teaching_calendar_entry_v2(
  null, 'Manual organization teaching day', 'teaching',
  :'manual_day'::date, :'manual_day'::date, 'manual', null
) as manual_entry_id \gset

select set_config('dev_org.closed_day', :'closed_day', true);
select set_config('dev_org.campus_a_id', :'campus_a_id', true);
do $$
begin
  begin
    perform public.create_teaching_calendar_entry_v2(
      current_setting('dev_org.campus_a_id')::uuid,
      'Overlapping campus entry', 'makeup',
      current_setting('dev_org.closed_day')::date,
      current_setting('dev_org.closed_day')::date,
      'manual', null
    );
    raise exception 'OVERLAPPING_CALENDAR_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CALENDAR_SCOPE_OVERLAP' then raise; end if;
  end;
  begin
    perform public.create_teaching_calendar_entry_v2(
      null::uuid, 'Invalid teaching range', 'teaching',
      current_setting('dev_org.closed_day')::date,
      current_setting('dev_org.closed_day')::date + 1,
      'mapped', 1::smallint
    );
    raise exception 'MULTIDAY_TEACHING_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'TEACHING_DAY_MUST_BE_SINGLE_DATE' then raise; end if;
  end;
end
$$;

select (
  public.get_effective_calendar_day_v2(:'closed_day'::date, :'room_a_id'::uuid) #>> '{entry,kind}' = 'teaching'
  and public.get_effective_calendar_day_v2(:'closed_day'::date, :'room_b_id'::uuid) #>> '{entry,kind}' = 'closed'
  and public.get_effective_calendar_day_v2(:'closed_day'::date, null::uuid) #>> '{entry,kind}' = 'closed'
  and (public.get_effective_calendar_day_v2(:'closed_day'::date, null::uuid) ->> 'locationPending')::boolean
  and public.get_effective_calendar_day_v2(:'manual_day'::date, :'room_b_id'::uuid) #>> '{entry,scheduleMode}' = 'manual'
) as calendar_precedence_ok \gset
\if :calendar_precedence_ok
\else
  \echo DEV-ORG-1 calendar precedence/manual mode assertion failed
  select 1 / 0;
\endif

select public.create_free_class_with_sessions_v2(
  'Calendar confirmation class', 12::smallint, :'room_b_id'::uuid,
  :'teacher_id'::uuid, null::uuid, :'term_id'::uuid, 'test',
  jsonb_build_array(jsonb_build_object(
    'lecture_id', null, 'title', 'Movable session',
    'scheduled_at', now() + interval '10 days', 'duration_min', 90
  )), true, 'short_term_topic'
) as classroom_id \gset
reset role;

select id as session_id from public.class_sessions
 where classroom_id = :'classroom_id'::uuid and title = 'Movable session' \gset
select (((:'closed_day'::date + time '10:00') at time zone
  (select timezone from public.organizations where singleton_key = 1)))::text as closed_at \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select set_config('dev_org.session_id', :'session_id', true);
select set_config('dev_org.room_b_id', :'room_b_id', true);
select set_config('dev_org.closed_at', :'closed_at', true);
do $$
begin
  begin
    perform public.update_managed_class_session_v2(
      current_setting('dev_org.session_id')::uuid,
      'Moved to closed day', current_setting('dev_org.closed_at')::timestamptz,
      90::smallint, current_setting('dev_org.room_b_id')::uuid, false, ''
    );
    raise exception 'CLOSED_DAY_WITHOUT_REASON_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CLOSED_DAY_CONFIRMATION_REQUIRED' then raise; end if;
  end;
end
$$;
select public.update_managed_class_session_v2(
  :'session_id'::uuid, 'Moved to closed day', :'closed_at'::timestamptz,
  90::smallint, :'room_b_id'::uuid, true, 'Approved exceptional lesson'
);
reset role;

select (
  exists(select 1 from public.class_sessions where id = :'session_id'::uuid
    and scheduled_at = :'closed_at'::timestamptz and room_id = :'room_b_id'::uuid
    and room_assignment_origin = 'session_override')
  and exists(select 1 from public.domain_events where entity_id = :'session_id'::uuid
    and event_type = 'session.closed_day.override_confirmed'
    and payload ->> 'reason' = 'Approved exceptional lesson')
) as closed_day_confirmation_ok \gset
\if :closed_day_confirmation_ok
\else
  \echo DEV-ORG-1 closed-day confirmation/audit assertion failed
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.list_school_years_v2()::text as years_dto \gset
select public.get_teaching_calendar_v2(:'closed_day'::date, :'manual_day'::date)::text as calendar_dto \gset
select (
  :'years_dto' not like '%"campusId"%'
  and :'calendar_dto' not like '%"code"%'
  and :'calendar_dto' not like '%"timezone"%'
) as academic_dto_ok \gset
\if :academic_dto_ok
\else
  \echo DEV-ORG-1 academic/calendar DTO leaked compatibility fields
  select 1 / 0;
\endif
reset role;

rollback;
\echo DEV-ORG-1 academic/calendar V2 assertions passed
