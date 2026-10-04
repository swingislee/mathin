-- 复用既有教学回滚样例与固定身份；不创建账号。
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; aid uuid:=gen_random_uuid(); other_aid uuid:=gen_random_uuid();
begin
  insert into public.assignments(id,classroom_id,session_id,title,created_by)
    select aid,classroom_id,id,'Question registration assertion',current_setting('teaching.test.teacher')::uuid from public.class_sessions where id=sid;
  insert into public.assignments(id,classroom_id,session_id,title,created_by)
    select other_aid,classroom_id,id,'Unrelated assignment',current_setting('teaching.test.supervisor')::uuid from public.class_sessions where id=current_setting('teaching.test.other')::uuid;
  perform set_config('homework.test.assignment',aid::text,true);
  perform set_config('homework.test.other',other_aid::text,true);
  perform set_config('homework.test.student',(select student_id::text from public.assignment_question_roster(aid) limit 1),true);
end $$;

set local role authenticated;
do $$
declare aid uuid:=current_setting('homework.test.assignment')::uuid; sid uuid:=current_setting('homework.test.student')::uuid;
  qid uuid; q2 uuid; workbook jsonb; saved jsonb; changes jsonb; status_value text; v integer:=0; teacher text:=current_setting('teaching.test.teacher');
begin
  perform set_config('request.jwt.claim.sub',teacher,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated','aal','aal2')::text,true);
  workbook:=public.get_assignment_question_workbook(aid);
  if jsonb_array_length(workbook->'students')<>1 or not (workbook->>'canWrite')::boolean then raise exception 'OFFLINE_ROSTER_OR_WRITE_SCOPE: students=%, write=%, permission=%, legacyTeacher=%',jsonb_array_length(workbook->'students'),workbook->>'canWrite',public.has_perm(teacher::uuid,'review.write'),public.is_session_teacher(current_setting('teaching.test.session')::uuid,teacher::uuid); end if;
  workbook:=public.add_assignment_questions(aid,'["练习1","练习2"]');
  if jsonb_array_length(workbook->'questions')<>2 then raise exception 'QUESTIONS_NOT_ADDED'; end if;
  qid:=(workbook#>>'{questions,0,id}')::uuid;q2:=(workbook#>>'{questions,1,id}')::uuid;
  foreach status_value in array array['explained','independent','prompted','imitated','incomplete','unchecked'] loop
    changes:=jsonb_build_array(jsonb_build_object('questionId',qid,'studentId',sid,'status',status_value,'note','纸质作业备注','expectedVersion',v));
    saved:=public.save_assignment_question_results(aid,changes);v:=v+1;
    if saved#>>'{0,status}'<>status_value or (saved#>>'{0,version}')::int<>v then raise exception 'STATUS_VERSION_MISMATCH'; end if;
  end loop;
  if (select count(*) from public.assignment_question_revisions where question_id=qid)<>6 then raise exception 'HISTORY_MISSING'; end if;
  if (select before_value->>'status' from public.assignment_question_revisions where question_id=qid and version=6)<>'incomplete' then raise exception 'CLEAR_LOST_HISTORY'; end if;
  begin perform public.save_assignment_question_results(aid,changes);raise exception 'STALE_VERSION_ALLOWED';
    exception when raise_exception then if sqlerrm<>'CONFLICT' then raise;end if;end;
  begin
    perform public.save_assignment_question_results(aid,jsonb_build_array(
      jsonb_build_object('questionId',qid,'studentId',sid,'status','independent','note','','expectedVersion',v),
      jsonb_build_object('questionId',q2,'studentId',gen_random_uuid(),'status','independent','note','','expectedVersion',0)));
    raise exception 'OUTSIDE_ROSTER_ALLOWED';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  if (select version from public.assignment_question_results where question_id=qid and student_id=sid)<>6 then raise exception 'PARTIAL_BATCH_WRITE'; end if;
  begin perform public.add_assignment_questions(current_setting('homework.test.other')::uuid,'["越权"]');raise exception 'OTHER_CLASS_WRITE_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  begin perform public.get_assignment_question_workbook(current_setting('homework.test.other')::uuid);raise exception 'OTHER_CLASS_READ_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  if jsonb_array_length(public.get_session_assignment_question_workbooks(current_setting('teaching.test.session')::uuid))<>1 then raise exception 'SESSION_READ_MISSING'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.supervisor'),true);
  workbook:=public.get_assignment_question_workbook(aid);
  if jsonb_array_length(workbook->'results')<>1 or (workbook->>'canWrite')::boolean then raise exception 'MANAGER_READ_WRITE_NOT_SEPARATE'; end if;
  begin perform public.add_assignment_questions(aid,'["越权"]');raise exception 'READ_ONLY_MANAGER_WRITE_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.outsider'),true);
  if exists(select 1 from public.assignment_questions) or exists(select 1 from public.assignment_question_results) or exists(select 1 from public.assignment_question_revisions) then raise exception 'STUDENT_RLS_LEAK'; end if;
  begin perform public.get_assignment_question_workbook(aid);raise exception 'STUDENT_RPC_LEAK';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.get_assignment_question_workbook(aid);raise exception 'ANONYMOUS_RPC_LEAK';
    exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise;end if;end;
  if has_function_privilege('anon','public.get_assignment_question_workbook(uuid)','execute') or has_table_privilege('authenticated','public.assignment_question_results','insert') then raise exception 'DIRECT_WRITE_OR_ANON_GRANT'; end if;
end $$;
reset role;
