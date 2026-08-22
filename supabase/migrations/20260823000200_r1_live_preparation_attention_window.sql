begin;

-- Preparation should enter a teacher's attention queue only two weeks before
-- class. The due point is T-7; from then until class it is overdue and becomes
-- visible to operational supervisors. The immutable scheduled_at remains the
-- boundary used by the application to label a later submission as late.
alter function public.list_my_work_items(text, boolean)
  rename to list_my_work_items_before_preparation_window;
revoke all on function public.list_my_work_items_before_preparation_window(text, boolean)
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
  with base as (
    select item_row.*
    from public.list_my_work_items_before_preparation_window(p_domain, p_ignore_snooze) item_row
    where item_row.kind <> 'session.prepare'
       or item_row.scheduled_at <= now() + interval '14 days'
  ),
  adjusted_base as (
    select
      base.work_key,
      base.group_key,
      base.type,
      base.domain,
      base.kind,
      base.primary_object_type,
      base.primary_object_id,
      base.primary_object_name,
      base.secondary_object_type,
      base.secondary_object_id,
      base.secondary_object_name,
      case when base.kind = 'session.prepare' then base.context || jsonb_build_object(
        'preparationWindowStartsAt', base.scheduled_at - interval '14 days',
        'preparationDueAt', base.scheduled_at - interval '7 days',
        'lateAfterAt', base.scheduled_at
      ) else base.context end,
      base.responsibility,
      base.ownership_mode,
      case when base.kind = 'session.prepare' then base.scheduled_at - interval '14 days' else base.available_at end,
      case when base.kind = 'session.prepare' then base.scheduled_at - interval '7 days' else base.due_at end,
      base.scheduled_at,
      base.created_at,
      case when base.kind = 'session.prepare' then prep_urgency.urgency_bucket else base.urgency_bucket end,
      case when base.kind = 'session.prepare' then prep_urgency.severity else base.severity end,
      case when base.kind = 'session.prepare' and base.ownership_mode <> 'oversight' then 0 else base.escalation_level end,
      case when base.kind = 'session.prepare' and base.ownership_mode = 'oversight' then base.scheduled_at - interval '7 days' else base.resurface_at end,
      case when base.kind = 'session.prepare' then base.reason_codes || array['preparation_window']::text[] else base.reason_codes end,
      base.action_code,
      base.can_act,
      base.context_lens,
      base.route_target,
      base.route_params,
      base.last_seen_at,
      base.snoozed_until,
      base.pinned_at,
      base.acknowledged_at,
      base.watching,
      base.source_kind,
      base.source_id,
      base.action_kind,
      base.action_href,
      base.assignee_id,
      base.assignee_name,
      case when base.kind = 'session.prepare' then prep_urgency.severity else base.priority end,
      base.read_state
    from base
    cross join lateral public.classify_work_item_urgency(
      case when base.kind = 'session.prepare' then base.scheduled_at - interval '7 days' else coalesce(base.due_at, base.scheduled_at) end,
      case when base.kind = 'session.prepare' then 'normal' else base.priority end
    ) prep_urgency
  ),
  supervisor_preparation as (
    select
      'session:' || session_row.id || ':prepare:overdue'::text,
      'session:' || session_row.id::text,
      'alert'::text,
      'teaching'::text,
      'session.prepare'::text,
      'session'::text,
      session_row.id,
      coalesce(nullif(session_row.title, ''), to_char(session_row.scheduled_at, 'MM-DD HH24:MI') || ' 课次'),
      'classroom'::text,
      session_row.classroom_id,
      classroom_row.name,
      jsonb_build_object(
        'prepStatus', coalesce(preparation_row.status, 'not_started'),
        'scheduledAt', session_row.scheduled_at,
        'preparationWindowStartsAt', session_row.scheduled_at - interval '14 days',
        'preparationDueAt', session_row.scheduled_at - interval '7 days',
        'lateAfterAt', session_row.scheduled_at
      ),
      'manager_oversight'::text,
      'oversight'::text,
      session_row.scheduled_at - interval '7 days',
      session_row.scheduled_at - interval '7 days',
      session_row.scheduled_at,
      coalesce(preparation_row.updated_at, session_row.created_at),
      urgency.urgency_bucket,
      urgency.severity,
      case when urgency.urgency_bucket = 'now' then 2 when urgency.urgency_bucket = 'overdue' then 1 else 0 end::integer,
      session_row.scheduled_at - interval '7 days',
      array['prep_overdue', 'manager_oversight']::text[],
      'review_preparation'::text,
      true,
      'management'::text,
      'session:' || session_row.id::text,
      '{}'::jsonb,
      state_row.last_seen_at,
      state_row.snoozed_until,
      state_row.pinned_at,
      state_row.acknowledged_at,
      coalesce(state_row.watching, false),
      'domain_projection'::text,
      session_row.id::text,
      'review_preparation'::text,
      '/dashboard/sessions/' || session_row.id::text,
      null::uuid,
      null::text,
      urgency.severity,
      case when state_row.last_seen_at is null then 'unseen' else 'seen' end::text
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    left join public.session_preparations preparation_row on preparation_row.session_id = session_row.id
    cross join lateral public.classify_work_item_urgency(session_row.scheduled_at - interval '7 days', 'normal') urgency
    left join public.work_item_user_state state_row
      on state_row.user_id = auth.uid()
     and state_row.work_key = 'session:' || session_row.id || ':prepare:overdue'
    where coalesce(preparation_row.status, 'not_started') <> 'ready'
      and session_row.deleted_at is null
      and session_row.voided_at is null
      and session_row.ended_at is null
      and session_row.scheduled_at is not null
      and session_row.scheduled_at <= now() + interval '7 days'
      and (nullif(btrim(coalesce(p_domain, '')), '') is null or nullif(btrim(p_domain), '') = 'teaching')
      and (public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'class.view.all') or public.has_perm(auth.uid(), 'class.manage'))
      and not exists (
        select 1 from public.classroom_staff_assignments assignment_row
        where assignment_row.classroom_id = session_row.classroom_id
          and assignment_row.user_id = auth.uid()
          and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      )
      and (
        p_ignore_snooze
        or not (
          state_row.snoozed_until is not null
          and state_row.snoozed_until > now()
          and urgency.urgency_bucket in ('today', 'upcoming', 'backlog')
        )
      )
  ),
  combined as (
    select * from adjusted_base
    union all
    select * from supervisor_preparation
  )
  select combined.*
  from combined
  order by
    case combined.urgency_bucket when 'now' then 0 when 'overdue' then 1 when 'today' then 2 when 'upcoming' then 3 else 4 end,
    combined.pinned_at desc nulls last,
    case combined.priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    coalesce(combined.due_at, combined.scheduled_at) asc nulls last,
    combined.created_at asc,
    combined.work_key asc
$$;

revoke all on function public.list_my_work_items(text, boolean) from public, anon, authenticated;
grant execute on function public.list_my_work_items(text, boolean) to authenticated;

comment on function public.list_my_work_items(text, boolean) is
  'R1-Live attention projection: teacher preparation T-14/T-7, supervisor overdue visibility from T-7.';

commit;
