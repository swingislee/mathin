\set ON_ERROR_STOP on
-- R1-7A: versioned student import dry-run, batch audit, atomic apply, idempotency, and retention.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as student_user_id from public.profiles where display_name = '测试-学生' limit 1 \gset
\if :{?admin_id}
\else
  \echo R1-7 fixture missing: admin
  select 1 / 0;
\endif
\if :{?student_user_id}
\else
  \echo R1-7 fixture missing: student
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}'; preview_definition text;
begin
  if to_regclass('public.data_import_batches') is null or to_regclass('public.data_import_rows') is null then
    failures := array_append(failures, 'data import tables missing');
  end if;
  if has_table_privilege('authenticated', 'public.data_import_batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_import_rows', 'UPDATE') then
    failures := array_append(failures, 'import ledger direct writes granted');
  end if;
  preview_definition := pg_get_functiondef('public.preview_student_import(text,jsonb,text,text)'::regprocedure);
  if preview_definition not ilike '%mathin-students-v1%'
     or preview_definition not ilike '%IDEMPOTENCY_CONFLICT%'
     or preview_definition not ilike '%pg_advisory_xact_lock%'
     or pg_get_functiondef('public.apply_student_import(uuid)'::regprocedure) not ilike '%BATCH_HAS_ERRORS%' then
    failures := array_append(failures, 'student import version/idempotency/atomicity contract missing');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-7 data governance structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);

do $$
declare
  invalid_rows jsonb := jsonb_build_array(
    jsonb_build_object('name','R1-7 Valid But Blocked','phone','+8613900007100','grade','6','region','测试','source','r1-7','remark',''),
    jsonb_build_object('name','','phone','+8613900007102','grade','6','region','测试','source','r1-7','remark','')
  );
  valid_rows jsonb := jsonb_build_array(
    jsonb_build_object('name','R1-7 Imported','phone','+8613900007101','grade','6','region','测试','source','r1-7','remark',''),
    jsonb_build_object('name','R1-7 Duplicate','phone','+86 139-0000-7101','grade','6','region','测试','source','r1-7','remark','')
  );
  invalid_result jsonb;
  repeated_result jsonb;
  preview_result jsonb;
  applied_result jsonb;
  reapplied_result jsonb;
  before_count integer;
begin
  select count(*) into before_count from public.students where phone in ('+8613900007100','+8613900007101','+8613900007102');
  if before_count <> 0 then raise exception 'R1_7_TEST_PHONE_ALREADY_EXISTS'; end if;

  invalid_result := public.preview_student_import(
    'mathin-students-v1', invalid_rows, 'r1-7-invalid-batch', repeat('a',64)
  );
  repeated_result := public.preview_student_import(
    'mathin-students-v1', invalid_rows, 'r1-7-invalid-batch', repeat('a',64)
  );
  if invalid_result->>'batchId' <> repeated_result->>'batchId'
     or (invalid_result->>'errorCount')::integer <> 1 then
    raise exception 'R1_7_DRY_RUN_NOT_IDEMPOTENT';
  end if;
  begin
    perform public.preview_student_import(
      'mathin-students-v1', jsonb_build_array(jsonb_build_object('name','changed')),
      'r1-7-invalid-batch', repeat('b',64)
    );
    raise exception 'R1_7_IDEMPOTENCY_CONFLICT_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  begin
    perform public.apply_student_import((invalid_result->>'batchId')::uuid);
    raise exception 'R1_7_ERROR_BATCH_WAS_APPLIED';
  exception when others then
    if SQLERRM <> 'BATCH_HAS_ERRORS' then raise; end if;
  end;
  if exists(select 1 from public.students where phone in ('+8613900007100','+8613900007102')) then
    raise exception 'R1_7_ERROR_BATCH_LEFT_PARTIAL_STUDENTS';
  end if;

  preview_result := public.preview_student_import(
    'mathin-students-v1', valid_rows, 'r1-7-valid-batch', repeat('c',64)
  );
  if (preview_result->>'valid')::integer <> 1
     or (preview_result->>'dup')::integer <> 1
     or (preview_result->>'errorCount')::integer <> 0 then
    raise exception 'R1_7_DUPLICATE_PREVIEW_COUNTS_WRONG';
  end if;
  applied_result := public.apply_student_import((preview_result->>'batchId')::uuid);
  reapplied_result := public.apply_student_import((preview_result->>'batchId')::uuid);
  if applied_result->>'status' <> 'completed'
     or (applied_result->>'inserted')::integer <> 1
     or (applied_result->>'dup')::integer <> 1
     or reapplied_result->>'batchId' <> applied_result->>'batchId'
     or (reapplied_result->>'inserted')::integer <> 1 then
    raise exception 'R1_7_APPLY_NOT_IDEMPOTENT';
  end if;
  if (select count(*) from public.students
       where regexp_replace(trim(phone), '[^0-9+]', '', 'g') = '+8613900007101') <> 1 then
    raise exception 'R1_7_APPLY_INSERT_COUNT_WRONG';
  end if;
  if exists(select 1 from public.data_import_rows
             where batch_id = (preview_result->>'batchId')::uuid and payload is not null) then
    raise exception 'R1_7_COMPLETED_BATCH_RETAINED_PII_PAYLOAD';
  end if;
  if exists(
    select 1
      from public.domain_events event_row
      join public.notifications notification_row on notification_row.source_event_id = event_row.id
     where event_row.entity_id in (
       (invalid_result->>'batchId')::uuid,
       (preview_result->>'batchId')::uuid
     )
       and event_row.event_type in ('data_import.validated', 'data_import.completed')
  ) then
    raise exception 'R1_7_IMPORT_EVENT_CREATED_NOTIFICATION_NOISE';
  end if;
  if exists(
    select 1 from public.domain_events event_row
     where event_row.entity_id in (
       (invalid_result->>'batchId')::uuid,
       (preview_result->>'batchId')::uuid
     )
       and event_row.event_type in ('data_import.validated', 'data_import.completed')
       and event_row.target_user_id is not null
  ) then
    raise exception 'R1_7_IMPORT_EVENT_RETAINED_NOTIFICATION_TARGET';
  end if;
end
$$;

reset role;
update public.data_import_batches
   set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
 where idempotency_key = 'r1-7-invalid-batch';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select (public.purge_expired_data_import_payloads(100) > 0) as r1_expired_payload_cleared \gset
\if :r1_expired_payload_cleared
\else
  \echo R1-7 expired import payload was not cleared
  select 1 / 0;
\endif

select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
begin
  begin
    perform public.preview_student_import(
      'mathin-students-v1', jsonb_build_array(jsonb_build_object('name','forbidden')),
      'r1-7-forbidden', repeat('d',64)
    );
    raise exception 'R1_7_STUDENT_IMPORT_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  if exists(select 1 from public.data_import_batches) then
    raise exception 'R1_7_STUDENT_READ_OTHER_IMPORT_BATCHES';
  end if;
end
$$;

reset role;
rollback;
