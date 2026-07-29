-- R1-2: durable jobs, first-party notifications, governed files, and fail-closed integrations.
-- External providers remain unselected and disabled by default. Secrets stay in environment
-- variables referenced by name; no credential value is stored in PostgreSQL.

-- ---------------------------------------------------------------------------
-- 1. Operations permission.
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage',
    'system.operations.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select role_row.id, 'system.operations.manage'
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

create or replace function public.assert_system_operator()
returns uuid language plpgsql security definer stable set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(), 'system.operations.manage') then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Fail-closed integration registry and webhook replay ledger.
-- ---------------------------------------------------------------------------

create table public.integration_channels (
  channel text primary key check (channel in ('email', 'sms', 'wechat', 'webhook')),
  provider_key text check (provider_key is null or provider_key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  status text not null default 'disabled' check (status in ('disabled', 'enabled', 'degraded')),
  secret_ref text check (secret_ref is null or secret_ref ~ '^MATHIN_[A-Z0-9_]+_SECRET$'),
  timeout_ms integer not null default 5000 check (timeout_ms between 100 and 60000),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 25),
  failure_threshold smallint not null default 5 check (failure_threshold between 1 and 25),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  degraded_until timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  change_reason text not null default 'R1-2 safe default' check (length(change_reason) between 1 and 500),
  constraint integration_enabled_configured check (
    status <> 'enabled' or (provider_key is not null and secret_ref is not null)
  )
);

insert into public.integration_channels(channel) values
  ('email'), ('sms'), ('wechat'), ('webhook')
on conflict do nothing;

create or replace function public.notification_channel_enabled(p_channel text)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select case p_channel
    when 'email' then public.is_feature_enabled('notifications.email')
    when 'sms' then public.is_feature_enabled('notifications.sms')
    when 'wechat' then public.is_feature_enabled('notifications.wechat')
    else false
  end
  and exists (
    select 1 from public.integration_channels channel_row
     where channel_row.channel = p_channel
       and channel_row.provider_key is not null
       and channel_row.secret_ref is not null
       and channel_row.status = 'enabled'
       and (channel_row.degraded_until is null or channel_row.degraded_until <= now())
  )
$$;

create table public.webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  external_event_id text not null check (length(external_event_id) between 1 and 200),
  event_timestamp timestamptz not null,
  signature_digest text not null check (signature_digest ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  job_id uuid,
  unique(provider_key, external_event_id)
);
create index webhook_receipts_received_idx on public.webhook_receipts(received_at desc);

-- ---------------------------------------------------------------------------
-- 3. Durable queue: leases, timeouts, backoff, dead-letter, effects, replay.
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 240),
  effect_key text not null check (length(effect_key) between 1 and 240),
  status text not null default 'pending' check (status in ('pending', 'running', 'retry', 'succeeded', 'dead', 'cancelled')),
  priority smallint not null default 0 check (priority between -100 and 100),
  available_at timestamptz not null default now(),
  lease_owner text check (lease_owner is null or length(lease_owner) between 1 and 160),
  lease_token uuid,
  lease_expires_at timestamptz,
  timeout_seconds integer not null default 300 check (timeout_seconds between 1 and 3600),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 25),
  backoff_base_seconds integer not null default 30 check (backoff_base_seconds between 1 and 3600),
  last_error_code text check (last_error_code is null or length(last_error_code) <= 100),
  last_error text check (last_error is null or length(last_error) <= 4000),
  result jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  replay_of_job_id uuid references public.jobs(id) on delete set null,
  constraint jobs_payload_cap check (octet_length(payload::text) <= 262144),
  constraint jobs_result_cap check (result is null or octet_length(result::text) <= 262144),
  constraint jobs_attempt_cap check (attempt_count <= max_attempts),
  constraint jobs_lease_shape check (
    (status = 'running' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
    or (status <> 'running' and lease_owner is null and lease_token is null and lease_expires_at is null)
  )
);
create index jobs_due_idx on public.jobs(priority desc, available_at, created_at)
  where status in ('pending', 'retry');
create index jobs_running_lease_idx on public.jobs(lease_expires_at) where status = 'running';
create index jobs_dead_idx on public.jobs(dead_lettered_at desc) where status = 'dead';
create index jobs_effect_idx on public.jobs(effect_key, created_at);

alter table public.webhook_receipts
  add constraint webhook_receipts_job_id_fkey foreign key(job_id) references public.jobs(id) on delete set null;

create table public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  worker_id text not null check (length(worker_id) between 1 and 160),
  lease_token uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running' check (outcome in ('running', 'succeeded', 'retry', 'dead', 'timeout', 'cancelled')),
  error_code text check (error_code is null or length(error_code) <= 100),
  error_message text check (error_message is null or length(error_message) <= 4000),
  unique(job_id, attempt_no)
);
create index job_attempts_recent_idx on public.job_attempts(started_at desc);

create table public.job_effects (
  effect_key text primary key check (length(effect_key) between 1 and 240),
  job_id uuid not null references public.jobs(id) on delete restrict,
  status text not null default 'reserved' check (status in ('reserved', 'completed')),
  reserved_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb,
  constraint job_effect_result_cap check (result is null or octet_length(result::text) <= 262144)
);

create table public.job_workers (
  worker_id text primary key check (length(worker_id) between 1 and 160),
  version text not null check (length(version) between 1 and 100),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_claimed_at timestamptz,
  processed_count bigint not null default 0 check (processed_count >= 0),
  failed_count bigint not null default 0 check (failed_count >= 0)
);

create or replace function public.enqueue_job(
  p_kind text,
  p_payload jsonb,
  p_idempotency_key text,
  p_effect_key text default null,
  p_available_at timestamptz default now(),
  p_priority integer default 0,
  p_max_attempts integer default 5,
  p_timeout_seconds integer default 300,
  p_backoff_base_seconds integer default 30
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare queued_id uuid;
begin
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_.-]{1,99}$' then raise exception 'VALIDATION'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 240 then raise exception 'VALIDATION'; end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 262144 then raise exception 'VALIDATION'; end if;

  insert into public.jobs(
    kind, payload, idempotency_key, effect_key, available_at, priority,
    max_attempts, timeout_seconds, backoff_base_seconds, created_by
  ) values (
    p_kind, coalesce(p_payload, '{}'::jsonb), p_idempotency_key,
    coalesce(nullif(p_effect_key, ''), p_idempotency_key), coalesce(p_available_at, now()),
    coalesce(p_priority, 0), coalesce(p_max_attempts, 5), coalesce(p_timeout_seconds, 300),
    coalesce(p_backoff_base_seconds, 30), auth.uid()
  )
  on conflict(idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into queued_id;
  return queued_id;
end
$$;

create or replace function public.recover_expired_job_leases()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare recovered integer;
begin
  update public.job_attempts attempt_row
     set finished_at = now(), outcome = 'timeout', error_code = 'LEASE_TIMEOUT',
         error_message = 'The worker lease expired before completion.'
    from public.jobs job_row
   where attempt_row.job_id = job_row.id
     and attempt_row.attempt_no = job_row.attempt_count
     and attempt_row.outcome = 'running'
     and job_row.status = 'running'
     and job_row.lease_expires_at <= now();

  update public.jobs
     set status = case when attempt_count >= max_attempts then 'dead' else 'retry' end,
         available_at = case when attempt_count >= max_attempts then available_at else now() end,
         dead_lettered_at = case when attempt_count >= max_attempts then now() else null end,
         last_error_code = 'LEASE_TIMEOUT',
         last_error = 'The worker lease expired before completion.',
         lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
   where status = 'running' and lease_expires_at <= now();
  get diagnostics recovered = row_count;

  delete from public.job_effects effect_row
   using public.jobs job_row
   where effect_row.job_id = job_row.id and effect_row.status = 'reserved'
     and job_row.last_error_code = 'LEASE_TIMEOUT' and job_row.updated_at >= now() - interval '1 minute';
  return recovered;
end
$$;

create or replace function public.claim_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
) returns table(
  job_id uuid, kind text, payload jsonb, effect_key text, attempt_no integer,
  lease_token uuid, lease_expires_at timestamptz, timeout_seconds integer
) language plpgsql security definer set search_path = public, pg_temp
as $$
declare candidate public.jobs%rowtype; token uuid; expiry timestamptz;
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 160 then raise exception 'VALIDATION'; end if;
  if p_limit not between 1 and 100 or p_lease_seconds not between 5 and 3600 then raise exception 'VALIDATION'; end if;
  perform public.recover_expired_job_leases();

  for candidate in
    select * from public.jobs
     where status in ('pending', 'retry') and available_at <= now()
     order by priority desc, available_at, created_at
     for update skip locked limit p_limit
  loop
    token := gen_random_uuid();
    expiry := now() + make_interval(secs => least(p_lease_seconds, candidate.timeout_seconds));
    update public.jobs set status = 'running', attempt_count = attempt_count + 1,
      lease_owner = p_worker_id, lease_token = token, lease_expires_at = expiry, updated_at = now()
      where id = candidate.id;
    insert into public.job_attempts(job_id, attempt_no, worker_id, lease_token)
      values(candidate.id, candidate.attempt_count + 1, p_worker_id, token);
    job_id := candidate.id;
    kind := candidate.kind;
    payload := candidate.payload;
    effect_key := candidate.effect_key;
    attempt_no := candidate.attempt_count + 1;
    lease_token := token;
    lease_expires_at := expiry;
    timeout_seconds := candidate.timeout_seconds;
    return next;
  end loop;

  update public.job_workers set last_seen_at = now(),
    last_claimed_at = case when found then now() else last_claimed_at end
    where worker_id = p_worker_id;
end
$$;

create or replace function public.heartbeat_job_worker(p_worker_id text, p_version text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 160
    or p_version is null or length(p_version) not between 1 and 100 then raise exception 'VALIDATION'; end if;
  insert into public.job_workers(worker_id, version) values(p_worker_id, p_version)
  on conflict(worker_id) do update set version = excluded.version, last_seen_at = now();
end
$$;

create or replace function public.heartbeat_job(p_job_id uuid, p_lease_token uuid, p_extend_seconds integer default 60)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp
as $$
declare expiry timestamptz;
begin
  if p_extend_seconds not between 5 and 3600 then raise exception 'VALIDATION'; end if;
  update public.jobs set lease_expires_at = now() + make_interval(secs => least(p_extend_seconds, timeout_seconds)), updated_at = now()
   where id = p_job_id and status = 'running' and lease_token = p_lease_token and lease_expires_at > now()
   returning lease_expires_at into expiry;
  if expiry is null then raise exception 'STALE_LEASE'; end if;
  return expiry;
end
$$;

create or replace function public.reserve_job_effect(p_job_id uuid, p_lease_token uuid, p_effect_key text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare existing public.job_effects%rowtype;
begin
  if not exists(select 1 from public.jobs where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_expires_at > now() and effect_key = p_effect_key) then
    raise exception 'STALE_LEASE';
  end if;
  insert into public.job_effects(effect_key, job_id) values(p_effect_key, p_job_id)
    on conflict(effect_key) do nothing;
  select * into existing from public.job_effects where effect_key = p_effect_key;
  return existing.job_id = p_job_id and existing.status = 'reserved';
end
$$;

create or replace function public.complete_job_effect(p_job_id uuid, p_lease_token uuid, p_effect_key text, p_result jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists(select 1 from public.jobs where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_expires_at > now()) then raise exception 'STALE_LEASE'; end if;
  update public.job_effects set status = 'completed', completed_at = now(), result = coalesce(p_result, '{}'::jsonb)
   where effect_key = p_effect_key and job_id = p_job_id and status = 'reserved';
  if not found then raise exception 'EFFECT_NOT_RESERVED'; end if;
end
$$;

create or replace function public.complete_job(p_job_id uuid, p_lease_token uuid, p_result jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare worker text; current_attempt integer;
begin
  select lease_owner, attempt_count into worker, current_attempt
    from public.jobs
   where id = p_job_id and status = 'running' and lease_token = p_lease_token and lease_expires_at > now()
   for update;
  if current_attempt is null then raise exception 'STALE_LEASE'; end if;
  update public.jobs set status = 'succeeded', result = coalesce(p_result, '{}'::jsonb),
    completed_at = now(), lease_owner = null, lease_token = null, lease_expires_at = null,
    last_error = null, last_error_code = null, updated_at = now()
   where id = p_job_id;
  update public.job_attempts set finished_at = now(), outcome = 'succeeded'
   where job_id = p_job_id and attempt_no = current_attempt and lease_token = p_lease_token and outcome = 'running';
  update public.job_workers set last_seen_at = now(), processed_count = processed_count + 1 where worker_id = worker;
end
$$;

create or replace function public.fail_job(
  p_job_id uuid, p_lease_token uuid, p_error_code text, p_error text, p_retryable boolean default true
) returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare job_row public.jobs%rowtype; next_status text; delay_seconds integer;
begin
  select * into job_row from public.jobs where id = p_job_id for update;
  if job_row.id is null or job_row.status <> 'running' or job_row.lease_token <> p_lease_token
    or job_row.lease_expires_at <= now() then raise exception 'STALE_LEASE'; end if;
  next_status := case when not coalesce(p_retryable, true) or job_row.attempt_count >= job_row.max_attempts then 'dead' else 'retry' end;
  delay_seconds := least(86400, job_row.backoff_base_seconds * power(2, greatest(job_row.attempt_count - 1, 0))::integer);
  update public.job_attempts set finished_at = now(), outcome = case when next_status = 'dead' then 'dead' else 'retry' end,
    error_code = left(coalesce(p_error_code, 'JOB_FAILED'), 100), error_message = left(coalesce(p_error, 'Job failed.'), 4000)
   where job_id = p_job_id and attempt_no = job_row.attempt_count and lease_token = p_lease_token and outcome = 'running';
  delete from public.job_effects where job_id = p_job_id and status = 'reserved';
  update public.jobs set status = next_status,
    available_at = case when next_status = 'retry' then now() + make_interval(secs => delay_seconds) else available_at end,
    dead_lettered_at = case when next_status = 'dead' then now() else null end,
    last_error_code = left(coalesce(p_error_code, 'JOB_FAILED'), 100),
    last_error = left(coalesce(p_error, 'Job failed.'), 4000),
    lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
   where id = p_job_id;
  update public.job_workers set last_seen_at = now(), failed_count = failed_count + 1 where worker_id = job_row.lease_owner;
  return next_status;
end
$$;

create or replace function public.replay_dead_job(p_job_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare actor uuid; original public.jobs%rowtype; replay_id uuid; replay_key text;
begin
  actor := public.assert_system_operator();
  if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION'; end if;
  select * into original from public.jobs where id = p_job_id and status = 'dead';
  if original.id is null then raise exception 'JOB_NOT_REPLAYABLE'; end if;
  replay_key := left(original.idempotency_key, 190) || ':replay:' || gen_random_uuid()::text;
  insert into public.jobs(kind, payload, idempotency_key, effect_key, priority, max_attempts,
    timeout_seconds, backoff_base_seconds, created_by, replay_of_job_id)
  values(original.kind, original.payload, replay_key, original.effect_key, original.priority,
    original.max_attempts, original.timeout_seconds, original.backoff_base_seconds, actor, original.id)
  returning id into replay_id;
  perform public.emit_domain_event('job.replayed', 'job', replay_id,
    jsonb_build_object('originalJobId', original.id, 'reason', trim(p_reason)), null, '/dashboard/system-health');
  return replay_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. First-party notifications and delivery history.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null references public.domain_events(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_key text not null check (length(notification_key) between 1 and 160),
  idempotency_key text not null check (length(idempotency_key) between 1 and 240),
  payload jsonb not null default '{}'::jsonb,
  deep_link text check (deep_link is null or (left(deep_link, 1) = '/' and length(deep_link) <= 500)),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz,
  unique(recipient_id, idempotency_key),
  constraint notifications_payload_cap check (octet_length(payload::text) <= 65536)
);
create index notifications_recipient_feed_idx on public.notifications(recipient_id, occurred_at desc) where archived_at is null;
create index notifications_recipient_unread_idx on public.notifications(recipient_id, occurred_at desc) where read_at is null and archived_at is null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'wechat')),
  provider_key text,
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 240),
  status text not null check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'dead', 'suppressed')),
  job_id uuid references public.jobs(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 240),
  sent_at timestamptz,
  receipt_at timestamptz,
  failed_at timestamptz,
  error_code text check (error_code is null or length(error_code) <= 100),
  error_message text check (error_message is null or length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_deliveries_status_idx on public.notification_deliveries(status, created_at);
create index notification_deliveries_recipient_idx on public.notification_deliveries(recipient_id, created_at desc);

create or replace function public.stage_notification_for_domain_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare notification_id uuid; channel_name text; delivery_id uuid; queued_job uuid; provider_name text;
begin
  if new.target_user_id is null then return new; end if;
  insert into public.notifications(source_event_id, recipient_id, notification_key, idempotency_key,
    payload, deep_link, occurred_at)
  values(new.id, new.target_user_id, new.event_type, 'domain_event:' || new.id::text,
    new.payload, new.event_link, new.occurred_at)
  on conflict(recipient_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into notification_id;

  insert into public.notification_deliveries(notification_id, recipient_id, channel, idempotency_key, status, sent_at)
  values(notification_id, new.target_user_id, 'in_app', 'notification:' || notification_id::text || ':in_app', 'sent', now())
  on conflict(idempotency_key) do nothing;

  foreach channel_name in array array['email', 'sms', 'wechat'] loop
    if public.notification_channel_enabled(channel_name) then
      select provider_key into provider_name from public.integration_channels where channel = channel_name;
      insert into public.notification_deliveries(notification_id, recipient_id, channel, provider_key, idempotency_key, status)
      values(notification_id, new.target_user_id, channel_name, provider_name,
        'notification:' || notification_id::text || ':' || channel_name, 'queued')
      on conflict(idempotency_key) do update set idempotency_key = excluded.idempotency_key
      returning id into delivery_id;
      queued_job := public.enqueue_job('notification.' || channel_name,
        jsonb_build_object('deliveryId', delivery_id, 'notificationId', notification_id),
        'notification-delivery:' || delivery_id::text,
        'notification-delivery-effect:' || delivery_id::text,
        now(), 10,
        (select max_attempts from public.integration_channels where channel = channel_name),
        greatest(1, ceil((select timeout_ms from public.integration_channels where channel = channel_name) / 1000.0)::integer),
        30);
      update public.notification_deliveries set job_id = queued_job where id = delivery_id;
    end if;
  end loop;
  return new;
end
$$;

create trigger domain_events_stage_notification
after insert on public.domain_events for each row execute function public.stage_notification_for_domain_event();

-- Backfill existing targeted events without creating external deliveries.
insert into public.notifications(source_event_id, recipient_id, notification_key, idempotency_key, payload, deep_link, occurred_at)
select event_row.id, event_row.target_user_id, event_row.event_type, 'domain_event:' || event_row.id::text,
  event_row.payload, event_row.event_link, event_row.occurred_at
from public.domain_events event_row where event_row.target_user_id is not null
on conflict(recipient_id, idempotency_key) do nothing;

insert into public.notification_deliveries(notification_id, recipient_id, channel, idempotency_key, status, sent_at, created_at, updated_at)
select notification_row.id, notification_row.recipient_id, 'in_app',
  'notification:' || notification_row.id::text || ':in_app', 'sent', notification_row.created_at,
  notification_row.created_at, notification_row.created_at
from public.notifications notification_row
on conflict(idempotency_key) do nothing;

create or replace function public.mark_notifications_read_through(p_notification_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare cutoff timestamptz; affected integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select occurred_at into cutoff from public.notifications where id = p_notification_id and recipient_id = auth.uid();
  if cutoff is null then raise exception 'NOT_FOUND'; end if;
  update public.notifications set read_at = now()
   where recipient_id = auth.uid() and read_at is null and archived_at is null and occurred_at <= cutoff;
  get diagnostics affected = row_count;
  return affected;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. File policy, TUS session ledger, verification and orphan cleanup.
-- ---------------------------------------------------------------------------

create table public.file_policies (
  bucket_id text primary key,
  purpose text not null check (length(purpose) between 1 and 200),
  access_mode text not null check (access_mode in ('public', 'signed', 'service')),
  upload_protocol text not null check (upload_protocol in ('standard', 'tus', 'service')),
  max_bytes bigint not null check (max_bytes between 1 and 10737418240),
  owner_quota_bytes bigint check (owner_quota_bytes is null or owner_quota_bytes >= max_bytes),
  allowed_mime_types text[] not null check (cardinality(allowed_mime_types) > 0),
  orphan_grace_hours integer not null default 24 check (orphan_grace_hours between 1 and 720),
  retention_days integer check (retention_days is null or retention_days between 1 and 3650),
  malicious_content_policy text not null check (malicious_content_policy in ('signature_only', 'trusted_pipeline')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.file_policies(bucket_id, purpose, access_mode, upload_protocol, max_bytes, owner_quota_bytes,
  allowed_mime_types, orphan_grace_hours, retention_days, malicious_content_policy) values
('note-assets', 'Private notebook source images; publication policy is handled by the content pipeline.', 'public', 'standard', 10485760, 209715200,
 array['image/avif','image/gif','image/jpeg','image/png','image/webp'], 24, null, 'signature_only'),
('courseware', 'Teacher classroom overlay media.', 'signed', 'tus', 209715200, 5368709120,
 array['image/avif','image/gif','image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'], 24, null, 'signature_only'),
('course-assets', 'Course template media.', 'signed', 'tus', 209715200, 21474836480,
 array['image/avif','image/gif','image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'], 24, null, 'signature_only'),
('session-videos', 'Student learning-result videos.', 'signed', 'tus', 209715200, 5368709120,
 array['video/mp4','video/webm','video/quicktime'], 24, 365, 'signature_only'),
('cw-objects', 'Immutable courseware CAS objects from the trusted import pipeline.', 'signed', 'service', 209715200, null,
 array['application/json','application/pdf','image/avif','image/gif','image/jpeg','image/png','image/svg+xml','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/ogg','audio/wav'], 168, null, 'trusted_pipeline'),
('cw-h5', 'Immutable content-addressed H5 packages from the trusted import pipeline.', 'public', 'service', 209715200, null,
 array['application/json','application/javascript','application/octet-stream','application/wasm','audio/mpeg','audio/ogg','audio/wav','font/otf','font/ttf','font/woff','font/woff2','image/gif','image/jpeg','image/png','image/svg+xml','text/css','text/html','text/plain','video/mp4','video/webm'], 168, null, 'trusted_pipeline')
on conflict(bucket_id) do update set purpose = excluded.purpose, access_mode = excluded.access_mode,
  upload_protocol = excluded.upload_protocol, max_bytes = excluded.max_bytes,
  owner_quota_bytes = excluded.owner_quota_bytes, allowed_mime_types = excluded.allowed_mime_types,
  orphan_grace_hours = excluded.orphan_grace_hours, retention_days = excluded.retention_days,
  malicious_content_policy = excluded.malicious_content_policy, enabled = true, updated_at = now();

alter table storage.buckets add column if not exists allowed_mime_types text[];

update storage.buckets set public = true, file_size_limit = 10485760,
  allowed_mime_types = array['image/avif','image/gif','image/jpeg','image/png','image/webp']
where id = 'note-assets';
update storage.buckets set public = false, file_size_limit = 209715200,
  allowed_mime_types = array['image/avif','image/gif','image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
where id in ('courseware', 'course-assets');
update storage.buckets set public = false, file_size_limit = 209715200,
  allowed_mime_types = array['video/mp4','video/webm','video/quicktime']
where id = 'session-videos';

create table public.file_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id text not null references public.file_policies(bucket_id),
  object_path text not null check (length(object_path) between 1 and 500 and object_path !~ '(^|/)\.\.(/|$)'),
  protocol text not null default 'tus' check (protocol = 'tus'),
  expected_size bigint not null check (expected_size > 0),
  mime_type text not null check (length(mime_type) between 1 and 160),
  expected_sha256 text check (expected_sha256 is null or expected_sha256 ~ '^[0-9a-f]{64}$'),
  current_offset bigint not null default 0 check (current_offset >= 0),
  status text not null default 'initiated' check (status in ('initiated','uploading','uploaded','verified','rejected','expired','aborted')),
  linked_entity_type text check (linked_entity_type is null or length(linked_entity_type) <= 100),
  linked_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  completed_at timestamptz,
  error_code text check (error_code is null or length(error_code) <= 100)
);
create unique index file_upload_sessions_active_path_idx on public.file_upload_sessions(bucket_id, object_path)
  where status in ('initiated','uploading','uploaded');
create index file_upload_sessions_expiry_idx on public.file_upload_sessions(expires_at)
  where status in ('initiated','uploading');

create table public.managed_files (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references public.file_policies(bucket_id),
  object_path text not null check (length(object_path) between 1 and 500),
  owner_id uuid references public.profiles(id) on delete set null,
  upload_session_id uuid references public.file_upload_sessions(id) on delete set null,
  byte_count bigint not null default 0 check (byte_count >= 0),
  mime_type text,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploaded' check (status in ('uploaded','verified','quarantined','rejected','cleanup_pending','deleted')),
  scan_status text not null default 'pending' check (scan_status in ('pending','signature_clean','trusted','rejected')),
  linked_entity_type text check (linked_entity_type is null or length(linked_entity_type) <= 100),
  linked_entity_id uuid,
  linked_at timestamptz,
  orphan_after timestamptz not null,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  deleted_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  unique(bucket_id, object_path)
);
create index managed_files_orphan_idx on public.managed_files(orphan_after)
  where linked_at is null and status in ('uploaded','verified','rejected');
create index managed_files_retention_idx on public.managed_files(retention_until)
  where retention_until is not null and status in ('uploaded','verified','rejected');

create or replace function public.capture_managed_storage_object()
returns trigger language plpgsql security definer set search_path = public, storage, pg_temp
as $$
declare policy_row public.file_policies%rowtype; size_value bigint; mime_value text;
  entity_type text; entity_id uuid; linked_time timestamptz;
begin
  select * into policy_row from public.file_policies where bucket_id = new.bucket_id and enabled;
  if policy_row.bucket_id is null or policy_row.upload_protocol = 'service' then return new; end if;
  size_value := case when coalesce(new.metadata ->> 'size', '') ~ '^[0-9]+$' then (new.metadata ->> 'size')::bigint else 0 end;
  mime_value := coalesce(new.metadata ->> 'mimetype', new.metadata ->> 'contentType');
  if new.bucket_id = 'note-assets' and cardinality(storage.foldername(new.name)) >= 2
    and (storage.foldername(new.name))[2] ~ '^[0-9a-f-]{36}$'
    and exists(select 1 from public.notes where id = (storage.foldername(new.name))[2]::uuid) then
    entity_type := 'note'; entity_id := (storage.foldername(new.name))[2]::uuid; linked_time := now();
  elsif new.bucket_id = 'courseware' and cardinality(storage.foldername(new.name)) >= 1
    and (storage.foldername(new.name))[1] ~ '^[0-9a-f-]{36}$' then
    entity_type := 'classroom'; entity_id := (storage.foldername(new.name))[1]::uuid; linked_time := now();
  elsif new.bucket_id = 'course-assets' and cardinality(storage.foldername(new.name)) >= 1
    and (storage.foldername(new.name))[1] ~ '^[0-9a-f-]{36}$' then
    entity_type := 'course'; entity_id := (storage.foldername(new.name))[1]::uuid; linked_time := now();
  end if;
  insert into public.managed_files(bucket_id, object_path, owner_id, byte_count, mime_type,
    linked_entity_type, linked_entity_id, linked_at, orphan_after, retention_until)
  values(new.bucket_id, new.name,
    case when coalesce(new.owner_id, '') ~ '^[0-9a-f-]{36}$' then new.owner_id::uuid else null end,
    size_value, mime_value,
    entity_type, entity_id, linked_time,
    now() + make_interval(hours => policy_row.orphan_grace_hours),
    case when policy_row.retention_days is null then null else now() + make_interval(days => policy_row.retention_days) end)
  on conflict(bucket_id, object_path) do update set owner_id = excluded.owner_id,
    byte_count = excluded.byte_count, mime_type = excluded.mime_type,
    linked_entity_type = coalesce(public.managed_files.linked_entity_type, excluded.linked_entity_type),
    linked_entity_id = coalesce(public.managed_files.linked_entity_id, excluded.linked_entity_id),
    linked_at = coalesce(public.managed_files.linked_at, excluded.linked_at),
    status = 'uploaded', deleted_at = null, last_error = null;
  return new;
end
$$;

create trigger storage_objects_capture_managed
after insert or update of metadata on storage.objects for each row execute function public.capture_managed_storage_object();

create or replace function public.capture_managed_storage_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.managed_files set status = 'deleted', deleted_at = now()
   where bucket_id = old.bucket_id and object_path = old.name;
  return old;
end
$$;
create trigger storage_objects_capture_delete
after delete on storage.objects for each row execute function public.capture_managed_storage_delete();

create or replace function public.link_session_video_managed_file()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.managed_files set linked_entity_type = 'session_video', linked_entity_id = new.id,
    linked_at = coalesce(linked_at, now()),
    retention_until = case when new.deleted_at is null then retention_until else now() + interval '30 days' end
   where bucket_id = 'session-videos' and object_path = new.storage_path;
  return new;
end
$$;
create trigger session_videos_link_managed_file after insert or update of deleted_at on public.session_videos
for each row execute function public.link_session_video_managed_file();

create or replace function public.begin_file_upload_session(
  p_bucket_id text, p_object_path text, p_expected_size bigint, p_mime_type text,
  p_expected_sha256 text default null, p_linked_entity_type text default null, p_linked_entity_id uuid default null
) returns table(session_id uuid, expires_at timestamptz, chunk_size integer)
language plpgsql security definer set search_path = public, storage, pg_temp
as $$
declare uid uuid := auth.uid(); policy_row public.file_policies%rowtype; used_bytes bigint; created public.file_upload_sessions%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into policy_row from public.file_policies where bucket_id = p_bucket_id and enabled;
  if policy_row.bucket_id is null or policy_row.upload_protocol <> 'tus' then raise exception 'TUS_NOT_ENABLED'; end if;
  if p_expected_size is null or p_expected_size <= 0 or p_expected_size > policy_row.max_bytes then raise exception 'FILE_SIZE_REJECTED'; end if;
  if p_mime_type is null or not (p_mime_type = any(policy_row.allowed_mime_types)) then raise exception 'FILE_TYPE_REJECTED'; end if;
  if p_object_path is null or length(p_object_path) not between 1 and 500 or p_object_path ~ '(^|/)\.\.(/|$)' then raise exception 'VALIDATION'; end if;
  if p_expected_sha256 is not null and p_expected_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_bucket_id, 0));
  select upload_row.* into created from public.file_upload_sessions upload_row
   where upload_row.owner_id = uid and upload_row.bucket_id = p_bucket_id and upload_row.object_path = p_object_path
     and upload_row.status in ('initiated','uploading') and upload_row.expires_at > now()
   order by upload_row.created_at desc limit 1;
  if created.id is not null then
    if created.expected_size <> p_expected_size or created.mime_type <> p_mime_type then raise exception 'UPLOAD_SESSION_CONFLICT'; end if;
    session_id := created.id; expires_at := created.expires_at; chunk_size := 6291456; return next;
    return;
  end if;
  if policy_row.owner_quota_bytes is not null then
    select coalesce((select sum(file_row.byte_count) from public.managed_files file_row where file_row.owner_id = uid and file_row.bucket_id = p_bucket_id and file_row.status <> 'deleted'), 0)
      + coalesce((select sum(upload_row.expected_size) from public.file_upload_sessions upload_row where upload_row.owner_id = uid and upload_row.bucket_id = p_bucket_id
        and upload_row.status in ('initiated','uploading') and upload_row.expires_at > now()), 0) into used_bytes;
    if used_bytes + p_expected_size > policy_row.owner_quota_bytes then raise exception 'FILE_QUOTA_EXCEEDED'; end if;
  end if;
  insert into public.file_upload_sessions(owner_id, bucket_id, object_path, expected_size, mime_type,
    expected_sha256, linked_entity_type, linked_entity_id)
  values(uid, p_bucket_id, p_object_path, p_expected_size, p_mime_type,
    p_expected_sha256, nullif(trim(p_linked_entity_type), ''), p_linked_entity_id)
  returning * into created;
  session_id := created.id; expires_at := created.expires_at; chunk_size := 6291456; return next;
end
$$;

create or replace function public.advance_file_upload_session(p_session_id uuid, p_offset bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.file_upload_sessions set current_offset = p_offset, status = 'uploading', updated_at = now()
   where id = p_session_id and owner_id = auth.uid() and status in ('initiated','uploading')
     and expires_at > now() and p_offset >= current_offset and p_offset <= expected_size;
  if not found then raise exception 'UPLOAD_SESSION_INVALID'; end if;
end
$$;

create or replace function public.finish_file_upload_session(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = public, storage, pg_temp
as $$
declare session_row public.file_upload_sessions%rowtype; object_row storage.objects%rowtype;
  actual_size bigint; file_id uuid; verify_job uuid;
begin
  select * into session_row from public.file_upload_sessions where id = p_session_id and owner_id = auth.uid() for update;
  if session_row.id is null or session_row.status not in ('initiated','uploading') or session_row.expires_at <= now() then raise exception 'UPLOAD_SESSION_INVALID'; end if;
  select * into object_row from storage.objects where bucket_id = session_row.bucket_id and name = session_row.object_path;
  if object_row.id is null or object_row.owner_id is distinct from auth.uid()::text then raise exception 'UPLOAD_OBJECT_MISSING'; end if;
  actual_size := case when coalesce(object_row.metadata ->> 'size', '') ~ '^[0-9]+$' then (object_row.metadata ->> 'size')::bigint else -1 end;
  if actual_size <> session_row.expected_size then raise exception 'UPLOAD_SIZE_MISMATCH'; end if;
  update public.file_upload_sessions set current_offset = expected_size, status = 'uploaded', completed_at = now(), updated_at = now()
   where id = session_row.id;
  update public.managed_files set upload_session_id = session_row.id,
    linked_entity_type = coalesce(linked_entity_type, session_row.linked_entity_type),
    linked_entity_id = coalesce(linked_entity_id, session_row.linked_entity_id),
    linked_at = case when coalesce(linked_entity_type, session_row.linked_entity_type) is null then linked_at else coalesce(linked_at, now()) end
   where bucket_id = session_row.bucket_id and object_path = session_row.object_path
   returning id into file_id;
  if file_id is null then raise exception 'MANAGED_FILE_MISSING'; end if;
  verify_job := public.enqueue_job('file.verify', jsonb_build_object('fileId', file_id),
    'file-verify:' || file_id::text, 'file-verified:' || file_id::text, now(), 5, 3, 900, 60);
  return verify_job;
end
$$;

create or replace function public.abort_file_upload_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.file_upload_sessions set status = 'aborted', updated_at = now()
   where id = p_session_id and owner_id = auth.uid() and status in ('initiated','uploading');
  if not found then raise exception 'UPLOAD_SESSION_INVALID'; end if;
end
$$;

create or replace function public.finish_file_verification(
  p_file_id uuid, p_sha256 text, p_byte_count bigint, p_clean boolean, p_error text default null
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_count < 0 then raise exception 'VALIDATION'; end if;
  update public.managed_files set sha256 = p_sha256, byte_count = p_byte_count,
    status = case when p_clean then 'verified' else 'rejected' end,
    scan_status = case when p_clean then 'signature_clean' else 'rejected' end,
    verified_at = now(), last_error = case when p_clean then null else left(coalesce(p_error, 'FILE_SIGNATURE_REJECTED'), 1000) end
   where id = p_file_id and status in ('uploaded','quarantined');
  if not found then raise exception 'FILE_NOT_VERIFIABLE'; end if;
  update public.file_upload_sessions upload_row set status = case when p_clean then 'verified' else 'rejected' end,
    error_code = case when p_clean then null else 'FILE_SIGNATURE_REJECTED' end, updated_at = now()
   from public.managed_files file_row where file_row.id = p_file_id and upload_row.id = file_row.upload_session_id;
end
$$;

create or replace function public.enqueue_file_cleanup_jobs(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare file_row public.managed_files%rowtype; queued integer := 0;
begin
  if p_limit not between 1 and 500 then raise exception 'VALIDATION'; end if;
  update public.file_upload_sessions set status = 'expired', updated_at = now()
   where status in ('initiated','uploading') and expires_at <= now();
  for file_row in
    select * from public.managed_files
     where status in ('uploaded','verified','rejected') and (
       (linked_at is null and orphan_after <= now()) or
       (retention_until is not null and retention_until <= now()) or status = 'rejected'
     ) order by coalesce(retention_until, orphan_after) for update skip locked limit p_limit
  loop
    perform public.enqueue_job('file.cleanup', jsonb_build_object('fileId', file_row.id, 'bucketId', file_row.bucket_id, 'objectPath', file_row.object_path),
      'file-cleanup:' || file_row.id::text, 'file-deleted:' || file_row.id::text, now(), 20, 5, 300, 60);
    update public.managed_files set status = 'cleanup_pending' where id = file_row.id;
    queued := queued + 1;
  end loop;
  return queued;
end
$$;

create or replace function public.mark_managed_file_deleted(p_file_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.managed_files set status = 'deleted', deleted_at = now() where id = p_file_id;
  if not found then raise exception 'FILE_NOT_FOUND'; end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Webhook admission and provider circuit breaker.
-- ---------------------------------------------------------------------------

create or replace function public.accept_webhook_receipt(
  p_provider_key text, p_external_event_id text, p_event_timestamp timestamptz,
  p_signature_digest text, p_payload_digest text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare receipt_id uuid; queued_job uuid;
begin
  if not exists(select 1 from public.integration_channels where channel = 'webhook'
    and provider_key = p_provider_key and status = 'enabled'
    and (degraded_until is null or degraded_until <= now())) then raise exception 'CHANNEL_DISABLED'; end if;
  if p_event_timestamp is null or abs(extract(epoch from (now() - p_event_timestamp))) > 300 then raise exception 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE'; end if;
  if p_external_event_id is null or length(p_external_event_id) not between 1 and 200
    or p_signature_digest !~ '^[0-9a-f]{64}$' or p_payload_digest !~ '^[0-9a-f]{64}$'
    or octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 262144 then raise exception 'VALIDATION'; end if;
  begin
    insert into public.webhook_receipts(provider_key, external_event_id, event_timestamp, signature_digest, payload_digest)
    values(p_provider_key, p_external_event_id, p_event_timestamp, p_signature_digest, p_payload_digest)
    returning id into receipt_id;
  exception when unique_violation then
    raise exception 'WEBHOOK_REPLAY';
  end;
  queued_job := public.enqueue_job('webhook.receive',
    jsonb_build_object('receiptId', receipt_id, 'providerKey', p_provider_key, 'payload', coalesce(p_payload, '{}'::jsonb)),
    'webhook:' || p_provider_key || ':' || p_external_event_id,
    'webhook-effect:' || p_provider_key || ':' || p_external_event_id, now(), 10, 5, 300, 30);
  update public.webhook_receipts set job_id = queued_job where id = receipt_id;
  return receipt_id;
end
$$;

create or replace function public.record_integration_outcome(p_channel text, p_success boolean, p_error_code text default null)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare result_status text;
begin
  update public.integration_channels set
    consecutive_failures = case when p_success then 0 else consecutive_failures + 1 end,
    last_success_at = case when p_success then now() else last_success_at end,
    last_failure_at = case when p_success then last_failure_at else now() end,
    last_error_code = case when p_success then null else left(coalesce(p_error_code, 'PROVIDER_FAILURE'), 100) end,
    status = case when p_success then case when provider_key is null then 'disabled' else 'enabled' end
      when consecutive_failures + 1 >= failure_threshold then 'degraded' else status end,
    degraded_until = case when p_success then null
      when consecutive_failures + 1 >= failure_threshold then now() + interval '15 minutes' else degraded_until end,
    updated_at = now()
  where channel = p_channel returning status into result_status;
  if result_status is null then raise exception 'UNKNOWN_CHANNEL'; end if;
  return result_status;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Aggregate operations snapshot and RLS/grants.
-- ---------------------------------------------------------------------------

create or replace function public.get_platform_operations_snapshot()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'audit.view') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'jobs', jsonb_build_object(
      'pending', (select count(*) from public.jobs where status in ('pending','retry')),
      'running', (select count(*) from public.jobs where status = 'running'),
      'succeeded24h', (select count(*) from public.jobs where status = 'succeeded' and completed_at >= now() - interval '24 hours'),
      'dead', (select count(*) from public.jobs where status = 'dead'),
      'oldestDueAt', (select min(available_at) from public.jobs where status in ('pending','retry') and available_at <= now()),
      'deadLetters', coalesce((select jsonb_agg(to_jsonb(dead_row) order by dead_row."deadLetteredAt" desc) from (
        select id, kind, attempt_count as "attemptCount", max_attempts as "maxAttempts",
          last_error_code as "errorCode", last_error as "errorMessage", dead_lettered_at as "deadLetteredAt"
        from public.jobs where status = 'dead' order by dead_lettered_at desc limit 20
      ) dead_row), '[]'::jsonb)
    ),
    'notifications', jsonb_build_object(
      'total24h', (select count(*) from public.notifications where created_at >= now() - interval '24 hours'),
      'unread', (select count(*) from public.notifications where read_at is null and archived_at is null),
      'failedDeliveries', (select count(*) from public.notification_deliveries where status in ('failed','dead')),
      'queuedDeliveries', (select count(*) from public.notification_deliveries where status in ('queued','sending'))
    ),
    'files', jsonb_build_object(
      'activeUploads', (select count(*) from public.file_upload_sessions where status in ('initiated','uploading','uploaded')),
      'orphansDue', (select count(*) from public.managed_files where linked_at is null and orphan_after <= now() and status in ('uploaded','verified','rejected')),
      'cleanupPending', (select count(*) from public.managed_files where status = 'cleanup_pending'),
      'rejected', (select count(*) from public.managed_files where status = 'rejected'),
      'policies', coalesce((select jsonb_agg(jsonb_build_object('bucketId', bucket_id, 'accessMode', access_mode,
        'uploadProtocol', upload_protocol, 'maxBytes', max_bytes, 'quotaBytes', owner_quota_bytes,
        'retentionDays', retention_days, 'enabled', enabled) order by bucket_id) from public.file_policies), '[]'::jsonb)
    ),
    'integrations', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'providerKey', provider_key,
      'status', status, 'secretConfigured', secret_ref is not null, 'consecutiveFailures', consecutive_failures,
      'degradedUntil', degraded_until, 'lastSuccessAt', last_success_at, 'lastFailureAt', last_failure_at) order by channel)
      from public.integration_channels), '[]'::jsonb),
    'workers', coalesce((select jsonb_agg(jsonb_build_object('workerId', worker_id, 'version', version,
      'lastSeenAt', last_seen_at, 'processedCount', processed_count, 'failedCount', failed_count) order by last_seen_at desc)
      from public.job_workers), '[]'::jsonb)
  );
end
$$;

alter table public.integration_channels enable row level security;
alter table public.webhook_receipts enable row level security;
alter table public.jobs enable row level security;
alter table public.job_attempts enable row level security;
alter table public.job_effects enable row level security;
alter table public.job_workers enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.file_policies enable row level security;
alter table public.file_upload_sessions enable row level security;
alter table public.managed_files enable row level security;

create policy jobs_audit_read on public.jobs for select to authenticated using(public.has_perm((select auth.uid()), 'audit.view'));
create policy job_attempts_audit_read on public.job_attempts for select to authenticated using(public.has_perm((select auth.uid()), 'audit.view'));
create policy job_workers_audit_read on public.job_workers for select to authenticated using(public.has_perm((select auth.uid()), 'audit.view'));
create policy notifications_own_read on public.notifications for select to authenticated using(recipient_id = (select auth.uid()));
create policy notification_deliveries_own_read on public.notification_deliveries for select to authenticated using(recipient_id = (select auth.uid()));
create policy file_upload_sessions_own_read on public.file_upload_sessions for select to authenticated using(owner_id = (select auth.uid()));
create policy managed_files_owner_or_audit_read on public.managed_files for select to authenticated
  using(owner_id = (select auth.uid()) or public.has_perm((select auth.uid()), 'audit.view'));
create policy file_policies_authenticated_read on public.file_policies for select to authenticated using(enabled);

revoke all on public.integration_channels, public.webhook_receipts, public.jobs, public.job_attempts,
  public.job_effects, public.job_workers, public.notifications, public.notification_deliveries,
  public.file_policies, public.file_upload_sessions, public.managed_files from public, anon, authenticated;
grant select on public.jobs, public.job_attempts, public.job_workers, public.notifications,
  public.notification_deliveries, public.file_policies, public.file_upload_sessions, public.managed_files to authenticated;

revoke all on function public.assert_system_operator() from public, anon, authenticated;
revoke all on function public.notification_channel_enabled(text) from public, anon, authenticated;
revoke all on function public.enqueue_job(text,jsonb,text,text,timestamptz,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.recover_expired_job_leases() from public, anon, authenticated;
revoke all on function public.claim_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.heartbeat_job_worker(text,text) from public, anon, authenticated;
revoke all on function public.heartbeat_job(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.reserve_job_effect(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.complete_job_effect(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.complete_job(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.fail_job(uuid,uuid,text,text,boolean) from public, anon, authenticated;
revoke all on function public.replay_dead_job(uuid,text) from public, anon, authenticated;
revoke all on function public.mark_notifications_read_through(uuid) from public, anon, authenticated;
revoke all on function public.begin_file_upload_session(text,text,bigint,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.advance_file_upload_session(uuid,bigint) from public, anon, authenticated;
revoke all on function public.finish_file_upload_session(uuid) from public, anon, authenticated;
revoke all on function public.abort_file_upload_session(uuid) from public, anon, authenticated;
revoke all on function public.finish_file_verification(uuid,text,bigint,boolean,text) from public, anon, authenticated;
revoke all on function public.enqueue_file_cleanup_jobs(integer) from public, anon, authenticated;
revoke all on function public.mark_managed_file_deleted(uuid) from public, anon, authenticated;
revoke all on function public.accept_webhook_receipt(text,text,timestamptz,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.record_integration_outcome(text,boolean,text) from public, anon, authenticated;
revoke all on function public.get_platform_operations_snapshot() from public, anon, authenticated;
revoke all on function public.stage_notification_for_domain_event() from public, anon, authenticated;
revoke all on function public.capture_managed_storage_object() from public, anon, authenticated;
revoke all on function public.capture_managed_storage_delete() from public, anon, authenticated;
revoke all on function public.link_session_video_managed_file() from public, anon, authenticated;

grant execute on function public.replay_dead_job(uuid,text) to authenticated;
grant execute on function public.mark_notifications_read_through(uuid) to authenticated;
grant execute on function public.begin_file_upload_session(text,text,bigint,text,text,text,uuid) to authenticated;
grant execute on function public.advance_file_upload_session(uuid,bigint) to authenticated;
grant execute on function public.finish_file_upload_session(uuid) to authenticated;
grant execute on function public.abort_file_upload_session(uuid) to authenticated;
grant execute on function public.get_platform_operations_snapshot() to authenticated;

grant execute on function public.enqueue_job(text,jsonb,text,text,timestamptz,integer,integer,integer,integer) to service_role;
grant execute on function public.recover_expired_job_leases() to service_role;
grant execute on function public.claim_jobs(text,integer,integer) to service_role;
grant execute on function public.heartbeat_job_worker(text,text) to service_role;
grant execute on function public.heartbeat_job(uuid,uuid,integer) to service_role;
grant execute on function public.reserve_job_effect(uuid,uuid,text) to service_role;
grant execute on function public.complete_job_effect(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.complete_job(uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_job(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.finish_file_verification(uuid,text,bigint,boolean,text) to service_role;
grant execute on function public.enqueue_file_cleanup_jobs(integer) to service_role;
grant execute on function public.mark_managed_file_deleted(uuid) to service_role;
grant execute on function public.accept_webhook_receipt(text,text,timestamptz,text,text,jsonb) to service_role;
grant execute on function public.record_integration_outcome(text,boolean,text) to service_role;

