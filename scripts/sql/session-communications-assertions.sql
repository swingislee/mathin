-- 外层事务复用固定身份并回滚全部样例。
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; cid uuid; new_student_id uuid:=gen_random_uuid();
begin
  select classroom_id into cid from public.class_sessions where id=sid;
  insert into public.students(id,name,bind_code,assigned_to) values(new_student_id,'Second communication student',gen_random_uuid()::text,current_setting('teaching.test.teacher')::uuid);
  insert into public.enrollments(classroom_id,student_id,status,joined_at) values(cid,new_student_id,'active',now());
  perform set_config('teaching.test.second_student',new_student_id::text,true);
  perform set_config('teaching.test.first_student',(select student_id::text from public.enrollments where classroom_id=cid and student_id<>new_student_id limit 1),true);
end;
$$;
set local role authenticated;
do $$
declare sid uuid:=current_setting('teaching.test.session')::uuid; uid uuid:=current_setting('teaching.test.teacher')::uuid;
  first_student uuid:=current_setting('teaching.test.first_student')::uuid;
  second_student uuid:=current_setting('teaching.test.second_student')::uuid;
  entry_id uuid:=gen_random_uuid(); group_id uuid:=gen_random_uuid(); result jsonb; other_student uuid;
begin
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','aal','aal2')::text,true);
  result:=public.get_session_communications(sid);
  if not (result->>'canWrite')::boolean or jsonb_array_length(result->'records')<>0 then raise exception 'SESSION_READ_OR_BACKGROUND_LEAK'; end if;
  result:=public.record_session_communication(entry_id,sid,first_student,'2040-01-10','phone','contacted','Parent feedback','',null);
  if jsonb_array_length(result->'records')<>1 or result #>> '{records,0,studentId}'<>first_student::text or (result->>'completed')::boolean then raise exception 'INDIVIDUAL_RECORD_MISMATCH'; end if;
  result:=public.record_session_communication(entry_id,sid,first_student,'2040-01-10','phone','contacted','Parent feedback','',null);
  if jsonb_array_length(result->'records')<>1 then raise exception 'RETRY_DUPLICATED'; end if;
  if not exists(select 1 from public.student_follow_ups where id=entry_id and session_id=sid and content='Parent feedback') then raise exception 'STUDENT_HISTORY_MISSING'; end if;
  begin
    perform public.record_session_communication(entry_id,sid,first_student,'2040-01-10','phone','contacted','Changed feedback','',null);
    raise exception 'CONFLICT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'SUBMISSION_CONFLICT' then raise; end if; end;
  begin perform public.finish_session_communications(sid); raise exception 'PARTIAL_COMPLETED';
  exception when raise_exception then if sqlerrm<>'COMMUNICATIONS_PENDING' then raise; end if; end;
  begin perform public.complete_session_task((select id from public.session_completion_tasks where session_id=sid and kind='followup'),'done',''); raise exception 'GENERIC_COMPLETION_BYPASS';
  exception when raise_exception then if sqlerrm<>'COMMUNICATIONS_PENDING' then raise; end if; end;
  result:=public.record_session_communication(gen_random_uuid(),sid,second_student,'2040-01-10','wechat','follow_up','Review homework','Call parent','2040-01-11');
  if result #>> '{records,0,nextFollowUpOn}'<>'2040-01-11' then raise exception 'FOLLOWUP_DATE_CHANGED'; end if;
  begin perform public.finish_session_communications(sid); raise exception 'OPEN_FOLLOWUP_COMPLETED';
  exception when raise_exception then if sqlerrm<>'COMMUNICATIONS_PENDING' then raise; end if; end;
  result:=public.record_session_communication(gen_random_uuid(),sid,second_student,'2040-01-09','wechat','not_needed','No individual follow-up needed','',null);
  result:=public.record_session_communication(group_id,sid,null,'2040-01-10','class_group','contacted','Whole class feedback','',null);
  if result #>> '{records,0,studentId}' is not null then raise exception 'GROUP_ASSIGNED_TO_STUDENT'; end if;
  result:=public.finish_session_communications(sid);
  if not (result->>'completed')::boolean then raise exception 'EXPLICIT_COMPLETION_FAILED'; end if;
  result:=public.record_session_communication(gen_random_uuid(),sid,null,'2040-01-11','class_group','follow_up','Group question','Group reply','2040-01-12');
  begin perform public.finish_session_communications(sid); raise exception 'GROUP_FOLLOWUP_COMPLETED';
  exception when raise_exception then if sqlerrm<>'COMMUNICATIONS_PENDING' then raise; end if; end;
  result:=public.record_session_communication(gen_random_uuid(),sid,first_student,'2040-01-11','phone','follow_up','New parent question','Reply','2040-01-12');
  if (result->>'completed')::boolean then raise exception 'NEW_FOLLOWUP_NOT_REOPENED'; end if;
  begin perform public.record_session_communication(gen_random_uuid(),sid,first_student,'2040-01-11','phone','follow_up','Missing action','',null); raise exception 'INVALID_FOLLOWUP_ALLOWED';
  exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  foreach other_student in array array[second_student,first_student] loop
    begin perform public.record_session_communication(gen_random_uuid(),current_setting('teaching.test.other')::uuid,other_student,'2040-01-10','phone','contacted','Outside class','',null); raise exception 'OTHER_CLASS_WRITE_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  end loop;
  begin perform public.record_session_communication(gen_random_uuid(),sid,gen_random_uuid(),'2040-01-10','phone','contacted','Outside roster','',null); raise exception 'OTHER_STUDENT_WRITE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.record_session_communication(gen_random_uuid(),current_setting('teaching.test.override')::uuid,first_student,'2040-01-10','phone','contacted','Substitute lesson','',null); raise exception 'OVERRIDE_WRITE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin insert into public.session_class_communications(id,session_id,author_id,content,occurred_on,communication_channel,communication_outcome)
    values(gen_random_uuid(),sid,uid,'Direct write','2040-01-10','wechat','contacted'); raise exception 'DIRECT_GROUP_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin insert into public.student_follow_ups(student_id,author_id,content,session_id) values(first_student,uid,'Forged context',sid); raise exception 'DIRECT_CONTEXT_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.outsider'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('teaching.test.outsider'),'role','authenticated')::text,true);
  if exists(select 1 from public.session_class_communications where session_id=sid) then raise exception 'RLS_LEAK'; end if;
  begin perform public.get_session_communications(sid); raise exception 'OUTSIDER_READ_ALLOWED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.finish_session_communications(sid); raise exception 'OUTSIDER_FINISH_ALLOWED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',current_setting('teaching.test.admin'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('teaching.test.admin'),'role','authenticated','aal','aal2')::text,true);
  result:=public.get_session_communications(sid);
  if jsonb_array_length(result->'records')<>6 then raise exception 'ADMIN_READ_MISMATCH'; end if;
end;
$$;
reset role;
