-- R1-7C: persistent, versioned data-quality scans. Scans are detection-only;
-- they never mutate the inspected business objects.

create table public.data_quality_rule_versions (
  rule_key text not null check (length(rule_key) between 3 and 100),
  version integer not null check (version > 0),
  rule_set_version text not null check (length(rule_set_version) between 3 and 100),
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  object_type text not null check (length(object_type) between 1 and 100),
  definition text not null check (length(definition) between 10 and 1000),
  definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (rule_key, version),
  constraint data_quality_rule_set_rule_key_unique unique (rule_set_version, rule_key)
);

create or replace function public.guard_data_quality_rule_immutable()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'QUALITY_RULE_IMMUTABLE';
end
$$;

create trigger data_quality_rule_versions_immutable
before update or delete on public.data_quality_rule_versions
for each row execute function public.guard_data_quality_rule_immutable();

with rules(rule_key, version, rule_set_version, severity, object_type, definition) as (
  values
    ('orphan_active_enrollment', 1, 'mathin-data-quality-v1', 'critical', 'enrollment', 'Active enrollment references a soft-deleted student.'),
    ('duplicate_student_phone', 1, 'mathin-data-quality-v1', 'error', 'student', 'Two or more active student records share the same normalized non-empty phone number.'),
    ('illegal_session_state', 1, 'mathin-data-quality-v1', 'error', 'class_session', 'A non-deleted class session ended without starting or ended before its start time.'),
    ('order_amount_unbalanced', 1, 'mathin-data-quality-v1', 'critical', 'order', 'Order due amount or derived status differs from append-only payment and completed-refund ledgers.'),
    ('missing_courseware_object', 1, 'mathin-data-quality-v1', 'critical', 'courseware_asset_object', 'A non-H5 courseware CAS object has no matching cw-objects storage row.')
)
insert into public.data_quality_rule_versions(
  rule_key, version, rule_set_version, severity, object_type, definition, definition_hash
)
select rule_key, version, rule_set_version, severity, object_type, definition,
  encode(extensions.digest(convert_to(definition, 'UTF8'), 'sha256'), 'hex')
from rules
on conflict(rule_key, version) do nothing;

create table public.data_quality_runs (
  id uuid primary key default gen_random_uuid(),
  rule_set_version text not null check (length(rule_set_version) between 3 and 100),
  rules_hash text not null check (rules_hash ~ '^[0-9a-f]{64}$'),
  snapshot_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'completed')),
  total_findings integer not null default 0 check (total_findings >= 0),
  info_findings integer not null default 0 check (info_findings >= 0),
  warning_findings integer not null default 0 check (warning_findings >= 0),
  error_findings integer not null default 0 check (error_findings >= 0),
  critical_findings integer not null default 0 check (critical_findings >= 0),
  findings_hash text check (findings_hash is null or findings_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint data_quality_run_completion check (
    (status = 'running' and completed_at is null and findings_hash is null)
    or (status = 'completed' and completed_at is not null and findings_hash is not null)
  ),
  constraint data_quality_run_counts check (
    total_findings = info_findings + warning_findings + error_findings + critical_findings
  )
);
create index data_quality_runs_latest_idx on public.data_quality_runs(completed_at desc) where status = 'completed';

create table public.data_quality_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.data_quality_runs(id) on delete cascade,
  rule_key text not null,
  rule_version integer not null,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  object_type text not null check (length(object_type) between 1 and 100),
  object_id uuid,
  dedupe_key text not null check (length(dedupe_key) between 1 and 240),
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(rule_key, rule_version) references public.data_quality_rule_versions(rule_key, version),
  unique(run_id, rule_key, dedupe_key),
  constraint data_quality_finding_evidence_cap check (octet_length(evidence::text) <= 32768)
);
create index data_quality_findings_run_severity_idx on public.data_quality_findings(run_id, severity, rule_key);
create index data_quality_findings_object_idx on public.data_quality_findings(object_type, object_id) where object_id is not null;

alter table public.data_quality_rule_versions enable row level security;
alter table public.data_quality_runs enable row level security;
alter table public.data_quality_findings enable row level security;

create policy data_quality_rules_audit_read on public.data_quality_rule_versions
for select to authenticated using (public.has_perm((select auth.uid()), 'audit.view'));
create policy data_quality_runs_audit_read on public.data_quality_runs
for select to authenticated using (public.has_perm((select auth.uid()), 'audit.view'));
create policy data_quality_findings_audit_read on public.data_quality_findings
for select to authenticated using (public.has_perm((select auth.uid()), 'audit.view'));

revoke all on public.data_quality_rule_versions, public.data_quality_runs, public.data_quality_findings from anon, authenticated;
grant select on public.data_quality_rule_versions, public.data_quality_runs, public.data_quality_findings to authenticated;

create or replace function public.get_data_quality_run(p_run_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.data_quality_runs%rowtype;
  v_findings jsonb;
begin
  if v_uid is null or not public.has_perm(v_uid, 'audit.view') then raise exception 'FORBIDDEN'; end if;
  select * into v_run from public.data_quality_runs where id = p_run_id and status = 'completed';
  if v_run.id is null then raise exception 'NOT_FOUND'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'ruleKey', item.rule_key,
    'ruleVersion', item.rule_version,
    'severity', item.severity,
    'objectType', item.object_type,
    'objectId', item.object_id,
    'dedupeKey', item.dedupe_key,
    'evidence', item.evidence,
    'observedAt', item.observed_at
  ) order by
    case item.severity when 'critical' then 1 when 'error' then 2 when 'warning' then 3 else 4 end,
    item.rule_key, item.dedupe_key), '[]'::jsonb)
    into v_findings
    from (
      select * from public.data_quality_findings
       where run_id = v_run.id
       order by case severity when 'critical' then 1 when 'error' then 2 when 'warning' then 3 else 4 end,
                rule_key, dedupe_key
       limit 200
    ) item;

  return jsonb_build_object(
    'id', v_run.id,
    'ruleSetVersion', v_run.rule_set_version,
    'rulesHash', v_run.rules_hash,
    'snapshotAt', v_run.snapshot_at,
    'status', v_run.status,
    'total', v_run.total_findings,
    'counts', jsonb_build_object(
      'info', v_run.info_findings,
      'warning', v_run.warning_findings,
      'error', v_run.error_findings,
      'critical', v_run.critical_findings
    ),
    'findingsHash', v_run.findings_hash,
    'completedAt', v_run.completed_at,
    'truncated', v_run.total_findings > 200,
    'findings', v_findings
  );
end
$$;

create or replace function public.get_latest_data_quality_run()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'audit.view') then raise exception 'FORBIDDEN'; end if;
  select id into v_run_id from public.data_quality_runs
   where status = 'completed' order by completed_at desc limit 1;
  if v_run_id is null then return null; end if;
  return public.get_data_quality_run(v_run_id);
end
$$;

create or replace function public.run_data_quality_scan()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rule_set text := 'mathin-data-quality-v1';
  v_rules_hash text;
  v_run_id uuid;
  v_snapshot timestamptz := statement_timestamp();
  v_total integer;
  v_info integer;
  v_warning integer;
  v_error integer;
  v_critical integer;
  v_findings_hash text;
begin
  if v_uid is null or not public.has_perm(v_uid, 'system.operations.manage') then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtext('mathin-data-quality-scan'));

  select encode(extensions.digest(convert_to(string_agg(
    rule_key || ':' || version::text || ':' || severity || ':' || definition_hash,
    E'\n' order by rule_key, version
  ), 'UTF8'), 'sha256'), 'hex')
    into v_rules_hash
    from public.data_quality_rule_versions
   where rule_set_version = v_rule_set and enabled;
  if v_rules_hash is null then raise exception 'QUALITY_RULE_SET_EMPTY'; end if;

  insert into public.data_quality_runs(rule_set_version, rules_hash, snapshot_at, created_by)
  values(v_rule_set, v_rules_hash, v_snapshot, v_uid)
  returning id into v_run_id;

  with duplicate_phone_groups as (
    select
      regexp_replace(trim(student_row.phone), '[^0-9+]', '', 'g') as normalized_phone,
      array_agg(student_row.id order by student_row.id) as student_ids,
      count(*)::integer as duplicate_count
    from public.students student_row
    where student_row.deleted_at is null
      and regexp_replace(trim(student_row.phone), '[^0-9+]', '', 'g') <> ''
    group by regexp_replace(trim(student_row.phone), '[^0-9+]', '', 'g')
    having count(*) > 1
  ), order_totals as (
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
  ), candidates(rule_key, object_id, dedupe_key, evidence) as (
    select
      'orphan_active_enrollment', enrollment_row.id,
      'enrollment:' || enrollment_row.id::text,
      jsonb_build_object(
        'enrollmentId', enrollment_row.id,
        'studentId', enrollment_row.student_id,
        'reason', 'active_student_deleted'
      )
    from public.enrollments enrollment_row
    join public.students student_row on student_row.id = enrollment_row.student_id
    where enrollment_row.status = 'active' and student_row.deleted_at is not null

    union all

    select
      'duplicate_student_phone', phone_group.student_ids[1],
      'student-set:' || encode(extensions.digest(convert_to(array_to_string(phone_group.student_ids, ','), 'UTF8'), 'sha256'), 'hex'),
      jsonb_build_object(
        'studentIds', to_jsonb(phone_group.student_ids),
        'duplicateCount', phone_group.duplicate_count,
        'normalizedKeyHash', encode(extensions.digest(convert_to(phone_group.normalized_phone, 'UTF8'), 'sha256'), 'hex')
      )
    from duplicate_phone_groups phone_group

    union all

    select
      'illegal_session_state', session_row.id,
      'session:' || session_row.id::text,
      jsonb_build_object(
        'sessionId', session_row.id,
        'startedAt', session_row.started_at,
        'endedAt', session_row.ended_at,
        'reason', case when session_row.started_at is null then 'ended_without_start' else 'ended_before_start' end
      )
    from public.class_sessions session_row
    where session_row.deleted_at is null
      and session_row.ended_at is not null
      and (session_row.started_at is null or session_row.ended_at < session_row.started_at)

    union all

    select
      'order_amount_unbalanced', order_row.id,
      'order:' || order_row.id::text,
      jsonb_build_object(
        'orderId', order_row.id,
        'amountOriginal', order_row.amount_original,
        'amountDiscount', order_row.amount_discount,
        'amountDue', order_row.amount_due,
        'expectedDue', greatest(order_row.amount_original - order_row.amount_discount, 0),
        'paidTotal', order_row.paid_total,
        'refundedTotal', order_row.refunded_total,
        'netPaid', order_row.net_paid,
        'actualStatus', order_row.status,
        'expectedStatus', order_row.expected_status
      )
    from order_state order_row
    where order_row.amount_due is distinct from greatest(order_row.amount_original - order_row.amount_discount, 0)
       or (order_row.status <> 'void' and order_row.status is distinct from order_row.expected_status)

    union all

    select
      'missing_courseware_object', object_row.id,
      'courseware-object:' || object_row.id::text,
      jsonb_build_object(
        'objectId', object_row.id,
        'sha256', object_row.sha256,
        'storagePath', object_row.storage_path,
        'bucket', 'cw-objects'
      )
    from public.cw_asset_objects object_row
    where object_row.kind <> 'h5'
      and not exists(
        select 1 from storage.objects storage_row
         where storage_row.bucket_id = 'cw-objects'
           and storage_row.name = object_row.storage_path
      )
  ), inserted as (
    insert into public.data_quality_findings(
      run_id, rule_key, rule_version, severity, object_type,
      object_id, dedupe_key, evidence, observed_at
    )
    select
      v_run_id, candidate.rule_key, rule_row.version, rule_row.severity, rule_row.object_type,
      candidate.object_id, candidate.dedupe_key, candidate.evidence, v_snapshot
    from candidates candidate
    join public.data_quality_rule_versions rule_row
      on rule_row.rule_key = candidate.rule_key
     and rule_row.rule_set_version = v_rule_set
     and rule_row.enabled
    returning severity
  )
  select
    count(*)::integer,
    count(*) filter(where severity = 'info')::integer,
    count(*) filter(where severity = 'warning')::integer,
    count(*) filter(where severity = 'error')::integer,
    count(*) filter(where severity = 'critical')::integer
  into v_total, v_info, v_warning, v_error, v_critical
  from inserted;

  select encode(extensions.digest(convert_to(coalesce(string_agg(
    finding_row.rule_key || ':' || finding_row.dedupe_key || ':' || finding_row.evidence::text,
    E'\n' order by finding_row.rule_key, finding_row.dedupe_key
  ), ''), 'UTF8'), 'sha256'), 'hex')
  into v_findings_hash
  from public.data_quality_findings finding_row
  where finding_row.run_id = v_run_id;

  update public.data_quality_runs
     set status = 'completed', total_findings = v_total,
         info_findings = v_info, warning_findings = v_warning,
         error_findings = v_error, critical_findings = v_critical,
         findings_hash = v_findings_hash, completed_at = clock_timestamp()
   where id = v_run_id;

  perform public.emit_domain_event(
    'data_quality.completed', 'data_quality_run', v_run_id,
    jsonb_build_object(
      'ruleSetVersion', v_rule_set,
      'rulesHash', v_rules_hash,
      'findingsHash', v_findings_hash,
      'total', v_total,
      'critical', v_critical,
      'error', v_error,
      'warning', v_warning,
      'info', v_info
    ), null, '/dashboard/data-maintenance'
  );

  return public.get_data_quality_run(v_run_id);
end
$$;

revoke all on function public.get_data_quality_run(uuid) from public, anon, authenticated;
revoke all on function public.get_latest_data_quality_run() from public, anon, authenticated;
revoke all on function public.run_data_quality_scan() from public, anon, authenticated;
grant execute on function public.get_data_quality_run(uuid) to authenticated;
grant execute on function public.get_latest_data_quality_run() to authenticated;
grant execute on function public.run_data_quality_scan() to authenticated;