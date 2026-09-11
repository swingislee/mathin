-- 教学工作台只投影课次履约状态；资料正文、文件地址和审核写权沿用原入口。
create function public.get_teaching_workbench(p_from timestamptz, p_to timestamptz, p_scope text default 'mine')
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_view_team boolean;
  result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  can_view_team := public.has_perm(uid, 'class.view.all');
  if not can_view_team and not public.has_perm(uid, 'class.view.mine') then
    raise exception 'FORBIDDEN';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_to <= p_from or p_to - p_from > interval '32 days'
     or p_scope is null or p_scope not in ('mine', 'team') then
    raise exception 'VALIDATION';
  end if;
  if p_scope = 'team' and not can_view_team then raise exception 'FORBIDDEN'; end if;

  with candidates as materialized (
    select s.id, s.classroom_id, s.title, s.scheduled_at, s.started_at, s.ended_at,
      s.teacher_override, s.postwork_completed_at, c.name as classroom_name
    from public.class_sessions s
    join public.classrooms c on c.id = s.classroom_id
    where s.deleted_at is null and s.voided_at is null
      and c.purpose = 'production' and c.archived_at is null and c.trashed_at is null
      and s.scheduled_at >= p_from and s.scheduled_at < p_to
      and (p_scope = 'team' or s.teacher_override = uid or exists (
        select 1 from public.classroom_staff_assignments a
        where a.classroom_id = s.classroom_id and a.user_id = uid
          and (a.responsibility = 'assistant_teacher'
            or (a.responsibility = 'primary_teacher' and s.teacher_override is null))
      ))
    order by s.scheduled_at, s.id
    limit 1001
  ), selected as materialized (
    select * from candidates order by scheduled_at, id limit 1000
  ), records as (
    select s.scheduled_at, s.id, jsonb_build_object(
      'id', s.id, 'classroomId', s.classroom_id, 'classroomName', s.classroom_name,
      'title', s.title, 'scheduledAt', s.scheduled_at, 'startedAt', s.started_at,
      'endedAt', s.ended_at, 'postworkCompletedAt', s.postwork_completed_at,
      'preparationStatus', coalesce(prep.status, 'not_started'),
      'preparedAt', prep.prepared_at, 'autoFrozen', coalesce(prep.auto_frozen, false),
      'canOpenPreparation', public.is_session_teacher(s.id, uid)
        or public.can_review_session_preparation(s.id, uid),
      'teachers', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name, p.id)
        from public.profiles p
        where p.id = s.teacher_override or exists (
          select 1 from public.classroom_staff_assignments a
          where a.classroom_id = s.classroom_id and a.user_id = p.id
            and (a.responsibility = 'assistant_teacher'
              or (a.responsibility = 'primary_teacher' and s.teacher_override is null))
        )
      ), '[]'::jsonb),
      'artifacts', (
        select jsonb_object_agg(k.kind, jsonb_build_object(
          'status', coalesce(r.status, case when k.has_draft then 'draft' else 'missing' end),
          'submittedAt', r.submitted_at
        ))
        from (values
          ('solution', exists(select 1 from public.solution_records x where x.session_id = s.id)
            or coalesce(jsonb_array_length(artifact.solution_files), 0) > 0),
          ('lesson_plan', exists(select 1 from public.lesson_plans x where x.session_id = s.id)
            or coalesce(jsonb_array_length(artifact.lesson_plan_files), 0) > 0),
          ('rehearsal_video', coalesce(btrim(artifact.rehearsal_video_url), '') <> '')
        ) k(kind, has_draft)
        left join public.session_preparation_reviews r on r.session_id = s.id and r.artifact_kind = k.kind
      ),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', task.id, 'source', task.source, 'kind', task.kind,
          'status', task.status, 'required', task.required, 'dueAt', task.due_at,
          'assignedTo', task.assigned_to, 'assigneeName', p.display_name,
          'completedAt', task.completed_at
        ) order by task.source, task.kind, task.id)
        from (
          select t.id, 'postwork' as source, t.kind, t.status, t.required,
            t.due_at, t.assigned_to, t.completed_at
          from public.session_completion_tasks t where t.session_id = s.id
          union all
          select t.id, 'support', t.kind, t.status, true,
            t.due_at, t.assigned_to, t.completed_at
          from public.class_support_tasks t where t.session_id = s.id
        ) task
        left join public.profiles p on p.id = task.assigned_to
      ), '[]'::jsonb)
    ) as value
    from selected s
    left join public.session_preparations prep on prep.session_id = s.id
    left join public.session_preparation_artifacts artifact on artifact.session_id = s.id
  )
  select jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(value order by scheduled_at, id) from records), '[]'::jsonb),
    'truncated', (select count(*) > 1000 from candidates)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_teaching_workbench(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_teaching_workbench(timestamptz, timestamptz, text) to authenticated;

comment on function public.get_teaching_workbench(timestamptz, timestamptz, text) is
  '教学履约只读汇总：class.view.all 可读团队，普通教师仅本人任教课次；返回提交状态和任务状态，不返回资料正文、家长联系方式或文件链接。';
