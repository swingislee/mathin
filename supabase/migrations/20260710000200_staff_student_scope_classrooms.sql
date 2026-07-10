-- ============================================================================
-- 学辅（跟进人）读作用域补缺（2026-07-10 全链路测验发现）
--
-- 现象：学辅打开名下学生的 360° 档案页，「学习」tab 里报名记录的班级名为空、
-- 未来课次永远「暂无排课」，费用卡订单显示「未关联班级」——enrollments/orders
-- 行本身可见，但 join 的 classrooms / class_sessions 被 RLS 挡住（现有 select
-- 策略只有 成员 / class.view.all / schedule.view.all 三条）。
--
-- 修复：staff 若能访问某学生（can_access_student，即 view.all 或名下 assigned），
-- 则可只读该学生报名所在的班级行与其课次行。包一层 security definer 辅助函数，
-- 避免策略内联子查询触发 enrollments 自身 RLS 的递归（模式同 is_classroom_member）。
-- ============================================================================

create or replace function public.staff_linked_classroom(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.enrollments e
     where e.classroom_id = cid
       and public.can_access_student(e.student_id, uid)
  );
$$;

revoke all on function public.staff_linked_classroom(uuid, uuid) from public;
grant execute on function public.staff_linked_classroom(uuid, uuid) to authenticated;

drop policy if exists "classrooms_select_student_scope" on public.classrooms;
create policy "classrooms_select_student_scope" on public.classrooms
  for select to authenticated
  using (
    public.is_staff((select auth.uid()))
    and public.staff_linked_classroom(id, (select auth.uid()))
  );

drop policy if exists "sessions_select_student_scope" on public.class_sessions;
create policy "sessions_select_student_scope" on public.class_sessions
  for select to authenticated
  using (
    public.is_staff((select auth.uid()))
    and public.staff_linked_classroom(classroom_id, (select auth.uid()))
  );
