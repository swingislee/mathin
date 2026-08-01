\set ON_ERROR_STOP on
-- R1-7D: allowlisted plans, stable target hashes, transactional execution and rollback.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select id as student_id from public.students where deleted_at is null order by created_at limit 1 \gset
select id as term_id from public.school_terms where is_current order by created_at limit 1 \gset
\if :{?admin_id}
\else
  \echo R1-7D fixture missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1-7D fixture missing: teacher
  select 1 / 0;
\endif
\if :{?student_user_id}
\else
  \echo R1-7D fixture missing: student user
  select 1 / 0;
\endif
\if :{?student_id}
\else
  \echo R1-7D fixture missing: student record
  select 1 / 0;
\endif
\if :{?term_id}
\else
  \echo R1-7D fixture missing: current term
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}'; execute_definition text; rollback_definition text;
begin
  if to_regclass('public.data_repair_capability_versions') is null
     or to_regclass('public.data_repair_plans') is null
     or to_regclass('public.data_repair_events') is null then
    failures := array_append(failures, 'repair tables missing');
  end if;
  if (select count(*) from public.data_repair_capability_versions) <> 4
     or (select count(*) from public.data_repair_capability_versions where plan_managed) <> 1
     or not exists(select 1 from public.data_repair_capability_versions
       where repair_key = 'student_merge' and recovery_class = 'backup_required')
     or not exists(select 1 from public.data_repair_capability_versions
       where repair_key = 'courseware_asset_replacement_rollback' and recovery_class = 'domain_rollback')
     or not exists(select 1 from public.data_repair_capability_versions
       where repair_key = 'order_status_recompute' and recovery_class = 'automatic_rollback') then
    failures := array_append(failures, 'capability boundary incomplete');
  end if;
  if has_table_privilege('authenticated', 'public.data_repair_capability_versions', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_repair_plans', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_repair_events', 'DELETE') then
    failures := array_append(failures, 'repair ledger direct writes granted');
  end if;
  execute_definition := pg_get_functiondef('public.execute_data_repair_plan(uuid)'::regprocedure);
  rollback_definition := pg_get_functiondef('public.rollback_data_repair_plan(uuid)'::regprocedure);
  if execute_definition not ilike '%system.operations.manage%'
     or execute_definition not ilike '%REPAIR_TARGET_CHANGED%'
     or execute_definition not ilike '%REPAIR_POSTCONDITION_FAILED%'
     or execute_definition ilike '%execute %'
     or rollback_definition not ilike '%REPAIR_TARGET_CHANGED%'
     or rollback_definition not ilike '%REPAIR_ROLLBACK_POSTCONDITION_FAILED%' then
    failures := array_append(failures, 'repair execution contract incomplete');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-7D repair structure assertions failed: %', array_to_string(failures, ', ');
  end if;

  begin
    update public.data_repair_capability_versions set definition = definition || ' changed'
      where repair_key = 'order_status_recompute';
    raise exception 'R1_7D_CAPABILITY_UPDATE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'DATA_REPAIR_LEDGER_IMMUTABLE' then raise; end if;
  end;
end
$$;

insert into public.staff_role_members(user_id, role_id, granted_by)
select :'teacher_id'::uuid, role_row.id, :'admin_id'::uuid
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

create function public.r17d_test_set_order_status(p_order_id uuid, p_status text)
returns void language sql security definer set search_path = public, pg_temp
as $$ update public.orders set status = p_status where id = p_order_id $$;
revoke all on function public.r17d_test_set_order_status(uuid, text) from public, anon, authenticated;
grant execute on function public.r17d_test_set_order_status(uuid, text) to authenticated;

insert into public.orders(order_no, student_id, amount_original, amount_discount, amount_due, status, created_by, term_id)
values('__R1_7D_ORDER__' || left(replace(gen_random_uuid()::text, '-', ''), 10), :'student_id'::uuid,
       100.00, 0.00, 100.00, 'refunding', :'admin_id'::uuid, :'term_id'::uuid)
returning id as repair_order_id \gset

insert into public.orders(order_no, student_id, amount_original, amount_discount, amount_due, status, created_by, term_id)
values('__R1_7D_DUE__' || left(replace(gen_random_uuid()::text, '-', ''), 10), :'student_id'::uuid,
       100.00, 0.00, 90.00, 'refunding', :'admin_id'::uuid, :'term_id'::uuid)
returning id as due_mismatch_order_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.run_data_quality_scan() ->> 'id' as quality_run_id \gset
select id as repair_finding_id from public.data_quality_findings
 where run_id = :'quality_run_id'::uuid and rule_key = 'order_amount_unbalanced' and object_id = :'repair_order_id'::uuid \gset
select id as due_mismatch_finding_id from public.data_quality_findings
 where run_id = :'quality_run_id'::uuid and rule_key = 'order_amount_unbalanced' and object_id = :'due_mismatch_order_id'::uuid \gset
select set_config('test.r17d_repair_order', :'repair_order_id', true);
select set_config('test.r17d_due_mismatch_order', :'due_mismatch_order_id', true);
select set_config('test.r17d_repair_finding', :'repair_finding_id', true);
select set_config('test.r17d_due_mismatch_finding', :'due_mismatch_finding_id', true);

do $$
declare
  preview jsonb;
  executed jsonb;
  rolled_back jsonb;
  final_execution jsonb;
  v_plan_id uuid;
  final_plan_id uuid;
  stale_status text;
begin
  if jsonb_array_length(public.list_data_repair_capabilities()) <> 4 then
    raise exception 'R1_7D_CAPABILITY_PROJECTION_INCORRECT';
  end if;
  preview := public.preview_order_status_repair(current_setting('test.r17d_repair_finding')::uuid);
  v_plan_id := (preview ->> 'id')::uuid;
  if preview ->> 'status' <> 'previewed'
     or (preview ->> 'impactCount')::integer <> 1
     or preview ->> 'targetHash' = preview ->> 'expectedAfterHash'
     or jsonb_array_length(preview -> 'events') <> 1
     or preview #>> '{recoverySnapshot,status}' <> 'refunding'
     or preview #>> '{expectedAfterSnapshot,status}' <> 'unpaid' then
    raise exception 'R1_7D_PREVIEW_INCOMPLETE';
  end if;

  perform public.r17d_test_set_order_status(current_setting('test.r17d_repair_order')::uuid, 'partial');
  begin
    perform public.execute_data_repair_plan(v_plan_id);
    raise exception 'R1_7D_STALE_EXECUTION_ACCEPTED';
  exception when others then
    if SQLERRM <> 'REPAIR_TARGET_CHANGED' then raise; end if;
  end;
  select status into stale_status from public.orders where id = current_setting('test.r17d_repair_order')::uuid;
  if stale_status <> 'partial'
     or (select repair_plan.status from public.data_repair_plans repair_plan where repair_plan.id = v_plan_id) <> 'previewed'
     or exists(select 1 from public.data_repair_events repair_event where repair_event.plan_id = v_plan_id and repair_event.event_type = 'executed') then
    raise exception 'R1_7D_STALE_EXECUTION_LEFT_PARTIAL_WRITES';
  end if;

  perform public.r17d_test_set_order_status(current_setting('test.r17d_repair_order')::uuid, 'refunding');
  executed := public.execute_data_repair_plan(v_plan_id);
  if executed ->> 'status' <> 'executed'
     or executed #>> '{afterSnapshot,status}' <> 'unpaid'
     or executed ->> 'afterHash' <> executed ->> 'expectedAfterHash'
     or jsonb_array_length(executed -> 'events') <> 2 then
    raise exception 'R1_7D_EXECUTION_INCOMPLETE';
  end if;

  rolled_back := public.rollback_data_repair_plan(v_plan_id);
  if rolled_back ->> 'status' <> 'rolled_back'
     or rolled_back ->> 'rollbackHash' <> rolled_back ->> 'targetHash'
     or jsonb_array_length(rolled_back -> 'events') <> 3
     or (select status from public.orders where id = current_setting('test.r17d_repair_order')::uuid) <> 'refunding' then
    raise exception 'R1_7D_ROLLBACK_INCOMPLETE';
  end if;
  begin
    perform public.execute_data_repair_plan(v_plan_id);
    raise exception 'R1_7D_REEXECUTION_ACCEPTED';
  exception when others then
    if SQLERRM <> 'REPAIR_PLAN_STATE_CONFLICT' then raise; end if;
  end;

  final_execution := public.preview_order_status_repair(current_setting('test.r17d_repair_finding')::uuid);
  final_plan_id := (final_execution ->> 'id')::uuid;
  final_execution := public.execute_data_repair_plan(final_plan_id);
  if (select status from public.orders where id = current_setting('test.r17d_repair_order')::uuid) <> 'unpaid'
     or final_execution ->> 'status' <> 'executed' then
    raise exception 'R1_7D_FINAL_EXECUTION_INCOMPLETE';
  end if;
  if exists(
    select 1 from public.domain_events event_row
    join public.notifications notification_row on notification_row.source_event_id = event_row.id
      where event_row.entity_id in (v_plan_id, final_plan_id)
  ) or exists(
    select 1 from public.domain_events event_row
      where event_row.entity_id in (v_plan_id, final_plan_id) and event_row.target_user_id is not null
  ) then
    raise exception 'R1_7D_REPAIR_CREATED_NOTIFICATION_NOISE';
  end if;

  begin
    perform public.preview_order_status_repair(current_setting('test.r17d_due_mismatch_finding')::uuid);
    raise exception 'R1_7D_DUE_REWRITE_PLAN_ACCEPTED';
  exception when others then
    if SQLERRM <> 'REPAIR_NOT_APPLICABLE' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
begin
  begin
    perform public.list_data_repair_plans();
    raise exception 'R1_7D_STUDENT_LIST_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.preview_order_status_repair(current_setting('test.r17d_repair_finding')::uuid);
    raise exception 'R1_7D_STUDENT_PREVIEW_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  if exists(select 1 from public.data_repair_capability_versions)
     or exists(select 1 from public.data_repair_plans)
     or exists(select 1 from public.data_repair_events) then
    raise exception 'R1_7D_STUDENT_READ_REPAIR_LEDGER';
  end if;
end
$$;

reset role;
rollback;
