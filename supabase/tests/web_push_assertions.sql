\set ON_ERROR_STOP on

do $$
declare
  failures text[] := array[]::text[];
  stage_definition text;
  monitoring_definition text;
begin
  if public.is_feature_enabled('notifications.web_push') then
    failures := array_append(failures, 'notifications.web_push must default off');
  end if;
  if not exists (
    select 1 from public.integration_channels
    where channel = 'web_push' and provider_key = 'web-push'
      and status = 'disabled' and secret_ref is null
  ) then
    failures := array_append(failures, 'web_push integration must be present and disabled without a secret');
  end if;
  if public.notification_channel_enabled('web_push') then
    failures := array_append(failures, 'web_push channel must remain fail-closed');
  end if;
  if not exists (
    select 1 from pg_class where oid = 'public.web_push_subscriptions'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_class where oid = 'public.notification_push_rollout_members'::regclass and relrowsecurity
  ) then
    failures := array_append(failures, 'web push tables must have RLS enabled');
  end if;
  if has_table_privilege('authenticated', 'public.web_push_subscriptions', 'SELECT')
    or has_table_privilege('authenticated', 'public.web_push_subscriptions', 'INSERT')
    or has_table_privilege('authenticated', 'public.notification_push_rollout_members', 'SELECT') then
    failures := array_append(failures, 'authenticated must not have direct web push table access');
  end if;
  if has_function_privilege('anon', 'public.get_my_web_push_devices()', 'EXECUTE')
    or has_function_privilege('anon', 'public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text)', 'EXECUTE') then
    failures := array_append(failures, 'anonymous users must not execute web push lifecycle RPCs');
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_web_push_devices()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.reconcile_my_web_push_subscription(text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.revoke_all_my_web_push_subscriptions()', 'EXECUTE') then
    failures := array_append(failures, 'authenticated lifecycle RPC grants are incomplete');
  end if;
  if not has_function_privilege('service_role', 'public.fail_web_push_job(uuid,uuid,text,text,boolean,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.notification_channel_enabled(text)', 'EXECUTE') then
    failures := array_append(failures, 'service role worker grants are incomplete');
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'web_push_subscriptions_active_endpoint_idx'
      and indexdef ilike '%unique%where (status = ''active''%'
  ) then
    failures := array_append(failures, 'active endpoint uniqueness index is missing');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_deliveries'::regclass
      and conname = 'notification_deliveries_web_push_target'
  ) then
    failures := array_append(failures, 'device-level delivery target constraint is missing');
  end if;

  select pg_get_functiondef('public.stage_notification_for_domain_event()'::regprocedure)
  into stage_definition;
  if stage_definition not ilike '%is_finance_domain_event%'
    or stage_definition not ilike '%notification.web_push%'
    or stage_definition not ilike '%jsonb_build_object(''deliveryId'', delivery_id)%'
    or stage_definition ilike '%jsonb_build_object(''deliveryId'', delivery_id, ''endpoint''%' then
    failures := array_append(failures, 'staging must retain finance guard and queue delivery IDs only');
  end if;

  select pg_get_functiondef('public.get_platform_operations_snapshot()'::regprocedure)
  into monitoring_definition;
  if monitoring_definition not ilike '%when public.notification_channel_enabled(''web_push'') then%'
    or monitoring_definition not ilike '%else false%' then
    failures := array_append(failures, 'disabled Web Push must not emit a stale-worker alert');
  end if;

  if cardinality(failures) > 0 then
    raise exception 'WEB_PUSH_ASSERTIONS_FAILED: %', array_to_string(failures, '; ');
  end if;
end
$$;

select 'web_push_assertions_passed' as result;
