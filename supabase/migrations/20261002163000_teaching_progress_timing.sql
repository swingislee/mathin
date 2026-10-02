-- 保留原状态字段与授权边界，补充六色进度所需的截止、完成和审核时刻。
create or replace function public.get_teaching_progress_facts(p_session_ids uuid[])
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  team boolean;
  contacts boolean;
  result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  team := public.has_perm(uid, 'class.view.all');
  if not public.is_staff(uid) or not (team or public.has_perm(uid, 'class.view.mine')) then raise exception 'FORBIDDEN'; end if;
  if p_session_ids is null or cardinality(p_session_ids) > 100 or array_position(p_session_ids, null) is not null then raise exception 'VALIDATION'; end if;
  if exists (
    select 1 from unnest(p_session_ids) requested(id)
    where not exists (
      select 1 from public.class_sessions s join public.classrooms c on c.id = s.classroom_id
      where s.id = requested.id and s.deleted_at is null and s.voided_at is null and s.cancelled_by is null
        and c.purpose = 'production' and c.archived_at is null and c.trashed_at is null
        and (team or s.teacher_override = uid or exists (
          select 1 from public.classroom_staff_assignments a where a.classroom_id = s.classroom_id and a.user_id = uid
            and (a.responsibility = 'assistant_teacher' or (a.responsibility = 'primary_teacher' and s.teacher_override is null))
        ))
    )
  ) then raise exception 'FORBIDDEN'; end if;
  contacts := public.has_perm(uid, 'followup.view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', s.id,
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'status', t.status) order by t.kind)
      from public.session_completion_tasks t where t.session_id = s.id and t.kind in ('reviews', 'assignment')), '[]'::jsonb),
    'taskTiming', coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'dueAt', t.due_at, 'completedAt', t.completed_at) order by t.kind)
      from public.session_completion_tasks t where t.session_id = s.id and t.kind in ('reviews', 'summary', 'assignment', 'followup')), '[]'::jsonb),
    'learningStatuses', coalesce((select jsonb_agg(coalesce(h.status, 'missing') order by roster.student_id, h.id)
      from unnest(public.session_communication_student_ids(s.id)) as roster(student_id)
      left join public.learning_result_heads h on h.session_id = s.id and h.student_id = roster.student_id and h.kind = 'session_review'), '[]'::jsonb),
    'learningResults', coalesce((select jsonb_agg(jsonb_build_object(
        'status', coalesce(h.status, 'missing'),
        'requiresReview', coalesce(h.requires_review, false),
        'reviewedAt', h.reviewed_at,
        'completedAt', case when h.status in ('review', 'published') then coalesce(
          (select max(e.created_at) from public.learning_result_events e where e.head_id = h.id
            and e.revision_id = case when h.status = 'published' then h.published_revision_id else h.current_revision_id end
            and e.to_status = 'review'),
          case when not h.requires_review then h.published_at end
        ) end
      ) order by roster.student_id, h.id)
      from unnest(public.session_communication_student_ids(s.id)) as roster(student_id)
      left join public.learning_result_heads h on h.session_id = s.id and h.student_id = roster.student_id and h.kind = 'session_review'), '[]'::jsonb),
    'classFeedback', case when contacts then coalesce((select g.communication_outcome from public.session_class_communications g
      where g.session_id = s.id and g.communication_channel = 'class_group' order by g.created_at desc, g.id desc limit 1), 'missing') else 'unavailable' end,
    'classFeedbackCompletedAt', case when contacts then (select case when g.communication_outcome = 'contacted' then g.created_at end
      from public.session_class_communications g where g.session_id = s.id and g.communication_channel = 'class_group'
      order by g.created_at desc, g.id desc limit 1) end,
    'communication', case when not contacts then 'unavailable'
      when contact_progress.total > 0 and contact_progress.complete then 'done' else 'pending' end,
    'communicationCompletedAt', case when contacts and contact_progress.total > 0 and contact_progress.complete then contact_progress.completed_at end
  ) order by s.id), '[]'::jsonb) into result
  from public.class_sessions s
  left join lateral (
    select count(*) as total,
      bool_and(coalesce(latest.communication_outcome in ('contacted', 'not_needed'), false)) as complete,
      max(latest.created_at) as completed_at
    from unnest(public.session_communication_student_ids(s.id)) as roster(student_id)
    left join lateral (
      select f.communication_outcome, f.created_at from public.student_follow_ups f
      where f.session_id = s.id and f.student_id = roster.student_id and f.communication_channel <> 'class_group'
      order by f.created_at desc, f.id desc limit 1
    ) latest on true
  ) contact_progress on contacts
  where s.id = any(p_session_ids);
  return result;
end;
$$;

revoke all on function public.get_teaching_progress_facts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_teaching_progress_facts(uuid[]) to authenticated;
comment on function public.get_teaching_progress_facts(uuid[]) is
  '班级教学进度只读汇总：实际任课与管理范围内的状态和时刻；按当前成果版本取提交事件，不返回学生身份、正文或文件地址。';
