\set ON_ERROR_STOP on
-- DEV-ORG-1: V2 DTOs, permission split, UUID room semantics and archival cleanup.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as term_id from public.school_terms order by is_current desc, starts_on desc nulls last, created_at desc limit 1 \gset

\if :{?admin_id}
\else
  \echo DEV-ORG-1 fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo DEV-ORG-1 fixtures missing: 测试-教师
  select 1 / 0;
\endif
\if :{?term_id}
\else
  \echo DEV-ORG-1 fixtures missing: school term
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if not exists(select 1 from unnest(public.school_permission_keys()) key where key = 'organization.profile.manage') then
    failures := array_append(failures, 'organization.profile.manage missing');
  end if;
  if not exists(select 1 from unnest(public.school_permission_keys()) key where key = 'location.manage') then
    failures := array_append(failures, 'location.manage missing');
  end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.classrooms'::regclass and tgname = 'classrooms_sync_room_compat_v2') then
    failures := array_append(failures, 'classroom room compatibility trigger missing');
  end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.class_sessions'::regclass and tgname = 'class_sessions_copy_default_room_v2') then
    failures := array_append(failures, 'session default room trigger missing');
  end if;
  if has_function_privilege('anon', 'public.get_location_catalog_v2(boolean)', 'EXECUTE') then
    failures := array_append(failures, 'anon location catalog execute granted');
  end if;
  if not has_column_privilege('authenticated', 'public.campuses', 'name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.campus_rooms', 'name', 'SELECT') then
    failures := array_append(failures, 'staff location read-model columns missing');
  end if;
  if has_column_privilege('authenticated', 'public.campuses', 'code', 'SELECT')
     or has_column_privilege('authenticated', 'public.campus_rooms', 'code', 'SELECT') then
    failures := array_append(failures, 'internal location code is selectable');
  end if;
  if has_column_privilege('anon', 'public.campuses', 'name', 'SELECT')
     or has_column_privilege('anon', 'public.campus_rooms', 'name', 'SELECT') then
    failures := array_append(failures, 'anonymous location read-model access granted');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'DEV-ORG-1 structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  begin
    perform public.create_campus_v2('Teacher forbidden campus', null);
    raise exception 'TEACHER_LOCATION_WRITE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.get_organization_profile_v2();
    raise exception 'TEACHER_ORGANIZATION_PROFILE_READ_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_campus_v2('DEV ORG V2 Campus', 'Test address') as campus_id \gset
select public.create_campus_room_v2(:'campus_id'::uuid, 'Room A', 20) as room_a_id \gset
select public.create_campus_room_v2(:'campus_id'::uuid, 'Room B', 10) as room_b_id \gset
select public.create_campus_room_v2(:'campus_id'::uuid, 'Room C', null) as room_c_id \gset

select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  exists(select 1 from public.campuses where id = :'campus_id'::uuid and name = 'DEV ORG V2 Campus')
  and exists(select 1 from public.campus_rooms where id = :'room_a_id'::uuid and name = 'Room A')
) as teacher_location_read_ok \gset
\if :teacher_location_read_ok
\else
  \echo DEV-ORG-1 staff code-free location read model failed
  select 1 / 0;
\endif
select set_config('request.jwt.claim.sub', :'admin_id', true);

select public.create_free_class_with_sessions_v2(
  'DEV ORG V2 Class',
  15::smallint,
  :'room_a_id'::uuid,
  :'teacher_id'::uuid,
  null::uuid,
  :'term_id'::uuid,
  'test',
  jsonb_build_array(
    jsonb_build_object('lecture_id', null, 'title', 'History session', 'scheduled_at', now() + interval '20 days', 'duration_min', 90),
    jsonb_build_object('lecture_id', null, 'title', 'Default session', 'scheduled_at', now() + interval '21 days', 'duration_min', 90),
    jsonb_build_object('lecture_id', null, 'title', 'Override session', 'scheduled_at', now() + interval '22 days', 'duration_min', 90)
  ),
  true,
  'short_term_topic'
) as classroom_id \gset
reset role;

select id as history_session_id from public.class_sessions
 where classroom_id = :'classroom_id'::uuid and title = 'History session' \gset
select id as default_session_id from public.class_sessions
 where classroom_id = :'classroom_id'::uuid and title = 'Default session' \gset
select id as override_session_id from public.class_sessions
 where classroom_id = :'classroom_id'::uuid and title = 'Override session' \gset

update public.class_sessions set started_at = now() where id = :'history_session_id'::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_class_session_room_v2(:'override_session_id'::uuid, null);
select (public.get_classroom_room_apply_preview_v2(:'classroom_id'::uuid, :'room_b_id'::uuid)
  ->> 'unstartedDefaultSessionCount')::integer as apply_count \gset
select public.update_classroom_default_room_v2(
  :'classroom_id'::uuid, :'room_b_id'::uuid, true, :apply_count
);
reset role;

select (
  (select default_room_id from public.classrooms where id = :'classroom_id'::uuid) = :'room_b_id'::uuid
  and exists(select 1 from public.class_sessions where id = :'history_session_id'::uuid
    and room_id = :'room_a_id'::uuid and room_assignment_origin = 'class_default')
  and exists(select 1 from public.class_sessions where id = :'default_session_id'::uuid
    and room_id = :'room_b_id'::uuid and room_assignment_origin = 'class_default')
  and exists(select 1 from public.class_sessions where id = :'override_session_id'::uuid
    and room_id is null and room_assignment_origin = 'session_override')
) as propagation_ok \gset
\if :propagation_ok
\else
  \echo DEV-ORG-1 default propagation/history assertion failed
  select 1 / 0;
\endif

select scheduled_at as unchanged_scheduled_at, duration_min as unchanged_duration_min
  from public.class_sessions where id = :'default_session_id'::uuid \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.update_managed_class_session_v2(
  :'default_session_id'::uuid,
  'Default session renamed',
  :'unchanged_scheduled_at'::timestamptz,
  :unchanged_duration_min::smallint,
  :'room_b_id'::uuid,
  false,
  ''
);
reset role;
select exists(
  select 1 from public.class_sessions where id = :'default_session_id'::uuid
    and room_id = :'room_b_id'::uuid and room_assignment_origin = 'class_default'
) as unchanged_room_origin_ok \gset
\if :unchanged_room_origin_ok
\else
  \echo DEV-ORG-1 unchanged room was converted into a session override
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_campus_room_status_v2(:'room_b_id'::uuid, 'inactive', 1);
reset role;

select (
  (select default_room_id is null from public.classrooms where id = :'classroom_id'::uuid)
  and exists(select 1 from public.class_sessions where id = :'default_session_id'::uuid
    and room_id is null and room_assignment_origin = 'class_default')
  and exists(select 1 from public.class_sessions where id = :'history_session_id'::uuid
    and room_id = :'room_a_id'::uuid)
) as inactive_cleanup_ok \gset
\if :inactive_cleanup_ok
\else
  \echo DEV-ORG-1 room deactivation cleanup/history assertion failed
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select (public.get_classroom_room_apply_preview_v2(:'classroom_id'::uuid, :'room_c_id'::uuid)
  ->> 'unstartedDefaultSessionCount')::integer as campus_apply_count \gset
select public.update_classroom_default_room_v2(
  :'classroom_id'::uuid, :'room_c_id'::uuid, true, :campus_apply_count
);
select (public.get_location_impact_v2('campus', :'campus_id'::uuid)
  ->> 'unstartedSessionCount')::integer as campus_impact_count \gset
select public.update_campus_v2(
  :'campus_id'::uuid, 'DEV ORG V2 Campus', 'Test address', 'archived', :campus_impact_count
);
reset role;

select (
  not exists(select 1 from public.campus_rooms where campus_id = :'campus_id'::uuid and status <> 'inactive')
  and not exists(select 1 from public.classrooms where id = :'classroom_id'::uuid and default_room_id is not null)
  and not exists(select 1 from public.class_sessions where classroom_id = :'classroom_id'::uuid
    and started_at is null and ended_at is null and room_id is not null)
  and exists(select 1 from public.class_sessions where id = :'history_session_id'::uuid
    and room_id = :'room_a_id'::uuid)
) as campus_archive_ok \gset
\if :campus_archive_ok
\else
  \echo DEV-ORG-1 campus archive cleanup/history assertion failed
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.get_location_catalog_v2(true)::text as catalog_text \gset
select public.get_organization_profile_v2()::text as profile_text \gset
select (
  :'catalog_text' not like '%"code"%'
  and :'catalog_text' not like '%"timezone"%'
  and :'catalog_text' not like '%"isDefault"%'
  and :'profile_text' not like '%"code"%'
  and :'profile_text' not like '%"defaultLocale"%'
) as dto_fields_ok \gset
\if :dto_fields_ok
\else
  \echo DEV-ORG-1 V2 DTO leaked compatibility fields
  select 1 / 0;
\endif
reset role;

rollback;
\echo DEV-ORG-1 organization/location V2 assertions passed
