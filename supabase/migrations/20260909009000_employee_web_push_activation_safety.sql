-- 员工测试启用前的投递隔离、即时撤销和独立监控。
-- 本迁移保持生产开关、通道和员工名单原值。

create or replace function public.is_web_push_recipient_eligible(
  p_recipient_id uuid, p_at timestamptz default now()
) returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    join public.notification_push_rollout_members r on r.recipient_id = p.id
    where p.id = p_recipient_id and p.role in ('staff', 'admin')
      and p.is_active and p.account_status = 'active'
      and r.status = 'active' and r.effective_from <= coalesce(p_at, now())
      and (r.effective_until is null or r.effective_until > coalesce(p_at, now()))
  )
$$;

create or replace function public.revoke_ineligible_employee_push()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not new.is_active or new.account_status <> 'active' or new.role not in ('staff', 'admin') then
    update public.web_push_subscriptions set status = 'revoked', encrypted_payload = null,
      revoked_at = now(), revoked_reason = 'recipient_ineligible', updated_at = now()
    where recipient_id = new.id and status = 'active';
  end if;
  return new;
end
$$;

create trigger revoke_ineligible_employee_push
after update of is_active, account_status, role on public.profiles
for each row execute function public.revoke_ineligible_employee_push();

create or replace function public.expire_web_push_subscriptions(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare affected integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'VALIDATION'; end if;
  with expired as (
    select s.id from public.web_push_subscriptions s
    where s.status = 'active' and (s.lease_expires_at <= now()
      or not public.is_web_push_recipient_eligible(s.recipient_id))
    order by s.lease_expires_at, s.id for update skip locked limit p_limit
  )
  update public.web_push_subscriptions s
  set status = case when s.lease_expires_at <= now() then 'expired' else 'revoked' end,
    encrypted_payload = null, revoked_at = now(), updated_at = now(),
    revoked_reason = case when s.lease_expires_at <= now() then 'lease_expired' else 'recipient_ineligible' end
  from expired e where s.id = e.id;
  get diagnostics affected = row_count;
  return affected;
end
$$;

create or replace function public.claim_web_push_jobs(
  p_worker_id text, p_limit integer default 10, p_lease_seconds integer default 60
) returns table(
  job_id uuid, kind text, payload jsonb, effect_key text, attempt_no integer,
  lease_token uuid, lease_expires_at timestamptz, timeout_seconds integer
) language plpgsql security definer set search_path = public, pg_temp
as $$
declare candidate public.jobs%rowtype; token uuid; expiry timestamptz; claimed integer := 0;
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 160
    or p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then raise exception 'VALIDATION'; end if;

  -- 只恢复推送租约，保留其他后台任务的状态和 effect。
  for candidate in select j.* from public.jobs j
    where j.kind = 'notification.web_push' and j.status = 'running' and j.lease_expires_at <= now()
    order by j.lease_expires_at, j.id for update skip locked limit 100
  loop
    update public.job_attempts a set finished_at = now(), outcome = 'timeout',
      error_code = 'LEASE_TIMEOUT', error_message = 'Web Push worker lease expired.'
    where a.job_id = candidate.id and a.attempt_no = candidate.attempt_count and a.outcome = 'running';
    update public.jobs set status = case when attempt_count >= max_attempts then 'dead' else 'retry' end,
      available_at = now(), dead_lettered_at = case when attempt_count >= max_attempts then now() else null end,
      last_error_code = 'LEASE_TIMEOUT', last_error = 'Web Push worker lease expired.',
      lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
    where id = candidate.id;
    delete from public.job_effects e where e.job_id = candidate.id and e.status = 'reserved';
    if candidate.attempt_count >= candidate.max_attempts then
      update public.notification_deliveries d set status = 'dead', error_code = 'LEASE_TIMEOUT',
        error_message = null, failed_at = now(), updated_at = now()
      where d.job_id = candidate.id and d.channel = 'web_push' and d.status in ('queued','sending');
    end if;
  end loop;

  for candidate in select j.* from public.jobs j
    where j.kind = 'notification.web_push' and j.status in ('pending','retry')
      and j.available_at <= now() and j.attempt_count < j.max_attempts
    order by j.priority desc, j.available_at, j.created_at, j.id
    for update skip locked limit p_limit
  loop
    token := gen_random_uuid();
    -- HTTP 请求超时为 10 秒，租约另留数据库读写和提交时间。
    expiry := now() + make_interval(secs => p_lease_seconds);
    update public.jobs set status = 'running', attempt_count = attempt_count + 1,
      lease_owner = p_worker_id, lease_token = token, lease_expires_at = expiry, updated_at = now()
    where id = candidate.id;
    insert into public.job_attempts(job_id, attempt_no, worker_id, lease_token)
    values(candidate.id, candidate.attempt_count + 1, p_worker_id, token);
    job_id := candidate.id; kind := candidate.kind; payload := candidate.payload;
    effect_key := candidate.effect_key; attempt_no := candidate.attempt_count + 1;
    lease_token := token; lease_expires_at := expiry; timeout_seconds := candidate.timeout_seconds;
    claimed := claimed + 1;
    return next;
  end loop;
  update public.job_workers set last_seen_at = now(),
    last_claimed_at = case when claimed > 0 then now() else last_claimed_at end
  where worker_id = p_worker_id;
end
$$;

create or replace function public.get_web_push_monitor_snapshot()
returns jsonb language sql security definer stable set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'featureEnabled', public.is_feature_enabled('notifications.web_push'),
    'integrationStatus', (select status from public.integration_channels where channel = 'web_push'),
    'providerAuthError', coalesce((select last_error_code in ('PUSH_HTTP_401','PUSH_HTTP_403')
      and status <> 'enabled' from public.integration_channels where channel = 'web_push'), false),
    'workerAgeSeconds', (select extract(epoch from now() - max(last_seen_at))
      from public.job_workers where version = 'r1-7.3-web-push-scoped'),
    'oldestDueSeconds', (select coalesce(extract(epoch from now() - min(available_at)), 0)
      from public.jobs where kind = 'notification.web_push' and status in ('pending','retry') and available_at <= now()),
    'dead', (select count(*) from public.jobs where kind = 'notification.web_push' and status = 'dead'),
    'failed24h', (select count(*) from public.notification_deliveries where channel = 'web_push'
      and status in ('failed','dead') and updated_at >= now() - interval '24 hours'),
    'queued', (select count(*) from public.notification_deliveries where channel = 'web_push' and status in ('queued','sending')),
    'sent24h', (select count(*) from public.notification_deliveries where channel = 'web_push' and status = 'sent'
      and sent_at >= now() - interval '24 hours')
  )
$$;

revoke all on function public.revoke_ineligible_employee_push() from public, anon, authenticated;
revoke all on function public.expire_web_push_subscriptions(integer) from public, anon, authenticated;
revoke all on function public.claim_web_push_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.get_web_push_monitor_snapshot() from public, anon, authenticated;
grant execute on function public.expire_web_push_subscriptions(integer) to service_role;
grant execute on function public.claim_web_push_jobs(text,integer,integer) to service_role;
grant execute on function public.get_web_push_monitor_snapshot() to service_role;
grant execute on function public.is_web_push_recipient_eligible(uuid,timestamptz) to service_role;


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
  perform pg_advisory_xact_lock(hashtextextended('web_push_recipient:' || uid::text, 0));
  if not public.is_web_push_recipient_eligible(uid) then raise exception 'WEB_PUSH_NOT_IN_ROLLOUT'; end if;
  if not public.notification_channel_enabled('web_push') then raise exception 'WEB_PUSH_CHANNEL_DISABLED'; end if;
  if p_browser_family <> 'edge' or p_platform_family <> 'windows' then
    raise exception 'WEB_PUSH_BROWSER_NOT_SUPPORTED';
  end if;
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

create or replace function public.send_my_web_push_test(p_subscription_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); event_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('web_push_recipient:' || uid::text, 0));
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

revoke all on function public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text) to authenticated;
revoke all on function public.send_my_web_push_test(uuid) from public, anon, authenticated;
grant execute on function public.send_my_web_push_test(uuid) to authenticated;
