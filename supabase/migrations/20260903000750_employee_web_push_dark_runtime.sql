-- DEV-WEB-PUSH-1 / PUSH-P1: employee desktop Web Push dark-runtime foundation.
-- Safe production default: feature flag off, integration disabled, rollout empty.
-- This migration does not create subscriptions, deliveries, jobs, or outbound traffic.

-- ---------------------------------------------------------------------------
-- 1. Fail-closed feature and integration registration.
-- ---------------------------------------------------------------------------

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled','notifications.email','notifications.sms','notifications.wechat','notifications.web_push',
    'public_content.publish','teaching.preparation_archive_edit',
    'teaching.classroom_board_checkpoint_v2','teaching.classroom_input_v2',
    'teaching.classroom_h5_pointer_v1','teaching.classroom_layout_v2',
    'teaching.teacher_microcourses_v1','teaching.teacher_microcourse_browser_v2'
  ]::text[]
$$;

insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'notifications.web_push', 1, false, now(), 'DEV-WEB-PUSH-1 fail-closed default'
from public.organizations organization_row
where organization_row.singleton_key = 1
  and not exists (
    select 1 from public.feature_flag_versions existing
    where existing.organization_id = organization_row.id
      and existing.campus_id is null
      and existing.flag_key = 'notifications.web_push'
  );

alter table public.integration_channels
  drop constraint if exists integration_channels_channel_check;
alter table public.integration_channels
  add constraint integration_channels_channel_check
  check (channel in ('email', 'sms', 'wechat', 'webhook', 'web_push'));

insert into public.integration_channels(
  channel, provider_key, status, secret_ref, timeout_ms, max_attempts,
  failure_threshold, change_reason
)
values (
  'web_push', 'web-push', 'disabled', null, 10000, 5, 3,
  'DEV-WEB-PUSH-1 dark deployment; outbound delivery remains disabled'
)
on conflict (channel) do nothing;

create or replace function public.notification_channel_enabled(p_channel text)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select case p_channel
    when 'email' then public.is_feature_enabled('notifications.email')
    when 'sms' then public.is_feature_enabled('notifications.sms')
    when 'wechat' then public.is_feature_enabled('notifications.wechat')
    when 'web_push' then public.is_feature_enabled('notifications.web_push')
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

-- ---------------------------------------------------------------------------
-- 2. Encrypted, per-device subscription and rollout ledgers.
-- ---------------------------------------------------------------------------

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired', 'gone')),
  endpoint_fingerprint text not null check (endpoint_fingerprint ~ '^[0-9a-f]{64}$'),
  encrypted_payload text,
  encryption_key_version smallint not null check (encryption_key_version between 1 and 32767),
  vapid_key_version smallint not null check (vapid_key_version between 1 and 32767),
  device_label text not null check (char_length(btrim(device_label)) between 1 and 80),
  device_mode text not null default 'shared' check (device_mode in ('shared', 'personal')),
  browser_family text not null check (browser_family ~ '^[a-z][a-z0-9_-]{0,39}$'),
  platform_family text not null check (platform_family ~ '^[a-z][a-z0-9_-]{0,39}$'),
  locale text not null default 'zh' check (locale in ('zh', 'en')),
  last_confirmed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 100),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_active_ciphertext check (
    (status = 'active' and encrypted_payload is not null
      and length(encrypted_payload) between 80 and 8192
      and encrypted_payload ~ '^[A-Za-z0-9+/]+={0,2}$')
    or (status <> 'active' and encrypted_payload is null)
  ),
  constraint web_push_lease_after_creation check (lease_expires_at > created_at)
);

create unique index web_push_subscriptions_active_endpoint_idx
  on public.web_push_subscriptions(endpoint_fingerprint)
  where status = 'active';
create index web_push_subscriptions_recipient_idx
  on public.web_push_subscriptions(recipient_id, status, lease_expires_at desc);
create index web_push_subscriptions_expiry_idx
  on public.web_push_subscriptions(lease_expires_at)
  where status = 'active';

create table public.notification_push_rollout_members (
  recipient_id uuid primary key references public.profiles(id) on delete restrict,
  cohort text not null check (cohort in ('employee_test', 'limited', 'general')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_push_rollout_range check (
    effective_until is null or effective_until > effective_from
  )
);

create index notification_push_rollout_active_idx
  on public.notification_push_rollout_members(status, cohort, effective_from)
  where status = 'active';

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_channel_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check
  check (channel in ('in_app', 'email', 'sms', 'wechat', 'web_push'));
alter table public.notification_deliveries
  add column subscription_id uuid references public.web_push_subscriptions(id) on delete restrict,
  add column expires_at timestamptz;
alter table public.notification_deliveries
  add constraint notification_deliveries_web_push_target check (
    (channel = 'web_push' and subscription_id is not null and expires_at is not null)
    or (channel <> 'web_push' and subscription_id is null)
  );
create index notification_deliveries_web_push_status_idx
  on public.notification_deliveries(status, expires_at, created_at)
  where channel = 'web_push';
create index notification_deliveries_subscription_idx
  on public.notification_deliveries(subscription_id, created_at desc)
  where subscription_id is not null;

create or replace function public.is_web_push_recipient_eligible(
  p_recipient_id uuid,
  p_at timestamptz default now()
) returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles profile_row
    join public.notification_push_rollout_members rollout_row
      on rollout_row.recipient_id = profile_row.id
    where profile_row.id = p_recipient_id
      and profile_row.role in ('staff', 'admin')
      and profile_row.account_status = 'active'
      and rollout_row.status = 'active'
      and rollout_row.effective_from <= coalesce(p_at, now())
      and (rollout_row.effective_until is null or rollout_row.effective_until > coalesce(p_at, now()))
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Authenticated subscription lifecycle RPCs. Ciphertext is never returned.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_web_push_capability()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  role_eligible boolean := false;
  rollout_eligible boolean := false;
  active_devices integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select exists (
    select 1 from public.profiles profile_row
    where profile_row.id = uid
      and profile_row.role in ('staff', 'admin')
      and profile_row.account_status = 'active'
  ) into role_eligible;
  rollout_eligible := public.is_web_push_recipient_eligible(uid);
  select count(*) into active_devices
  from public.web_push_subscriptions subscription_row
  where subscription_row.recipient_id = uid
    and subscription_row.status = 'active'
    and subscription_row.lease_expires_at > now();

  return jsonb_build_object(
    'roleEligible', role_eligible,
    'rolloutEligible', rollout_eligible,
    'featureEnabled', public.is_feature_enabled('notifications.web_push'),
    'channelEnabled', public.notification_channel_enabled('web_push'),
    'activeDeviceCount', active_devices,
    'maxDevices', 5
  );
end
$$;

create or replace function public.get_my_web_push_devices()
returns table (
  id uuid,
  device_label text,
  device_mode text,
  browser_family text,
  platform_family text,
  locale text,
  status text,
  last_confirmed_at timestamptz,
  lease_expires_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text
) language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return query
  select
    subscription_row.id,
    subscription_row.device_label,
    subscription_row.device_mode,
    subscription_row.browser_family,
    subscription_row.platform_family,
    subscription_row.locale,
    subscription_row.status,
    subscription_row.last_confirmed_at,
    subscription_row.lease_expires_at,
    subscription_row.last_success_at,
    subscription_row.last_failure_at,
    subscription_row.last_error_code
  from public.web_push_subscriptions subscription_row
  where subscription_row.recipient_id = uid
  order by (subscription_row.status = 'active') desc, subscription_row.updated_at desc;
end
$$;

create or replace function public.register_my_web_push_subscription(
  p_endpoint_fingerprint text,
  p_encrypted_payload text,
  p_encryption_key_version integer,
  p_vapid_key_version integer,
  p_device_label text,
  p_device_mode text,
  p_browser_family text,
  p_platform_family text,
  p_locale text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  subscription_id uuid;
  active_count integer;
  lease_until timestamptz;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_web_push_recipient_eligible(uid) then raise exception 'WEB_PUSH_NOT_IN_ROLLOUT'; end if;
  if not public.notification_channel_enabled('web_push') then raise exception 'WEB_PUSH_CHANNEL_DISABLED'; end if;
  if p_endpoint_fingerprint is null or p_endpoint_fingerprint !~ '^[0-9a-f]{64}$'
    or p_encrypted_payload is null or length(p_encrypted_payload) not between 80 and 8192
    or p_encrypted_payload !~ '^[A-Za-z0-9+/]+={0,2}$'
    or p_encryption_key_version not between 1 and 32767
    or p_vapid_key_version not between 1 and 32767
    or char_length(btrim(coalesce(p_device_label, ''))) not between 1 and 80
    or p_device_mode not in ('shared', 'personal')
    or p_browser_family !~ '^[a-z][a-z0-9_-]{0,39}$'
    or p_platform_family !~ '^[a-z][a-z0-9_-]{0,39}$'
    or p_locale not in ('zh', 'en') then
    raise exception 'VALIDATION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_endpoint_fingerprint, 0));

  update public.web_push_subscriptions
  set status = 'revoked', encrypted_payload = null, revoked_at = now(),
    revoked_reason = case when recipient_id = uid then 'subscription_replaced' else 'account_switched' end,
    updated_at = now()
  where endpoint_fingerprint = p_endpoint_fingerprint and status = 'active';

  select count(*) into active_count
  from public.web_push_subscriptions subscription_row
  where subscription_row.recipient_id = uid
    and subscription_row.status = 'active'
    and subscription_row.lease_expires_at > now();
  if active_count >= 5 then raise exception 'WEB_PUSH_DEVICE_LIMIT'; end if;

  lease_until := now() + case when p_device_mode = 'shared' then interval '8 hours' else interval '30 days' end;
  insert into public.web_push_subscriptions(
    recipient_id, endpoint_fingerprint, encrypted_payload, encryption_key_version,
    vapid_key_version, device_label, device_mode, browser_family, platform_family,
    locale, last_confirmed_at, lease_expires_at
  ) values (
    uid, p_endpoint_fingerprint, p_encrypted_payload, p_encryption_key_version,
    p_vapid_key_version, btrim(p_device_label), p_device_mode, p_browser_family,
    p_platform_family, p_locale, now(), lease_until
  ) returning id into subscription_id;

  return subscription_id;
end
$$;

create or replace function public.reconcile_my_web_push_subscription(p_endpoint_fingerprint text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); owned_subscription_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_endpoint_fingerprint is null or p_endpoint_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_endpoint_fingerprint, 0));

  update public.web_push_subscriptions
  set status = case when lease_expires_at <= now() then 'expired' else 'revoked' end,
    encrypted_payload = null,
    revoked_at = now(),
    revoked_reason = case when lease_expires_at <= now() then 'lease_expired' else 'account_switched' end,
    updated_at = now()
  where endpoint_fingerprint = p_endpoint_fingerprint
    and status = 'active'
    and (recipient_id <> uid or lease_expires_at <= now());

  if not public.is_web_push_recipient_eligible(uid) then
    update public.web_push_subscriptions
    set status = 'revoked', encrypted_payload = null, revoked_at = now(),
      revoked_reason = 'recipient_ineligible', updated_at = now()
    where endpoint_fingerprint = p_endpoint_fingerprint
      and recipient_id = uid and status = 'active';
    return null;
  end if;

  update public.web_push_subscriptions
  set last_confirmed_at = now(),
    lease_expires_at = now() + case when device_mode = 'shared' then interval '8 hours' else interval '30 days' end,
    updated_at = now()
  where endpoint_fingerprint = p_endpoint_fingerprint
    and recipient_id = uid and status = 'active'
  returning id into owned_subscription_id;

  return owned_subscription_id;
end
$$;

create or replace function public.revoke_my_web_push_subscription(p_subscription_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); affected integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.web_push_subscriptions
  set status = 'revoked', encrypted_payload = null, revoked_at = now(),
    revoked_reason = 'user_revoked', updated_at = now()
  where id = p_subscription_id and recipient_id = uid and status = 'active';
  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

create or replace function public.revoke_all_my_web_push_subscriptions()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); affected integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.web_push_subscriptions
  set status = 'revoked', encrypted_payload = null, revoked_at = now(),
    revoked_reason = 'user_revoked_all', updated_at = now()
  where recipient_id = uid and status = 'active';
  get diagnostics affected = row_count;
  return affected;
end
$$;

create or replace function public.set_web_push_rollout_member(
  p_recipient_id uuid,
  p_cohort text,
  p_status text,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare actor uuid := public.assert_system_operator();
begin
  if p_cohort not in ('employee_test', 'limited', 'general')
    or p_status not in ('active', 'inactive')
    or p_effective_from is null
    or (p_effective_until is not null and p_effective_until <= p_effective_from)
    or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'VALIDATION';
  end if;
  if not exists (
    select 1 from public.profiles profile_row
    where profile_row.id = p_recipient_id
      and profile_row.role in ('staff', 'admin')
      and profile_row.account_status = 'active'
  ) then raise exception 'INVALID_RECIPIENT'; end if;

  insert into public.notification_push_rollout_members(
    recipient_id, cohort, status, effective_from, effective_until, reason, updated_by
  ) values (
    p_recipient_id, p_cohort, p_status, p_effective_from, p_effective_until,
    btrim(p_reason), actor
  )
  on conflict (recipient_id) do update set
    cohort = excluded.cohort,
    status = excluded.status,
    effective_from = excluded.effective_from,
    effective_until = excluded.effective_until,
    reason = excluded.reason,
    updated_by = excluded.updated_by,
    updated_at = now();

  if p_status <> 'active' then
    update public.web_push_subscriptions
    set status = 'revoked', encrypted_payload = null, revoked_at = now(),
      revoked_reason = 'rollout_removed', updated_at = now()
    where recipient_id = p_recipient_id and status = 'active';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Device-level staging, test delivery, and authenticated click resolution.
-- ---------------------------------------------------------------------------

create or replace function public.stage_notification_for_domain_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  notification_id uuid;
  channel_name text;
  delivery_id uuid;
  queued_job uuid;
  provider_name text;
  subscription_row public.web_push_subscriptions;
begin
  if new.target_user_id is null then return new; end if;
  if public.is_finance_domain_event(new.id) and not public.is_feature_enabled('finance.enabled') then return new; end if;

  insert into public.notifications(
    source_event_id, recipient_id, notification_key, idempotency_key,
    payload, deep_link, occurred_at
  ) values (
    new.id, new.target_user_id, new.event_type, 'domain_event:' || new.id::text,
    new.payload, new.event_link, new.occurred_at
  )
  on conflict(recipient_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into notification_id;

  insert into public.notification_deliveries(
    notification_id, recipient_id, channel, idempotency_key, status, sent_at
  ) values (
    notification_id, new.target_user_id, 'in_app',
    'notification:' || notification_id::text || ':in_app', 'sent', now()
  ) on conflict(idempotency_key) do nothing;

  foreach channel_name in array array['email', 'sms', 'wechat'] loop
    if public.notification_channel_enabled(channel_name) then
      select provider_key into provider_name
      from public.integration_channels where channel = channel_name;
      insert into public.notification_deliveries(
        notification_id, recipient_id, channel, provider_key, idempotency_key, status
      ) values (
        notification_id, new.target_user_id, channel_name, provider_name,
        'notification:' || notification_id::text || ':' || channel_name, 'queued'
      )
      on conflict(idempotency_key) do update set idempotency_key = excluded.idempotency_key
      returning id into delivery_id;
      queued_job := public.enqueue_job(
        'notification.' || channel_name,
        jsonb_build_object('deliveryId', delivery_id, 'notificationId', notification_id),
        'notification-delivery:' || delivery_id::text,
        'notification-delivery-effect:' || delivery_id::text,
        now(), 10,
        (select max_attempts from public.integration_channels where channel = channel_name),
        greatest(1, ceil((select timeout_ms from public.integration_channels where channel = channel_name) / 1000.0)::integer),
        30
      );
      update public.notification_deliveries set job_id = queued_job where id = delivery_id;
    end if;
  end loop;

  if public.notification_channel_enabled('web_push')
    and public.is_web_push_recipient_eligible(new.target_user_id) then
    select provider_key into provider_name
    from public.integration_channels where channel = 'web_push';
    for subscription_row in
      select subscription_candidate.*
      from public.web_push_subscriptions subscription_candidate
      where subscription_candidate.recipient_id = new.target_user_id
        and subscription_candidate.status = 'active'
        and subscription_candidate.lease_expires_at > now()
        and (
          new.event_type <> 'web_push.test'
          or subscription_candidate.id::text = coalesce(new.payload ->> 'subscriptionId', '')
        )
      order by subscription_candidate.created_at
    loop
      insert into public.notification_deliveries(
        notification_id, recipient_id, channel, provider_key, idempotency_key,
        status, subscription_id, expires_at
      ) values (
        notification_id, new.target_user_id, 'web_push', provider_name,
        'notification:' || notification_id::text || ':web_push:' || subscription_row.id::text,
        'queued', subscription_row.id, now() + interval '4 hours'
      )
      on conflict(idempotency_key) do update set idempotency_key = excluded.idempotency_key
      returning id into delivery_id;
      queued_job := public.enqueue_job(
        'notification.web_push',
        jsonb_build_object('deliveryId', delivery_id),
        'notification-delivery:' || delivery_id::text,
        'notification-delivery-effect:' || delivery_id::text,
        now(), 10,
        (select max_attempts from public.integration_channels where channel = 'web_push'),
        greatest(1, ceil((select timeout_ms from public.integration_channels where channel = 'web_push') / 1000.0)::integer),
        30
      );
      update public.notification_deliveries set job_id = queued_job where id = delivery_id;
    end loop;
  end if;
  return new;
end
$$;

create or replace function public.send_my_web_push_test(p_subscription_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); event_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.notification_channel_enabled('web_push')
    or not public.is_web_push_recipient_eligible(uid) then
    raise exception 'WEB_PUSH_CHANNEL_DISABLED';
  end if;
  if not exists (
    select 1 from public.web_push_subscriptions subscription_row
    where subscription_row.id = p_subscription_id
      and subscription_row.recipient_id = uid
      and subscription_row.status = 'active'
      and subscription_row.lease_expires_at > now()
  ) then raise exception 'WEB_PUSH_DEVICE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.notifications notification_row
    where notification_row.recipient_id = uid
      and notification_row.notification_key = 'web_push.test'
      and notification_row.created_at >= now() - interval '1 minute'
  ) then raise exception 'RATE_LIMITED'; end if;

  event_id := public.emit_domain_event(
    'web_push.test', 'web_push_subscription', p_subscription_id,
    jsonb_build_object('subscriptionId', p_subscription_id, 'kind', 'generic_test'),
    uid, '/dashboard/account-security'
  );
  return event_id;
end
$$;

create or replace function public.resolve_my_web_push_delivery(p_delivery_id uuid)
returns table(notification_id uuid, deep_link text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); resolved_notification uuid; resolved_link text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select notification_row.id,
    case
      when notification_row.deep_link is not null
        and left(notification_row.deep_link, 1) = '/'
        and left(notification_row.deep_link, 2) <> '//'
        and position(E'\\' in notification_row.deep_link) = 0
      then notification_row.deep_link
      else '/dashboard'
    end
  into resolved_notification, resolved_link
  from public.notification_deliveries delivery_row
  join public.notifications notification_row on notification_row.id = delivery_row.notification_id
  where delivery_row.id = p_delivery_id
    and delivery_row.channel = 'web_push'
    and delivery_row.recipient_id = uid
    and notification_row.recipient_id = uid;
  if resolved_notification is null then raise exception 'NOT_FOUND'; end if;

  update public.notifications set read_at = coalesce(read_at, now())
  where id = resolved_notification and recipient_id = uid;
  return query select resolved_notification, resolved_link;
end
$$;

create or replace function public.fail_web_push_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error text,
  p_retryable boolean default true,
  p_retry_after_seconds integer default null
) returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  job_row public.jobs%rowtype;
  next_status text;
  exponential_cap integer;
  delay_seconds integer;
begin
  select * into job_row from public.jobs where id = p_job_id for update;
  if job_row.id is null or job_row.kind <> 'notification.web_push'
    or job_row.status <> 'running' or job_row.lease_token <> p_lease_token
    or job_row.lease_expires_at <= now() then raise exception 'STALE_LEASE'; end if;
  if p_retry_after_seconds is not null and p_retry_after_seconds not between 0 and 14400 then
    raise exception 'VALIDATION';
  end if;

  next_status := case
    when not coalesce(p_retryable, true) or job_row.attempt_count >= job_row.max_attempts then 'dead'
    else 'retry'
  end;
  exponential_cap := least(
    14400,
    job_row.backoff_base_seconds * power(2, greatest(job_row.attempt_count - 1, 0))::integer
  );
  delay_seconds := greatest(
    1,
    floor(random() * greatest(exponential_cap, 1))::integer,
    coalesce(p_retry_after_seconds, 0)
  );

  update public.job_attempts
  set finished_at = now(), outcome = case when next_status = 'dead' then 'dead' else 'retry' end,
    error_code = left(coalesce(p_error_code, 'WEB_PUSH_FAILED'), 100),
    error_message = left(coalesce(p_error, 'Web Push request failed.'), 4000)
  where job_id = p_job_id and attempt_no = job_row.attempt_count
    and lease_token = p_lease_token and outcome = 'running';
  delete from public.job_effects where job_id = p_job_id and status = 'reserved';
  update public.jobs set
    status = next_status,
    available_at = case when next_status = 'retry' then now() + make_interval(secs => delay_seconds) else available_at end,
    dead_lettered_at = case when next_status = 'dead' then now() else null end,
    last_error_code = left(coalesce(p_error_code, 'WEB_PUSH_FAILED'), 100),
    last_error = left(coalesce(p_error, 'Web Push request failed.'), 4000),
    lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_job_id;
  update public.job_workers set last_seen_at = now(), failed_count = failed_count + 1
  where worker_id = job_row.lease_owner;
  return next_status;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Web Push monitoring. No endpoint, key, label, or employee identity leaves.
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
    'webPush', jsonb_build_object(
      'featureEnabled', public.is_feature_enabled('notifications.web_push'),
      'rolloutMembers', (select count(*) from public.notification_push_rollout_members
        where status = 'active' and effective_from <= now() and (effective_until is null or effective_until > now())),
      'activeSubscriptions', (select count(*) from public.web_push_subscriptions
        where status = 'active' and lease_expires_at > now()),
      'sharedSubscriptions', (select count(*) from public.web_push_subscriptions
        where status = 'active' and lease_expires_at > now() and device_mode = 'shared'),
      'expiredOrGoneSubscriptions', (select count(*) from public.web_push_subscriptions
        where status in ('expired','gone')),
      'queued', (select count(*) from public.notification_deliveries
        where channel = 'web_push' and status in ('queued','sending')),
      'sent24h', (select count(*) from public.notification_deliveries
        where channel = 'web_push' and status = 'sent' and sent_at >= now() - interval '24 hours'),
      'suppressed24h', (select count(*) from public.notification_deliveries
        where channel = 'web_push' and status = 'suppressed' and updated_at >= now() - interval '24 hours'),
      'failed', (select count(*) from public.notification_deliveries
        where channel = 'web_push' and status in ('failed','dead')),
      'oldestDueAt', (select min(job_row.available_at)
        from public.jobs job_row where job_row.kind = 'notification.web_push'
          and job_row.status in ('pending','retry') and job_row.available_at <= now()),
      'workerStale', coalesce((select max(worker_row.last_seen_at) < now() - interval '2 minutes'
        from public.job_workers worker_row where worker_row.version like '%web-push%'), true)
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

alter table public.web_push_subscriptions enable row level security;
alter table public.notification_push_rollout_members enable row level security;

revoke all on public.web_push_subscriptions, public.notification_push_rollout_members
  from public, anon, authenticated;

revoke all on function public.is_web_push_recipient_eligible(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.get_my_web_push_capability() from public, anon, authenticated;
revoke all on function public.get_my_web_push_devices() from public, anon, authenticated;
revoke all on function public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.reconcile_my_web_push_subscription(text) from public, anon, authenticated;
revoke all on function public.revoke_my_web_push_subscription(uuid) from public, anon, authenticated;
revoke all on function public.revoke_all_my_web_push_subscriptions() from public, anon, authenticated;
revoke all on function public.set_web_push_rollout_member(uuid,text,text,timestamptz,timestamptz,text) from public, anon, authenticated;
revoke all on function public.send_my_web_push_test(uuid) from public, anon, authenticated;
revoke all on function public.resolve_my_web_push_delivery(uuid) from public, anon, authenticated;
revoke all on function public.fail_web_push_job(uuid,uuid,text,text,boolean,integer) from public, anon, authenticated;

grant execute on function public.get_my_web_push_capability() to authenticated;
grant execute on function public.get_my_web_push_devices() to authenticated;
grant execute on function public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text) to authenticated;
grant execute on function public.reconcile_my_web_push_subscription(text) to authenticated;
grant execute on function public.revoke_my_web_push_subscription(uuid) to authenticated;
grant execute on function public.revoke_all_my_web_push_subscriptions() to authenticated;
grant execute on function public.set_web_push_rollout_member(uuid,text,text,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.send_my_web_push_test(uuid) to authenticated;
grant execute on function public.resolve_my_web_push_delivery(uuid) to authenticated;
grant execute on function public.notification_channel_enabled(text) to service_role;
grant execute on function public.fail_web_push_job(uuid,uuid,text,text,boolean,integer) to service_role;
