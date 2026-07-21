-- P4I-13：班级工作区「运营记录」tab。
-- domain_events 的通用 RLS（can_read_domain_event）只认 actor/target/admin/audit.view，
-- 教学/学辅角色查看非本人操作的班级事件会被拒——这个策略是为个人审计流设计的，
-- 不适合"班级维度给所有相关责任人看"的场景，因此单独开一个 SECURITY DEFINER RPC，
-- 复用 can_manage_classroom / classroom_staff_assignments 判断 scope。

create or replace function public.list_classroom_operational_events(p_classroom_id uuid)
returns table(event_type text, occurred_at timestamptz, actor_name text, payload jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.can_manage_classroom(p_classroom_id, uid)
    or exists (
      select 1 from public.classroom_staff_assignments
       where classroom_id = p_classroom_id and user_id = uid
    )
  ) then raise exception 'FORBIDDEN_SCOPE'; end if;

  return query
  select e.event_type, e.occurred_at, coalesce(p.display_name, ''), e.payload
    from public.domain_events e
    left join public.profiles p on p.id = e.actor_id
   where e.event_type <> 'session.page_changed' -- 课堂实时翻页遥测，不算运营记录
     and (
       (e.entity_type = 'classroom' and e.entity_id = p_classroom_id)
       or (e.entity_type = 'class_session' and e.entity_id in (
             select id from public.class_sessions where classroom_id = p_classroom_id
           ))
     )
   order by e.occurred_at desc
   limit 80;
end;
$$;

revoke all on function public.list_classroom_operational_events(uuid) from public, anon, authenticated;
grant execute on function public.list_classroom_operational_events(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 班级花名册角色列信号（出勤/作业/请假/欠费）。
-- assignments/submissions 的 RLS 走的是旧 P4 classroom_members 模型
-- （is_classroom_member），student_accounts 走的是 finance 权限模型
-- （can_view_finance_student）——两者都不认 P4H 的 classroom_staff_assignments，
-- 学辅/教师直查这几张表会被挡。统一开一个 SECURITY DEFINER RPC，
-- 用 session_preparations 同款的 scope 判断（staff assignment 或 can_manage_classroom）
-- 一次性批量返回，避免 4 次零散查询各自撞不同的 RLS 假设。
-- ---------------------------------------------------------------------------

create or replace function public.get_classroom_roster_signals(p_classroom_id uuid)
returns table(
  student_id uuid,
  recent_absences integer,
  pending_submissions integer,
  graded_avg numeric,
  pending_leave_requests integer,
  account_balance numeric
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.can_manage_classroom(p_classroom_id, uid)
    or exists (
      select 1 from public.classroom_staff_assignments
       where classroom_id = p_classroom_id and user_id = uid
    )
  ) then raise exception 'FORBIDDEN_SCOPE'; end if;

  return query
  with roster as (
    select e.student_id from public.enrollments e
     where e.classroom_id = p_classroom_id and e.status = 'active'
  ),
  recent_sessions as (
    select cs.id from public.class_sessions cs
     where cs.classroom_id = p_classroom_id and cs.ended_at is not null
     order by cs.ended_at desc
     limit 3
  ),
  attendance_agg as (
    select sa.student_id, count(*) filter (where sa.status in ('absent', 'leave')) as recent_absences
      from public.session_attendance sa
     where sa.session_id in (select id from recent_sessions)
     group by sa.student_id
  ),
  submission_agg as (
    select st.id as student_id,
           count(*) filter (where sub.id is null or sub.submitted_at is null) as pending_submissions,
           avg(sub.score) filter (where sub.score is not null) as graded_avg
      from public.students st
      join public.assignments a on a.classroom_id = p_classroom_id
      left join public.submissions sub on sub.assignment_id = a.id and sub.user_id = st.user_id
     where st.id in (select roster.student_id from roster) and st.user_id is not null
     group by st.id
  ),
  leave_agg as (
    select lr.student_id, count(*) as pending_leave_requests
      from public.session_leave_requests lr
      join public.class_sessions cs on cs.id = lr.session_id
     where cs.classroom_id = p_classroom_id and lr.status = 'pending'
     group by lr.student_id
  )
  select r.student_id,
         coalesce(att.recent_absences, 0)::integer,
         coalesce(sub.pending_submissions, 0)::integer,
         sub.graded_avg,
         coalesce(lv.pending_leave_requests, 0)::integer,
         coalesce(bal.balance, 0)
    from roster r
    left join attendance_agg att on att.student_id = r.student_id
    left join submission_agg sub on sub.student_id = r.student_id
    left join leave_agg lv on lv.student_id = r.student_id
    left join public.student_accounts bal on bal.student_id = r.student_id;
end;
$$;

revoke all on function public.get_classroom_roster_signals(uuid) from public, anon, authenticated;
grant execute on function public.get_classroom_roster_signals(uuid) to authenticated;
