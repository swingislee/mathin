-- R1-8: keep finance safely closed for the 1.0 release baseline.
-- Historical finance rows and audit evidence remain intact. Runtime reads,
-- commands, coordination, notifications, metrics, and jobs fail closed until a
-- later reviewed migration explicitly opens finance_release_gate_open().

begin;

-- ---------------------------------------------------------------------------
-- 1. Release gate: a feature-flag row alone cannot enable unfinished finance.
-- ---------------------------------------------------------------------------

create or replace function public.finance_release_gate_open()
returns boolean language sql immutable
set search_path = public, pg_temp
as $$ select false $$;

create or replace function public.is_feature_enabled(
  p_flag_key text,
  p_campus_id uuid default null,
  p_at timestamptz default now()
) returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select case
    when p_flag_key = 'finance.enabled' and not public.finance_release_gate_open() then false
    else coalesce((
      select version_row.enabled
        from public.feature_flag_versions version_row
       where version_row.organization_id = (select id from public.organizations where singleton_key = 1)
         and version_row.flag_key = p_flag_key
         and version_row.flag_key = any(public.organization_feature_keys())
         and (version_row.campus_id is null or version_row.campus_id = p_campus_id)
         and version_row.effective_from <= coalesce(p_at, now())
         and (version_row.effective_until is null or version_row.effective_until > coalesce(p_at, now()))
       order by (version_row.campus_id is not null) desc, version_row.effective_from desc, version_row.version desc
       limit 1
    ), false)
  end
$$;

create or replace function public.reject_closed_finance_release_enable()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.flag_key = 'finance.enabled' and new.enabled and not public.finance_release_gate_open() then
    raise exception 'FINANCE_RELEASE_CLOSED';
  end if;
  return new;
end
$$;

drop trigger if exists feature_flag_finance_release_gate on public.feature_flag_versions;
create trigger feature_flag_finance_release_gate
before insert on public.feature_flag_versions
for each row execute function public.reject_closed_finance_release_enable();

-- ---------------------------------------------------------------------------
-- 2. Data and metric reads: every finance table gets a restrictive flag gate.
-- Existing scope policies still decide who can read after a future enablement.
-- ---------------------------------------------------------------------------

create or replace function public.can_view_order(p_order_id uuid, uid uuid)
returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select public.is_feature_enabled('finance.enabled') and (
    public.is_admin(uid)
    or public.staff_has_perm(uid, 'finance.order.view')
    or exists (select 1 from public.orders order_row where order_row.id = p_order_id and order_row.created_by = uid)
    or exists (
      select 1 from public.orders order_row
      join public.students student_row on student_row.id = order_row.student_id
      where order_row.id = p_order_id and student_row.assigned_to = uid
    )
  )
$$;

create or replace function public.can_view_finance_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select public.is_feature_enabled('finance.enabled') and (
    public.is_admin(uid)
    or public.staff_has_perm(uid, 'finance.order.view')
    or public.staff_has_perm(uid, 'finance.account.adjust')
    or public.staff_has_perm(uid, 'finance.scholarship.grant')
    or public.staff_has_perm(uid, 'finance.coupon.manage')
    or public.can_access_student(sid, uid)
    or exists (select 1 from public.students student_row where student_row.id = sid and student_row.assigned_to = uid)
  )
$$;

create policy finance_release_gate on public.orders as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.order_items as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.payments as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.refunds as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.coupons as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.coupon_grants as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.scholarships as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.student_accounts as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));
create policy finance_release_gate on public.account_ledger as restrictive
  for select to authenticated using (public.is_feature_enabled('finance.enabled'));

-- ---------------------------------------------------------------------------
-- 3. Hybrid work items and approvals: block new/changed finance coordination,
-- hide historical open rows, and keep close-only maintenance available.
-- ---------------------------------------------------------------------------

create or replace function public.guard_closed_finance_coordination()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare finance_target boolean;
begin
  finance_target := new.domain = 'finance' or new.action_href like '/dashboard/finance%';
  if not finance_target or public.is_feature_enabled('finance.enabled') then return new; end if;

  if tg_table_name = 'work_items' and tg_op = 'UPDATE'
     and old.status = 'open' and new.status = 'closed' then
    return new;
  end if;
  raise exception 'FINANCE_RELEASE_CLOSED';
end
$$;

create trigger work_items_finance_release_gate
before insert or update on public.work_items
for each row execute function public.guard_closed_finance_coordination();

create trigger approval_requests_finance_release_gate
before insert or update on public.approval_requests
for each row execute function public.guard_closed_finance_coordination();

alter function public.list_my_work_items(text, boolean)
  rename to list_my_work_items_without_finance_gate;
revoke all on function public.list_my_work_items_without_finance_gate(text, boolean)
  from public, anon, authenticated;

create or replace function public.list_my_work_items(
  p_domain text default null,
  p_ignore_snooze boolean default false
)
returns table(
  work_key text, group_key text, type text, domain text, kind text,
  primary_object_type text, primary_object_id uuid, primary_object_name text,
  secondary_object_type text, secondary_object_id uuid, secondary_object_name text,
  context jsonb, responsibility text, ownership_mode text,
  available_at timestamptz, due_at timestamptz, scheduled_at timestamptz, created_at timestamptz,
  urgency_bucket text, severity text, escalation_level integer, resurface_at timestamptz,
  reason_codes text[], action_code text, can_act boolean, context_lens text,
  route_target text, route_params jsonb, last_seen_at timestamptz, snoozed_until timestamptz,
  pinned_at timestamptz, acknowledged_at timestamptz, watching boolean,
  source_kind text, source_id text, action_kind text, action_href text,
  assignee_id uuid, assignee_name text, priority text, read_state text
)
language sql security definer stable set search_path = public, pg_temp
as $$
  select item_row.*
  from public.list_my_work_items_without_finance_gate(p_domain, p_ignore_snooze) item_row
  where public.is_feature_enabled('finance.enabled')
     or (item_row.domain <> 'finance' and item_row.action_href not like '/dashboard/finance%')
$$;

revoke all on function public.list_my_work_items(text, boolean) from public, anon, authenticated;
grant execute on function public.list_my_work_items(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notifications: finance events remain auditable in domain_events, but do
-- not create or expose notifications while the release gate is closed.
-- ---------------------------------------------------------------------------

create or replace function public.is_finance_domain_event(p_event_id uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select coalesce((
    select
      event_row.event_type ~ '^(finance|orders?|payments?|refunds?)\.'
      or event_row.entity_type = any(array[
        'finance','order','orders','order_item','order_items','payment','payments','refund','refunds',
        'coupon','coupons','coupon_grant','coupon_grants','scholarship','scholarships',
        'student_account','student_accounts','account_ledger'
      ]::text[])
      or coalesce(event_row.payload ->> 'domain', '') = 'finance'
      or (
        event_row.entity_type = 'work_item'
        and exists (
          select 1 from public.work_items item_row
          where item_row.id = event_row.entity_id
            and (item_row.domain = 'finance' or item_row.action_href like '/dashboard/finance%')
        )
      )
      or (
        event_row.entity_type = 'approval_request'
        and exists (
          select 1 from public.approval_requests request_row
          where request_row.id = event_row.entity_id
            and (request_row.domain = 'finance' or request_row.action_href like '/dashboard/finance%')
        )
      )
    from public.domain_events event_row where event_row.id = p_event_id
  ), false)
$$;

create or replace function public.stage_notification_for_domain_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare notification_id uuid; channel_name text; delivery_id uuid; queued_job uuid; provider_name text;
begin
  if new.target_user_id is null then return new; end if;
  if public.is_finance_domain_event(new.id) and not public.is_feature_enabled('finance.enabled') then return new; end if;

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

drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for select to authenticated
using (
  recipient_id = (select auth.uid())
  and (public.is_feature_enabled('finance.enabled') or not public.is_finance_domain_event(source_event_id))
);

drop policy if exists notification_deliveries_own_read on public.notification_deliveries;
create policy notification_deliveries_own_read on public.notification_deliveries for select to authenticated
using (
  recipient_id = (select auth.uid())
  and exists (
    select 1 from public.notifications notification_row
    where notification_row.id = notification_id
      and (public.is_feature_enabled('finance.enabled') or not public.is_finance_domain_event(notification_row.source_event_id))
  )
);

-- ---------------------------------------------------------------------------
-- 5. Jobs: reject new finance jobs and cancel queued/running historical work.
-- The claim wrapper repeats suppression so a future-effective close is safe.
-- ---------------------------------------------------------------------------

create or replace function public.is_finance_job_payload(p_kind text, p_payload jsonb)
returns boolean language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare notification_text text := coalesce(p_payload ->> 'notificationId', '');
begin
  if coalesce(p_kind, '') ~ '^(finance|orders?|payments?|refunds?)\.'
     or coalesce(p_payload ->> 'domain', '') = 'finance' then return true; end if;
  if notification_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return exists (
      select 1 from public.notifications notification_row
      where notification_row.id = notification_text::uuid
        and public.is_finance_domain_event(notification_row.source_event_id)
    );
  end if;
  return false;
end
$$;

create or replace function public.guard_closed_finance_job()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.is_feature_enabled('finance.enabled')
     and public.is_finance_job_payload(new.kind, new.payload) then
    raise exception 'FINANCE_RELEASE_CLOSED';
  end if;
  return new;
end
$$;

create trigger jobs_finance_release_gate
before insert on public.jobs
for each row execute function public.guard_closed_finance_job();

create or replace function public.suppress_closed_finance_jobs()
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare affected integer := 0;
begin
  if public.is_feature_enabled('finance.enabled') then return 0; end if;

  update public.notification_deliveries delivery_row
     set status = 'suppressed', updated_at = now(), error_code = 'FINANCE_RELEASE_CLOSED',
         error_message = 'Finance is disabled for this release.'
    from public.jobs job_row
   where delivery_row.job_id = job_row.id
     and delivery_row.status in ('queued', 'sending')
     and job_row.status in ('pending', 'retry', 'running')
     and public.is_finance_job_payload(job_row.kind, job_row.payload);

  update public.job_attempts attempt_row
     set finished_at = now(), outcome = 'cancelled', error_code = 'FINANCE_RELEASE_CLOSED',
         error_message = 'Finance is disabled for this release.'
    from public.jobs job_row
   where attempt_row.job_id = job_row.id and attempt_row.outcome = 'running'
     and job_row.status = 'running'
     and public.is_finance_job_payload(job_row.kind, job_row.payload);

  delete from public.job_effects effect_row
   using public.jobs job_row
   where effect_row.job_id = job_row.id and effect_row.status = 'reserved'
     and job_row.status in ('pending', 'retry', 'running')
     and public.is_finance_job_payload(job_row.kind, job_row.payload);

  update public.jobs job_row
     set status = 'cancelled', result = jsonb_build_object('suppressed', true, 'reason', 'FINANCE_RELEASE_CLOSED'),
         completed_at = now(), lease_owner = null, lease_token = null, lease_expires_at = null,
         last_error_code = 'FINANCE_RELEASE_CLOSED', last_error = 'Finance is disabled for this release.', updated_at = now()
   where job_row.status in ('pending', 'retry', 'running')
     and public.is_finance_job_payload(job_row.kind, job_row.payload);
  get diagnostics affected = row_count;
  return affected;
end
$$;

create or replace function public.suppress_finance_jobs_on_flag_close()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.flag_key = 'finance.enabled' and not new.enabled and new.effective_from <= now() then
    perform public.suppress_closed_finance_jobs();
  end if;
  return new;
end
$$;

create trigger feature_flag_suppress_finance_jobs
after insert on public.feature_flag_versions
for each row execute function public.suppress_finance_jobs_on_flag_close();

alter function public.claim_jobs(text, integer, integer)
  rename to claim_jobs_without_finance_gate;
revoke all on function public.claim_jobs_without_finance_gate(text, integer, integer)
  from public, anon, authenticated, service_role;

create or replace function public.claim_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
) returns table(
  job_id uuid, kind text, payload jsonb, effect_key text, attempt_no integer,
  lease_token uuid, lease_expires_at timestamptz, timeout_seconds integer
) language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.suppress_closed_finance_jobs();
  return query
  select queued.* from public.claim_jobs_without_finance_gate(p_worker_id, p_limit, p_lease_seconds) queued;
end
$$;

select public.suppress_closed_finance_jobs();

revoke all on function public.finance_release_gate_open() from public, anon, authenticated;
revoke all on function public.reject_closed_finance_release_enable() from public, anon, authenticated;
revoke all on function public.guard_closed_finance_coordination() from public, anon, authenticated;
revoke all on function public.is_finance_domain_event(uuid) from public, anon;
revoke all on function public.stage_notification_for_domain_event() from public, anon, authenticated;
revoke all on function public.is_finance_job_payload(text, jsonb) from public, anon, authenticated;
revoke all on function public.guard_closed_finance_job() from public, anon, authenticated;
revoke all on function public.suppress_closed_finance_jobs() from public, anon, authenticated;
revoke all on function public.suppress_finance_jobs_on_flag_close() from public, anon, authenticated;
revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated, service_role;

grant execute on function public.is_finance_domain_event(uuid) to authenticated;
grant execute on function public.claim_jobs(text, integer, integer) to service_role;

commit;
