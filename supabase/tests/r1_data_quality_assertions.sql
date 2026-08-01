\set ON_ERROR_STOP on
-- R1-7C: versioned, persistent and permission-scoped data-quality scans.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select id as term_id from public.school_terms where is_current order by created_at limit 1 \gset
\if :{?admin_id}
\else
  \echo R1-7C fixture missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1-7C fixture missing: teacher
  select 1 / 0;
\endif
\if :{?student_user_id}
\else
  \echo R1-7C fixture missing: student
  select 1 / 0;
\endif
\if :{?term_id}
\else
  \echo R1-7C fixture missing: current term
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}'; scan_definition text;
begin
  if to_regclass('public.data_quality_rule_versions') is null
     or to_regclass('public.data_quality_runs') is null
     or to_regclass('public.data_quality_findings') is null then
    failures := array_append(failures, 'quality tables missing');
  end if;
  if (select count(*) from public.data_quality_rule_versions
       where rule_set_version = 'mathin-data-quality-v1' and version = 1 and enabled) <> 5 then
    failures := array_append(failures, 'versioned rule set incomplete');
  end if;
  if has_table_privilege('authenticated', 'public.data_quality_rule_versions', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_quality_runs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_quality_findings', 'DELETE') then
    failures := array_append(failures, 'quality ledger direct writes granted');
  end if;
  scan_definition := pg_get_functiondef('public.run_data_quality_scan()'::regprocedure);
  if scan_definition not ilike '%system.operations.manage%'
     or scan_definition not ilike '%pg_advisory_xact_lock%'
     or scan_definition not ilike '%statement_timestamp()%'
     or scan_definition not ilike '%orphan_active_enrollment%'
     or scan_definition not ilike '%duplicate_student_phone%'
     or scan_definition not ilike '%illegal_session_state%'
     or scan_definition not ilike '%order_amount_unbalanced%'
     or scan_definition not ilike '%missing_courseware_object%' then
    failures := array_append(failures, 'quality stable-scan contract incomplete');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-7C data quality structure assertions failed: %', array_to_string(failures, ', ');
  end if;

  begin
    update public.data_quality_rule_versions
       set definition = definition || ' changed'
     where rule_key = 'orphan_active_enrollment' and version = 1;
    raise exception 'R1_7C_RULE_UPDATE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'QUALITY_RULE_IMMUTABLE' then raise; end if;
  end;
end
$$;

insert into public.staff_role_members(user_id, role_id, granted_by)
select :'teacher_id'::uuid, role_row.id, :'admin_id'::uuid
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

insert into public.students(name, phone, status, bind_code, assigned_to, created_by)
values('__R1_7C_DUPLICATE_A__', '+86 139-0000-7111', 'enrolled', public.generate_student_bind_code(), :'teacher_id'::uuid, :'admin_id'::uuid)
returning id as duplicate_student_a \gset
insert into public.students(name, phone, status, bind_code, assigned_to, created_by)
values('__R1_7C_DUPLICATE_B__', '+8613900007111', 'enrolled', public.generate_student_bind_code(), :'teacher_id'::uuid, :'admin_id'::uuid)
returning id as duplicate_student_b \gset
insert into public.students(name, phone, status, bind_code, assigned_to, created_by)
values('__R1_7C_ORPHAN__', '+8613900007112', 'enrolled', public.generate_student_bind_code(), :'teacher_id'::uuid, :'admin_id'::uuid)
returning id as orphan_student_id \gset

insert into public.classrooms(owner_id, name, invite_code, purpose, term_id)
values(:'teacher_id'::uuid, '__R1_7C_CLASS__', 'r17c' || left(replace(gen_random_uuid()::text, '-', ''), 20), 'test', :'term_id'::uuid)
returning id as classroom_id \gset
insert into public.classroom_members(classroom_id, user_id, role)
values(:'classroom_id'::uuid, :'teacher_id'::uuid, 'teacher');
insert into public.enrollments(classroom_id, student_id, status, operated_by, term_id)
values(:'classroom_id'::uuid, :'orphan_student_id'::uuid, 'active', :'admin_id'::uuid, :'term_id'::uuid)
returning id as orphan_enrollment_id \gset
update public.students set deleted_at = now() where id = :'orphan_student_id'::uuid;

insert into public.class_sessions(classroom_id, title, scheduled_at, duration_min, ended_at, term_id)
values(:'classroom_id'::uuid, '__R1_7C_ILLEGAL_SESSION__', now(), 60, now(), :'term_id'::uuid)
returning id as illegal_session_id \gset

insert into public.orders(order_no, student_id, amount_original, amount_discount, amount_due, status, created_by, term_id)
values('__R1_7C_ORDER__' || left(replace(gen_random_uuid()::text, '-', ''), 10), :'duplicate_student_a'::uuid,
       100.00, 0.00, 90.00, 'unpaid', :'admin_id'::uuid, :'term_id'::uuid)
returning id as unbalanced_order_id \gset

insert into public.cw_asset_objects(sha256, mime, byte_count, kind, storage_path)
values(encode(digest(convert_to('__R1_7C_MISSING_OBJECT__' || gen_random_uuid()::text, 'UTF8'), 'sha256'), 'hex'),
       'image/png', 64, 'image', '__r1_7c_missing__/object.png')
returning id as missing_object_id \gset

select set_config('test.r17c_duplicate_a', :'duplicate_student_a', true);
select set_config('test.r17c_duplicate_b', :'duplicate_student_b', true);
select set_config('test.r17c_orphan_enrollment', :'orphan_enrollment_id', true);
select set_config('test.r17c_illegal_session', :'illegal_session_id', true);
select set_config('test.r17c_unbalanced_order', :'unbalanced_order_id', true);
select set_config('test.r17c_missing_object', :'missing_object_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);

do $$
declare first_run jsonb; second_run jsonb; first_id uuid; second_id uuid;
begin
  first_run := public.run_data_quality_scan();
  second_run := public.run_data_quality_scan();
  first_id := (first_run ->> 'id')::uuid;
  second_id := (second_run ->> 'id')::uuid;

  if first_run ->> 'ruleSetVersion' <> 'mathin-data-quality-v1'
     or first_run ->> 'status' <> 'completed'
     or (first_run ->> 'findingsHash') is null then
    raise exception 'R1_7C_SCAN_RESULT_INCOMPLETE';
  end if;
  if first_run ->> 'findingsHash' <> second_run ->> 'findingsHash'
     or (first_run ->> 'total')::integer <> (second_run ->> 'total')::integer
     or first_run -> 'counts' <> second_run -> 'counts' then
    raise exception 'R1_7C_REPEAT_SCAN_NOT_STABLE';
  end if;
  if public.get_latest_data_quality_run() ->> 'id' <> second_id::text
     or public.get_data_quality_run(first_id) ->> 'id' <> first_id::text then
    raise exception 'R1_7C_RUN_PROJECTION_INCORRECT';
  end if;
  if not exists(select 1 from public.data_quality_findings where run_id = first_id
      and rule_key = 'orphan_active_enrollment' and object_id = current_setting('test.r17c_orphan_enrollment')::uuid)
     or not exists(select 1 from public.data_quality_findings where run_id = first_id
      and rule_key = 'illegal_session_state' and object_id = current_setting('test.r17c_illegal_session')::uuid)
     or not exists(select 1 from public.data_quality_findings where run_id = first_id
      and rule_key = 'order_amount_unbalanced' and object_id = current_setting('test.r17c_unbalanced_order')::uuid)
     or not exists(select 1 from public.data_quality_findings where run_id = first_id
      and rule_key = 'missing_courseware_object' and object_id = current_setting('test.r17c_missing_object')::uuid)
     or not exists(select 1 from public.data_quality_findings where run_id = first_id
      and rule_key = 'duplicate_student_phone'
      and evidence -> 'studentIds' ? current_setting('test.r17c_duplicate_a')
      and evidence -> 'studentIds' ? current_setting('test.r17c_duplicate_b')) then
    raise exception 'R1_7C_EXPECTED_FINDINGS_MISSING';
  end if;
  if exists(select 1 from public.data_quality_findings where run_id = first_id
      and rule_key = 'duplicate_student_phone'
      and (evidence ? 'phone' or evidence::text like '%13900007111%')) then
    raise exception 'R1_7C_PHONE_LEAKED_IN_EVIDENCE';
  end if;
  if exists(
    select 1 from public.domain_events event_row
    join public.notifications notification_row on notification_row.source_event_id = event_row.id
    where event_row.entity_id in (first_id, second_id) and event_row.event_type = 'data_quality.completed'
  ) or exists(
    select 1 from public.domain_events event_row
    where event_row.entity_id in (first_id, second_id) and event_row.target_user_id is not null
  ) then
    raise exception 'R1_7C_SCAN_CREATED_NOTIFICATION_NOISE';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
begin
  begin
    perform public.run_data_quality_scan();
    raise exception 'R1_7C_STUDENT_SCAN_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.get_latest_data_quality_run();
    raise exception 'R1_7C_STUDENT_PROJECTION_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  if exists(select 1 from public.data_quality_runs)
     or exists(select 1 from public.data_quality_findings)
     or exists(select 1 from public.data_quality_rule_versions) then
    raise exception 'R1_7C_STUDENT_READ_QUALITY_LEDGER';
  end if;
end
$$;

reset role;
rollback;