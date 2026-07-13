-- ============================================================================
-- P4B-5 考勤与学情（docs/plan/10-school-backend.md §5.5、§8「学习」tab）
-- session_attendance：点名事实，四态，marked_by/marked_at 由触发器强制写入防伪造；
-- 学情聚合需要跨教室读 session_events（星星）/assignments/submissions（作业成绩），
-- 均为「追加」只读 select 策略，按 can_access_student 收窄到该员工可见的学生，
-- 不改动/不撤销任何既有策略（P4/P4B-0..4 全部继续原样工作）。
-- ============================================================================

create table public.session_attendance (
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  status     text not null check (status in ('present', 'absent', 'late', 'leave')),
  note       text not null default '',
  marked_by  uuid references public.profiles (id) on delete set null,
  marked_at  timestamptz not null default now(),
  primary key (session_id, student_id)
);

comment on table public.session_attendance is '课次点名；marked_by/marked_at 由触发器强制写入 auth.uid()/now()，客户端不可伪造';

create index session_attendance_student_idx on public.session_attendance (student_id);

create function public.session_attendance_set_marker()
returns trigger
language plpgsql
as $$
begin
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end;
$$;

create trigger session_attendance_set_marker
  before insert or update on public.session_attendance
  for each row execute function public.session_attendance_set_marker();

-- ----------------------------------------------------------------------------
-- RLS 辅助函数
-- ----------------------------------------------------------------------------

-- 点名写权限：本班的 attendance.mark 持有者（全校可见或本人任教），admin 恒真。
create function public.can_mark_attendance(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or (
      public.staff_has_perm(uid, 'attendance.mark')
      and (public.staff_has_perm(uid, 'class.view.all') or public.is_classroom_teacher(cid, uid))
    );
$$;

-- 点名读权限：能写的人自然能读；此外任何能访问该学生档案的员工（student.view.all/assigned）
-- 也能读该生的考勤（供 360 档案页「学习」tab 聚合，不要求同时持有 attendance.mark）。
create function public.can_view_attendance(p_session_id uuid, p_student_id uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or exists (
      select 1 from public.class_sessions cs
       where cs.id = p_session_id
         and public.can_mark_attendance(cs.classroom_id, uid)
    )
    or public.can_access_student(p_student_id, uid);
$$;

revoke all on function public.can_mark_attendance(uuid, uuid) from public;
revoke all on function public.can_view_attendance(uuid, uuid, uuid) from public;
grant execute on function public.can_mark_attendance(uuid, uuid) to authenticated;
grant execute on function public.can_view_attendance(uuid, uuid, uuid) to authenticated;

alter table public.session_attendance enable row level security;

create policy "attendance_select_scope" on public.session_attendance
  for select to authenticated
  using (public.can_view_attendance(session_id, student_id, (select auth.uid())));

create policy "attendance_insert_mark" on public.session_attendance
  for insert to authenticated
  with check (
    exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id
         and public.can_mark_attendance(cs.classroom_id, (select auth.uid()))
    )
  );

create policy "attendance_update_mark" on public.session_attendance
  for update to authenticated
  using (
    exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id
         and public.can_mark_attendance(cs.classroom_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.class_sessions cs
       where cs.id = session_id
         and public.can_mark_attendance(cs.classroom_id, (select auth.uid()))
    )
  );

revoke all on public.session_attendance from anon, authenticated;
grant select, insert (session_id, student_id, status, note) on public.session_attendance to authenticated;
grant update (status, note) on public.session_attendance to authenticated;

-- student/parent 无表级授权，一律经下方白名单 RPC 读自己/孩子的考勤。
create or replace function public.get_my_attendance(p_from timestamptz, p_to timestamptz)
returns table (
  session_id     uuid,
  student_name   text,
  classroom_name text,
  lecture_name   text,
  scheduled_at   timestamptz,
  status         text,
  note           text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select cs.id, s.name, c.name, cs.title, cs.scheduled_at, sa.status, sa.note
    from public.session_attendance sa
    join public.class_sessions cs on cs.id = sa.session_id
    join public.classrooms c on c.id = cs.classroom_id
    join public.students s on s.id = sa.student_id
   where (
      s.user_id = auth.uid()
      or exists (
        select 1 from public.student_guardians g
         where g.student_id = s.id and g.guardian_id = auth.uid()
      )
    )
    and cs.scheduled_at is not null and cs.scheduled_at >= p_from and cs.scheduled_at < p_to
   order by cs.scheduled_at desc;
$$;

revoke all on function public.get_my_attendance(timestamptz, timestamptz) from public;
grant execute on function public.get_my_attendance(timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 追加只读策略：学情聚合要跨到 P4 的 session_events/assignments/submissions，
-- 按「该生可访问」收窄，供 360 档案页「学习」tab 用；不影响这些表既有的课堂内策略。
-- ----------------------------------------------------------------------------

create policy "events_select_student_scope" on public.session_events
  for select to authenticated
  using (
    type in ('star', 'star_undo')
    and exists (
      select 1 from public.students s
       where s.user_id = session_events.user_id
         and public.can_access_student(s.id, (select auth.uid()))
    )
  );

-- 点名抽屉「有账号且该 session 有其 user 事件」预填检测：本班可管理者（未必是
-- classroom_members，如 class.view.all 的 admin/主管）也要能看到事件是否存在。
create policy "events_select_manage" on public.session_events
  for select to authenticated
  using (
    exists (
      select 1 from public.class_sessions cs
       where cs.id = session_events.session_id
         and public.can_manage_classroom(cs.classroom_id, (select auth.uid()))
    )
  );

create policy "submissions_select_student_scope" on public.submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.students s
       where s.user_id = submissions.user_id
         and public.can_access_student(s.id, (select auth.uid()))
    )
  );

create policy "assignments_select_student_scope" on public.assignments
  for select to authenticated
  using (
    exists (
      select 1
        from public.submissions sub
        join public.students s on s.user_id = sub.user_id
       where sub.assignment_id = assignments.id
         and public.can_access_student(s.id, (select auth.uid()))
    )
  );
