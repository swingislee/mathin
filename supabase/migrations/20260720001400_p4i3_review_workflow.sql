-- P4I-3：课程制作与多轮校对状态机。
-- cw_lecture_workflows（讲次×轨道当前状态头）+ cw_review_cycles（校对轮次事件日志，兼作审计记录）。
-- 判断点（详见 docs/plan/19-p4i-final.md §9-10、§19.4-19.5 与 .claude/p4i-0-baseline.md「P4I-3 执行记录」）：
--   1. 不改动既有 publish_cw_track_release（现役 Studio 发布按钮，P4I-12 换 UI 前不能砸）；
--      新状态机的发布走 publish_cw_review_cycle，两者短期并存。
--   2. 「下一校」不单独建 RPC，是 approve_cw_review 在 round < required 时的自动副作用。
--   3. 不做「固定指派校对人」RPC；鉴权统一走 has_perm('courseware.review')；
--      谁先调用 approve/reject 谁就顺带认领该轮（reviewer_id 从 null 变成 uid）。
--   4. 发布必须发布提交时冻结的 content_snapshot，不得在通过之后重新从当前草稿头取，
--      否则审校形同虚设；perform_cw_publish 按快照里的 revisionId 写头，
--      若草稿头在审校期间又被改过，draft_revision_id 不会被清空（对应 UI 状态「已发布・有未发布修改」）。

-- ---------------------------------------------------------------------------
-- 1. cw_lecture_workflows
-- ---------------------------------------------------------------------------

create table public.cw_lecture_workflows (
  lecture_id uuid not null references public.course_lectures(id) on delete cascade,
  track text not null check (track in ('native-16x9', 'adapted-4x3')),
  stage text not null default 'idle'
    check (stage in ('idle', 'editing', 'in_review', 'changes_requested', 'ready_to_publish')),
  current_review_round smallint check (current_review_round between 1 and 3),
  required_review_rounds_snapshot smallint check (required_review_rounds_snapshot between 1 and 3),
  active_review_cycle_id uuid,
  internal_due_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (lecture_id, track)
);

comment on table public.cw_lecture_workflows is
  'P4I-3：讲次×轨道当前校对状态机头，懒创建（submit_cw_review 首次提交时才建行）。';

-- ---------------------------------------------------------------------------
-- 2. cw_review_cycles
-- ---------------------------------------------------------------------------

create table public.cw_review_cycles (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.course_lectures(id) on delete cascade,
  track text not null check (track in ('native-16x9', 'adapted-4x3')),
  workflow_cycle_no smallint not null check (workflow_cycle_no >= 1),
  review_round_no smallint not null check (review_round_no between 0 and 3),
  status text not null check (status in ('submitted', 'changes_requested', 'passed', 'withdrawn', 'published', 'bypassed')),
  creator_id uuid not null references public.profiles(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  self_review boolean not null default false,
  policy_snapshot jsonb not null,
  content_snapshot jsonb not null,
  submission_note text not null default '',
  submitted_at timestamptz not null default now(),
  review_note text,
  reviewed_pages integer[],
  reviewed_at timestamptz,
  published_release_id uuid references public.cw_lecture_releases(id) on delete set null,
  closed_at timestamptz
);

create index cw_review_cycles_lecture_track_idx
  on public.cw_review_cycles (lecture_id, track, workflow_cycle_no, review_round_no);

comment on table public.cw_review_cycles is
  'P4I-3：校对轮次事件日志，一对多、永不物理删除，兼作本状态机的审计记录（项目无独立 audit_log 表）。review_round_no=0 专用于紧急发布事件行。';
comment on column public.cw_review_cycles.content_snapshot is
  '提交时冻结的页面 revision + 资源绑定快照；发布必须发布这份冻结值，不得在通过后重新从当前草稿头取。';

alter table public.cw_lecture_workflows
  add constraint cw_lecture_workflows_active_review_cycle_fk
  foreign key (active_review_cycle_id) references public.cw_review_cycles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS：is_staff 广泛只读，写全部走下面的 SECURITY DEFINER RPC。
-- ---------------------------------------------------------------------------

alter table public.cw_lecture_workflows enable row level security;
alter table public.cw_review_cycles enable row level security;

create policy "cw_lecture_workflows_select_staff" on public.cw_lecture_workflows
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_review_cycles_select_staff" on public.cw_review_cycles
  for select to authenticated using (public.is_staff((select auth.uid())));

revoke all on public.cw_lecture_workflows, public.cw_review_cycles from anon, authenticated;
grant select on public.cw_lecture_workflows, public.cw_review_cycles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 共享只读 helper（不对外暴露 execute，供下面的 RPC 内部复用）
-- ---------------------------------------------------------------------------

create or replace function public.build_cw_track_snapshot(p_lecture_id uuid, p_track text)
returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_agg(jsonb_build_object('pageDocId', rows.page_id, 'revisionId', rows.revision_id, 'bindings', rows.bindings) order by rows.page_no)
    from (
      select page.id page_id, page.page_no, coalesce(head.draft_revision_id, head.current_revision_id) revision_id,
        coalesce((select jsonb_agg(jsonb_build_object('bindingKey', binding.binding_key, 'assetRevisionId',
          coalesce(binding.pinned_revision_id, variant.draft_revision_id, variant.published_revision_id, asset.published_revision_id)) order by binding.binding_key)
          from public.cw_page_asset_bindings binding
          join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
          left join public.cw_asset_variant_heads variant on variant.shared_asset_id = binding.shared_asset_id and variant.track = p_track
          where binding.page_doc_id = page.id and binding.track = p_track), '[]'::jsonb) bindings
      from public.cw_page_docs page
      join public.cw_page_track_heads head on head.page_doc_id = page.id and head.track = p_track
      where page.lecture_id = p_lecture_id and page.deleted_at is null
    ) rows;
$$;

create or replace function public.cw_track_is_ready(p_lecture_id uuid, p_track text)
returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.cw_page_docs page where page.lecture_id = p_lecture_id and page.deleted_at is null
  ) and not exists (
    select 1 from public.cw_page_docs page
    left join public.cw_page_track_heads head on head.page_doc_id = page.id and head.track = p_track
    where page.lecture_id = p_lecture_id and page.deleted_at is null
      and coalesce(head.draft_revision_id, head.current_revision_id) is null
  ) and not exists (
    select 1 from public.cw_page_asset_bindings binding
    join public.cw_page_docs page on page.id = binding.page_doc_id
    left join public.cw_asset_variant_heads variant on variant.shared_asset_id = binding.shared_asset_id and variant.track = p_track
    left join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
    where page.lecture_id = p_lecture_id and page.deleted_at is null and binding.track = p_track
      and coalesce(binding.pinned_revision_id, variant.draft_revision_id, variant.published_revision_id, asset.published_revision_id) is null
  );
$$;

create or replace function public.perform_cw_publish(p_lecture_id uuid, p_track text, p_note text, p_snapshot jsonb, p_uid uuid)
returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare
  next_no int;
  release_id uuid;
begin
  select coalesce(max(release_no), 0) + 1 into next_no
    from public.cw_lecture_releases where lecture_id = p_lecture_id and track = p_track;
  insert into public.cw_lecture_releases(lecture_id, release_no, note, snapshot, published_by, track)
  values (p_lecture_id, next_no, left(trim(coalesce(p_note, '')), 1000), p_snapshot, p_uid, p_track)
  returning id into release_id;

  update public.cw_page_track_heads head
     set current_revision_id = (elem.value ->> 'revisionId')::uuid,
         draft_revision_id = case when head.draft_revision_id = (elem.value ->> 'revisionId')::uuid then null else head.draft_revision_id end,
         updated_at = now()
    from jsonb_array_elements(p_snapshot) elem
   where head.page_doc_id = (elem.value ->> 'pageDocId')::uuid and head.track = p_track;

  insert into public.cw_lecture_track_heads(lecture_id, track, current_release_id)
  values (p_lecture_id, p_track, release_id)
  on conflict (lecture_id, track) do update set current_release_id = excluded.current_release_id, updated_at = now();

  if p_track = 'native-16x9' then
    update public.cw_page_docs page
       set current_revision_id = (elem.value ->> 'revisionId')::uuid,
           draft_revision_id = case when page.draft_revision_id = (elem.value ->> 'revisionId')::uuid then null else page.draft_revision_id end,
           aspect = '16:9'
      from jsonb_array_elements(p_snapshot) elem
     where page.id = (elem.value ->> 'pageDocId')::uuid and page.lecture_id = p_lecture_id;
    update public.course_lectures set current_release_id = release_id where id = p_lecture_id;
  end if;

  return release_id;
end;
$$;

revoke all on function public.build_cw_track_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function public.cw_track_is_ready(uuid, text) from public, anon, authenticated;
revoke all on function public.perform_cw_publish(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 状态机 RPC
-- ---------------------------------------------------------------------------

create or replace function public.submit_cw_review(p_lecture_id uuid, p_track text, p_note text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  wf public.cw_lecture_workflows%rowtype;
  policy public.cw_workflow_policies;
  snapshot jsonb;
  next_cycle_no smallint;
  next_round_no smallint;
  required_snapshot smallint;
  new_cycle_id uuid;
  due timestamptz;
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if not public.cw_track_is_ready(p_lecture_id, p_track) then raise exception 'PAGE_TRACK_NOT_READY'; end if;

  insert into public.cw_lecture_workflows(lecture_id, track, stage, updated_by)
  values (p_lecture_id, p_track, 'idle', uid)
  on conflict (lecture_id, track) do nothing;

  select * into wf from public.cw_lecture_workflows where lecture_id = p_lecture_id and track = p_track for update;

  if wf.stage not in ('idle', 'editing', 'changes_requested') then
    raise exception 'INVALID_STAGE_FOR_SUBMIT';
  end if;

  policy := public.resolve_cw_workflow_policy(p_lecture_id);
  snapshot := public.build_cw_track_snapshot(p_lecture_id, p_track);

  if wf.stage = 'changes_requested' and wf.active_review_cycle_id is not null then
    select workflow_cycle_no into next_cycle_no from public.cw_review_cycles where id = wf.active_review_cycle_id;
    next_round_no := wf.current_review_round;
    required_snapshot := wf.required_review_rounds_snapshot;
  else
    select coalesce(max(workflow_cycle_no), 0) + 1 into next_cycle_no
      from public.cw_review_cycles where lecture_id = p_lecture_id and track = p_track;
    next_round_no := 1;
    required_snapshot := policy.required_review_rounds;
  end if;

  insert into public.cw_review_cycles(
    lecture_id, track, workflow_cycle_no, review_round_no, status, creator_id, reviewer_id, self_review,
    policy_snapshot, content_snapshot, submission_note, submitted_at
  ) values (
    p_lecture_id, p_track, next_cycle_no, next_round_no, 'submitted', uid, null, false,
    jsonb_build_object(
      'policyId', policy.id, 'scopeType', policy.scope_type,
      'requiredReviewRounds', policy.required_review_rounds,
      'allowCreatorAsReviewer', policy.allow_creator_as_reviewer,
      'emergencyPublishEnabled', policy.emergency_publish_enabled,
      'defaultReviewSlaHours', policy.default_review_sla_hours
    ),
    snapshot, left(trim(coalesce(p_note, '')), 1000), now()
  ) returning id into new_cycle_id;

  if policy.default_review_sla_hours is not null then
    due := now() + make_interval(hours => policy.default_review_sla_hours);
  else
    due := null;
  end if;

  update public.cw_lecture_workflows
     set stage = 'in_review',
         current_review_round = next_round_no,
         required_review_rounds_snapshot = required_snapshot,
         active_review_cycle_id = new_cycle_id,
         internal_due_at = due,
         updated_by = uid,
         updated_at = now()
   where lecture_id = p_lecture_id and track = p_track;

  return new_cycle_id;
end;
$$;

create or replace function public.withdraw_cw_review(p_review_cycle_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  cycle public.cw_review_cycles%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  select * into cycle from public.cw_review_cycles where id = p_review_cycle_id for update;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  if cycle.creator_id <> uid then raise exception 'FORBIDDEN'; end if;
  if cycle.status <> 'submitted' then raise exception 'INVALID_CYCLE_STATUS'; end if;

  update public.cw_review_cycles set status = 'withdrawn', closed_at = now() where id = p_review_cycle_id;

  update public.cw_lecture_workflows
     set stage = 'editing', active_review_cycle_id = null, updated_by = uid, updated_at = now()
   where lecture_id = cycle.lecture_id and track = cycle.track;
end;
$$;

create or replace function public.approve_cw_review(p_review_cycle_id uuid, p_note text default '', p_reviewed_pages integer[] default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  cycle public.cw_review_cycles%rowtype;
  wf public.cw_lecture_workflows%rowtype;
  resolved_reviewer uuid;
  resolved_self_review boolean;
  next_round_no smallint;
  next_cycle_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.review') then raise exception 'FORBIDDEN'; end if;
  select * into cycle from public.cw_review_cycles where id = p_review_cycle_id for update;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  if cycle.status <> 'submitted' then raise exception 'INVALID_CYCLE_STATUS'; end if;

  -- reviewer_id 在此处必为 null：本设计没有独立的「认领」步骤，
  -- reviewer_id 只在通过/退回关闭轮次的同一条 UPDATE 里跟 status 一起写，
  -- 所以状态仍是 submitted 时不可能已经被别人认领。
  if uid = cycle.creator_id and not coalesce((cycle.policy_snapshot ->> 'allowCreatorAsReviewer')::boolean, true) then
    raise exception 'FORBIDDEN_SELF_REVIEW';
  end if;
  resolved_reviewer := uid;
  resolved_self_review := (uid = cycle.creator_id);

  update public.cw_review_cycles
     set status = 'passed', reviewer_id = resolved_reviewer, self_review = resolved_self_review,
         review_note = left(trim(coalesce(p_note, '')), 1000), reviewed_pages = p_reviewed_pages,
         reviewed_at = now(), closed_at = now()
   where id = p_review_cycle_id;

  select * into wf from public.cw_lecture_workflows where lecture_id = cycle.lecture_id and track = cycle.track for update;

  if wf.current_review_round < wf.required_review_rounds_snapshot then
    next_round_no := wf.current_review_round + 1;
    insert into public.cw_review_cycles(
      lecture_id, track, workflow_cycle_no, review_round_no, status, creator_id, reviewer_id, self_review,
      policy_snapshot, content_snapshot, submission_note, submitted_at
    ) values (
      cycle.lecture_id, cycle.track, cycle.workflow_cycle_no, next_round_no, 'submitted', cycle.creator_id, null, false,
      cycle.policy_snapshot, cycle.content_snapshot, cycle.submission_note, now()
    ) returning id into next_cycle_id;

    update public.cw_lecture_workflows
       set stage = 'in_review', current_review_round = next_round_no, active_review_cycle_id = next_cycle_id,
           updated_by = uid, updated_at = now()
     where lecture_id = cycle.lecture_id and track = cycle.track;

    return next_cycle_id;
  else
    update public.cw_lecture_workflows
       set stage = 'ready_to_publish', active_review_cycle_id = p_review_cycle_id, updated_by = uid, updated_at = now()
     where lecture_id = cycle.lecture_id and track = cycle.track;

    return p_review_cycle_id;
  end if;
end;
$$;

create or replace function public.reject_cw_review(p_review_cycle_id uuid, p_note text, p_reviewed_pages integer[] default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  cycle public.cw_review_cycles%rowtype;
  resolved_reviewer uuid;
  resolved_self_review boolean;
  trimmed_note text;
begin
  if uid is null or not public.has_perm(uid, 'courseware.review') then raise exception 'FORBIDDEN'; end if;
  trimmed_note := trim(coalesce(p_note, ''));
  if length(trimmed_note) = 0 then raise exception 'REVIEW_NOTE_REQUIRED'; end if;

  select * into cycle from public.cw_review_cycles where id = p_review_cycle_id for update;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  if cycle.status <> 'submitted' then raise exception 'INVALID_CYCLE_STATUS'; end if;

  -- reviewer_id 在此处必为 null：本设计没有独立的「认领」步骤，
  -- reviewer_id 只在通过/退回关闭轮次的同一条 UPDATE 里跟 status 一起写，
  -- 所以状态仍是 submitted 时不可能已经被别人认领。
  if uid = cycle.creator_id and not coalesce((cycle.policy_snapshot ->> 'allowCreatorAsReviewer')::boolean, true) then
    raise exception 'FORBIDDEN_SELF_REVIEW';
  end if;
  resolved_reviewer := uid;
  resolved_self_review := (uid = cycle.creator_id);

  update public.cw_review_cycles
     set status = 'changes_requested', reviewer_id = resolved_reviewer, self_review = resolved_self_review,
         review_note = left(trimmed_note, 1000), reviewed_pages = p_reviewed_pages,
         reviewed_at = now(), closed_at = now()
   where id = p_review_cycle_id;

  update public.cw_lecture_workflows
     set stage = 'changes_requested', updated_by = uid, updated_at = now()
   where lecture_id = cycle.lecture_id and track = cycle.track;
end;
$$;

create or replace function public.publish_cw_review_cycle(p_lecture_id uuid, p_track text, p_note text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  wf public.cw_lecture_workflows%rowtype;
  cycle public.cw_review_cycles%rowtype;
  release_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;

  select * into wf from public.cw_lecture_workflows where lecture_id = p_lecture_id and track = p_track for update;
  if not found or wf.stage <> 'ready_to_publish' or wf.active_review_cycle_id is null then
    raise exception 'NOT_READY_TO_PUBLISH';
  end if;

  select * into cycle from public.cw_review_cycles where id = wf.active_review_cycle_id for update;
  if not found or cycle.status <> 'passed' then raise exception 'NOT_READY_TO_PUBLISH'; end if;

  release_id := public.perform_cw_publish(p_lecture_id, p_track, p_note, cycle.content_snapshot, uid);

  update public.cw_review_cycles set published_release_id = release_id where id = cycle.id;

  update public.cw_lecture_workflows
     set stage = 'idle', current_review_round = null, required_review_rounds_snapshot = null,
         active_review_cycle_id = null, internal_due_at = null, updated_by = uid, updated_at = now()
   where lecture_id = p_lecture_id and track = p_track;

  return release_id;
end;
$$;

create or replace function public.emergency_publish_cw_review(p_lecture_id uuid, p_track text, p_reason text, p_note text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  policy public.cw_workflow_policies;
  wf public.cw_lecture_workflows%rowtype;
  snapshot jsonb;
  trimmed_reason text;
  bypass_cycle_id uuid;
  next_cycle_no smallint;
  release_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.emergency_publish') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  trimmed_reason := trim(coalesce(p_reason, ''));
  if length(trimmed_reason) = 0 then raise exception 'REASON_REQUIRED'; end if;

  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;

  policy := public.resolve_cw_workflow_policy(p_lecture_id);
  if not policy.emergency_publish_enabled then raise exception 'EMERGENCY_PUBLISH_DISABLED'; end if;
  if not public.cw_track_is_ready(p_lecture_id, p_track) then raise exception 'PAGE_TRACK_NOT_READY'; end if;

  snapshot := public.build_cw_track_snapshot(p_lecture_id, p_track);

  select * into wf from public.cw_lecture_workflows where lecture_id = p_lecture_id and track = p_track for update;
  if found and wf.active_review_cycle_id is not null then
    update public.cw_review_cycles set status = 'bypassed', closed_at = now()
     where id = wf.active_review_cycle_id and status = 'submitted';
  end if;

  select coalesce(max(workflow_cycle_no), 0) + 1 into next_cycle_no
    from public.cw_review_cycles where lecture_id = p_lecture_id and track = p_track;

  insert into public.cw_review_cycles(
    lecture_id, track, workflow_cycle_no, review_round_no, status, creator_id, reviewer_id, self_review,
    policy_snapshot, content_snapshot, submission_note, submitted_at, review_note, reviewed_at, closed_at
  ) values (
    p_lecture_id, p_track, next_cycle_no, 0, 'bypassed', uid, uid, false,
    jsonb_build_object(
      'policyId', policy.id, 'scopeType', policy.scope_type,
      'requiredReviewRounds', policy.required_review_rounds,
      'allowCreatorAsReviewer', policy.allow_creator_as_reviewer,
      'emergencyPublishEnabled', policy.emergency_publish_enabled,
      'defaultReviewSlaHours', policy.default_review_sla_hours
    ),
    snapshot, left(trim(coalesce(p_note, '')), 1000), now(), trimmed_reason, now(), now()
  ) returning id into bypass_cycle_id;

  release_id := public.perform_cw_publish(p_lecture_id, p_track, p_note, snapshot, uid);

  update public.cw_review_cycles set published_release_id = release_id where id = bypass_cycle_id;

  insert into public.cw_lecture_workflows(lecture_id, track, stage, updated_by)
  values (p_lecture_id, p_track, 'idle', uid)
  on conflict (lecture_id, track) do update
    set stage = 'idle', current_review_round = null, required_review_rounds_snapshot = null,
        active_review_cycle_id = null, internal_due_at = null, updated_by = uid, updated_at = now();

  return release_id;
end;
$$;

revoke all on function public.submit_cw_review(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_cw_review(uuid, text, text) to authenticated;
revoke all on function public.withdraw_cw_review(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_cw_review(uuid) to authenticated;
revoke all on function public.approve_cw_review(uuid, text, integer[]) from public, anon, authenticated;
grant execute on function public.approve_cw_review(uuid, text, integer[]) to authenticated;
revoke all on function public.reject_cw_review(uuid, text, integer[]) from public, anon, authenticated;
grant execute on function public.reject_cw_review(uuid, text, integer[]) to authenticated;
revoke all on function public.publish_cw_review_cycle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.publish_cw_review_cycle(uuid, text, text) to authenticated;
revoke all on function public.emergency_publish_cw_review(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.emergency_publish_cw_review(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 回填：已有草稿头视为 editing，仅已发布/无草稿视为 idle；无 cw_page_track_heads 记录的组合不建行。
-- ---------------------------------------------------------------------------

insert into public.cw_lecture_workflows(lecture_id, track, stage, updated_at)
select page.lecture_id, head.track,
  case when bool_or(head.draft_revision_id is not null) then 'editing' else 'idle' end,
  now()
from public.cw_page_track_heads head
join public.cw_page_docs page on page.id = head.page_doc_id
where page.deleted_at is null
group by page.lecture_id, head.track
on conflict (lecture_id, track) do nothing;
