\set ON_ERROR_STOP on
-- R1-8: finance is release-locked closed across data, commands, work items,
-- notifications, metrics, and jobs while preserving historical rows.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select id as student_id from public.students where user_id = :'student_user_id'::uuid limit 1 \gset
select set_config('r1.teacher_id', :'teacher_id', true);

do $$
declare failures text[] := '{}';
begin
  if public.finance_release_gate_open() then failures := array_append(failures, 'release gate unexpectedly open'); end if;
  if public.is_feature_enabled('finance.enabled') then failures := array_append(failures, 'finance feature unexpectedly enabled'); end if;
  if (select count(*) from pg_policies where schemaname = 'public' and policyname = 'finance_release_gate'
      and tablename = any(array['orders','order_items','payments','refunds','coupons','coupon_grants','scholarships','student_accounts','account_ledger'])) <> 9
  then failures := array_append(failures, 'restrictive finance table policies incomplete'); end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.work_items'::regclass and tgname = 'work_items_finance_release_gate' and not tgisinternal)
  then failures := array_append(failures, 'work item release trigger missing'); end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.approval_requests'::regclass and tgname = 'approval_requests_finance_release_gate' and not tgisinternal)
  then failures := array_append(failures, 'approval release trigger missing'); end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.jobs'::regclass and tgname = 'jobs_finance_release_gate' and not tgisinternal)
  then failures := array_append(failures, 'job release trigger missing'); end if;
  if cardinality(failures) > 0 then raise exception 'R1-8 structure assertions failed: %', array_to_string(failures, ', '); end if;
end
$$;

insert into public.orders(id, order_no, student_id, kind, amount_original, amount_discount, amount_due, status, remark, created_by)
values ('00000000-0000-4000-8000-000000009981', 'R1-8-CLOSED-ORDER', :'student_id', 'deposit', 10, 0, 10, 'unpaid', 'R1-8 retained history', :'admin_id');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
begin
  if public.has_perm(auth.uid(), 'finance.order.view') then raise exception 'R1_FINANCE_PERMISSION_VISIBLE'; end if;
  if exists(select 1 from public.orders where id = '00000000-0000-4000-8000-000000009981')
  then raise exception 'R1_FINANCE_TABLE_ROW_VISIBLE'; end if;
  if exists(select 1 from public.list_my_work_items() where domain = 'finance' or action_href like '/dashboard/finance%')
  then raise exception 'R1_FINANCE_WORK_ITEM_VISIBLE'; end if;
  begin
    perform public.set_feature_flag('finance.enabled', null, true, now(), 'R1-8 forbidden enable');
    raise exception 'R1_FINANCE_ENABLE_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;
  begin
    perform public.create_coupon('R18CLOSED', 'R1-8 closed coupon', 'amount', 10, '{}'::jsonb, null, null);
    raise exception 'R1_FINANCE_COMMAND_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  begin
    perform public.create_durable_work_item(
      'manual', 'r1-8-closed', 'r1-8-closed-work', 'finance', 'Closed finance work', '',
      current_setting('r1.teacher_id')::uuid, now() + interval '1 day', 'normal', 'R1-8 closed', '/dashboard/finance'
    );
    raise exception 'R1_FINANCE_WORK_ITEM_CREATE_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;
  begin
    perform public.request_approval(
      'finance.release', 'finance', 'r1-8', 'r1-8-closed-approval', 'finance',
      'Closed finance approval', 'R1-8 closed', '{}'::jsonb, current_setting('r1.teacher_id')::uuid,
      now() + interval '1 day', 'normal', '/dashboard/finance'
    );
    raise exception 'R1_FINANCE_APPROVAL_CREATE_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;
end
$$;
reset role;

-- Simulate rows created before the release gate existed. The gate hides the
-- coordination records and cancels the queued job without deleting history.
set local session_replication_role = replica;
insert into public.work_items(
  id, source_kind, source_id, idempotency_key, domain, title, description, action_href,
  assignee_id, due_at, priority, created_reason, created_by
) values (
  '00000000-0000-4000-8000-000000009982', 'manual', 'r1-8-legacy', 'r1-8-legacy-work',
  'finance', 'Legacy finance work', '', '/dashboard/finance', :'teacher_id', now() + interval '1 day',
  'normal', 'R1-8 legacy fixture', :'admin_id'
);
insert into public.approval_requests(
  id, approval_kind, subject_kind, subject_id, idempotency_key, domain, title,
  request_reason, payload, action_href, requester_id, approver_id, due_at, priority
) values (
  '00000000-0000-4000-8000-000000009983', 'finance.release', 'finance', 'r1-8',
  'r1-8-legacy-approval', 'finance', 'Legacy finance approval', 'R1-8 legacy fixture',
  '{}'::jsonb, '/dashboard/finance', :'admin_id', :'teacher_id', now() + interval '1 day', 'normal'
);
insert into public.jobs(
  id, kind, payload, idempotency_key, effect_key, status
) values (
  '00000000-0000-4000-8000-000000009984', 'finance.reconcile', '{"domain":"finance"}'::jsonb,
  'r1-8-legacy-job', 'r1-8-legacy-effect', 'pending'
);
set local session_replication_role = origin;

select public.emit_domain_event(
  'finance.test', 'finance', '00000000-0000-4000-8000-000000009981',
  jsonb_build_object('domain', 'finance'), :'teacher_id'::uuid, '/dashboard/finance'
) as finance_event_id \gset
select set_config('r1.finance_event_id', :'finance_event_id', true);

do $$
begin
  if exists(select 1 from public.notifications where source_event_id = current_setting('r1.finance_event_id')::uuid)
  then raise exception 'R1_FINANCE_NOTIFICATION_STAGED'; end if;
end
$$;

insert into public.notifications(
  id, source_event_id, recipient_id, notification_key, idempotency_key, payload, deep_link, occurred_at
) values (
  '00000000-0000-4000-8000-000000009985', :'finance_event_id', :'teacher_id', 'finance.test',
  'r1-8-legacy-notification', '{"domain":"finance"}'::jsonb, '/dashboard/finance', now()
);
insert into public.notification_deliveries(
  id, notification_id, recipient_id, channel, idempotency_key, status, sent_at
) values (
  '00000000-0000-4000-8000-000000009986', '00000000-0000-4000-8000-000000009985',
  :'teacher_id', 'in_app', 'r1-8-legacy-delivery', 'sent', now()
);

select set_config('r1.suppressed_jobs', public.suppress_closed_finance_jobs()::text, true);
do $$
begin
  if current_setting('r1.suppressed_jobs')::integer <> 1 then raise exception 'R1_FINANCE_JOB_NOT_SUPPRESSED'; end if;
  if (select status from public.jobs where id = '00000000-0000-4000-8000-000000009984') <> 'cancelled'
  then raise exception 'R1_FINANCE_JOB_STILL_ACTIONABLE'; end if;
  begin
    perform public.enqueue_job('finance.reconcile', '{"domain":"finance"}'::jsonb, 'r1-8-new-job');
    raise exception 'R1_FINANCE_JOB_CREATE_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  if exists(select 1 from public.list_my_work_items() where domain = 'finance' or action_href like '/dashboard/finance%')
  then raise exception 'R1_LEGACY_FINANCE_COORDINATION_VISIBLE'; end if;
  if exists(select 1 from public.list_my_work_summary() where domain = 'finance')
  then raise exception 'R1_FINANCE_WORK_METRIC_VISIBLE'; end if;
  if exists(select 1 from public.notifications where id = '00000000-0000-4000-8000-000000009985')
  then raise exception 'R1_LEGACY_FINANCE_NOTIFICATION_VISIBLE'; end if;
  if exists(select 1 from public.notification_deliveries where id = '00000000-0000-4000-8000-000000009986')
  then raise exception 'R1_LEGACY_FINANCE_DELIVERY_VISIBLE'; end if;
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- BUG-R1M-025：领域修复计划是关闭门此前唯一漏掉的 orders 写入路径。
-- BUG-R1M-024：计划快照曾把订单金额正文整体投影给无 finance.order.view 的角色。
-- ---------------------------------------------------------------------------

insert into public.staff_role_members(user_id, role_id, granted_by)
select :'teacher_id'::uuid, role_row.id, :'admin_id'::uuid
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

select id as gate_term_id from public.school_terms where is_current order by created_at limit 1 \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  if not public.has_perm(auth.uid(), 'system.operations.manage') then
    raise exception 'R1_FINANCE_REPAIR_FIXTURE_MISSING_PERM';
  end if;
  -- 关闭态下 preview 在读取 finding 之前即被关闭门拒绝。
  begin
    perform public.preview_order_status_repair('00000000-0000-4000-8000-000000009987'::uuid);
    raise exception 'R1_FINANCE_REPAIR_PREVIEW_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;
end
$$;
reset role;

-- 直接构造一个「关闭门上线前留下的 executed 计划」。发布门 finance_release_gate_open()
-- 是硬编码 select false 的安全边界，测试不替换它；计划行按 §13.5 记录的真实金额形状
-- 写入，用于检验关闭态下的拒绝与投影裁剪。
insert into public.orders(order_no, student_id, amount_original, amount_discount, amount_due, status, created_by, term_id)
values('__R1_8_GATE__' || left(replace(gen_random_uuid()::text, '-', ''), 10), :'student_id'::uuid,
       3000.00, 200.00, 2800.00, 'refunding', :'admin_id'::uuid, :'gate_term_id'::uuid)
returning id as gate_order_id \gset

select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.run_data_quality_scan() ->> 'id' as gate_run_id \gset
select id as gate_finding_id from public.data_quality_findings
 where run_id = :'gate_run_id'::uuid and rule_key = 'order_amount_unbalanced' and object_id = :'gate_order_id'::uuid \gset

select public.build_order_status_repair_snapshot(:'gate_order_id'::uuid) as gate_snapshot \gset
insert into public.data_repair_plans(
  repair_key, repair_version, source_run_id, source_finding_id,
  target_object_type, target_object_id, impact_count,
  target_hash, expected_after_hash, recovery_snapshot, expected_after_snapshot,
  status, after_snapshot, after_hash, executed_by, executed_at, created_by, expires_at
)
select
  'order_status_recompute', 1, :'gate_run_id'::uuid, :'gate_finding_id'::uuid,
  'order', :'gate_order_id'::uuid, 1,
  public.data_repair_snapshot_hash(:'gate_snapshot'::jsonb),
  public.data_repair_snapshot_hash(expected.snapshot),
  :'gate_snapshot'::jsonb, expected.snapshot,
  'executed', expected.snapshot, public.data_repair_snapshot_hash(expected.snapshot),
  :'admin_id'::uuid, now() - interval '1 hour', :'admin_id'::uuid, now() + interval '24 hours'
from (
  select (:'gate_snapshot'::jsonb || jsonb_build_object('status', :'gate_snapshot'::jsonb ->> 'expectedStatus')) as snapshot
) expected
returning id as gate_plan_id \gset

insert into public.data_repair_events(plan_id, event_type, actor_id, before_hash, after_hash, details)
select :'gate_plan_id'::uuid, event_type, :'admin_id'::uuid,
  public.data_repair_snapshot_hash(:'gate_snapshot'::jsonb),
  public.data_repair_snapshot_hash(:'gate_snapshot'::jsonb),
  '{"impactCount": 1}'::jsonb
from (values ('previewed'), ('executed')) as fixture(event_type);

select set_config('r1.gate_plan_id', :'gate_plan_id', true);
select set_config('r1.gate_order_id', :'gate_order_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
declare
  v_plan_id uuid := current_setting('r1.gate_plan_id')::uuid;
  v_status_before text;
  v_projection jsonb;
begin
  if public.is_feature_enabled('finance.enabled') then raise exception 'R1_FINANCE_GATE_FIXTURE_STILL_OPEN'; end if;
  select status into v_status_before from public.data_repair_plans where id = v_plan_id;
  if v_status_before <> 'executed' then raise exception 'R1_FINANCE_REPAIR_FIXTURE_NOT_EXECUTED'; end if;

  begin
    perform public.rollback_data_repair_plan(v_plan_id);
    raise exception 'R1_FINANCE_REPAIR_ROLLBACK_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;
  begin
    perform public.execute_data_repair_plan(v_plan_id);
    raise exception 'R1_FINANCE_REPAIR_EXECUTE_ACCEPTED';
  exception when others then if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if; end;

  if (select status from public.data_repair_plans where id = v_plan_id) <> 'executed'
     or exists(select 1 from public.data_repair_events where plan_id = v_plan_id and event_type = 'rolled_back') then
    raise exception 'R1_FINANCE_REPAIR_GATE_LEFT_PARTIAL_WRITES';
  end if;

  -- BUG-R1M-024：投影只保留审计元数据与状态迁移，金额键一律不下发。
  v_projection := public.get_data_repair_plan(v_plan_id);
  if v_projection #>> '{recoverySnapshot,status}' is null
     or v_projection ->> 'targetHash' is null
     or (v_projection ->> 'impactCount')::integer <> 1 then
    raise exception 'R1_FINANCE_REPAIR_AUDIT_METADATA_MISSING';
  end if;
  if v_projection #> '{recoverySnapshot,amountDue}' is not null
     or v_projection #> '{recoverySnapshot,paidTotal}' is not null
     or v_projection #> '{recoverySnapshot,amountOriginal}' is not null
     or v_projection #> '{recoverySnapshot,netPaid}' is not null
     or v_projection #> '{expectedAfterSnapshot,amountDue}' is not null
     or v_projection #> '{afterSnapshot,amountDue}' is not null
     or v_projection #> '{afterSnapshot,refundedTotal}' is not null then
    raise exception 'R1_FINANCE_REPAIR_AMOUNTS_LEAKED';
  end if;
  if not coalesce((v_projection #>> '{recoverySnapshot,amountsRedacted}')::boolean, false) then
    raise exception 'R1_FINANCE_REPAIR_REDACTION_NOT_MARKED';
  end if;
  if public.list_data_repair_plans()::text like '%amountDue%' then
    raise exception 'R1_FINANCE_REPAIR_LIST_AMOUNTS_LEAKED';
  end if;
end
$$;
reset role;

rollback;
\echo R1-8 finance safe-close assertions passed
