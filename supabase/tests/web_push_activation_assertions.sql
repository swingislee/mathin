-- 由 loopback-only runner 在 SERIALIZABLE 事务中加载；所有业务夹具均回滚。
do $$
declare
  admin_id uuid; teacher_id uuid; first_device uuid; second_device uuid;
  event_id uuid; delivery_id uuid; claimed record; count_claimed integer := 0;
  foreign_job uuid; fixture_prefix text := 'push-check:' || gen_random_uuid()::text;
  snapshot jsonb;
begin
  select id into admin_id from auth.users where email = current_setting('push_test.admin_email');
  select id into teacher_id from auth.users where email = current_setting('push_test.teacher_email');
  if admin_id is null or teacher_id is null or admin_id = teacher_id then raise exception 'FIXED_ACCOUNTS_NOT_FOUND'; end if;
  if not exists(select 1 from public.profiles where id=admin_id and role='admin' and is_active and account_status='active')
    or not exists(select 1 from public.profiles where id=teacher_id and role='staff' and is_active and account_status='active')
  then raise exception 'FIXED_ACCOUNTS_NOT_ELIGIBLE'; end if;

  if has_function_privilege('anon','public.claim_web_push_jobs(text,integer,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_web_push_jobs(text,integer,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.expire_web_push_subscriptions(integer)','EXECUTE')
    or has_function_privilege('authenticated','public.get_web_push_monitor_snapshot()','EXECUTE')
    or not has_function_privilege('service_role','public.claim_web_push_jobs(text,integer,integer)','EXECUTE')
  then raise exception 'WORKER_RPC_ACL_FAILED'; end if;
  if has_table_privilege('authenticated','public.web_push_subscriptions','SELECT')
    or has_table_privilege('anon','public.web_push_subscriptions','SELECT')
  then raise exception 'CIPHERTEXT_READ_ACL_FAILED'; end if;

  insert into public.notification_push_rollout_members(recipient_id,cohort,status,reason)
  values(admin_id,'employee_test','active','transaction-local test'),(teacher_id,'employee_test','active','transaction-local test')
  on conflict(recipient_id) do update set status='active',effective_from=now(),effective_until=null;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform public.set_feature_flag('notifications.web_push',null,true,now(),'transaction-local push test');
  update public.integration_channels set status='enabled',secret_ref='MATHIN_WEB_PUSH_TEST_SECRET',degraded_until=null where channel='web_push';
  if not public.notification_channel_enabled('web_push') then raise exception 'TEST_CHANNEL_NOT_ENABLED'; end if;

  perform set_config('request.jwt.claim.sub',teacher_id::text,true);
  begin
    perform public.register_my_web_push_subscription(repeat('d',64),repeat('A',100),1,1,'Rejected device','shared','chrome','windows','zh');
    raise exception 'UNSUPPORTED_BROWSER_REGISTERED';
  exception when raise_exception then
    if sqlerrm <> 'WEB_PUSH_BROWSER_NOT_SUPPORTED' then raise; end if;
  end;
  if position('web_push_recipient:' in pg_get_functiondef('public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text)'::regprocedure)) = 0
    or position('web_push_recipient:' in pg_get_functiondef('public.send_my_web_push_test(uuid)'::regprocedure)) = 0
  then raise exception 'RECIPIENT_SERIALIZATION_MISSING'; end if;
  first_device := public.register_my_web_push_subscription(repeat('a',64),repeat('A',100),1,1,'Rollback shared device','shared','edge','windows','zh');
  if not exists(select 1 from public.web_push_subscriptions where id=first_device and lease_expires_at=now()+interval '8 hours')
  then raise exception 'SHARED_LEASE_FAILED'; end if;
  event_id := public.send_my_web_push_test(first_device);
  select d.id into delivery_id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
    where n.source_event_id=event_id and d.channel='web_push';
  if delivery_id is null then raise exception 'DEVICE_STAGING_FAILED'; end if;
  begin
    perform public.send_my_web_push_test(first_device);
    raise exception 'TEST_RATE_LIMIT_NOT_ENFORCED';
  exception when raise_exception then
    if sqlerrm <> 'RATE_LIMITED' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  if exists(select 1 from public.get_my_web_push_devices() where id=first_device)
  then raise exception 'FOREIGN_DEVICE_VISIBLE'; end if;
  if public.revoke_my_web_push_subscription(first_device) then raise exception 'FOREIGN_REVOKE_SUCCEEDED'; end if;
  begin
    perform public.resolve_my_web_push_delivery(delivery_id);
    raise exception 'FOREIGN_CLICK_SUCCEEDED';
  exception when raise_exception then
    if sqlerrm <> 'NOT_FOUND' then raise; end if;
  end;
  second_device := public.register_my_web_push_subscription(repeat('a',64),repeat('B',100),1,1,'Rollback personal device','personal','edge','windows','en');
  if not exists(select 1 from public.web_push_subscriptions where id=first_device and status='revoked' and encrypted_payload is null)
    or not exists(select 1 from public.web_push_subscriptions where id=second_device and lease_expires_at=now()+interval '30 days')
  then raise exception 'SHARED_OWNER_REPLACEMENT_FAILED'; end if;
  update public.profiles set is_active=false where id=admin_id;
  if public.is_web_push_recipient_eligible(admin_id)
    or exists(select 1 from public.web_push_subscriptions where id=second_device and encrypted_payload is not null)
  then raise exception 'IMMEDIATE_RECIPIENT_REVOKE_FAILED'; end if;

  perform set_config('request.jwt.claim.sub',teacher_id::text,true);
  second_device := public.register_my_web_push_subscription(repeat('b',64),repeat('C',100),1,1,'Rollback expired device','shared','edge','windows','zh');
  update public.web_push_subscriptions set created_at=now()-interval '2 days',lease_expires_at=now()-interval '1 day' where id=second_device;
  perform public.expire_web_push_subscriptions(500);
  if not exists(select 1 from public.web_push_subscriptions where id=second_device and status='expired' and encrypted_payload is null)
  then raise exception 'EXPIRY_CIPHERTEXT_REMOVAL_FAILED'; end if;

  foreign_job := public.enqueue_job('file.verify','{}',fixture_prefix||':foreign',fixture_prefix||':foreign-effect',now(),100,5,10,30);
  perform public.heartbeat_job_worker('push-db-check','r1-7.3-web-push-scoped');
  for claimed in select * from public.claim_web_push_jobs('push-db-check',100,60) loop
    if claimed.kind <> 'notification.web_push' then raise exception 'FOREIGN_JOB_CLAIMED'; end if;
    if claimed.lease_expires_at < now()+interval '60 seconds' then raise exception 'PUSH_LEASE_TOO_SHORT'; end if;
    count_claimed := count_claimed+1;
  end loop;
  if count_claimed=0 or not exists(select 1 from public.jobs where id=foreign_job and status='pending')
  then raise exception 'PUSH_CLAIM_ISOLATION_FAILED'; end if;
  update public.jobs set lease_expires_at=now()-interval '1 second',attempt_count=max_attempts where id=(select job_id from public.notification_deliveries where id=delivery_id);
  perform public.claim_web_push_jobs('push-db-check',100,60);
  if not exists(select 1 from public.notification_deliveries where id=delivery_id and status='dead' and error_code='LEASE_TIMEOUT')
  then raise exception 'FINAL_LEASE_TIMEOUT_NOT_TERMINAL'; end if;

  update public.profiles set is_active=true where id=admin_id;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform public.set_feature_flag('notifications.web_push',null,false,now(),'transaction-local kill switch test');
  if public.notification_channel_enabled('web_push') then raise exception 'FEATURE_KILL_SWITCH_FAILED'; end if;
  snapshot := public.get_web_push_monitor_snapshot();
  if (snapshot->>'featureEnabled')::boolean or (snapshot->>'dead')::integer < 1
    or snapshot::text ~ '(endpoint|encrypted_payload|recipient_id|deep_link|email)'
  then raise exception 'AGGREGATE_MONITOR_CONTRACT_FAILED'; end if;
end
$$;
select 'web_push_activation_assertions_passed';
