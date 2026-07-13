-- P4C-7 顾客侧补齐（docs/plan/11 §0.7/§0.8）：两个白名单 RPC 扩返回列。
-- returns table 改列集不允许 create or replace（§8 施工守则），必须 drop 再 create，
-- 同事务内完成；drop 会连带丢 grant，末尾统一重授。

-- ----------------------------------------------------------------------------
-- 1) get_my_schedule 补 classroom_id：mySchedule 磁贴「进教室」按钮需要落点。
-- ----------------------------------------------------------------------------

drop function if exists public.get_my_schedule(timestamptz, timestamptz);

create function public.get_my_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  duration_min smallint,
  teacher_name text,
  student_name text,
  classroom_id uuid
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
         s.name,
         c.id
    from public.class_sessions cs
    join public.classrooms c on c.id = cs.classroom_id
    join public.enrollments e on e.classroom_id = c.id and e.status = 'active'
    join public.students s on s.id = e.student_id
   where (
     s.user_id = auth.uid()
     or exists (select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid())
   )
   and cs.deleted_at is null
   and cs.scheduled_at is not null
   and cs.scheduled_at >= p_from
   and cs.scheduled_at < p_to
   order by cs.scheduled_at;
$$;

revoke all on function public.get_my_schedule(timestamptz, timestamptz) from public;
grant execute on function public.get_my_schedule(timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) get_my_learning_summary 扩两列（childCard 增强 + 学生 myStars 磁贴同源）：
--    week_session_count       未来 7 天课次数（时刻展示串由 TS 侧从课表拼）
--    pending_assignment_count 孩子有账号时按其 classroom_members 教室算
--                             未交且未过期；无账号返回 null（TS 显示"—"，
--                             不返回 0——0 是"都交了"，语义完全不同）
-- ----------------------------------------------------------------------------

drop function if exists public.get_my_learning_summary();

create function public.get_my_learning_summary()
returns table (
  student_id               uuid,
  student_name             text,
  grade                    smallint,
  next_session_at          timestamptz,
  attendance_rate_30d      numeric,
  recent_submissions       jsonb,
  star_total               int,
  payment_status           text,
  week_session_count       int,
  pending_assignment_count int
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
       where e.student_id = ms.id and cs.scheduled_at >= now() and cs.deleted_at is null
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
    ),
    (
      select count(*)::int
        from public.class_sessions cs
        join public.enrollments e on e.classroom_id = cs.classroom_id and e.status = 'active'
       where e.student_id = ms.id and cs.deleted_at is null
         and cs.scheduled_at >= now() and cs.scheduled_at < now() + interval '7 days'
    ),
    (
      select case when ms.user_id is null then null else (
        select count(*)::int
          from public.assignments a
          join public.classroom_members cm
            on cm.classroom_id = a.classroom_id and cm.user_id = ms.user_id and cm.role = 'student'
         where (a.due_at is null or a.due_at >= now())
           and not exists (
             select 1 from public.submissions sub
              where sub.assignment_id = a.id and sub.user_id = ms.user_id and sub.submitted_at is not null
           )
      ) end
    )
  from my_students ms;
$$;

revoke all on function public.get_my_learning_summary() from public;
grant execute on function public.get_my_learning_summary() to authenticated;
