\set ON_ERROR_STOP on
-- DEV-ORG-1: teaching-calendar impact is derived from room membership only.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as term_id from public.school_terms order by is_current desc, starts_on desc nulls last limit 1 \gset
select (current_date + 100)::text as impact_day \gset
select (((:'impact_day'::date + time '10:00') at time zone
  (select timezone from public.organizations where singleton_key = 1)))::text as impact_at_a \gset
select (((:'impact_day'::date + time '11:00') at time zone
  (select timezone from public.organizations where singleton_key = 1)))::text as impact_at_b \gset
select (((:'impact_day'::date + time '12:00') at time zone
  (select timezone from public.organizations where singleton_key = 1)))::text as impact_at_tbd \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.preview_teaching_calendar_impact_v2(
  null, :'impact_day'::date, :'impact_day'::date
) as baseline_org_impact \gset
select public.create_campus_v2('Impact Campus A', null) as campus_a_id \gset
select public.create_campus_v2('Impact Campus B', null) as campus_b_id \gset
select public.create_campus_room_v2(:'campus_a_id'::uuid, 'Impact Room A', null) as room_a_id \gset
select public.create_campus_room_v2(:'campus_b_id'::uuid, 'Impact Room B', null) as room_b_id \gset
select public.create_free_class_with_sessions_v2(
  'Impact Class A', null, :'room_a_id'::uuid, :'teacher_id'::uuid, null,
  :'term_id'::uuid, 'test', jsonb_build_array(jsonb_build_object(
    'lecture_id', null, 'title', 'Impact A', 'scheduled_at', :'impact_at_a'::timestamptz, 'duration_min', 60
  )), false, 'short_term_topic'
) as class_a_id \gset
select public.create_free_class_with_sessions_v2(
  'Impact Class B', null, :'room_b_id'::uuid, :'teacher_id'::uuid, null,
  :'term_id'::uuid, 'test', jsonb_build_array(jsonb_build_object(
    'lecture_id', null, 'title', 'Impact B', 'scheduled_at', :'impact_at_b'::timestamptz, 'duration_min', 60
  )), false, 'short_term_topic'
) as class_b_id \gset
select public.create_free_class_with_sessions_v2(
  'Impact Class TBD', null, null, :'teacher_id'::uuid, null,
  :'term_id'::uuid, 'test', jsonb_build_array(jsonb_build_object(
    'lecture_id', null, 'title', 'Impact TBD', 'scheduled_at', :'impact_at_tbd'::timestamptz, 'duration_min', 60
  )), false, 'short_term_topic'
) as class_tbd_id \gset
reset role;

update public.class_sessions set started_at = now()
 where classroom_id = :'class_b_id'::uuid and title = 'Impact B';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.preview_teaching_calendar_impact_v2(null, :'impact_day'::date, :'impact_day'::date) as org_impact \gset
select public.preview_teaching_calendar_impact_v2(:'campus_a_id'::uuid, :'impact_day'::date, :'impact_day'::date) as campus_a_impact \gset
select public.preview_teaching_calendar_impact_v2(:'campus_b_id'::uuid, :'impact_day'::date, :'impact_day'::date) as campus_b_impact \gset
select (
  (:'org_impact'::jsonb ->> 'futureSessionCount')::int
    - (:'baseline_org_impact'::jsonb ->> 'futureSessionCount')::int = 2
  and (:'org_impact'::jsonb ->> 'futureClassroomCount')::int
    - (:'baseline_org_impact'::jsonb ->> 'futureClassroomCount')::int = 2
  and (:'org_impact'::jsonb ->> 'locationPendingCount')::int
    - (:'baseline_org_impact'::jsonb ->> 'locationPendingCount')::int = 1
  and (:'org_impact'::jsonb ->> 'historicalSessionCount')::int
    - (:'baseline_org_impact'::jsonb ->> 'historicalSessionCount')::int = 1
  and (:'campus_a_impact'::jsonb ->> 'futureSessionCount')::int = 1
  and (:'campus_a_impact'::jsonb ->> 'locationPendingCount')::int = 0
  and (:'campus_b_impact'::jsonb ->> 'futureSessionCount')::int = 0
  and (:'campus_b_impact'::jsonb ->> 'historicalSessionCount')::int = 1
) as impact_ok \gset
\if :impact_ok
\else
  \echo DEV-ORG-1 teaching-calendar impact scope/count assertion failed
  select 1 / 0;
\endif
reset role;

rollback;
\echo DEV-ORG-1 teaching-calendar impact V2 assertions passed
