-- P4C-2 课次软删与回收站（docs/plan/11 §7）
-- class_sessions 加 deleted_at 软删列；所有读课次的路径补 deleted_at is null；
-- 教师误删课次可从班级详情回收站恢复。物理删除永不发生（回收站永存）。

alter table public.class_sessions add column if not exists deleted_at timestamptz;

-- 存活课次按班级检索的部分索引（软删后的行不进索引）
create index if not exists class_sessions_alive_idx
  on public.class_sessions (classroom_id) where deleted_at is null;

-- 软删/恢复走 UPDATE deleted_at：列级 grant 必须包含该列，否则 RLS 前先被列权限挡下
grant update (deleted_at) on public.class_sessions to authenticated;

-- ----------------------------------------------------------------------------
-- 三个 get_my_* RPC：补 cs.deleted_at is null（签名与返回列不变，create or replace 即可）
-- ----------------------------------------------------------------------------

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
   and cs.deleted_at is null
   and cs.scheduled_at is not null
   and cs.scheduled_at >= p_from
   and cs.scheduled_at < p_to
   order by cs.scheduled_at;
$$;

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
    and cs.deleted_at is null
    and cs.scheduled_at is not null and cs.scheduled_at >= p_from and cs.scheduled_at < p_to
   order by cs.scheduled_at desc;
$$;

-- get_my_learning_summary：仅「下次上课」子查询读未来课次，补 deleted_at is null。
-- （出勤子查询 join 的是已有 attendance 的课次；软删只允许未开始课次，天然无 attendance，无需改。）
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
    )
  from my_students ms;
$$;
