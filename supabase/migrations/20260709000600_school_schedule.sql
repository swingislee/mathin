-- ============================================================================
-- P4B-4 课表视图（docs/plan/10-school-backend.md §5.8、§9）
-- get_my_schedule：学生/家长白名单 RPC，取本人/孩子的未来课次。
-- schedule.view.all 是独立于 class.view.all 的功能键（默认种子里两者总是同授，
-- 但管理员可单独配置），故给 classrooms/class_sessions/classroom_members
-- 追加一条按 schedule.view.all 放行的 select 策略（additive，不影响既有策略）。
-- ============================================================================

create or replace function public.get_my_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  duration_min smallint,
  teacher_name text,
  student_name text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select cs.id,
         c.name,
         cs.title,
         cs.scheduled_at,
         cs.duration_min,
         coalesce((
           select p.display_name
             from public.classroom_members cm
             join public.profiles p on p.id = cm.user_id
            where cm.classroom_id = c.id and cm.role = 'teacher'
            limit 1
         ), ''),
         s.name
    from public.class_sessions cs
    join public.classrooms c on c.id = cs.classroom_id
    join public.enrollments e on e.classroom_id = c.id and e.status = 'active'
    join public.students s on s.id = e.student_id
   where (
     s.user_id = auth.uid()
     or exists (select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid())
   )
   and cs.scheduled_at is not null
   and cs.scheduled_at >= p_from
   and cs.scheduled_at < p_to
   order by cs.scheduled_at;
$$;

revoke all on function public.get_my_schedule(timestamptz, timestamptz) from public;
grant execute on function public.get_my_schedule(timestamptz, timestamptz) to authenticated;

create policy "classrooms_select_schedule_view_all" on public.classrooms
  for select to authenticated
  using (public.staff_has_perm((select auth.uid()), 'schedule.view.all'));

create policy "sessions_select_schedule_view_all" on public.class_sessions
  for select to authenticated
  using (public.staff_has_perm((select auth.uid()), 'schedule.view.all'));

create policy "cls_members_select_schedule_view_all" on public.classroom_members
  for select to authenticated
  using (public.staff_has_perm((select auth.uid()), 'schedule.view.all'));
