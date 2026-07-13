-- ============================================================================
-- P4B-8 学生/家长端收尾（docs/plan/10-school-backend.md §7、§9）
-- get_my_learning_summary：家长首屏「每个孩子一张卡」+ /dashboard/children 详情页
-- 共用的单一聚合 RPC——下次上课、近 30 天出勤率、最近作业成绩、星标总数、缴费状态，
-- 全部服务端一次算好；自身也在 my_students 里（student 本人同样可调用，返回本人一行）。
-- ============================================================================

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
       where ms.user_id is not null and ev.user_id = ms.user_id and ev.type in ('star', 'star_undo')
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
