-- P4I-4：课次备课状态（session_preparations）与课后任务闭环（session_completion_tasks/session_task_policies）。
-- 关键边界（详见 .claude/p4i-0-baseline.md「P4I-4 执行记录」）：
--   1) 真正的课件合并/冻结大数据继续走既有 freeze_session_courseware（P6），本迁移不改它，
--      也不把 TS 层 resolveCourseware 的合并逻辑搬进 SQL——mark_session_preparation_ready
--      只是状态收尾 RPC，不做真正的冻结，教师"完成备课"的完整编排留给 P4I-14 UI 任务。
--   2) session_task_policies 按 kind 单例（无 family/lecture 分层继承），与 cw_workflow_policies
--      的继承模型不同——doc19 §19.7 没有给这张表任何 scope 字段。
--   3) 调课/取消/作废对本任务两张新表的联动清理不在本任务范围（doc19 把这条明确写在 P4I-5
--      的 support_task_policies 里），本迁移只处理 ended_at 首次置位这一个生成时机。

-- ---------------------------------------------------------------------------
-- 1. session_task_policies：课后任务按 kind 的机构级策略单例。
-- ---------------------------------------------------------------------------

create table public.session_task_policies (
  kind text primary key
    check (kind in ('attendance','reviews','summary','assignment','video_review','followup')),
  enabled boolean not null default true,
  required_by_default boolean not null default true,
  due_offset_minutes integer,
  default_responsibility text
    check (default_responsibility in ('primary_teacher','assistant_teacher')),
  allow_reassign boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.session_task_policies is
  'P4I-4 课后任务策略，按 kind 单例（无分层继承），主管可改 enabled/required_by_default/due_offset_minutes/default_responsibility。';

insert into public.session_task_policies (kind, enabled, required_by_default, default_responsibility) values
  ('attendance', true, true, 'primary_teacher'),
  ('reviews', true, true, 'primary_teacher'),
  ('summary', true, true, 'primary_teacher'),
  ('assignment', true, true, 'primary_teacher'),
  ('video_review', true, false, null),
  ('followup', true, false, null)
on conflict (kind) do nothing;

alter table public.session_task_policies enable row level security;

create policy "session_task_policies_select_scope" on public.session_task_policies
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or public.has_perm((select auth.uid()), 'session.postwork.manage')
  );

create policy "session_task_policies_update_manage" on public.session_task_policies
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'session.postwork.manage'))
  with check (public.has_perm((select auth.uid()), 'session.postwork.manage'));

revoke all on table public.session_task_policies from anon, authenticated;
grant select on table public.session_task_policies to authenticated;
grant update (enabled, required_by_default, due_offset_minutes, default_responsibility, allow_reassign, updated_by, updated_at)
  on table public.session_task_policies to authenticated;

-- ---------------------------------------------------------------------------
-- 2. session_completion_tasks：课后任务实例。
-- ---------------------------------------------------------------------------

create table public.session_completion_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  kind text not null
    check (kind in ('attendance','reviews','summary','assignment','video_review','followup')),
  required boolean not null default true,
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, kind)
);

create index session_completion_tasks_session_idx on public.session_completion_tasks (session_id, status);
create index session_completion_tasks_assigned_idx on public.session_completion_tasks (assigned_to, status);

alter table public.session_completion_tasks enable row level security;

create policy "session_completion_tasks_select_scope" on public.session_completion_tasks
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or assigned_to = (select auth.uid())
    or exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id
         and public.is_classroom_staff_assigned(cs.classroom_id, (select auth.uid()))
    )
  );

-- 没有直接 INSERT/UPDATE 授权：生成靠下面的触发器（security definer 绕过 RLS），
-- 完成/跳过靠 complete_session_task RPC，避免绕过状态机直接改状态（与 class_support_tasks 同一惯例）。
revoke all on table public.session_completion_tasks from anon, authenticated;
grant select on table public.session_completion_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 生成触发器：课次下课时按策略生成课后任务。
-- ---------------------------------------------------------------------------

create or replace function public.generate_session_completion_tasks()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  policy_row record;
  resolved_assignee uuid;
  resolved_due_at timestamptz;
begin
  if old.ended_at is null and new.ended_at is not null then
    for policy_row in select * from public.session_task_policies where enabled loop
      resolved_assignee := null;
      if policy_row.default_responsibility is not null then
        select assignment.user_id into resolved_assignee
          from public.classroom_staff_assignments assignment
         where assignment.classroom_id = new.classroom_id
           and assignment.responsibility = policy_row.default_responsibility
         limit 1;
      end if;

      resolved_due_at := case
        when policy_row.due_offset_minutes is null then null
        else new.ended_at + make_interval(mins => policy_row.due_offset_minutes)
      end;

      insert into public.session_completion_tasks (session_id, kind, required, assigned_to, due_at)
      values (new.id, policy_row.kind, policy_row.required_by_default, resolved_assignee, resolved_due_at)
      on conflict (session_id, kind) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

create trigger class_sessions_generate_completion_tasks
  after update on public.class_sessions
  for each row execute function public.generate_session_completion_tasks();

-- ---------------------------------------------------------------------------
-- 4. 完成/跳过课后任务：唯一的状态变更入口。
-- ---------------------------------------------------------------------------

create or replace function public.complete_session_task(
  p_task_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  task_row public.session_completion_tasks%rowtype;
  cid uuid;
  can_complete boolean;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('done', 'skipped') then raise exception 'INVALID_STATUS'; end if;

  select * into task_row from public.session_completion_tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if task_row.status <> 'pending' then raise exception 'TASK_ALREADY_COMPLETED'; end if;

  if p_status = 'skipped' and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'SKIP_REASON_REQUIRED';
  end if;

  select classroom_id into cid from public.class_sessions where id = task_row.session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;

  can_complete := case task_row.kind
    when 'attendance' then public.has_perm(uid, 'attendance.mark')
    when 'reviews' then public.can_review_session(cid, uid)
    when 'summary' then public.can_review_session(cid, uid)
    when 'assignment' then public.is_classroom_teacher(cid, uid) or public.has_perm(uid, 'class.manage')
    when 'video_review' then public.can_review_video_session(cid, uid)
    when 'followup' then public.has_perm(uid, 'followup.write')
    else false
  end;
  if not can_complete then raise exception 'FORBIDDEN'; end if;

  update public.session_completion_tasks
     set status = p_status,
         completed_by = uid,
         completed_at = now(),
         skip_reason = case when p_status = 'skipped' then left(btrim(p_note), 1000) else null end,
         updated_at = now()
   where id = p_task_id;

  perform public.emit_domain_event(
    'session_task.completed', 'session_completion_task', p_task_id,
    jsonb_build_object('kind', task_row.kind, 'status', p_status), uid, null
  );
end;
$$;

revoke all on function public.complete_session_task(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_session_task(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 我的课后任务列表。
-- ---------------------------------------------------------------------------

create or replace function public.list_my_session_tasks(p_status text default 'pending')
returns table(
  id uuid,
  session_id uuid,
  session_title text,
  classroom_id uuid,
  classroom_name text,
  kind text,
  status text,
  due_at timestamptz,
  required boolean
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_view_all boolean;
  v_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_status is not null and v_status not in ('pending', 'done', 'skipped') then raise exception 'INVALID_STATUS'; end if;
  can_view_all := public.has_perm(uid, 'class.view.all');

  return query
  select
    task_row.id,
    task_row.session_id,
    session_row.title,
    session_row.classroom_id,
    classroom_row.name,
    task_row.kind,
    task_row.status,
    task_row.due_at,
    task_row.required
  from public.session_completion_tasks task_row
  join public.class_sessions session_row on session_row.id = task_row.session_id
  join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
  where (v_status is null or task_row.status = v_status)
    and (
      can_view_all
      or task_row.assigned_to = uid
      or public.is_classroom_staff_assigned(session_row.classroom_id, uid)
    )
  order by task_row.due_at asc nulls last, task_row.created_at asc
  limit 100;
end;
$$;

revoke all on function public.list_my_session_tasks(text) from public, anon, authenticated;
grant execute on function public.list_my_session_tasks(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. session_preparations：课次备课状态头。
-- ---------------------------------------------------------------------------

create table public.session_preparations (
  session_id uuid primary key references public.class_sessions(id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','ready')),
  source_release_id uuid references public.cw_lecture_releases(id) on delete set null,
  track text check (track in ('native-16x9','adapted-4x3')),
  prepared_by uuid references public.profiles(id) on delete set null,
  prepared_at timestamptz,
  auto_frozen boolean not null default false,
  overlay_revision_id uuid,
  copied_from_session_id uuid references public.class_sessions(id) on delete set null,
  source_preparation_id uuid references public.class_sessions(id) on delete set null,
  last_contributor_id uuid references public.profiles(id) on delete set null,
  invalidated_at timestamptz,
  invalidated_by uuid references public.profiles(id) on delete set null,
  invalidate_reason text,
  updated_at timestamptz not null default now()
);

comment on table public.session_preparations is
  'P4I-4 课次备课状态头；实际冻结大数据继续写 class_sessions.courseware/courseware_resolved（P6 freeze_session_courseware）。';
comment on column public.session_preparations.overlay_revision_id is
  '预留列，当前 courseware_overlay 是 class_sessions 上的 jsonb 列而非 revision 化表，本任务不写入/不使用，语义留给后续任务。';
comment on column public.session_preparations.auto_frozen is
  'true 表示该课次未走"完成备课"就直接被 startClassSession 的自动冻结路径触发（sync_session_preparation_on_freeze 触发器写入）。';

alter table public.session_preparations enable row level security;

create policy "session_preparations_select_scope" on public.session_preparations
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id
         and public.is_classroom_staff_assigned(cs.classroom_id, (select auth.uid()))
    )
  );

-- 不开放直接写，全部走下面的 RPC。
revoke all on table public.session_preparations from anon, authenticated;
grant select on table public.session_preparations to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 备课 RPC。
-- ---------------------------------------------------------------------------

create or replace function public.start_session_preparation(p_session_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_classroom_teacher(cid, uid) then raise exception 'FORBIDDEN'; end if;

  insert into public.session_preparations (session_id, status, prepared_by, last_contributor_id)
  values (p_session_id, 'in_progress', uid, uid)
  on conflict (session_id) do update
     set status = case when public.session_preparations.status = 'not_started' then 'in_progress' else public.session_preparations.status end,
         last_contributor_id = uid,
         updated_at = now();
end;
$$;

revoke all on function public.start_session_preparation(uuid) from public, anon, authenticated;
grant execute on function public.start_session_preparation(uuid) to authenticated;

create or replace function public.copy_session_preparation(p_session_id uuid, p_from_session_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  target_lecture uuid;
  source_lecture uuid;
  source_row public.session_preparations%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id, lecture_id into cid, target_lecture from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_classroom_teacher(cid, uid) then raise exception 'FORBIDDEN'; end if;

  select lecture_id into source_lecture from public.class_sessions where id = p_from_session_id and deleted_at is null;
  if source_lecture is null or target_lecture is null or source_lecture <> target_lecture then
    raise exception 'LECTURE_MISMATCH';
  end if;

  select * into source_row from public.session_preparations where session_id = p_from_session_id;
  if not found then raise exception 'SOURCE_PREPARATION_NOT_FOUND'; end if;

  insert into public.session_preparations (
    session_id, status, source_release_id, track,
    copied_from_session_id, source_preparation_id, last_contributor_id
  )
  values (
    p_session_id, 'in_progress', source_row.source_release_id, source_row.track,
    p_from_session_id, p_from_session_id, uid
  )
  on conflict (session_id) do update
     set status = 'in_progress',
         source_release_id = excluded.source_release_id,
         track = excluded.track,
         copied_from_session_id = excluded.copied_from_session_id,
         source_preparation_id = excluded.source_preparation_id,
         last_contributor_id = uid,
         updated_at = now();
end;
$$;

revoke all on function public.copy_session_preparation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_session_preparation(uuid, uuid) to authenticated;

create or replace function public.mark_session_preparation_ready(
  p_session_id uuid,
  p_source_release_id uuid,
  p_track text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  frozen_at timestamptz;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_TRACK'; end if;

  select classroom_id, courseware_frozen_at into cid, frozen_at
    from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_classroom_teacher(cid, uid) then raise exception 'FORBIDDEN'; end if;
  if frozen_at is not null then raise exception 'ALREADY_FROZEN'; end if;

  insert into public.session_preparations (
    session_id, status, source_release_id, track,
    prepared_by, prepared_at, auto_frozen, last_contributor_id
  )
  values (p_session_id, 'ready', p_source_release_id, p_track, uid, now(), false, uid)
  on conflict (session_id) do update
     set status = 'ready',
         source_release_id = excluded.source_release_id,
         track = excluded.track,
         prepared_by = uid,
         prepared_at = now(),
         auto_frozen = false,
         last_contributor_id = uid,
         updated_at = now();
end;
$$;

revoke all on function public.mark_session_preparation_ready(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_session_preparation_ready(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. 自动冻结联动：freeze_session_courseware 首次写入 courseware_frozen_at 时，
--    若备课状态还没被显式置为 ready（教师没走"完成备课"），自动补一条 ready+auto_frozen 记录。
-- ---------------------------------------------------------------------------

create or replace function public.sync_session_preparation_on_freeze()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.courseware_frozen_at is null and new.courseware_frozen_at is not null then
    insert into public.session_preparations (session_id, status, auto_frozen, prepared_at)
    values (new.id, 'ready', true, now())
    on conflict (session_id) do update
       set status = 'ready',
           auto_frozen = true,
           prepared_at = coalesce(public.session_preparations.prepared_at, now()),
           updated_at = now()
     where public.session_preparations.status is distinct from 'ready';
  end if;
  return new;
end;
$$;

create trigger class_sessions_sync_preparation_on_freeze
  after update on public.class_sessions
  for each row execute function public.sync_session_preparation_on_freeze();

-- ---------------------------------------------------------------------------
-- 9. 完成本次课 / 重新打开。
-- ---------------------------------------------------------------------------

alter table public.class_sessions
  add column postwork_completed_at timestamptz,
  add column postwork_completed_by uuid references public.profiles(id) on delete set null;

create or replace function public.can_manage_session_postwork(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or (public.has_perm(uid, 'session.postwork.manage') and (public.has_perm(uid, 'class.view.all') or public.is_classroom_teacher(cid, uid)));
$$;

revoke all on function public.can_manage_session_postwork(uuid, uuid) from public;
grant execute on function public.can_manage_session_postwork(uuid, uuid) to authenticated;

create or replace function public.complete_class_session_postwork(p_session_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  pending_count int;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_manage_session_postwork(cid, uid) then raise exception 'FORBIDDEN'; end if;

  select count(*) into pending_count
    from public.session_completion_tasks
   where session_id = p_session_id and required and status = 'pending';
  if pending_count > 0 then raise exception 'TASKS_NOT_COMPLETE'; end if;

  update public.class_sessions
     set postwork_completed_at = now(), postwork_completed_by = uid
   where id = p_session_id;
end;
$$;

revoke all on function public.complete_class_session_postwork(uuid) from public, anon, authenticated;
grant execute on function public.complete_class_session_postwork(uuid) to authenticated;

create or replace function public.reopen_class_session_postwork(p_session_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  completed_at timestamptz;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id, postwork_completed_at into cid, completed_at
    from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_manage_session_postwork(cid, uid) then raise exception 'FORBIDDEN'; end if;
  if completed_at is null then raise exception 'NOT_COMPLETED'; end if;

  update public.class_sessions
     set postwork_completed_at = null, postwork_completed_by = null
   where id = p_session_id;
end;
$$;

revoke all on function public.reopen_class_session_postwork(uuid) from public, anon, authenticated;
grant execute on function public.reopen_class_session_postwork(uuid) to authenticated;
