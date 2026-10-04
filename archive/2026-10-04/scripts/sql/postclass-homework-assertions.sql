-- 事务夹具覆盖班级模板、教研讲次绑定、课后主题修订和逐生调整。
do $$
declare cid uuid; course_id_value uuid:=gen_random_uuid(); lecture_id_value uuid:=gen_random_uuid();
begin
  select classroom_id into cid from public.class_sessions where id=current_setting('teaching.test.session')::uuid;
  insert into public.classroom_members(classroom_id,user_id,role) values(cid,current_setting('teaching.test.teacher')::uuid,'teacher') on conflict do nothing;
  insert into public.courses(id,title,grade,term) values(course_id_value,'Homework assertion course',3,1);
  insert into public.course_lectures(id,course_id,no,name) values(lecture_id_value,course_id_value,1,'Homework assertion lecture');
  update public.class_sessions set lecture_id=lecture_id_value where id=current_setting('teaching.test.session')::uuid;
  perform set_config('homework.test.class',cid::text,true);
  perform set_config('homework.test.lecture',lecture_id_value::text,true);
end $$;
set local role authenticated;
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; cid uuid:=current_setting('homework.test.class')::uuid; lid uuid:=current_setting('homework.test.lecture')::uuid;
  state jsonb; doc jsonb; saved jsonb; source_id uuid:=gen_random_uuid(); aid uuid; qid uuid; student_id_value uuid; result_before jsonb;
begin
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
  state:=public.get_homework_document('classroom',cid);
  doc:=(state->'document')||jsonb_build_object('questions',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'label','1','group','基础','content','','answer','','sourceQuestionId',null),
    jsonb_build_object('id',gen_random_uuid(),'label','1','group','提高','content','','answer','','sourceQuestionId',null)));
  perform public.save_homework_document('classroom',cid,state->>'revision',doc);
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.admin'),true);
  state:=public.get_homework_document('lecture',lid);
  doc:=(state->'document')||jsonb_build_object('topic','图形复习','lessonPlan','教学目标与课堂安排','questions',jsonb_build_array(
    jsonb_build_object('id',source_id,'label','1','group','基础','content','画出一个正方形','answer','四边相等且四角为直角','sourceQuestionId',null)));
  perform public.save_homework_document('lecture',lid,state->>'revision',doc);
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.teacher'),true);
  aid:=public.publish_session_template_assignment(sid,'本周练习','完成练习后复盘',null);
  state:=public.get_homework_document('assignment',aid);
  if jsonb_array_length(state#>'{document,questions}')<>2 or state#>>'{document,questions,0,content}'<>'画出一个正方形' or state#>>'{document,questions,1,content}'<>'' then raise exception 'BINDING_MISMATCH'; end if;
  if public.get_assignment_question_workbook(aid)#>>'{questions,0,title}'<>'基础 · 1' or public.get_assignment_question_workbook(aid)#>>'{questions,1,title}'<>'提高 · 1' then raise exception 'GROUP_LABEL_MISSING'; end if;
  qid:=(state#>>'{document,questions,0,id}')::uuid;
  student_id_value:=(state#>>'{students,0,id}')::uuid;
  result_before:=public.save_assignment_question_results(aid,jsonb_build_array(jsonb_build_object('questionId',qid,'studentId',student_id_value,'status','independent','note','','expectedVersion',0)));
  doc:=(state->'document')||jsonb_build_object('topic','更正后的主题','overrides',jsonb_build_array(jsonb_build_object('studentId',student_id_value,'questionId',qid,'content','为这位学生补充的练习')));
  saved:=public.save_homework_document('assignment',aid,state->>'revision',doc);
  if saved#>>'{document,topic}'<>'更正后的主题' or saved#>>'{document,overrides,0,content}'<>'为这位学生补充的练习' then raise exception 'CUSTOMIZATION_LOST'; end if;
  if not exists(select 1 from public.assignment_question_results where question_id=qid and student_id=student_id_value and version=1 and status='independent') then raise exception 'RESULTS_CHANGED'; end if;
  begin perform public.save_homework_document('assignment',aid,state->>'revision',doc); raise exception 'STALE_WRITE_ALLOWED';
    exception when others then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.save_homework_document('assignment',aid,saved->>'revision',doc||jsonb_build_object('questions','[]'::jsonb,'overrides','[]'::jsonb)); raise exception 'QUESTION_HISTORY_REMOVED';
    exception when others then if sqlerrm<>'QUESTION_IN_USE' then raise; end if; end;
  begin perform public.save_homework_document('assignment',aid,saved->>'revision',doc||jsonb_build_object('overrides',jsonb_build_array(jsonb_build_object('studentId',gen_random_uuid(),'questionId',qid,'content','foreign student')))); raise exception 'FOREIGN_OVERRIDE_ALLOWED';
    exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.admin'),true);
  state:=public.get_homework_document('lecture',lid);
  perform public.save_homework_document('lecture',lid,state->>'revision',(state->'document')||jsonb_build_object('questions','[]'::jsonb));
  state:=public.get_homework_document('assignment',aid);
  if state#>>'{document,questions,0,content}'<>'画出一个正方形' then raise exception 'TEMPLATE_CHANGED_ASSIGNED_SNAPSHOT'; end if;
  if (select count(*) from public.homework_document_revisions where document_id in (select id from public.homework_documents where assignment_id=aid))<>2 then raise exception 'AUDIT_MISSING'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.outsider'),true);
  begin perform public.get_homework_document('assignment',aid); raise exception 'OUTSIDER_READ_ALLOWED';
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if exists(select 1 from public.homework_documents) or exists(select 1 from public.homework_document_revisions) then raise exception 'RLS_LEAK'; end if;
end $$;
reset role;
