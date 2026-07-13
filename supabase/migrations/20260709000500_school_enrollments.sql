-- ============================================================================
-- P4B-3 建班、报名、排课与课件模板/覆盖层（docs/plan/10-school-backend.md §5.4、§4.3）
-- classrooms/class_sessions 追加可空列（旧的轻量教室零迁移继续工作）；
-- enrollments：报名事实（教务维度），与 classroom_members（账号维度）解耦不互触发；
-- 覆盖层 courseware_overlay：教师只能插页/排序，服务端禁止删改模板页；
-- 全部新增 RLS 策略均为「追加」（additive OR），不改动/不撤销 P4 既有策略——
--   保证旧课堂（无课程）与旧教师自建教室继续原样工作。
-- ============================================================================

alter table public.classrooms
  add column course_id   uuid references public.courses (id) on delete set null,
  add column grade       smallint,
  add column capacity    smallint,
  add column room        text not null default '',
  add column archived_at timestamptz;

alter table public.class_sessions
  add column lecture_id          uuid references public.course_lectures (id) on delete set null,
  add column lecture_no          smallint,
  add column scheduled_at        timestamptz,
  add column duration_min        smallint,
  add column courseware_overlay  jsonb not null default '[]',
  add column courseware_frozen_at timestamptz,
  add constraint class_sessions_overlay_cap check (octet_length(courseware_overlay::text) <= 1048576);

create index class_sessions_sched_idx on public.class_sessions (scheduled_at);
create index class_sessions_lecture_idx on public.class_sessions (lecture_id);

-- ----------------------------------------------------------------------------
-- 报名 enrollments
-- ----------------------------------------------------------------------------

create table public.enrollments (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  status       text not null default 'active'
    check (status in ('active', 'completed', 'transferred_out', 'withdrawn')),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  remark       text not null default '',
  operated_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- 同班同学生仅一条 active：left_at 只在离开(active→其它)时写入，
  -- 故 active 行恒 left_at is null；PG17 支持 nulls not distinct，天然把多条 active 行当重复拒绝。
  constraint enrollments_one_active unique nulls not distinct (classroom_id, student_id, left_at)
);

comment on table public.enrollments is '报名（教务事实）；与 classroom_members（账号/上课权限）解耦，花名册 UI 自行比对错位';

create index enrollments_student_idx on public.enrollments (student_id);
create index enrollments_classroom_idx on public.enrollments (classroom_id);

-- ----------------------------------------------------------------------------
-- RLS 辅助函数
-- ----------------------------------------------------------------------------

create or replace function public.teacher_of_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.enrollments e
      join public.classroom_members m on m.classroom_id = e.classroom_id and m.role = 'teacher'
     where e.student_id = sid and e.status = 'active' and m.user_id = uid
  );
$$;

-- 补全 P4B-2 遗留：students/follow_ups 的作用域现在也放行「我任教班级」的学生
create or replace function public.can_access_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or public.staff_has_perm(uid, 'student.view.all')
    or (
      public.staff_has_perm(uid, 'student.view.assigned')
      and (public.assigned_of_student(sid, uid) or public.teacher_of_student(sid, uid))
    );
$$;

-- 班级「全局 vs 仅本人」写作用域：class.manage 是写闸，class.view.all 决定是不是全局
create or replace function public.can_manage_classroom(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or (
      public.staff_has_perm(uid, 'class.manage')
      and (public.staff_has_perm(uid, 'class.view.all') or public.is_classroom_teacher(cid, uid))
    );
$$;

create or replace function public.can_view_enrollment(cid uuid, sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or public.staff_has_perm(uid, 'class.view.all')
    or public.is_classroom_teacher(cid, uid)
    or public.assigned_of_student(sid, uid);
$$;

revoke all on function public.teacher_of_student(uuid, uuid) from public;
revoke all on function public.can_access_student(uuid, uuid) from public;
revoke all on function public.can_manage_classroom(uuid, uuid) from public;
revoke all on function public.can_view_enrollment(uuid, uuid, uuid) from public;
grant execute on function public.teacher_of_student(uuid, uuid) to authenticated;
grant execute on function public.can_access_student(uuid, uuid) to authenticated;
grant execute on function public.can_manage_classroom(uuid, uuid) to authenticated;
grant execute on function public.can_view_enrollment(uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RPC：建班 + 报名/转班/退班（跨表/跨权限边界，一律 security definer）
-- ----------------------------------------------------------------------------

create or replace function public.create_class(
  p_name text,
  p_course_id uuid default null,
  p_grade smallint default null,
  p_capacity smallint default null,
  p_room text default '',
  p_teacher_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  code text;
  teacher uuid := coalesce(p_teacher_id, uid);
  attempts int := 0;
begin
  if uid is null or not public.has_perm(uid, 'class.create') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_staff(teacher) then
    raise exception 'TEACHER_NOT_STAFF';
  end if;
  loop
    code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8);
    begin
      insert into public.classrooms (owner_id, name, invite_code, course_id, grade, capacity, room)
      values (uid, coalesce(trim(p_name), ''), code, p_course_id, p_grade, p_capacity, coalesce(p_room, ''))
      returning id into cid;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts > 5 then raise; end if;
    end;
  end loop;
  insert into public.classroom_members (classroom_id, user_id, role)
  values (cid, teacher, 'teacher')
  on conflict (classroom_id, user_id) do nothing;
  return cid;
end;
$$;

create or replace function public.enroll_student(p_classroom_id uuid, p_student_id uuid, p_remark text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  eid uuid;
  cap smallint;
  active_count int;
  cur_status text;
begin
  if uid is null or not public.has_perm(uid, 'class.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select capacity into cap from public.classrooms where id = p_classroom_id;
  if cap is not null then
    select count(*) into active_count from public.enrollments
     where classroom_id = p_classroom_id and status = 'active';
    if active_count >= cap then
      raise exception 'CLASS_FULL';
    end if;
  end if;

  begin
    insert into public.enrollments (classroom_id, student_id, remark, operated_by)
    values (p_classroom_id, p_student_id, coalesce(p_remark, ''), uid)
    returning id into eid;
  exception when unique_violation then
    raise exception 'ALREADY_ENROLLED';
  end;

  select status into cur_status from public.students where id = p_student_id;
  if cur_status in ('lead', 'trialing') then
    update public.students set status = 'enrolled' where id = p_student_id;
  end if;

  return eid;
end;
$$;

create or replace function public.transfer_student(
  p_student_id uuid,
  p_from_classroom uuid,
  p_to_classroom uuid,
  p_remark text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  cap smallint;
  active_count int;
begin
  if uid is null or not public.has_perm(uid, 'class.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not (public.can_manage_classroom(p_from_classroom, uid) and public.can_manage_classroom(p_to_classroom, uid)) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select capacity into cap from public.classrooms where id = p_to_classroom;
  if cap is not null then
    select count(*) into active_count from public.enrollments
     where classroom_id = p_to_classroom and status = 'active';
    if active_count >= cap then
      raise exception 'CLASS_FULL';
    end if;
  end if;

  update public.enrollments
     set status = 'transferred_out', left_at = now(), remark = coalesce(p_remark, remark), operated_by = uid
   where classroom_id = p_from_classroom and student_id = p_student_id and status = 'active';
  if not found then
    raise exception 'NOT_ENROLLED';
  end if;

  insert into public.enrollments (classroom_id, student_id, remark, operated_by)
  values (p_to_classroom, p_student_id, coalesce(p_remark, ''), uid)
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.withdraw_student(p_enrollment_id uuid, p_remark text default '')
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null or not public.has_perm(uid, 'class.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select classroom_id into cid from public.enrollments where id = p_enrollment_id and status = 'active';
  if cid is null then
    raise exception 'NOT_ACTIVE';
  end if;
  if not public.can_manage_classroom(cid, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  update public.enrollments
     set status = 'withdrawn', left_at = now(), remark = coalesce(p_remark, remark), operated_by = uid
   where id = p_enrollment_id;
end;
$$;

revoke all on function public.create_class(text, uuid, smallint, smallint, text, uuid) from public;
revoke all on function public.enroll_student(uuid, uuid, text) from public;
revoke all on function public.transfer_student(uuid, uuid, uuid, text) from public;
revoke all on function public.withdraw_student(uuid, text) from public;
grant execute on function public.create_class(text, uuid, smallint, smallint, text, uuid) to authenticated;
grant execute on function public.enroll_student(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_student(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.withdraw_student(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS：enrollments（新表）
-- ----------------------------------------------------------------------------

alter table public.enrollments enable row level security;

create policy "enrollments_select_scope" on public.enrollments
  for select to authenticated
  using (public.can_view_enrollment(classroom_id, student_id, (select auth.uid())));

revoke all on public.enrollments from anon, authenticated;
grant select on public.enrollments to authenticated;

-- ----------------------------------------------------------------------------
-- RLS：classrooms / class_sessions / classroom_members 追加策略
-- 「全局」（class.view.all / admin）— 追加 select；「全局或本班写」— 追加 insert/update/delete。
-- 原 P4-3/P4-4 owner/teacher 策略保留不动，多策略 OR 叠加，纯扩权不收权。
-- ----------------------------------------------------------------------------

create policy "classrooms_select_view_all" on public.classrooms
  for select to authenticated
  using (public.is_admin((select auth.uid())) or public.staff_has_perm((select auth.uid()), 'class.view.all'));

create policy "classrooms_update_manage" on public.classrooms
  for update to authenticated
  using (public.can_manage_classroom(id, (select auth.uid())))
  with check (public.can_manage_classroom(id, (select auth.uid())));

create policy "cls_members_select_manage" on public.classroom_members
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.staff_has_perm((select auth.uid()), 'class.view.all')
    or public.can_manage_classroom(classroom_id, (select auth.uid()))
  );

create policy "sessions_select_view_all" on public.class_sessions
  for select to authenticated
  using (public.is_admin((select auth.uid())) or public.staff_has_perm((select auth.uid()), 'class.view.all'));

create policy "sessions_insert_manage" on public.class_sessions
  for insert to authenticated
  with check (public.can_manage_classroom(classroom_id, (select auth.uid())));

create policy "sessions_update_manage" on public.class_sessions
  for update to authenticated
  using (public.can_manage_classroom(classroom_id, (select auth.uid())))
  with check (public.can_manage_classroom(classroom_id, (select auth.uid())));

create policy "sessions_delete_manage" on public.class_sessions
  for delete to authenticated
  using (public.can_manage_classroom(classroom_id, (select auth.uid())));

-- ----------------------------------------------------------------------------
-- 列级 grant 扩展（原列不动，追加新列）
-- ----------------------------------------------------------------------------

grant select (course_id, grade, capacity, room, archived_at) on public.classrooms to authenticated;
grant update (name, course_id, grade, capacity, room, archived_at) on public.classrooms to authenticated;

grant update (lecture_id, lecture_no, scheduled_at, duration_min, courseware_overlay, courseware_frozen_at)
  on public.class_sessions to authenticated;
grant insert (lecture_id, lecture_no, scheduled_at, duration_min, courseware_overlay)
  on public.class_sessions to authenticated;

-- course_lectures.courseware_template：写入另需 courseware.template.edit（Server Action 层判），
-- RLS 行级放宽为 course.manage 或 courseware.template.edit 任一持有者可写该行。
drop policy if exists "lectures_update_manage" on public.course_lectures;
create policy "lectures_update_manage" on public.course_lectures
  for update to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.manage')
    or public.has_perm((select auth.uid()), 'courseware.template.edit')
  )
  with check (
    public.has_perm((select auth.uid()), 'course.manage')
    or public.has_perm((select auth.uid()), 'courseware.template.edit')
  );

grant update (courseware_template) on public.course_lectures to authenticated;

-- ----------------------------------------------------------------------------
-- Storage：course-assets 私有 bucket（§4.3），模板页图片/视频
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('course-assets', 'course-assets', false, 209715200)
on conflict (id) do nothing;

create policy "course_assets_select_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'course-assets');

create policy "course_assets_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-assets' and public.is_admin((select auth.uid())));

create policy "course_assets_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-assets' and public.is_admin((select auth.uid())));
