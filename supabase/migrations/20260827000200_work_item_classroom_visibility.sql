-- Keep the ordinary staff inbox aligned with the ordinary classroom list.
--
-- Classroom fixtures and archived classrooms remain available through the
-- dedicated test scope, but must not create global operational work items.
-- Apply the rule once around the unified projection so current and future
-- class/session-backed sources cannot drift independently.

begin;

alter function public.list_my_work_items(text, boolean)
  rename to list_my_work_items_before_classroom_visibility;
revoke all on function public.list_my_work_items_before_classroom_visibility(text, boolean)
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
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with projected as (
    select item_row.*
    from public.list_my_work_items_before_classroom_visibility(p_domain, p_ignore_snooze) item_row
  ), resolved as (
    select
      projected.*,
      (
        coalesce(projected.primary_object_type in ('classroom', 'session'), false)
        or coalesce(projected.secondary_object_type in ('classroom', 'session'), false)
      ) as is_classroom_scoped,
      coalesce(
        case when projected.primary_object_type = 'classroom' then projected.primary_object_id end,
        primary_session.classroom_id,
        case when projected.secondary_object_type = 'classroom' then projected.secondary_object_id end,
        secondary_session.classroom_id
      ) as resolved_classroom_id
    from projected
    left join public.class_sessions primary_session
      on projected.primary_object_type = 'session'
     and primary_session.id = projected.primary_object_id
    left join public.class_sessions secondary_session
      on projected.secondary_object_type = 'session'
     and secondary_session.id = projected.secondary_object_id
  )
  select
    resolved.work_key,
    resolved.group_key,
    resolved.type,
    resolved.domain,
    resolved.kind,
    resolved.primary_object_type,
    resolved.primary_object_id,
    resolved.primary_object_name,
    resolved.secondary_object_type,
    resolved.secondary_object_id,
    resolved.secondary_object_name,
    resolved.context,
    resolved.responsibility,
    resolved.ownership_mode,
    resolved.available_at,
    resolved.due_at,
    resolved.scheduled_at,
    resolved.created_at,
    resolved.urgency_bucket,
    resolved.severity,
    resolved.escalation_level,
    resolved.resurface_at,
    resolved.reason_codes,
    resolved.action_code,
    resolved.can_act,
    resolved.context_lens,
    resolved.route_target,
    resolved.route_params,
    resolved.last_seen_at,
    resolved.snoozed_until,
    resolved.pinned_at,
    resolved.acknowledged_at,
    resolved.watching,
    resolved.source_kind,
    resolved.source_id,
    resolved.action_kind,
    resolved.action_href,
    resolved.assignee_id,
    resolved.assignee_name,
    resolved.priority,
    resolved.read_state
  from resolved
  left join public.classrooms classroom_row
    on classroom_row.id = resolved.resolved_classroom_id
  where not resolved.is_classroom_scoped
     or (
       classroom_row.id is not null
       and classroom_row.purpose = 'production'
       and classroom_row.archived_at is null
       and classroom_row.trashed_at is null
     )
  order by
    case resolved.urgency_bucket when 'now' then 0 when 'overdue' then 1 when 'today' then 2 when 'upcoming' then 3 else 4 end,
    resolved.pinned_at desc nulls last,
    case resolved.priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    coalesce(resolved.due_at, resolved.scheduled_at) asc nulls last,
    resolved.created_at asc,
    resolved.work_key asc
$$;

revoke all on function public.list_my_work_items(text, boolean) from public, anon, authenticated;
grant execute on function public.list_my_work_items(text, boolean) to authenticated;

comment on function public.list_my_work_items(text, boolean) is
  'Unified staff inbox; class/session-backed items are limited to ordinary visible production classrooms.';

-- Rebind the summary projection explicitly to the visibility-filtered reader.
create or replace function public.list_my_work_summary()
returns table(domain text, urgency_bucket text, item_count bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select item_row.domain, item_row.urgency_bucket, count(*)::bigint
  from public.list_my_work_items() item_row
  group by item_row.domain, item_row.urgency_bucket
$$;

revoke all on function public.list_my_work_summary() from public, anon, authenticated;
grant execute on function public.list_my_work_summary() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
