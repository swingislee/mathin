-- P4I-6：统一工作投影（docs/plan/19-p4i-final.md §6-7, §19.9, §22）
--
-- 判断点（详见 .claude/p4i-0-baseline.md「P4I-6 执行记录」）：
-- 1. 首期来源边界：只投影"生成器已接线、真实会产生行"的来源，共 11 个 kind。
--    明确排除：absence_check/makeup_followup/renewal_followup（P4H-9/P4I-5 保留未接线，投影也是空查询）、
--    排课冲突、花名册错位（全仓库无检测逻辑，超出本任务范围）、"未来7天使用但无release"（与
--    review.approve/review.publish 信号重叠）、催缴（orders 无 assignee 列，无法落地"明确指派"）。
-- 2. list_my_work_items 内部 union all 11 个来源子查询，urgency_bucket/severity 由
--    classify_work_item_urgency() 统一计算，避免复制粘贴同一段 case。
-- 3. snooze 对 now/overdue 桶的限制是真限制：now 桶禁止 snooze；overdue/today 上限 24h；
--    其余上限 14 天。列表侧对称：snoozed_until>now() 只在 upcoming/backlog/today 桶隐藏该行，
--    now/overdue 永不因 snooze 隐藏。
-- 4. escalation_level/resurface_at 不做历史表，按当前状态动态算（仅 oversight 行有意义）。
-- 5. work_item_user_state 只读 RLS + RPC 写入，不给直接 insert/update policy。
-- 6. can_act 是 UI 展示提示，不是安全边界——真正执行仍会调用各领域自己的 RPC，那里才是最终权限判定。
-- 7. snooze/seen/pin/acknowledge/watch 是轻量 UI 状态，不通过 emit_domain_event 记审计事件
--    （避免每次"已读"都写进审计日志，与其它高频只读态标记的处理方式一致）。

begin;

-- ============================================================
-- 1. work_item_user_state
-- ============================================================

create table if not exists public.work_item_user_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_key text not null,
  last_seen_at timestamptz,
  snoozed_until timestamptz,
  pinned_at timestamptz,
  acknowledged_at timestamptz,
  watching boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_key)
);

comment on table public.work_item_user_state is 'P4I-6 统一工作项的用户级状态（已读/延后/置顶/确认/关注），不持有业务事实。';

create trigger work_item_user_state_set_updated_at
  before update on public.work_item_user_state
  for each row execute function public.set_updated_at();

alter table public.work_item_user_state enable row level security;

create policy work_item_user_state_select_self on public.work_item_user_state
  for select using (user_id = auth.uid());

grant select on public.work_item_user_state to authenticated;

-- ============================================================
-- 2. classify_work_item_urgency
-- ============================================================

create or replace function public.classify_work_item_urgency(
  p_effective_at timestamptz,
  p_severity_floor text default 'normal'
)
returns table(urgency_bucket text, severity text)
language sql
stable
set search_path = public, pg_temp
as $$
  with bucket as (
    select case
      when p_effective_at is null then 'backlog'
      when p_effective_at <= now() then 'overdue'
      when p_effective_at <= now() + interval '30 minutes' then 'now'
      when p_effective_at::date = now()::date then 'today'
      when p_effective_at <= now() + interval '7 days' then 'upcoming'
      else 'backlog'
    end as b
  )
  select
    bucket.b,
    case
      when bucket.b = 'now' then 'critical'
      when bucket.b = 'overdue' and p_effective_at <= now() - interval '2 hours' then 'critical'
      when p_severity_floor = 'critical' then 'critical'
      when bucket.b = 'overdue' then 'high'
      when p_severity_floor = 'high' then 'high'
      when p_severity_floor = 'low' then 'low'
      else 'normal'
    end
  from bucket
$$;

revoke all on function public.classify_work_item_urgency(timestamptz, text) from public, anon;
grant execute on function public.classify_work_item_urgency(timestamptz, text) to authenticated;

-- ============================================================
-- 3. list_my_work_items
-- ============================================================

create or replace function public.list_my_work_items(p_domain text default null, p_ignore_snooze boolean default false)
returns table(
  work_key text,
  group_key text,
  type text,
  domain text,
  kind text,
  primary_object_type text,
  primary_object_id uuid,
  primary_object_name text,
  secondary_object_type text,
  secondary_object_id uuid,
  secondary_object_name text,
  context jsonb,
  responsibility text,
  ownership_mode text,
  available_at timestamptz,
  due_at timestamptz,
  scheduled_at timestamptz,
  created_at timestamptz,
  urgency_bucket text,
  severity text,
  escalation_level integer,
  resurface_at timestamptz,
  reason_codes text[],
  action_code text,
  can_act boolean,
  context_lens text,
  route_target text,
  route_params jsonb,
  last_seen_at timestamptz,
  snoozed_until timestamptz,
  pinned_at timestamptz,
  acknowledged_at timestamptz,
  watching boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_domain text := nullif(trim(coalesce(p_domain, '')), '');
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if v_domain is not null and v_domain not in ('curriculum', 'teaching', 'student_service', 'finance', 'operations') then
    raise exception 'INVALID_DOMAIN';
  end if;

  return query
  with source as (
    -- review.fix：校对退回，制作人修改重提
    select
      'lecture:' || cyc.lecture_id || ':' || cyc.track || ':review:fix:' || cyc.id as work_key,
      'action'::text as type,
      'curriculum'::text as domain,
      'review.fix'::text as kind,
      'lecture'::text as primary_object_type,
      cyc.lecture_id as primary_object_id,
      lec.name as primary_object_name,
      null::text as secondary_object_type,
      null::uuid as secondary_object_id,
      null::text as secondary_object_name,
      jsonb_build_object('track', cyc.track, 'round', cyc.review_round_no, 'reviewNote', cyc.review_note) as context,
      'object_owner'::text as responsibility,
      'direct'::text as ownership_mode,
      null::timestamptz as available_at,
      wf.internal_due_at as due_at,
      null::timestamptz as scheduled_at,
      coalesce(cyc.reviewed_at, cyc.submitted_at) as created_at,
      array['review_changes_requested']::text[] as reason_codes,
      'fix_and_resubmit'::text as action_code,
      public.has_perm(uid, 'courseware.page.edit') as can_act,
      'production'::text as context_lens,
      'lecture:' || cyc.lecture_id as route_target,
      jsonb_build_object('track', cyc.track) as route_params,
      'normal'::text as severity_floor
    from public.cw_review_cycles cyc
    join public.cw_lecture_workflows wf on wf.lecture_id = cyc.lecture_id and wf.track = cyc.track
    join public.course_lectures lec on lec.id = cyc.lecture_id
    where cyc.status = 'changes_requested'
      and wf.active_review_cycle_id = cyc.id
      and lec.archived_at is null
      and cyc.creator_id = uid

    union all

    -- review.approve：等待校对
    select
      'lecture:' || cyc.lecture_id || ':' || cyc.track || ':review:approve:' || cyc.id,
      'action', 'curriculum', 'review.approve',
      'lecture', cyc.lecture_id, lec.name,
      null, null, null,
      jsonb_build_object('track', cyc.track, 'round', cyc.review_round_no, 'submissionNote', cyc.submission_note),
      'reviewer',
      case
        when exists (
          select 1 from public.resolve_course_assignments(cyc.lecture_id) ra
          where ra.responsibility = 'reviewer' and ra.user_id = uid
        ) then 'direct'
        else 'oversight'
      end,
      cyc.submitted_at, wf.internal_due_at, null, cyc.submitted_at,
      array['review_waiting_approval'],
      'approve_or_reject',
      public.has_perm(uid, 'courseware.review'),
      'production',
      'lecture:' || cyc.lecture_id, jsonb_build_object('track', cyc.track),
      'normal'
    from public.cw_review_cycles cyc
    join public.cw_lecture_workflows wf on wf.lecture_id = cyc.lecture_id and wf.track = cyc.track
    join public.course_lectures lec on lec.id = cyc.lecture_id
    where cyc.status = 'submitted'
      and cyc.reviewer_id is null
      and wf.active_review_cycle_id = cyc.id
      and lec.archived_at is null
      and (
        exists (
          select 1 from public.resolve_course_assignments(cyc.lecture_id) ra
          where ra.responsibility = 'reviewer' and ra.user_id = uid
        ) and public.has_perm(uid, 'courseware.review')
        or (
          not exists (select 1 from public.resolve_course_assignments(cyc.lecture_id) ra where ra.responsibility = 'reviewer')
          and (public.is_admin(uid) or public.has_perm(uid, 'course.manage'))
        )
      )

    union all

    -- review.publish：待发布
    select
      'lecture:' || wf.lecture_id || ':' || wf.track || ':release:publish',
      'action', 'curriculum', 'review.publish',
      'lecture', wf.lecture_id, lec.name,
      null, null, null,
      jsonb_build_object('track', wf.track, 'round', wf.current_review_round),
      'object_owner',
      case
        when exists (
          select 1 from public.resolve_course_assignments(wf.lecture_id) ra
          where ra.responsibility in ('owner', 'editor') and ra.user_id = uid
        ) and public.has_perm(uid, 'courseware.release.publish') then 'direct'
        else 'oversight'
      end,
      null, wf.internal_due_at, null, wf.updated_at,
      array['ready_to_publish'],
      'publish',
      public.has_perm(uid, 'courseware.release.publish'),
      'production',
      'lecture:' || wf.lecture_id, jsonb_build_object('track', wf.track),
      'normal'
    from public.cw_lecture_workflows wf
    join public.course_lectures lec on lec.id = wf.lecture_id
    where wf.stage = 'ready_to_publish'
      and lec.archived_at is null
      and (
        (
          exists (
            select 1 from public.resolve_course_assignments(wf.lecture_id) ra
            where ra.responsibility in ('owner', 'editor') and ra.user_id = uid
          ) and public.has_perm(uid, 'courseware.release.publish')
        )
        or public.is_admin(uid) or public.has_perm(uid, 'course.manage')
      )

    union all

    -- session.prepare：课次备课未开始/未完成（未建 session_preparations 行时视同 not_started）
    select
      'session:' || cs.id || ':prepare',
      'action', 'teaching', 'session.prepare',
      'session', cs.id, coalesce(nullif(cs.title, ''), to_char(cs.scheduled_at, 'MM-DD HH24:MI') || ' 课次'),
      'classroom', cs.classroom_id, cr.name,
      jsonb_build_object('prepStatus', coalesce(sp.status, 'not_started'), 'scheduledAt', cs.scheduled_at),
      case when csa.responsibility = 'primary_teacher' then 'primary_teacher' else 'assistant_teacher' end,
      'direct',
      null, cs.scheduled_at, cs.scheduled_at, coalesce(sp.updated_at, cs.created_at),
      array['prep_' || coalesce(sp.status, 'not_started')],
      'continue_preparation',
      true,
      'teaching',
      'session:' || cs.id, '{}'::jsonb,
      case when cs.scheduled_at <= now() + interval '24 hours' then 'high' else 'normal' end
    from public.class_sessions cs
    join public.classrooms cr on cr.id = cs.classroom_id
    left join public.session_preparations sp on sp.session_id = cs.id
    join public.classroom_staff_assignments csa
      on csa.classroom_id = cs.classroom_id and csa.user_id = uid and csa.responsibility in ('primary_teacher', 'assistant_teacher')
    where coalesce(sp.status, 'not_started') <> 'ready'
      and cs.deleted_at is null
      and cs.ended_at is null
      and cs.scheduled_at is not null

    union all

    -- session.task：课后任务（点名/课评/总结/作业/视频/回访）
    select
      'session:' || sct.session_id || ':task:' || sct.kind,
      'action', 'teaching', 'session.task',
      'session', sct.session_id, coalesce(nullif(cs.title, ''), to_char(cs.scheduled_at, 'MM-DD HH24:MI') || ' 课次'),
      'classroom', cs.classroom_id, cr.name,
      jsonb_build_object('taskKind', sct.kind, 'required', sct.required),
      case when sct.assigned_to is not null then 'explicit_assignee' else 'manager_oversight' end,
      case when sct.assigned_to = uid then 'direct' else 'oversight' end,
      null, sct.due_at, cs.scheduled_at, sct.created_at,
      array['session_task_' || sct.kind],
      'complete_task',
      (sct.assigned_to = uid) or public.has_perm(uid, 'class.manage'),
      'teaching',
      'session:' || sct.session_id, jsonb_build_object('taskKind', sct.kind),
      case when sct.required then 'normal' else 'low' end
    from public.session_completion_tasks sct
    join public.class_sessions cs on cs.id = sct.session_id
    join public.classrooms cr on cr.id = cs.classroom_id
    where sct.status = 'pending'
      and (
        sct.assigned_to = uid
        or (
          sct.assigned_to is null
          and (public.is_admin(uid) or public.has_perm(uid, 'class.view.all') or public.is_classroom_staff_assigned(cs.classroom_id, uid, 'primary_teacher'))
        )
      )

    union all

    -- support.task：学辅任务（课前通知/课后回访）
    select
      'support-task:' || sct.id,
      'action', 'student_service', 'support.task',
      case when sct.session_id is not null then 'session' else 'classroom' end,
      coalesce(sct.session_id, sct.classroom_id),
      case when sct.session_id is not null then coalesce(nullif(cs.title, ''), to_char(cs.scheduled_at, 'MM-DD HH24:MI') || ' 课次') else cr.name end,
      'classroom', sct.classroom_id, cr.name,
      jsonb_build_object('taskKind', sct.kind, 'note', sct.note),
      case when sct.assigned_to is not null then 'learning_support' else 'manager_oversight' end,
      case when sct.assigned_to = uid then 'direct' else 'oversight' end,
      null, sct.due_at, cs.scheduled_at, sct.created_at,
      array['support_task_' || sct.kind],
      'complete_support_task',
      (sct.assigned_to = uid) or public.has_perm(uid, 'class.manage'),
      'support',
      case when sct.session_id is not null then 'session:' || sct.session_id else 'classroom:' || sct.classroom_id end,
      jsonb_build_object('taskKind', sct.kind),
      'normal'
    from public.class_support_tasks sct
    join public.classrooms cr on cr.id = sct.classroom_id
    left join public.class_sessions cs on cs.id = sct.session_id
    where sct.status = 'pending'
      and (
        sct.assigned_to = uid
        or (sct.assigned_to is null and (public.is_admin(uid) or public.has_perm(uid, 'class.view.all')))
      )

    union all

    -- leave_request.decide：请假请求待决定
    select
      'leave-request:' || lr.id,
      'action', 'student_service', 'leave_request.decide',
      'session', lr.session_id, coalesce(nullif(cs.title, ''), to_char(cs.scheduled_at, 'MM-DD HH24:MI') || ' 课次'),
      'student', lr.student_id, st.name,
      jsonb_build_object('reason', lr.reason, 'requestedAt', lr.created_at),
      'primary_teacher',
      case
        when public.is_classroom_staff_assigned(cs.classroom_id, uid, 'primary_teacher') then 'direct'
        else 'oversight'
      end,
      lr.created_at, cs.scheduled_at, cs.scheduled_at, lr.created_at,
      array['leave_request_pending'],
      'decide_leave_request',
      public.can_mark_attendance(cs.classroom_id, uid),
      'teaching',
      'session:' || lr.session_id, jsonb_build_object('leaveRequestId', lr.id),
      'high'
    from public.session_leave_requests lr
    join public.class_sessions cs on cs.id = lr.session_id
    join public.students st on st.id = lr.student_id
    where lr.status = 'pending'
      and (
        public.is_classroom_staff_assigned(cs.classroom_id, uid)
        or public.is_admin(uid) or public.has_perm(uid, 'class.view.all')
      )

    union all

    -- student.followup：学员跟进到期
    select
      'student:' || s.id || ':followup',
      'action', 'student_service', 'student.followup',
      'student', s.id, s.name,
      null, null, null,
      jsonb_build_object('followUpStatus', s.follow_up_status, 'nextFollowUpAt', s.next_follow_up_at),
      case when s.assigned_to is not null then 'explicit_assignee' else 'manager_oversight' end,
      case when s.assigned_to = uid then 'direct' else 'oversight' end,
      null, s.next_follow_up_at, null, s.created_at,
      array['followup_due'],
      'log_followup',
      (s.assigned_to = uid) or public.has_perm(uid, 'followup.write'),
      'management',
      'student:' || s.id, '{}'::jsonb,
      'normal'
    from public.students s
    where s.deleted_at is null
      and s.next_follow_up_at is not null
      and s.next_follow_up_at < now()
      and (
        s.assigned_to = uid
        or (s.assigned_to is null and (public.is_admin(uid) or public.has_perm(uid, 'student.view.all')))
      )

    union all

    -- refund.approve：退款待审批
    select
      'refund:' || r.id || ':approve',
      'action', 'finance', 'refund.approve',
      'refund', r.id, '退款 ' || to_char(r.amount, 'FM999999990.00') || ' 元',
      'order', r.order_id, o.order_no,
      jsonb_build_object('amount', r.amount, 'reason', r.reason),
      'approver',
      'direct',
      r.requested_at, null, null, r.requested_at,
      array['refund_pending_approval'],
      'approve_refund',
      true,
      'management',
      'refund:' || r.id, jsonb_build_object('orderId', r.order_id),
      'high'
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where r.status = 'pending'
      and public.has_perm(uid, 'finance.refund.approve')

    union all

    -- classroom.no_primary_teacher：在读班级无主讲
    select
      'classroom:' || cr.id || ':no-primary-teacher',
      'alert', 'operations', 'classroom.no_primary_teacher',
      'classroom', cr.id, cr.name,
      null, null, null,
      jsonb_build_object('activeEnrollments', (select count(*) from public.enrollments e where e.classroom_id = cr.id and e.status = 'active')),
      'manager_oversight', 'oversight',
      null, null, null, cr.created_at,
      array['no_primary_teacher'],
      'assign_primary_teacher',
      public.has_perm(uid, 'class.manage'),
      'management',
      'classroom:' || cr.id, '{}'::jsonb,
      'normal'
    from public.classrooms cr
    where cr.archived_at is null
      and cr.trashed_at is null
      and exists (select 1 from public.enrollments e where e.classroom_id = cr.id and e.status = 'active')
      and not exists (select 1 from public.classroom_staff_assignments csa where csa.classroom_id = cr.id and csa.responsibility = 'primary_teacher')
      and (public.is_admin(uid) or public.has_perm(uid, 'class.view.all') or public.has_perm(uid, 'class.manage'))

    union all

    -- session.overdue_not_started：已过点未开课
    select
      'session:' || cs.id || ':overdue-not-started',
      'alert', 'operations', 'session.overdue_not_started',
      'session', cs.id, coalesce(nullif(cs.title, ''), to_char(cs.scheduled_at, 'MM-DD HH24:MI') || ' 课次'),
      'classroom', cs.classroom_id, cr.name,
      jsonb_build_object('scheduledAt', cs.scheduled_at),
      'manager_oversight', 'oversight',
      null, cs.scheduled_at, cs.scheduled_at, cs.created_at,
      array['overdue_not_started'],
      'investigate_session',
      public.has_perm(uid, 'class.manage'),
      'management',
      'session:' || cs.id, '{}'::jsonb,
      'normal'
    from public.class_sessions cs
    join public.classrooms cr on cr.id = cs.classroom_id
    where cs.deleted_at is null
      and cs.voided_at is null
      and cs.started_at is null
      and cs.ended_at is null
      and cs.scheduled_at is not null
      and cs.scheduled_at < now()
      and (public.is_admin(uid) or public.has_perm(uid, 'class.view.all') or public.has_perm(uid, 'class.manage'))
  ),
  classified as (
    select
      src.*,
      cls.urgency_bucket,
      cls.severity
    from source src
    cross join lateral public.classify_work_item_urgency(coalesce(src.due_at, src.scheduled_at), src.severity_floor) cls
  )
  select
    c.work_key,
    c.primary_object_type || ':' || c.primary_object_id::text as group_key,
    c.type,
    c.domain,
    c.kind,
    c.primary_object_type,
    c.primary_object_id,
    c.primary_object_name,
    c.secondary_object_type,
    c.secondary_object_id,
    c.secondary_object_name,
    c.context,
    c.responsibility,
    c.ownership_mode,
    c.available_at,
    c.due_at,
    c.scheduled_at,
    c.created_at,
    c.urgency_bucket,
    c.severity,
    case
      when c.ownership_mode <> 'oversight' then 0
      when c.urgency_bucket = 'now' then 2
      when c.urgency_bucket = 'overdue' then 1
      else 0
    end as escalation_level,
    case when c.ownership_mode = 'oversight' then c.due_at else null end as resurface_at,
    c.reason_codes,
    c.action_code,
    c.can_act,
    c.context_lens,
    c.route_target,
    c.route_params,
    uas.last_seen_at,
    uas.snoozed_until,
    uas.pinned_at,
    uas.acknowledged_at,
    coalesce(uas.watching, false) as watching
  from classified c
  left join public.work_item_user_state uas on uas.user_id = uid and uas.work_key = c.work_key
  where (v_domain is null or c.domain = v_domain)
    and (
      p_ignore_snooze
      or not (
        uas.snoozed_until is not null and uas.snoozed_until > now()
        and c.urgency_bucket in ('upcoming', 'backlog', 'today')
      )
    )
  order by
    case c.urgency_bucket when 'now' then 0 when 'overdue' then 1 when 'today' then 2 when 'upcoming' then 3 else 4 end,
    uas.pinned_at desc nulls last,
    case c.severity when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    coalesce(c.due_at, c.scheduled_at) asc nulls last,
    c.created_at asc,
    c.work_key asc;
end;
$$;

revoke all on function public.list_my_work_items(text, boolean) from public, anon;
grant execute on function public.list_my_work_items(text, boolean) to authenticated;

-- ============================================================
-- 4. list_my_work_summary
-- ============================================================

create or replace function public.list_my_work_summary()
returns table(domain text, urgency_bucket text, item_count bigint)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select domain, urgency_bucket, count(*)::bigint as item_count
  from public.list_my_work_items()
  group by domain, urgency_bucket
$$;

revoke all on function public.list_my_work_summary() from public, anon;
grant execute on function public.list_my_work_summary() to authenticated;

-- ============================================================
-- 5. 用户状态 RPC：seen / snooze / pin / acknowledge / watch
-- ============================================================

create or replace function public.set_work_item_seen(p_work_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_work_key is null or length(trim(p_work_key)) = 0 then raise exception 'INVALID_WORK_KEY'; end if;

  insert into public.work_item_user_state (user_id, work_key, last_seen_at)
  values (uid, p_work_key, now())
  on conflict (user_id, work_key) do update
    set last_seen_at = excluded.last_seen_at, updated_at = now();
end;
$$;

create or replace function public.snooze_work_item(p_work_key text, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item_row record;
  max_until timestamptz;
  effective_until timestamptz := p_until;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_work_key is null or length(trim(p_work_key)) = 0 then raise exception 'INVALID_WORK_KEY'; end if;
  if effective_until is null or effective_until <= now() then raise exception 'INVALID_SNOOZE_UNTIL'; end if;

  select urgency_bucket, severity into item_row
  from public.list_my_work_items(null, true)
  where work_key = p_work_key;

  if not found then raise exception 'NOT_FOUND'; end if;
  if item_row.urgency_bucket = 'now' then raise exception 'SNOOZE_NOT_ALLOWED'; end if;

  max_until := case
    when item_row.urgency_bucket in ('overdue', 'today') then now() + interval '24 hours'
    else now() + interval '14 days'
  end;
  if effective_until > max_until then
    effective_until := max_until;
  end if;

  insert into public.work_item_user_state (user_id, work_key, snoozed_until)
  values (uid, p_work_key, effective_until)
  on conflict (user_id, work_key) do update
    set snoozed_until = excluded.snoozed_until, updated_at = now();
end;
$$;

create or replace function public.pin_work_item(p_work_key text, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_work_key is null or length(trim(p_work_key)) = 0 then raise exception 'INVALID_WORK_KEY'; end if;

  insert into public.work_item_user_state (user_id, work_key, pinned_at)
  values (uid, p_work_key, case when p_pinned then now() else null end)
  on conflict (user_id, work_key) do update
    set pinned_at = excluded.pinned_at, updated_at = now();
end;
$$;

create or replace function public.acknowledge_work_item(p_work_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_work_key is null or length(trim(p_work_key)) = 0 then raise exception 'INVALID_WORK_KEY'; end if;

  insert into public.work_item_user_state (user_id, work_key, acknowledged_at)
  values (uid, p_work_key, now())
  on conflict (user_id, work_key) do update
    set acknowledged_at = excluded.acknowledged_at, updated_at = now();
end;
$$;

create or replace function public.watch_work_item(p_work_key text, p_watching boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_work_key is null or length(trim(p_work_key)) = 0 then raise exception 'INVALID_WORK_KEY'; end if;

  insert into public.work_item_user_state (user_id, work_key, watching)
  values (uid, p_work_key, coalesce(p_watching, false))
  on conflict (user_id, work_key) do update
    set watching = excluded.watching, updated_at = now();
end;
$$;

revoke all on function public.set_work_item_seen(text) from public, anon;
revoke all on function public.snooze_work_item(text, timestamptz) from public, anon;
revoke all on function public.pin_work_item(text, boolean) from public, anon;
revoke all on function public.acknowledge_work_item(text) from public, anon;
revoke all on function public.watch_work_item(text, boolean) from public, anon;

grant execute on function public.set_work_item_seen(text) to authenticated;
grant execute on function public.snooze_work_item(text, timestamptz) to authenticated;
grant execute on function public.pin_work_item(text, boolean) to authenticated;
grant execute on function public.acknowledge_work_item(text) to authenticated;
grant execute on function public.watch_work_item(text, boolean) to authenticated;

commit;
