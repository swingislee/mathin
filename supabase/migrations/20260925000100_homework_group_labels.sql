-- 所有作业汇总与登记共用题组名称，保留原题目 ID、题号和逐生结果。
create or replace function public.get_assignment_question_workbook(p_assignment_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_read_assignment_questions(p_assignment_id,uid) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('assignment',jsonb_build_object('id',a.id,'title',a.title,'classroomName',c.name,'sessionId',a.session_id),
    'canWrite',public.can_write_assignment_questions(a.id,uid),
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'title',concat_ws(' · ',nullif(detail.item->>'group',''),q.title),'position',q.position) order by q.position)
      from public.assignment_questions q left join public.homework_documents d on d.assignment_id=q.assignment_id
      left join lateral (select e as item from jsonb_array_elements(coalesce(d.document->'questions','[]')) e where e->>'id'=q.id::text) detail on true
      where q.assignment_id=a.id),'[]'),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',r.student_id,'name',r.name) order by r.roster_order,r.student_id) from public.assignment_question_roster(a.id) r),'[]'),
    'results',coalesce((select jsonb_agg(jsonb_build_object('questionId',r.question_id,'studentId',r.student_id,'status',r.status,'note',r.note,'version',r.version,'markedAt',r.marked_at,'author',p.display_name))
      from public.assignment_question_results r join public.assignment_questions q on q.id=r.question_id
      join public.assignment_question_roster(a.id) roster on roster.student_id=r.student_id
      left join public.profiles p on p.id=r.marked_by where q.assignment_id=a.id),'[]')) into result
    from public.assignments a join public.classrooms c on c.id=a.classroom_id where a.id=p_assignment_id;
  return result;
end $$;
revoke all on function public.get_assignment_question_workbook(uuid) from public,anon,authenticated;
grant execute on function public.get_assignment_question_workbook(uuid) to authenticated;
