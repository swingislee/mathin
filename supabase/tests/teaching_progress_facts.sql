-- 在已核对的本机事务内运行；调用者负责 begin / rollback，夹具均为本事务新建。
do $$
declare
  manager uuid; teacher uuid; outsider uuid; term uuid;
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  student1 uuid := gen_random_uuid(); student2 uuid := gen_random_uuid();
  learning_head uuid; prior_revision uuid := gen_random_uuid(); current_revision uuid := gen_random_uuid();
  facts jsonb; rejected boolean; item uuid;
begin
  select id into manager from public.profiles where is_active and not password_change_required and public.is_staff(id) and public.has_perm(id,'class.view.all') order by id limit 1;
  select id into teacher from public.profiles where is_active and not password_change_required and public.is_staff(id) and public.has_perm(id,'class.view.mine')
    and public.has_perm(id,'followup.view') and not public.has_perm(id,'class.view.all') order by id limit 1;
  select id into outsider from public.profiles where is_active and not public.is_staff(id) order by id limit 1;
  select id into term from public.school_terms order by is_current desc,id limit 1;
  if manager is null or teacher is null or outsider is null or term is null then raise exception 'PROGRESS_FIXED_IDENTITIES_REQUIRED'; end if;
  if has_function_privilege('anon','public.get_teaching_progress_facts(uuid[])','execute') then raise exception 'PROGRESS_ANON_EXECUTE'; end if;
  if not has_column_privilege('authenticated','public.classrooms','term_id','select') then raise exception 'PROGRESS_TERM_READ_MISSING'; end if;
  if has_column_privilege('anon','public.classrooms','term_id','select') then raise exception 'PROGRESS_ANON_TERM_READ'; end if;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  insert into public.classrooms(id,owner_id,name,invite_code,term_id,purpose) values
    (c1,manager,'Progress assertion A',c1::text,term,'production'),(c2,manager,'Progress assertion B',c2::text,term,'production');
  insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values(c1,teacher,'primary_teacher');
  insert into public.class_sessions(id,classroom_id,title,teacher_override) values
    (s1,c1,'Progress assertion A',null),(s2,c2,'Progress assertion B',null),(s3,c2,'Progress substitute',teacher);
  insert into public.session_completion_tasks(session_id,kind,status,due_at,completed_at) values
    (s3,'reviews','done',now()+interval '1 day',now()),(s3,'assignment','done',now()-interval '1 hour',now()),(s3,'followup','done',now()+interval '1 day',now());
  perform set_config('request.jwt.claim.sub',teacher::text,true);
  if auth.uid() is distinct from teacher then raise exception 'PROGRESS_CLAIM_MISMATCH'; end if;
  if not public.is_staff(teacher) then raise exception 'PROGRESS_STAFF_LOST'; end if;
  if not public.has_perm(teacher,'class.view.mine') then raise exception 'PROGRESS_SCOPE_LOST'; end if;
  facts := public.get_teaching_progress_facts(array[s1,s3]);
  if jsonb_array_length(facts) <> 2 then raise exception 'PROGRESS_TEACHER_OR_SUBSTITUTE_MISSING'; end if;
  facts := public.get_teaching_progress_facts(array[s3])->0;
  if facts->>'communication' <> 'pending' then raise exception 'PROGRESS_EMPTY_ROSTER_DONE'; end if;
  if not (facts->'tasks' @> '[{"kind":"assignment","status":"done"}]') then raise exception 'PROGRESS_SUBSTITUTE_TASK_HIDDEN'; end if;
  if jsonb_array_length(facts->'tasks') <> 2 or jsonb_array_length(facts->'taskTiming') <> 3 then raise exception 'PROGRESS_TIMING_BREAKS_LEGACY_TASKS'; end if;
  if (select (row->>'dueAt')::timestamptz from jsonb_array_elements(facts->'taskTiming') row where row->>'kind'='assignment') <> now()-interval '1 hour'
    or (select (row->>'completedAt')::timestamptz from jsonb_array_elements(facts->'taskTiming') row where row->>'kind'='assignment') <> now() then
    raise exception 'PROGRESS_TASK_TIMING_MISMATCH'; end if;
  if facts->>'communicationCompletedAt' is not null then raise exception 'PROGRESS_EMPTY_ROSTER_HAS_COMPLETION_TIME'; end if;
  rejected := false;
  begin perform public.get_teaching_progress_facts(array[s1,s2]); exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if; rejected := true; end;
  if not rejected then raise exception 'PROGRESS_MIXED_SCOPE_ALLOWED'; end if;
  update public.class_sessions set teacher_override=manager where id=s1;
  rejected := false;
  begin perform public.get_teaching_progress_facts(array[s1]); exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if; rejected := true; end;
  if not rejected then raise exception 'PROGRESS_REPLACED_TEACHER_ALLOWED'; end if;
  update public.classroom_staff_assignments set responsibility='assistant_teacher' where classroom_id=c1 and user_id=teacher;
  perform public.get_teaching_progress_facts(array[s1]);

  perform set_config('request.jwt.claim.sub',manager::text,true);
  insert into public.students(id,name,bind_code) values(student1,'Progress assertion student A',student1::text),(student2,'Progress assertion student B',student2::text);
  insert into public.session_roster_revisions(session_id,revision,source_hash,reason,created_by) values(s3,1,repeat('a',64),'start',manager);
  insert into public.session_roster_entries(session_id,revision,student_id,name,roster_order) values
    (s3,1,student1,'Progress assertion student A',0),(s3,1,student2,'Progress assertion student B',1);
  update public.class_sessions set roster_revision=1,roster_source_hash=repeat('a',64),roster_frozen_at=now() where id=s3;
  insert into public.learning_result_heads(kind,source_key,student_id,term_id,session_id,status,requires_review)
    values('session_review',s3::text||':'||student1::text,student1,term,s3,'review',false) returning id into learning_head;
  insert into public.learning_result_revisions(id,head_id,revision_no,content) values
    (prior_revision,learning_head,1,'{}'),(current_revision,learning_head,2,'{}');
  update public.learning_result_heads set current_revision_id=current_revision where id=learning_head;
  insert into public.learning_result_events(head_id,revision_id,to_status,created_at) values
    (learning_head,prior_revision,'review',now()+interval '1 day'),
    (learning_head,current_revision,'review',now()-interval '1 hour');
  insert into public.session_class_communications(id,session_id,author_id,content,occurred_on,communication_channel,communication_outcome)
    values(gen_random_uuid(),s3,manager,'Progress assertion group',current_date,'class_group','contacted');
  perform set_config('request.jwt.claim.sub',teacher::text,true);
  facts := public.get_teaching_progress_facts(array[s3])->0;
  if facts->>'classFeedback' <> 'contacted' or facts->>'communication' <> 'pending'
    or jsonb_array_length(facts->'learningStatuses') <> 2 or not (facts->'learningStatuses' @> '["review","missing"]') then
    raise exception 'PROGRESS_FACT_SOURCES_CONFLATED'; end if;
  if jsonb_array_length(facts->'learningResults') <> 2 or not exists (
    select 1 from jsonb_array_elements(facts->'learningResults') row
    where row->>'status'='review' and (row->>'completedAt')::timestamptz=now()-interval '1 hour' and not (row->>'requiresReview')::boolean
  ) then raise exception 'PROGRESS_CURRENT_REVISION_SUBMISSION_TIME'; end if;
  if facts->>'classFeedbackCompletedAt' is null then raise exception 'PROGRESS_GROUP_COMPLETION_TIME_MISSING'; end if;
  update public.learning_result_heads set status='published',published_revision_id=current_revision,published_at=now(),reviewed_at=now() where session_id=s3;
  facts := public.get_teaching_progress_facts(array[s3])->0;
  if not (facts->'learningStatuses' @> '["published","missing"]') then raise exception 'PROGRESS_PARTIAL_LEARNING_DONE'; end if;
  if not exists (select 1 from jsonb_array_elements(facts->'learningResults') row where row->>'status'='published'
    and (row->>'completedAt')::timestamptz=now()-interval '1 hour' and (row->>'reviewedAt')::timestamptz=now()) then
    raise exception 'PROGRESS_APPROVAL_OVERWROTE_COMPLETION_TIME'; end if;
  insert into public.learning_result_heads(kind,source_key,student_id,term_id,session_id,status,requires_review,published_at)
    values('session_review',s3::text||':'||student2::text,student2,term,s3,'published',false,now());
  if public.get_teaching_progress_facts(array[s3])->0->'learningStatuses' <> '["published","published"]' then raise exception 'PROGRESS_COMPLETE_LEARNING_MISSING'; end if;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  insert into public.student_follow_ups(student_id,author_id,content,kind,session_id,occurred_on,communication_channel,communication_outcome,next_action,created_at) values
    (student1,manager,'Progress assertion individual','class',s3,current_date,'phone','contacted','',now()),
    (student2,manager,'Progress assertion group-copy','class',s3,current_date,'class_group','contacted','',now());
  if public.get_teaching_progress_facts(array[s3])->0->>'communication' <> 'pending' then raise exception 'PROGRESS_GROUP_COUNTS_AS_INDIVIDUAL'; end if;
  insert into public.student_follow_ups(student_id,author_id,content,kind,session_id,occurred_on,communication_channel,communication_outcome,next_action,created_at) values
    (student2,manager,'Progress assertion individual','class',s3,current_date,'wechat','not_needed','',now()+interval '1 second');
  insert into public.session_class_communications(id,session_id,author_id,content,occurred_on,communication_channel,communication_outcome,next_action,next_follow_up_at,created_at)
    values(gen_random_uuid(),s3,manager,'Progress assertion unresolved group',current_date,'class_group','follow_up','Next',now()+interval '1 day',now()+interval '2 seconds');
  facts := public.get_teaching_progress_facts(array[s3])->0;
  if facts->>'communication' <> 'done' or facts->>'classFeedback' <> 'follow_up' then raise exception 'PROGRESS_GROUP_RESETS_INDIVIDUAL'; end if;
  if (facts->>'communicationCompletedAt')::timestamptz <> now()+interval '1 second' or facts->>'classFeedbackCompletedAt' is not null then
    raise exception 'PROGRESS_CONTACT_TIMING_CONFLATED'; end if;
  insert into public.student_follow_ups(student_id,author_id,content,kind,session_id,occurred_on,communication_channel,communication_outcome,next_action,next_follow_up_at,created_at) values
    (student1,manager,'Progress assertion follow-up','class',s3,current_date,'phone','follow_up','Next',now()+interval '1 day',now()+interval '3 seconds');
  if public.get_teaching_progress_facts(array[s3])->0->>'communication' <> 'pending' then raise exception 'PROGRESS_LATEST_INDIVIDUAL_IGNORED'; end if;
  if public.get_teaching_progress_facts(array[s3])->0->>'communicationCompletedAt' is not null then raise exception 'PROGRESS_PENDING_CONTACT_HAS_COMPLETION_TIME'; end if;
  if facts::text like '%Progress assertion%' or facts::text like '%'||student1::text||'%' or facts::text like '%'||student2::text||'%'
    or facts ? 'studentId' then raise exception 'PROGRESS_PRIVATE_BODY_RETURNED'; end if;

  update public.class_sessions set cancelled_by=manager,cancel_reason='Progress assertion' where id=s2;
  update public.classrooms set archived_at=now() where id=c1;
  foreach item in array array[s1,s2,gen_random_uuid()] loop
    rejected := false;
    begin perform public.get_teaching_progress_facts(array[item]); exception when others then
      if sqlerrm <> 'FORBIDDEN' then raise; end if; rejected := true; end;
    if not rejected then raise exception 'PROGRESS_INACTIVE_OR_MISSING_ALLOWED'; end if;
  end loop;
  rejected := false;
  begin perform public.get_teaching_progress_facts(array_fill(s3,array[101])); exception when others then
    if sqlerrm <> 'VALIDATION' then raise; end if; rejected := true; end;
  if not rejected then raise exception 'PROGRESS_OVERSIZED_BATCH_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  rejected := false;
  begin perform public.get_teaching_progress_facts(array[s3]); exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if; rejected := true; end;
  if not rejected then raise exception 'PROGRESS_NONSTAFF_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  rejected := false;
  begin perform public.get_teaching_progress_facts(array[s3]); exception when others then
    if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; rejected := true; end;
  if not rejected then raise exception 'PROGRESS_UNAUTHENTICATED_ALLOWED'; end if;
end;
$$;
