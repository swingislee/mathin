\set ON_ERROR_STOP on
-- R1-2: durable queue, notification idempotency, file governance, and integrations fail closed.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo R1 fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1 fixtures missing: 测试-教师
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if (select count(*) from public.integration_channels where status = 'disabled' and provider_key is null) <> 4 then failures := array_append(failures, 'integration defaults are not fail-closed'); end if;
  if exists(select 1 from unnest(array['email','sms','wechat']) channel_name where public.notification_channel_enabled(channel_name)) then failures := array_append(failures, 'unselected notification channel is enabled'); end if;
  if (select count(*) from public.file_policies) <> 6 then failures := array_append(failures, 'file policy defaults incomplete'); end if;
  if (select file_size_limit from storage.buckets where id = 'note-assets') <> 10485760 then failures := array_append(failures, 'note asset size policy missing'); end if;
  if (select public from storage.buckets where id = 'session-videos') then failures := array_append(failures, 'session video bucket is public'); end if;
  if has_table_privilege('authenticated', 'public.jobs', 'INSERT') then failures := array_append(failures, 'authenticated can insert jobs directly'); end if;
  if has_function_privilege('authenticated', 'public.claim_jobs(text,integer,integer)', 'EXECUTE') then failures := array_append(failures, 'authenticated can claim jobs'); end if;
  if not has_function_privilege('authenticated', 'public.replay_dead_job(uuid,text)', 'EXECUTE') then failures := array_append(failures, 'operator replay RPC unavailable'); end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.domain_events'::regclass and tgname = 'domain_events_stage_notification' and not tgisinternal) then failures := array_append(failures, 'notification outbox trigger missing'); end if;
  if cardinality(failures) > 0 then raise exception 'R1-2 structure assertions failed: %', array_to_string(failures, ', '); end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
begin
  begin
    perform public.get_platform_operations_snapshot();
    raise exception 'R1_NON_AUDITOR_SNAPSHOT_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.replay_dead_job(gen_random_uuid(), 'forbidden test');
    raise exception 'R1_NON_OPERATOR_REPLAY_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.begin_file_upload_session('session-videos', 'invalid.bin', 100, 'application/octet-stream');
    raise exception 'R1_INVALID_FILE_TYPE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FILE_TYPE_REJECTED' then raise; end if;
  end;
end
$$;

select session_id as upload_session_id from public.begin_file_upload_session(
  'session-videos', :'teacher_id' || '/r1/session/test.mp4', 1024, 'video/mp4'
) \gset
select session_id as same_upload_session_id from public.begin_file_upload_session(
  'session-videos', :'teacher_id' || '/r1/session/test.mp4', 1024, 'video/mp4'
) \gset
select (:'upload_session_id'::uuid = :'same_upload_session_id'::uuid) as r1_upload_session_idempotent \gset
\if :r1_upload_session_idempotent
\else
  \echo R1-2 TUS upload session idempotency failed
  select 1 / 0;
\endif
select public.abort_file_upload_session(:'upload_session_id'::uuid);
reset role;

select public.enqueue_job('test.noop', '{"case":"retry"}'::jsonb, 'r1:job:retry', 'r1:effect:retry', now(), 0, 2, 60, 2) as retry_job_id \gset
select public.enqueue_job('test.noop', '{"case":"retry"}'::jsonb, 'r1:job:retry', 'r1:effect:retry', now(), 0, 2, 60, 2) as duplicate_job_id \gset
select (:'retry_job_id'::uuid = :'duplicate_job_id'::uuid and (select count(*) from public.jobs where idempotency_key = 'r1:job:retry') = 1) as r1_job_enqueue_idempotent \gset
\if :r1_job_enqueue_idempotent
\else
  \echo R1-2 job enqueue idempotency failed
  select 1 / 0;
\endif

select public.heartbeat_job_worker('r1-ci-worker-a', 'test');
select job_id as claimed_job_id, lease_token as claimed_lease_token, attempt_no as claimed_attempt_no
  from public.claim_jobs('r1-ci-worker-a', 1, 60) \gset
select (:'claimed_job_id'::uuid = :'retry_job_id'::uuid and :'claimed_attempt_no'::integer = 1
  and (select count(*) from public.claim_jobs('r1-ci-worker-b', 1, 60)) = 0) as r1_job_lease_exclusive \gset
\if :r1_job_lease_exclusive
\else
  \echo R1-2 job lease exclusivity failed
  select 1 / 0;
\endif

select public.fail_job(:'claimed_job_id'::uuid, :'claimed_lease_token'::uuid, 'TRANSIENT', 'retry me', true) as retry_status \gset
select (:'retry_status' = 'retry' and (select available_at > now() from public.jobs where id = :'retry_job_id'::uuid)) as r1_job_backoff_ok \gset
\if :r1_job_backoff_ok
\else
  \echo R1-2 exponential backoff failed
  select 1 / 0;
\endif
update public.jobs set available_at = now() where id = :'retry_job_id'::uuid;
select job_id as claimed_job_id_2, lease_token as claimed_lease_token_2, attempt_no as claimed_attempt_no_2
  from public.claim_jobs('r1-ci-worker-b', 1, 60) \gset
select public.fail_job(:'claimed_job_id_2'::uuid, :'claimed_lease_token_2'::uuid, 'TRANSIENT', 'exhaust retries', true) as dead_status \gset
select (:'dead_status' = 'dead' and :'claimed_attempt_no_2'::integer = 2
  and (select dead_lettered_at is not null from public.jobs where id = :'retry_job_id'::uuid)) as r1_dead_letter_ok \gset
\if :r1_dead_letter_ok
\else
  \echo R1-2 dead-letter transition failed
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.replay_dead_job(:'retry_job_id'::uuid, 'CI operator replay') as replay_job_id \gset
select ((select replay_of_job_id = :'retry_job_id'::uuid and effect_key = 'r1:effect:retry' and status = 'pending'
          from public.jobs where id = :'replay_job_id'::uuid)
  and exists(select 1 from public.domain_events where event_type = 'job.replayed' and entity_id = :'replay_job_id'::uuid)) as r1_manual_replay_ok \gset
\if :r1_manual_replay_ok
\else
  \echo R1-2 manual replay audit failed
  select 1 / 0;
\endif
select (public.get_platform_operations_snapshot() ? 'jobs') as r1_ops_snapshot_ok \gset
\if :r1_ops_snapshot_ok
\else
  \echo R1-2 operations snapshot failed
  select 1 / 0;
\endif
reset role;

select public.enqueue_job('test.noop', '{"case":"timeout"}'::jsonb, 'r1:job:timeout', 'r1:effect:timeout', now(), 50, 1, 5, 1) as timeout_job_id \gset
select job_id as timeout_claimed_id, lease_token as timeout_lease_token from public.claim_jobs('r1-ci-timeout', 1, 5) \gset
update public.jobs set lease_expires_at = now() - interval '1 second' where id = :'timeout_job_id'::uuid;
select public.recover_expired_job_leases();
select ((select status = 'dead' and last_error_code = 'LEASE_TIMEOUT' from public.jobs where id = :'timeout_job_id'::uuid)
  and (select outcome = 'timeout' from public.job_attempts where job_id = :'timeout_job_id'::uuid and attempt_no = 1)) as r1_job_timeout_ok \gset
\if :r1_job_timeout_ok
\else
  \echo R1-2 lease timeout recovery failed
  select 1 / 0;
\endif

select public.enqueue_job('test.noop', '{"case":"effect-a"}'::jsonb, 'r1:job:effect-a', 'r1:shared-effect', now(), 40, 1, 60, 1) as effect_job_a \gset
select public.enqueue_job('test.noop', '{"case":"effect-b"}'::jsonb, 'r1:job:effect-b', 'r1:shared-effect', now(), 39, 1, 60, 1) as effect_job_b \gset
do $$
declare claimed record; first_seen boolean := false; reserved boolean;
begin
  for claimed in select * from public.claim_jobs('r1-ci-effects', 2, 60) loop
    reserved := public.reserve_job_effect(claimed.job_id, claimed.lease_token, claimed.effect_key);
    if not first_seen then
      if not reserved then raise exception 'FIRST_EFFECT_NOT_RESERVED'; end if;
      perform public.complete_job_effect(claimed.job_id, claimed.lease_token, claimed.effect_key, '{"done":true}'::jsonb);
      first_seen := true;
    elsif reserved then
      raise exception 'DUPLICATE_EFFECT_RESERVED';
    end if;
    perform public.complete_job(claimed.job_id, claimed.lease_token, jsonb_build_object('reserved', reserved));
  end loop;
end
$$;
select ((select count(*) from public.job_effects where effect_key = 'r1:shared-effect' and status = 'completed') = 1) as r1_effect_idempotency_ok \gset
\if :r1_effect_idempotency_ok
\else
  \echo R1-2 effect idempotency failed
  select 1 / 0;
\endif

insert into public.domain_events(actor_id, actor_role, target_user_id, event_type, entity_type, payload, event_link)
values(:'admin_id'::uuid, 'admin', :'teacher_id'::uuid, 'r1.notification.test', 'profile', '{"safe":"summary"}'::jsonb, '/dashboard')
returning id as notification_event_id \gset
select id as notification_id from public.notifications where source_event_id = :'notification_event_id'::uuid \gset
select ((select count(*) from public.notifications where source_event_id = :'notification_event_id'::uuid) = 1
  and (select count(*) from public.notification_deliveries where notification_id = :'notification_id'::uuid and channel = 'in_app' and status = 'sent') = 1
  and not exists(select 1 from public.jobs where kind like 'notification.%' and payload ->> 'notificationId' = :'notification_id')) as r1_in_app_notification_ok \gset
\if :r1_in_app_notification_ok
\else
  \echo R1-2 in-app notification or external fail-closed assertion failed
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select ((select count(*) from public.notifications where id = :'notification_id'::uuid) = 1
  and public.mark_notifications_read_through(:'notification_id'::uuid) >= 1) as r1_notification_read_ok \gset
\if :r1_notification_read_ok
\else
  \echo R1-2 notification RLS/read state failed
  select 1 / 0;
\endif
reset role;

do $$
begin
  begin
    perform public.accept_webhook_receipt('ci-provider', 'disabled', now(), repeat('a',64), repeat('b',64), '{}'::jsonb);
    raise exception 'R1_DISABLED_WEBHOOK_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'CHANNEL_DISABLED' then raise; end if;
  end;
end
$$;
update public.integration_channels set provider_key = 'ci-provider', status = 'enabled', secret_ref = 'MATHIN_WEBHOOK_CI_SECRET',
  failure_threshold = 2, change_reason = 'CI transaction only' where channel = 'webhook';
select public.accept_webhook_receipt('ci-provider', 'event-1', now(), repeat('a',64), repeat('b',64), '{"kind":"test"}'::jsonb) as webhook_receipt_id \gset
do $$
begin
  begin
    perform public.accept_webhook_receipt('ci-provider', 'event-1', now(), repeat('a',64), repeat('b',64), '{}'::jsonb);
    raise exception 'R1_WEBHOOK_REPLAY_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'WEBHOOK_REPLAY' then raise; end if;
  end;
  begin
    perform public.accept_webhook_receipt('ci-provider', 'event-old', now() - interval '10 minutes', repeat('a',64), repeat('b',64), '{}'::jsonb);
    raise exception 'R1_STALE_WEBHOOK_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE' then raise; end if;
  end;
end
$$;
select public.record_integration_outcome('webhook', false, 'TIMEOUT');
select public.record_integration_outcome('webhook', false, 'TIMEOUT') as degraded_status \gset
select (:'degraded_status' = 'degraded' and (select degraded_until > now() from public.integration_channels where channel = 'webhook')) as r1_provider_degradation_ok \gset
\if :r1_provider_degradation_ok
\else
  \echo R1-2 provider circuit breaker failed
  select 1 / 0;
\endif

insert into public.notes(owner_id, title, document) values(:'teacher_id'::uuid, 'R1 managed file', '[]'::jsonb) returning id as managed_note_id \gset
insert into storage.objects(id, bucket_id, name, owner_id, metadata)
values(gen_random_uuid(), 'note-assets', :'teacher_id' || '/' || :'managed_note_id' || '/r1.png', :'teacher_id',
  '{"size":128,"mimetype":"image/png"}'::jsonb);
select id as managed_note_file_id from public.managed_files
 where bucket_id = 'note-assets' and object_path = :'teacher_id' || '/' || :'managed_note_id' || '/r1.png' \gset
select (select linked_entity_type = 'note' and linked_entity_id = :'managed_note_id'::uuid and byte_count = 128
  from public.managed_files where id = :'managed_note_file_id'::uuid) as r1_managed_file_capture_ok \gset
\if :r1_managed_file_capture_ok
\else
  \echo R1-2 managed file capture/link failed
  select 1 / 0;
\endif

insert into storage.objects(id, bucket_id, name, owner_id, metadata)
values(gen_random_uuid(), 'session-videos', :'teacher_id' || '/orphan/r1.mp4', :'teacher_id',
  '{"size":256,"mimetype":"video/mp4"}'::jsonb);
update public.managed_files set orphan_after = now() - interval '1 second'
 where bucket_id = 'session-videos' and object_path = :'teacher_id' || '/orphan/r1.mp4';
select public.enqueue_file_cleanup_jobs(10) as cleanup_count \gset
select (:'cleanup_count'::integer >= 1 and exists(select 1 from public.jobs where kind = 'file.cleanup'
  and payload ->> 'objectPath' = :'teacher_id' || '/orphan/r1.mp4')) as r1_orphan_cleanup_ok \gset
\if :r1_orphan_cleanup_ok
\else
  \echo R1-2 orphan cleanup enqueue failed
  select 1 / 0;
\endif

rollback;
\echo R1-2 platform runtime assertions passed
