-- R1-7D: versioned, allowlisted data repair plans with stable target hashes,
-- recovery snapshots, transactional execution and audited rollback.

create table public.data_repair_capability_versions (
  repair_key text not null check (length(repair_key) between 3 and 100),
  version integer not null check (version > 0),
  domain text not null check (length(domain) between 2 and 100),
  recovery_class text not null check (recovery_class in ('automatic_rollback', 'domain_rollback', 'backup_required')),
  plan_managed boolean not null default false,
  entrypoint text not null check (length(entrypoint) between 3 and 240),
  definition text not null check (length(definition) between 10 and 1000),
  definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (repair_key, version),
  unique (repair_key)
);

with capabilities(repair_key, version, domain, recovery_class, plan_managed, entrypoint, definition) as (
  values
    ('order_status_recompute', 1, 'finance', 'automatic_rollback', true,
      'preview_order_status_repair -> execute_data_repair_plan -> rollback_data_repair_plan',
      'Recompute one non-void order status from append-only payment and completed-refund ledgers; preserve the prior status as the automatic recovery point.'),
    ('student_merge', 1, 'student', 'backup_required', false,
      'merge_students',
      'Merge duplicate student relationships into a kept student. The operation is transactional but is not automatically reversible and therefore requires an external backup recovery point.'),
    ('courseware_asset_replacement_rollback', 1, 'courseware', 'domain_rollback', false,
      'rollback_cw_asset_replacement',
      'Rollback one applied courseware asset replacement through its existing domain ledger and conflict checks.'),
    ('test_data_purge', 1, 'testdata', 'backup_required', false,
      'purge_test_course_family / purge_test_classroom',
      'Permanently delete allowlisted test-purpose data after existing domain guards. Automatic rollback is unavailable and a verified backup is required.')
)
insert into public.data_repair_capability_versions(
  repair_key, version, domain, recovery_class, plan_managed, entrypoint, definition, definition_hash
)
select repair_key, version, domain, recovery_class, plan_managed, entrypoint, definition,
  encode(extensions.digest(convert_to(definition, 'UTF8'), 'sha256'), 'hex')
from capabilities;

create or replace function public.guard_data_repair_ledger_immutable()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'DATA_REPAIR_LEDGER_IMMUTABLE';
end
$$;

create trigger data_repair_capabilities_immutable
before update or delete on public.data_repair_capability_versions
for each row execute function public.guard_data_repair_ledger_immutable();

create table public.data_repair_plans (
  id uuid primary key default gen_random_uuid(),
  repair_key text not null,
  repair_version integer not null,
  source_run_id uuid not null references public.data_quality_runs(id) on delete restrict,
  source_finding_id uuid not null references public.data_quality_findings(id) on delete restrict,
  target_object_type text not null check (length(target_object_type) between 1 and 100),
  target_object_id uuid not null,
  impact_count integer not null check (impact_count between 1 and 10000),
  target_hash text not null check (target_hash ~ '^[0-9a-f]{64}$'),
  expected_after_hash text not null check (expected_after_hash ~ '^[0-9a-f]{64}$'),
  recovery_snapshot jsonb not null,
  expected_after_snapshot jsonb not null,
  status text not null default 'previewed' check (status in ('previewed', 'executed', 'rolled_back')),
  after_snapshot jsonb,
  after_hash text check (after_hash is null or after_hash ~ '^[0-9a-f]{64}$'),
  rollback_hash text check (rollback_hash is null or rollback_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  executed_by uuid references public.profiles(id),
  executed_at timestamptz,
  rolled_back_by uuid references public.profiles(id),
  rolled_back_at timestamptz,
  foreign key(repair_key, repair_version) references public.data_repair_capability_versions(repair_key, version),
  constraint data_repair_snapshot_caps check (
    octet_length(recovery_snapshot::text) <= 32768
    and octet_length(expected_after_snapshot::text) <= 32768
    and (after_snapshot is null or octet_length(after_snapshot::text) <= 32768)
  ),
  constraint data_repair_plan_state check (
    (status = 'previewed' and executed_by is null and executed_at is null and after_snapshot is null and after_hash is null
      and rolled_back_by is null and rolled_back_at is null and rollback_hash is null)
    or (status = 'executed' and executed_by is not null and executed_at is not null and after_snapshot is not null and after_hash is not null
      and rolled_back_by is null and rolled_back_at is null and rollback_hash is null)
    or (status = 'rolled_back' and executed_by is not null and executed_at is not null and after_snapshot is not null and after_hash is not null
      and rolled_back_by is not null and rolled_back_at is not null and rollback_hash is not null)
  )
);
create index data_repair_plans_latest_idx on public.data_repair_plans(created_at desc);
create index data_repair_plans_target_idx on public.data_repair_plans(target_object_type, target_object_id, created_at desc);

create table public.data_repair_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.data_repair_plans(id) on delete restrict,
  event_type text not null check (event_type in ('previewed', 'executed', 'rolled_back')),
  actor_id uuid not null references public.profiles(id),
  before_hash text not null check (before_hash ~ '^[0-9a-f]{64}$'),
  after_hash text not null check (after_hash ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) <= 8192),
  created_at timestamptz not null default now(),
  unique(plan_id, event_type)
);
create index data_repair_events_plan_idx on public.data_repair_events(plan_id, created_at);

create trigger data_repair_events_immutable
before update or delete on public.data_repair_events
for each row execute function public.guard_data_repair_ledger_immutable();

alter table public.data_repair_capability_versions enable row level security;
alter table public.data_repair_plans enable row level security;
alter table public.data_repair_events enable row level security;

create policy data_repair_capabilities_audit_read on public.data_repair_capability_versions
for select to authenticated using (public.has_perm((select auth.uid()), 'audit.view'));
create policy data_repair_plans_audit_read on public.data_repair_plans
for select to authenticated using (public.has_perm((select auth.uid()), 'audit.view'));
create policy data_repair_events_audit_read on public.data_repair_events
for select to authenticated using (public.has_perm((select auth.uid()), 'audit.view'));

revoke all on public.data_repair_capability_versions, public.data_repair_plans, public.data_repair_events from anon, authenticated;
grant select on public.data_repair_capability_versions, public.data_repair_plans, public.data_repair_events to authenticated;

create or replace function public.data_repair_snapshot_hash(p_snapshot jsonb)
returns text language sql immutable
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.build_order_status_repair_snapshot(p_order_id uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp
as $$
  with order_totals as (
    select
      order_row.id,
      order_row.amount_original,
      order_row.amount_discount,
      order_row.amount_due,
      order_row.status,
      coalesce((select sum(payment_row.amount) from public.payments payment_row where payment_row.order_id = order_row.id), 0)::numeric(12,2) as paid_total,
      coalesce((select sum(refund_row.amount) from public.refunds refund_row where refund_row.order_id = order_row.id and refund_row.status = 'done'), 0)::numeric(12,2) as refunded_total,
      exists(select 1 from public.refunds refund_row where refund_row.order_id = order_row.id and refund_row.status = 'pending') as has_pending_refund
    from public.orders order_row
    where order_row.id = p_order_id
  ), order_state as (
    select totals.*,
      totals.paid_total - totals.refunded_total as net_paid,
      case
        when totals.has_pending_refund then 'refunding'
        when totals.refunded_total > 0 and totals.paid_total - totals.refunded_total <= 0 then 'refunded'
        when totals.amount_due <= 0 and totals.paid_total = 0 then 'paid'
        when totals.paid_total - totals.refunded_total >= totals.amount_due and totals.amount_due > 0 then 'paid'
        when totals.paid_total - totals.refunded_total > 0 then 'partial'
        else 'unpaid'
      end as expected_status
    from order_totals totals
  )
  select jsonb_build_object(
    'orderId', state.id,
    'amountOriginal', state.amount_original,
    'amountDiscount', state.amount_discount,
    'amountDue', state.amount_due,
    'expectedDue', greatest(state.amount_original - state.amount_discount, 0),
    'paidTotal', state.paid_total,
    'refundedTotal', state.refunded_total,
    'netPaid', state.net_paid,
    'hasPendingRefund', state.has_pending_refund,
    'status', state.status,
    'expectedStatus', state.expected_status,
    'dueMatches', state.amount_due is not distinct from greatest(state.amount_original - state.amount_discount, 0)
  )
  from order_state state
$$;

create or replace function public.project_data_repair_plan(p_plan_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.data_repair_plans%rowtype;
  v_events jsonb;
begin
  select * into v_plan from public.data_repair_plans where id = p_plan_id;
  if v_plan.id is null then return null; end if;
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
    'recoverySnapshot', v_plan.recovery_snapshot,
    'expectedAfterSnapshot', v_plan.expected_after_snapshot,
    'status', v_plan.status,
    'afterSnapshot', v_plan.after_snapshot,
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

create or replace function public.list_data_repair_capabilities()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not public.has_perm(v_uid, 'audit.view') then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'repairKey', capability.repair_key,
    'version', capability.version,
    'domain', capability.domain,
    'recoveryClass', capability.recovery_class,
    'planManaged', capability.plan_managed,
    'entrypoint', capability.entrypoint,
    'definitionHash', capability.definition_hash
  ) order by capability.domain, capability.repair_key), '[]'::jsonb)
    into v_result from public.data_repair_capability_versions capability;
  return v_result;
end
$$;

create or replace function public.list_data_repair_plans()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not public.has_perm(v_uid, 'audit.view') then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(public.project_data_repair_plan(recent.id) order by recent.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select plan_row.id, plan_row.created_at from public.data_repair_plans plan_row
      order by plan_row.created_at desc limit 25
    ) recent;
  return v_result;
end
$$;

create or replace function public.get_data_repair_plan(p_plan_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not public.has_perm(v_uid, 'audit.view') then raise exception 'FORBIDDEN'; end if;
  v_result := public.project_data_repair_plan(p_plan_id);
  if v_result is null then raise exception 'NOT_FOUND'; end if;
  return v_result;
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

revoke all on function public.data_repair_snapshot_hash(jsonb) from public, anon, authenticated;
revoke all on function public.build_order_status_repair_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.project_data_repair_plan(uuid) from public, anon, authenticated;
revoke all on function public.list_data_repair_capabilities() from public, anon, authenticated;
revoke all on function public.list_data_repair_plans() from public, anon, authenticated;
revoke all on function public.get_data_repair_plan(uuid) from public, anon, authenticated;
revoke all on function public.preview_order_status_repair(uuid) from public, anon, authenticated;
revoke all on function public.execute_data_repair_plan(uuid) from public, anon, authenticated;
revoke all on function public.rollback_data_repair_plan(uuid) from public, anon, authenticated;
grant execute on function public.list_data_repair_capabilities() to authenticated;
grant execute on function public.list_data_repair_plans() to authenticated;
grant execute on function public.get_data_repair_plan(uuid) to authenticated;
grant execute on function public.preview_order_status_repair(uuid) to authenticated;
grant execute on function public.execute_data_repair_plan(uuid) to authenticated;
grant execute on function public.rollback_data_repair_plan(uuid) to authenticated;
