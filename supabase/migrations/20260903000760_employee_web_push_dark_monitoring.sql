-- DEV-WEB-PUSH-1: an intentionally disabled Web Push runtime must not emit a
-- stale-worker alert. Once the feature and integration are both enabled,
-- absence of a recent Web Push-capable worker becomes actionable.

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
      'workerStale', case
        when public.notification_channel_enabled('web_push') then
          coalesce((select max(worker_row.last_seen_at) < now() - interval '2 minutes'
            from public.job_workers worker_row where worker_row.version like '%web-push%'), true)
        else false
      end
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
