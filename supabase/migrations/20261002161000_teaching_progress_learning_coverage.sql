-- 只返回进度，不返回学生身份或沟通正文；避免将表级 RLS 隐藏误认为未完成。
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
    'learningStatuses', coalesce((select jsonb_agg(coalesce(h.status, 'missing') order by roster.student_id, h.id)
      from unnest(public.session_communication_student_ids(s.id)) as roster(student_id)
      left join public.learning_result_heads h on h.session_id = s.id and h.student_id = roster.student_id and h.kind = 'session_review'), '[]'::jsonb),
    'classFeedback', case when contacts then coalesce((select g.communication_outcome from public.session_class_communications g
      where g.session_id = s.id and g.communication_channel = 'class_group' order by g.created_at desc, g.id desc limit 1), 'missing') else 'unavailable' end,
    'communication', case when not contacts then 'unavailable'
      when cardinality(public.session_communication_student_ids(s.id)) > 0 and not exists (
        select 1 from unnest(public.session_communication_student_ids(s.id)) as roster(student_id)
        where coalesce((select f.communication_outcome from public.student_follow_ups f
          where f.session_id = s.id and f.student_id = roster.student_id
            and f.communication_channel <> 'class_group'
          order by f.created_at desc, f.id desc limit 1), 'pending') not in ('contacted', 'not_needed')
      ) then 'done' else 'pending' end
  ) order by s.id), '[]'::jsonb) into result
  from public.class_sessions s where s.id = any(p_session_ids);
  return result;
end;
$$;

revoke all on function public.get_teaching_progress_facts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_teaching_progress_facts(uuid[]) to authenticated;
comment on function public.get_teaching_progress_facts(uuid[]) is
  '班级教学进度只读汇总：管理范围或实际任课课次；班群反馈与逐生沟通分别聚合，不返回身份、正文或文件地址。';
