-- P4I-5：学辅与家庭摘要底座。判断点详见 .claude/p4i-0-baseline.md「P4I-5 执行记录」。
-- 1) 主责学辅：classroom_staff_assignments.is_primary，不改 class_support_tasks 现有 fan-out 生成策略。
-- 2) support_task_policies 只接线 preclass_notice/postclass_followup 两个已生成 kind 的 offset；
--    absence_check/makeup_followup/renewal_followup 继续保留、不接生成器（沿用 P4H-9 的既定边界）。
-- 3) 调课重算只影响 preclass_notice；取消联动新增 status='invalidated'。
--    session_completion_tasks（P4I-4）无需取消联动：cancel_session 要求 started_at/ended_at 均为 null，
--    而 session_completion_tasks 只在 ended_at 首次置位时生成，两者时间线不可能重叠。
-- 4) class_support_task_recipients 只对 preclass_notice 逐人展开（家庭通知），不覆盖 postclass_followup。
-- 5) session_family_briefs 草稿/发布分离；家庭侧读取走专用 RPC，不给家庭任何原表 RLS policy。
-- 6) session_leave_requests 是真实可跑通的最小闭环，approve 时内部复用既有 record_session_change。

-- ---------------------------------------------------------------------------
-- 1. 主责学辅
-- ---------------------------------------------------------------------------

alter table public.classroom_staff_assignments
  add column if not exists is_primary boolean not null default false;

alter table public.classroom_staff_assignments
  add constraint classroom_staff_assignments_primary_only_support
  check (not is_primary or responsibility = 'learning_support');

create unique index if not exists classroom_staff_assignments_one_primary_support_idx
  on public.classroom_staff_assignments (classroom_id)
  where responsibility = 'learning_support' and is_primary;

create or replace function public.set_primary_learning_support(
  p_classroom_id uuid,
  p_user_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if not exists (
    select 1 from public.profiles where id = p_user_id and is_active and role in ('staff', 'admin')
  ) then raise exception 'INVALID_STAFF'; end if;

  insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
  values (p_classroom_id, p_user_id, 'learning_support', uid)
  on conflict (classroom_id, user_id, responsibility) do nothing;

  update public.classroom_staff_assignments
     set is_primary = false
   where classroom_id = p_classroom_id
     and responsibility = 'learning_support'
     and user_id <> p_user_id
     and is_primary;

  update public.classroom_staff_assignments
     set is_primary = true
   where classroom_id = p_classroom_id
     and responsibility = 'learning_support'
     and user_id = p_user_id;

  perform public.emit_domain_event(
    'classroom.staff.primary_support_set', 'classroom', p_classroom_id,
    jsonb_build_object('userId', p_user_id), p_user_id, null
  );
end;
$$;

revoke all on function public.set_primary_learning_support(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_primary_learning_support(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. support_task_policies
-- ---------------------------------------------------------------------------

create table public.support_task_policies (
  kind text primary key check (kind in (
    'preclass_notice','absence_check','makeup_followup','postclass_followup','renewal_followup'
  )),
  enabled boolean not null default true,
  due_offset_minutes integer,
  recalc_on_reschedule boolean not null default false,
  invalidate_on_cancel boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.support_task_policies (kind, enabled, due_offset_minutes, recalc_on_reschedule) values
  ('preclass_notice', true, -1440, true),
  ('postclass_followup', true, 2880, false),
  ('absence_check', false, -120, false),
  ('makeup_followup', false, 4320, false),
  ('renewal_followup', false, null, false);

create trigger support_task_policies_set_updated_at
  before update on public.support_task_policies
  for each row execute function public.set_updated_at();

alter table public.support_task_policies enable row level security;

-- 单例配置表无 classroom 维度可过滤，任何在职员工（有任意 classroom_staff_assignments 记录）
-- 或持有 class.view.all/session.postwork.manage 的角色均可见，写权限收窄到后者。
create policy "support_task_policies_select_scope" on public.support_task_policies
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or public.has_perm((select auth.uid()), 'session.postwork.manage')
    or exists (
      select 1 from public.classroom_staff_assignments a
       where a.user_id = (select auth.uid())
    )
  );

create policy "support_task_policies_update_scope" on public.support_task_policies
  for update to authenticated
  using (public.is_admin((select auth.uid())) or public.has_perm((select auth.uid()), 'session.postwork.manage'))
  with check (public.is_admin((select auth.uid())) or public.has_perm((select auth.uid()), 'session.postwork.manage'));

revoke all on table public.support_task_policies from anon, authenticated;
grant select on table public.support_task_policies to authenticated;
grant update (enabled, due_offset_minutes, recalc_on_reschedule, invalidate_on_cancel, updated_by, updated_at)
  on table public.support_task_policies to authenticated;

-- ---------------------------------------------------------------------------
-- 3. class_support_tasks 扩展：kind/status 约束、策略驱动生成、调课重算、取消失效
-- ---------------------------------------------------------------------------

alter table public.class_support_tasks drop constraint class_support_tasks_kind_check;
alter table public.class_support_tasks add constraint class_support_tasks_kind_check
  check (kind in ('preclass_notice','absence_check','makeup_followup','postclass_followup','renewal_followup'));

alter table public.class_support_tasks drop constraint class_support_tasks_status_check;
alter table public.class_support_tasks add constraint class_support_tasks_status_check
  check (status in ('pending','done','skipped','invalidated'));

create or replace function public.generate_preclass_support_task()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  support_row record;
  policy_row public.support_task_policies%rowtype;
begin
  select * into policy_row from public.support_task_policies where kind = 'preclass_notice';
  if policy_row.enabled is not true then return new; end if;

  for support_row in
    select user_id from public.classroom_staff_assignments
     where classroom_id = new.classroom_id and responsibility = 'learning_support'
  loop
    insert into public.class_support_tasks (classroom_id, session_id, kind, due_at, assigned_to)
    values (
      new.classroom_id, new.id, 'preclass_notice',
      new.scheduled_at + make_interval(mins => coalesce(policy_row.due_offset_minutes, 0)),
      support_row.user_id
    );
  end loop;
  return new;
end;
$$;

create or replace function public.generate_postclass_support_task()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  support_row record;
  policy_row public.support_task_policies%rowtype;
begin
  if old.ended_at is null and new.ended_at is not null then
    select * into policy_row from public.support_task_policies where kind = 'postclass_followup';
    if policy_row.enabled is not true then return new; end if;

    for support_row in
      select user_id from public.classroom_staff_assignments
       where classroom_id = new.classroom_id and responsibility = 'learning_support'
    loop
      insert into public.class_support_tasks (classroom_id, session_id, kind, due_at, assigned_to)
      values (
        new.classroom_id, new.id, 'postclass_followup',
        new.ended_at + make_interval(mins => coalesce(policy_row.due_offset_minutes, 0)),
        support_row.user_id
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.recalc_preclass_support_task_due()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  policy_row public.support_task_policies%rowtype;
begin
  if old.scheduled_at is distinct from new.scheduled_at then
    select * into policy_row from public.support_task_policies where kind = 'preclass_notice';
    if policy_row.recalc_on_reschedule is true then
      update public.class_support_tasks
         set due_at = new.scheduled_at + make_interval(mins => coalesce(policy_row.due_offset_minutes, 0))
       where session_id = new.id and kind = 'preclass_notice' and status = 'pending';
    end if;
  end if;
  return new;
end;
$$;

create trigger class_sessions_recalc_preclass_task
  after update on public.class_sessions
  for each row execute function public.recalc_preclass_support_task_due();

create or replace function public.invalidate_support_tasks_on_cancel()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.class_support_tasks
       set status = 'invalidated'
     where session_id = new.id and status = 'pending';

    update public.class_support_task_recipients
       set status = 'waived'
     where status = 'pending'
       and task_id in (select id from public.class_support_tasks where session_id = new.id);
  end if;
  return new;
end;
$$;

create trigger class_sessions_invalidate_support_tasks
  after update on public.class_sessions
  for each row execute function public.invalidate_support_tasks_on_cancel();

-- ---------------------------------------------------------------------------
-- 4. class_support_task_recipients
-- ---------------------------------------------------------------------------

create table public.class_support_task_recipients (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.class_support_tasks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','confirmed','failed','waived')),
  channel text not null default 'app',
  sent_at timestamptz,
  confirmed_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index class_support_task_recipients_task_idx on public.class_support_task_recipients (task_id);
create index class_support_task_recipients_student_idx on public.class_support_task_recipients (student_id);

create or replace function public.family_of_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.students s where s.id = sid and s.user_id = uid)
    or exists (select 1 from public.student_guardians g where g.student_id = sid and g.guardian_id = uid);
$$;

revoke all on function public.family_of_student(uuid, uuid) from public;
grant execute on function public.family_of_student(uuid, uuid) to authenticated;

alter table public.class_support_task_recipients enable row level security;

create policy "class_support_task_recipients_select_scope" on public.class_support_task_recipients
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or public.family_of_student(student_id, (select auth.uid()))
    or exists (
      select 1 from public.class_support_tasks t
       where t.id = task_id and public.is_classroom_staff_assigned(t.classroom_id, (select auth.uid()))
    )
  );

revoke all on table public.class_support_task_recipients from anon, authenticated;
grant select on table public.class_support_task_recipients to authenticated;

create or replace function public.generate_support_task_recipients()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  enrollment_row record;
  guardian_row record;
  has_guardian boolean;
begin
  if new.kind <> 'preclass_notice' then return new; end if;

  for enrollment_row in
    select student_id from public.enrollments
     where classroom_id = new.classroom_id and status = 'active'
  loop
    has_guardian := false;
    for guardian_row in
      select guardian_id from public.student_guardians where student_id = enrollment_row.student_id
    loop
      has_guardian := true;
      insert into public.class_support_task_recipients (task_id, student_id, guardian_id)
      values (new.id, enrollment_row.student_id, guardian_row.guardian_id);
    end loop;
    if not has_guardian then
      insert into public.class_support_task_recipients (task_id, student_id, guardian_id)
      values (new.id, enrollment_row.student_id, null);
    end if;
  end loop;
  return new;
end;
$$;

create trigger class_support_tasks_generate_recipients
  after insert on public.class_support_tasks
  for each row execute function public.generate_support_task_recipients();

create or replace function public.update_support_task_recipient(
  p_recipient_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  recipient_row public.class_support_task_recipients%rowtype;
  task_row public.class_support_tasks%rowtype;
  can_update boolean;
  valid_transition boolean;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('sent','confirmed','failed','waived') then raise exception 'INVALID_STATUS'; end if;

  select * into recipient_row from public.class_support_task_recipients where id = p_recipient_id for update;
  if not found then raise exception 'RECIPIENT_NOT_FOUND'; end if;
  select * into task_row from public.class_support_tasks where id = recipient_row.task_id;

  can_update := public.is_admin(uid)
    or public.has_perm(uid, 'class.view.all')
    or public.has_perm(uid, 'class.manage')
    or public.is_classroom_staff_assigned(task_row.classroom_id, uid);
  if not can_update then raise exception 'FORBIDDEN'; end if;

  valid_transition := p_status = 'waived'
    or (recipient_row.status = 'pending' and p_status in ('sent','failed'))
    or (recipient_row.status = 'sent' and p_status in ('confirmed','failed'));
  if not valid_transition then raise exception 'INVALID_TRANSITION'; end if;

  update public.class_support_task_recipients
     set status = p_status,
         note = left(btrim(coalesce(p_note, '')), 1000),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end
   where id = p_recipient_id;
end;
$$;

revoke all on function public.update_support_task_recipient(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_support_task_recipient(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. session_family_briefs
-- ---------------------------------------------------------------------------

create table public.session_family_briefs (
  session_id uuid primary key references public.class_sessions(id) on delete cascade,
  lesson_title text not null default '',
  learning_summary text not null default '',
  homework_summary text not null default '',
  materials_note text not null default '',
  teacher_public_comment text not null default '',
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger session_family_briefs_set_updated_at
  before update on public.session_family_briefs
  for each row execute function public.set_updated_at();

alter table public.session_family_briefs enable row level security;

create policy "session_family_briefs_select_staff_scope" on public.session_family_briefs
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id and public.can_review_session(cs.classroom_id, (select auth.uid()))
    )
  );

revoke all on table public.session_family_briefs from anon, authenticated;
grant select on table public.session_family_briefs to authenticated;

create or replace function public.save_session_family_brief(
  p_session_id uuid,
  p_lesson_title text,
  p_learning_summary text,
  p_homework_summary text default '',
  p_materials_note text default '',
  p_teacher_public_comment text default ''
)
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
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;

  insert into public.session_family_briefs (
    session_id, lesson_title, learning_summary, homework_summary, materials_note, teacher_public_comment
  )
  values (
    p_session_id, left(trim(coalesce(p_lesson_title, '')), 200), left(trim(coalesce(p_learning_summary, '')), 2000),
    left(trim(coalesce(p_homework_summary, '')), 2000), left(trim(coalesce(p_materials_note, '')), 2000),
    left(trim(coalesce(p_teacher_public_comment, '')), 2000)
  )
  on conflict (session_id) do update set
    lesson_title = excluded.lesson_title,
    learning_summary = excluded.learning_summary,
    homework_summary = excluded.homework_summary,
    materials_note = excluded.materials_note,
    teacher_public_comment = excluded.teacher_public_comment,
    updated_at = now();
end;
$$;

revoke all on function public.save_session_family_brief(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_session_family_brief(uuid, text, text, text, text, text) to authenticated;

create or replace function public.publish_session_family_brief(p_session_id uuid)
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
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.session_family_briefs where session_id = p_session_id) then
    raise exception 'BRIEF_NOT_FOUND';
  end if;

  update public.session_family_briefs
     set published_by = uid, published_at = now()
   where session_id = p_session_id;

  perform public.emit_domain_event(
    'session_family_brief.published', 'class_session', p_session_id, '{}'::jsonb, null, null
  );
end;
$$;

revoke all on function public.publish_session_family_brief(uuid) from public, anon, authenticated;
grant execute on function public.publish_session_family_brief(uuid) to authenticated;

create or replace function public.get_family_session_brief(p_session_id uuid)
returns table(
  lesson_title text, learning_summary text, homework_summary text,
  materials_note text, teacher_public_comment text, published_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select cs.classroom_id into cid from public.class_sessions cs where cs.id = p_session_id and cs.deleted_at is null;
  if cid is null then return; end if;

  if not exists (
    select 1 from public.enrollments e
     where e.classroom_id = cid and e.status = 'active'
       and public.family_of_student(e.student_id, uid)
  ) then return; end if;

  return query
  select b.lesson_title, b.learning_summary, b.homework_summary, b.materials_note, b.teacher_public_comment, b.published_at
    from public.session_family_briefs b
   where b.session_id = p_session_id and b.published_at is not null;
end;
$$;

revoke all on function public.get_family_session_brief(uuid) from public, anon, authenticated;
grant execute on function public.get_family_session_brief(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. session_leave_requests
-- ---------------------------------------------------------------------------

create table public.session_leave_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index session_leave_requests_session_idx on public.session_leave_requests (session_id, status);
create index session_leave_requests_requested_by_idx on public.session_leave_requests (requested_by, status);

alter table public.session_leave_requests enable row level security;

create policy "session_leave_requests_select_scope" on public.session_leave_requests
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or public.has_perm((select auth.uid()), 'attendance.mark')
    or public.family_of_student(student_id, (select auth.uid()))
    or exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id and public.is_classroom_staff_assigned(cs.classroom_id, (select auth.uid()))
    )
  );

revoke all on table public.session_leave_requests from anon, authenticated;
grant select on table public.session_leave_requests to authenticated;

create or replace function public.submit_session_leave_request(
  p_session_id uuid,
  p_student_id uuid,
  p_reason text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  session_row public.class_sessions%rowtype;
  request_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.family_of_student(p_student_id, uid) then raise exception 'FORBIDDEN'; end if;

  select * into session_row from public.class_sessions where id = p_session_id and deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  cid := session_row.classroom_id;
  if session_row.ended_at is not null or session_row.scheduled_at is null or session_row.scheduled_at <= now() then
    raise exception 'SESSION_NOT_LEAVABLE';
  end if;
  if not exists (
    select 1 from public.enrollments where classroom_id = cid and student_id = p_student_id and status = 'active'
  ) then raise exception 'STUDENT_NOT_ENROLLED'; end if;

  insert into public.session_leave_requests (session_id, student_id, requested_by, reason)
  values (p_session_id, p_student_id, uid, left(btrim(coalesce(p_reason, '')), 1000))
  returning id into request_id;

  perform public.emit_domain_event(
    'leave_request.submitted', 'session_leave_request', request_id,
    jsonb_build_object('sessionId', p_session_id, 'studentId', p_student_id), uid, null
  );
  return request_id;
end;
$$;

revoke all on function public.submit_session_leave_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_session_leave_request(uuid, uuid, text) to authenticated;

create or replace function public.decide_session_leave_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  request_row public.session_leave_requests%rowtype;
  cid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into request_row from public.session_leave_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'pending' then raise exception 'REQUEST_ALREADY_DECIDED'; end if;

  select classroom_id into cid from public.class_sessions where id = request_row.session_id;
  if cid is null or not public.can_mark_attendance(cid, uid) then raise exception 'FORBIDDEN'; end if;

  if p_approve then
    perform public.record_session_change(request_row.session_id, request_row.student_id, 'leave', null, request_row.reason);
    update public.session_leave_requests
       set status = 'approved', decided_by = uid, decided_at = now()
     where id = p_request_id;
  else
    update public.session_leave_requests
       set status = 'rejected', decided_by = uid, decided_at = now()
     where id = p_request_id;
  end if;

  perform public.emit_domain_event(
    'leave_request.' || (case when p_approve then 'approved' else 'rejected' end),
    'session_leave_request', p_request_id, '{}'::jsonb, uid, null
  );
end;
$$;

revoke all on function public.decide_session_leave_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.decide_session_leave_request(uuid, boolean) to authenticated;

create or replace function public.list_my_session_leave_requests()
returns table(
  id uuid, session_id uuid, session_title text, student_id uuid, student_name text,
  reason text, status text, created_at timestamptz, decided_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  return query
  select r.id, r.session_id, cs.title, r.student_id, s.name, r.reason, r.status, r.created_at, r.decided_at
    from public.session_leave_requests r
    join public.class_sessions cs on cs.id = r.session_id
    join public.students s on s.id = r.student_id
   where r.requested_by = uid
   order by r.created_at desc
   limit 100;
end;
$$;

revoke all on function public.list_my_session_leave_requests() from public, anon, authenticated;
grant execute on function public.list_my_session_leave_requests() to authenticated;
