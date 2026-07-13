-- ============================================================================
-- 修复星标事件聚合形状不一致（2026-07-10 全链路测验发现）
--
-- P4 上课页发星的权威形状（LiveShell append("star", { studentId })）：
--   user_id = 事件作者（教师）、payload->>'studentId' = 学生的 user id。
-- 而 P4B 的学情聚合与 RLS（20260709000700 / 20260709000900）按
--   ev.user_id = 学生 user_id 统计——真实课堂发的星星永远统计不到。
-- 本 migration 把两处统一改为按 payload->>'studentId' 匹配。
-- （课堂报告 report.ts 一直用 payload 形状，是正确参照，不动。）
-- ============================================================================

-- 1) staff 360° 档案页「学习」tab 的行作用域策略改为 payload 匹配
drop policy if exists "events_select_student_scope" on public.session_events;
create policy "events_select_student_scope" on public.session_events
  for select to authenticated
  using (
    type in ('star', 'star_undo')
    and exists (
      select 1 from public.students s
       where s.user_id is not null
         and s.user_id::text = session_events.payload->>'studentId'
         and public.can_access_student(s.id, (select auth.uid()))
    )
  );

-- 2) get_my_learning_summary 星标子查询改为 payload 匹配（其余列不变）
create or replace function public.get_my_learning_summary()
returns table (
  student_id           uuid,
  student_name         text,
  grade                smallint,
  next_session_at      timestamptz,
  attendance_rate_30d  numeric,
  recent_submissions   jsonb,
  star_total           int,
  payment_status       text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  with my_students as (
    select s.id, s.name, s.grade, s.user_id
      from public.students s
     where s.user_id = auth.uid()
    union
    select s.id, s.name, s.grade, s.user_id
      from public.students s
      join public.student_guardians g on g.student_id = s.id
     where g.guardian_id = auth.uid()
  )
  select
    ms.id,
    ms.name,
    ms.grade,
    (
      select min(cs.scheduled_at)
        from public.class_sessions cs
        join public.enrollments e on e.classroom_id = cs.classroom_id and e.status = 'active'
       where e.student_id = ms.id and cs.scheduled_at >= now()
    ),
    (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where sa.status = 'present') / count(*), 1)
             end
        from public.session_attendance sa
        join public.class_sessions cs on cs.id = sa.session_id
       where sa.student_id = ms.id
         and cs.scheduled_at >= now() - interval '30 days'
         and cs.scheduled_at < now()
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object('title', row.title, 'score', row.score, 'gradedAt', row.graded_at) order by row.rank), '[]'::jsonb)
        from (
          select a.title, sub.score, sub.graded_at,
                 row_number() over (order by coalesce(sub.graded_at, sub.submitted_at) desc) as rank
            from public.submissions sub
            join public.assignments a on a.id = sub.assignment_id
           where ms.user_id is not null and sub.user_id = ms.user_id
        ) row
       where row.rank <= 5
    ),
    (
      select greatest(0, coalesce(sum(case when ev.type = 'star' then 1 else -1 end), 0))::int
        from public.session_events ev
       where ms.user_id is not null
         and ev.payload->>'studentId' = ms.user_id::text
         and ev.type in ('star', 'star_undo')
    ),
    (
      select case
               when exists (select 1 from public.orders o where o.student_id = ms.id and o.status in ('unpaid', 'partial')) then 'overdue'
               when exists (select 1 from public.orders o where o.student_id = ms.id) then 'ok'
               else 'none'
             end
    )
  from my_students ms;
$$;

revoke all on function public.get_my_learning_summary() from public;
grant execute on function public.get_my_learning_summary() to authenticated;
