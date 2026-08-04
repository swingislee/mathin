-- R1-8 缺口修复（BUG-R1M-024 / BUG-R1M-025）。
--
-- 人工验收 §9.4/§9.5 实测：`data_repair_plans` 的订单修复链是 R1-8 关闭门唯一没有覆盖的
-- 财务写入路径。三个 SECURITY DEFINER RPC 只校验 `system.operations.manage`，绕过 `orders`
-- 上的 `finance_release_gate` restrictive 策略；`project_data_repair_plan` 又把计划快照整体
-- 投影给客户端，把 amountDue/paidTotal 等金额正文下发到无 `finance.order.view` 的角色。
--
-- 本迁移做两件事：
--   1. 给 finance 域修复能力的 preview/execute/rollback 加关闭门，抛 FINANCE_RELEASE_CLOSED。
--   2. 投影层按调用者的财务可见性裁剪金额字段，只保留审计元数据与状态迁移。
-- 历史计划行、事件与 hash 不变，审计链完整。

begin;

-- ---------------------------------------------------------------------------
-- 1. 投影裁剪：金额字段只对「财务已开启且持有 finance.order.view」的调用者下发。
-- ---------------------------------------------------------------------------

create or replace function public.data_repair_finance_detail_visible(p_uid uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_uid is not null
    and public.is_feature_enabled('finance.enabled')
    and public.has_perm(p_uid, 'finance.order.view'),
    false
  )
$$;

-- 保留 orderId、status、expectedStatus 与两个布尔判据：数据维护页只渲染状态迁移，
-- 审计仍可核对「哪个对象、从什么状态改到什么状态」。金额一律不出服务端。
create or replace function public.redact_finance_repair_snapshot(p_snapshot jsonb)
returns jsonb language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when p_snapshot is null then null
    else (p_snapshot - 'amountOriginal' - 'amountDiscount' - 'amountDue' - 'expectedDue'
                     - 'paidTotal' - 'refundedTotal' - 'netPaid')
         || jsonb_build_object('amountsRedacted', true)
  end
$$;

create or replace function public.project_data_repair_plan(p_plan_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.data_repair_plans%rowtype;
  v_events jsonb;
  v_domain text;
  v_redact boolean;
  v_recovery jsonb;
  v_expected jsonb;
  v_after jsonb;
begin
  select * into v_plan from public.data_repair_plans where id = p_plan_id;
  if v_plan.id is null then return null; end if;

  select capability.domain into v_domain
    from public.data_repair_capability_versions capability
   where capability.repair_key = v_plan.repair_key and capability.version = v_plan.repair_version;

  v_redact := v_domain = 'finance'
    and not public.data_repair_finance_detail_visible((select auth.uid()));

  v_recovery := v_plan.recovery_snapshot;
  v_expected := v_plan.expected_after_snapshot;
  v_after := v_plan.after_snapshot;
  if v_redact then
    v_recovery := public.redact_finance_repair_snapshot(v_recovery);
    v_expected := public.redact_finance_repair_snapshot(v_expected);
    v_after := public.redact_finance_repair_snapshot(v_after);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', event_row.id,
    'eventType', event_row.event_type,
    'actorId', event_row.actor_id,
    'beforeHash', event_row.before_hash,
    'afterHash', event_row.after_hash,
    'details', event_row.details,
    'createdAt', event_row.created_at
  ) order by event_row.created_at, event_row.id), '[]'::jsonb)
    into v_events from public.data_repair_events event_row where event_row.plan_id = v_plan.id;

  return jsonb_build_object(
    'id', v_plan.id,
    'repairKey', v_plan.repair_key,
    'repairVersion', v_plan.repair_version,
    'sourceRunId', v_plan.source_run_id,
    'sourceFindingId', v_plan.source_finding_id,
    'targetObjectType', v_plan.target_object_type,
    'targetObjectId', v_plan.target_object_id,
    'impactCount', v_plan.impact_count,
    'targetHash', v_plan.target_hash,
    'expectedAfterHash', v_plan.expected_after_hash,
    'recoverySnapshot', v_recovery,
    'expectedAfterSnapshot', v_expected,
    'status', v_plan.status,
    'afterSnapshot', v_after,
    'afterHash', v_plan.after_hash,
    'rollbackHash', v_plan.rollback_hash,
    'createdBy', v_plan.created_by,
    'createdAt', v_plan.created_at,
    'expiresAt', v_plan.expires_at,
    'executedBy', v_plan.executed_by,
    'executedAt', v_plan.executed_at,
    'rolledBackBy', v_plan.rolled_back_by,
    'rolledBackAt', v_plan.rolled_back_at,
    'events', v_events
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 2. 关闭门：finance 域的修复能力在 finance.enabled 关闭时不可预览/执行/回滚。
-- ---------------------------------------------------------------------------

create or replace function public.assert_data_repair_release_open(p_repair_key text, p_repair_version integer)
returns void language plpgsql stable
set search_path = public, pg_temp
as $$
declare v_domain text;
begin
  select capability.domain into v_domain
    from public.data_repair_capability_versions capability
   where capability.repair_key = p_repair_key and capability.version = p_repair_version;
  if v_domain = 'finance' and not public.is_feature_enabled('finance.enabled') then
    raise exception 'FINANCE_RELEASE_CLOSED';
  end if;
end
$$;

create or replace function public.preview_order_status_repair(p_finding_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_finding public.data_quality_findings%rowtype;
  v_run public.data_quality_runs%rowtype;
  v_snapshot jsonb;
  v_expected_snapshot jsonb;
  v_target_hash text;
  v_expected_hash text;
  v_plan_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'system.operations.manage') then raise exception 'FORBIDDEN'; end if;
  perform public.assert_data_repair_release_open('order_status_recompute', 1);
  select * into v_finding from public.data_quality_findings where id = p_finding_id;
  if v_finding.id is null then raise exception 'QUALITY_FINDING_NOT_FOUND'; end if;
  select * into v_run from public.data_quality_runs where id = v_finding.run_id and status = 'completed';
  if v_run.id is null or v_finding.rule_key <> 'order_amount_unbalanced' or v_finding.object_type <> 'order' or v_finding.object_id is null then
    raise exception 'REPAIR_NOT_APPLICABLE';
  end if;

  v_snapshot := public.build_order_status_repair_snapshot(v_finding.object_id);
  if v_snapshot is null then raise exception 'REPAIR_TARGET_NOT_FOUND'; end if;
  if not (v_snapshot ->> 'dueMatches')::boolean
     or v_snapshot ->> 'status' = 'void'
     or v_snapshot ->> 'status' = v_snapshot ->> 'expectedStatus' then
    raise exception 'REPAIR_NOT_APPLICABLE';
  end if;
  v_expected_snapshot := v_snapshot || jsonb_build_object('status', v_snapshot ->> 'expectedStatus');
  v_target_hash := public.data_repair_snapshot_hash(v_snapshot);
  v_expected_hash := public.data_repair_snapshot_hash(v_expected_snapshot);

  insert into public.data_repair_plans(
    repair_key, repair_version, source_run_id, source_finding_id,
    target_object_type, target_object_id, impact_count,
    target_hash, expected_after_hash, recovery_snapshot, expected_after_snapshot,
    created_by, expires_at
  ) values(
    'order_status_recompute', 1, v_run.id, v_finding.id,
    'order', v_finding.object_id, 1,
    v_target_hash, v_expected_hash, v_snapshot, v_expected_snapshot,
    v_uid, now() + interval '24 hours'
  ) returning id into v_plan_id;

  insert into public.data_repair_events(plan_id, event_type, actor_id, before_hash, after_hash, details)
  values(v_plan_id, 'previewed', v_uid, v_target_hash, v_expected_hash,
    jsonb_build_object('sourceRunId', v_run.id, 'sourceFindingId', v_finding.id, 'impactCount', 1));

  return public.project_data_repair_plan(v_plan_id);
end
$$;

create or replace function public.execute_data_repair_plan(p_plan_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.data_repair_plans%rowtype;
  v_current_snapshot jsonb;
  v_after_snapshot jsonb;
  v_current_hash text;
  v_after_hash text;
begin
  if v_uid is null or not public.has_perm(v_uid, 'system.operations.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.data_repair_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'REPAIR_PLAN_NOT_FOUND'; end if;
  perform public.assert_data_repair_release_open(v_plan.repair_key, v_plan.repair_version);
  if v_plan.status <> 'previewed' then raise exception 'REPAIR_PLAN_STATE_CONFLICT'; end if;
  if v_plan.expires_at <= now() then raise exception 'REPAIR_PLAN_EXPIRED'; end if;
  if v_plan.repair_key <> 'order_status_recompute' or v_plan.repair_version <> 1 then raise exception 'REPAIR_KIND_NOT_SUPPORTED'; end if;

  perform 1 from public.orders where id = v_plan.target_object_id for update;
  if not found then raise exception 'REPAIR_TARGET_NOT_FOUND'; end if;
  v_current_snapshot := public.build_order_status_repair_snapshot(v_plan.target_object_id);
  v_current_hash := public.data_repair_snapshot_hash(v_current_snapshot);
  if v_current_hash <> v_plan.target_hash then raise exception 'REPAIR_TARGET_CHANGED'; end if;

  perform public.recompute_order_status(v_plan.target_object_id);
  v_after_snapshot := public.build_order_status_repair_snapshot(v_plan.target_object_id);
  v_after_hash := public.data_repair_snapshot_hash(v_after_snapshot);
  if v_after_hash <> v_plan.expected_after_hash then raise exception 'REPAIR_POSTCONDITION_FAILED'; end if;

  update public.data_repair_plans
     set status = 'executed', after_snapshot = v_after_snapshot, after_hash = v_after_hash,
         executed_by = v_uid, executed_at = clock_timestamp()
   where id = v_plan.id;
  insert into public.data_repair_events(plan_id, event_type, actor_id, before_hash, after_hash, details)
  values(v_plan.id, 'executed', v_uid, v_plan.target_hash, v_after_hash,
    jsonb_build_object('impactCount', v_plan.impact_count, 'targetObjectType', v_plan.target_object_type, 'targetObjectId', v_plan.target_object_id));
  perform public.emit_domain_event(
    'data_repair.executed', 'data_repair_plan', v_plan.id,
    jsonb_build_object('repairKey', v_plan.repair_key, 'repairVersion', v_plan.repair_version,
      'impactCount', v_plan.impact_count, 'targetHash', v_plan.target_hash, 'afterHash', v_after_hash),
    null, '/dashboard/data-maintenance'
  );
  return public.project_data_repair_plan(v_plan.id);
end
$$;

create or replace function public.rollback_data_repair_plan(p_plan_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.data_repair_plans%rowtype;
  v_current_snapshot jsonb;
  v_rollback_snapshot jsonb;
  v_current_hash text;
  v_rollback_hash text;
  v_prior_status text;
begin
  if v_uid is null or not public.has_perm(v_uid, 'system.operations.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_plan from public.data_repair_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'REPAIR_PLAN_NOT_FOUND'; end if;
  perform public.assert_data_repair_release_open(v_plan.repair_key, v_plan.repair_version);
  if v_plan.status <> 'executed' then raise exception 'REPAIR_PLAN_STATE_CONFLICT'; end if;
  if v_plan.repair_key <> 'order_status_recompute' or v_plan.repair_version <> 1 then raise exception 'REPAIR_KIND_NOT_SUPPORTED'; end if;

  perform 1 from public.orders where id = v_plan.target_object_id for update;
  if not found then raise exception 'REPAIR_TARGET_NOT_FOUND'; end if;
  v_current_snapshot := public.build_order_status_repair_snapshot(v_plan.target_object_id);
  v_current_hash := public.data_repair_snapshot_hash(v_current_snapshot);
  if v_current_hash <> v_plan.after_hash then raise exception 'REPAIR_TARGET_CHANGED'; end if;

  v_prior_status := v_plan.recovery_snapshot ->> 'status';
  update public.orders set status = v_prior_status where id = v_plan.target_object_id;
  v_rollback_snapshot := public.build_order_status_repair_snapshot(v_plan.target_object_id);
  v_rollback_hash := public.data_repair_snapshot_hash(v_rollback_snapshot);
  if v_rollback_hash <> v_plan.target_hash then raise exception 'REPAIR_ROLLBACK_POSTCONDITION_FAILED'; end if;

  update public.data_repair_plans
     set status = 'rolled_back', rollback_hash = v_rollback_hash,
         rolled_back_by = v_uid, rolled_back_at = clock_timestamp()
   where id = v_plan.id;
  insert into public.data_repair_events(plan_id, event_type, actor_id, before_hash, after_hash, details)
  values(v_plan.id, 'rolled_back', v_uid, v_plan.after_hash, v_rollback_hash,
    jsonb_build_object('impactCount', v_plan.impact_count, 'targetObjectType', v_plan.target_object_type, 'targetObjectId', v_plan.target_object_id));
  perform public.emit_domain_event(
    'data_repair.rolled_back', 'data_repair_plan', v_plan.id,
    jsonb_build_object('repairKey', v_plan.repair_key, 'repairVersion', v_plan.repair_version,
      'impactCount', v_plan.impact_count, 'beforeHash', v_plan.after_hash, 'rollbackHash', v_rollback_hash),
    null, '/dashboard/data-maintenance'
  );
  return public.project_data_repair_plan(v_plan.id);
end
$$;

revoke all on function public.data_repair_finance_detail_visible(uuid) from public, anon, authenticated;
revoke all on function public.redact_finance_repair_snapshot(jsonb) from public, anon, authenticated;
revoke all on function public.assert_data_repair_release_open(text, integer) from public, anon, authenticated;

commit;
