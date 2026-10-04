-- 在保存点内验证隔离资料可查、办理不需要恢复、原始事实保持以及角色范围。
savepoint unified_records_contract;
do $test$
declare actor uuid; teacher uuid; outsider uuid; subject uuid:=gen_random_uuid(); result jsonb; page jsonb;
  err text; request uuid:=gen_random_uuid(); payload jsonb; before_tasks bigint; visible_count integer;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into teacher from auth.users where email='test-teacher@mathin.local';
  select id into outsider from auth.users where email='test-student@mathin.local';
  if actor is null or teacher is null or outsider is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(subject,'record-contract-'||subject,'record-contract-'||subject,'600000008855','600000008855','uncontacted',actor,actor);
  insert into public.lead_communications(lead_id,outcome,note,recorded_by,occurred_at)
    values(subject,'unreachable','Earlier call, no answer',actor,now()-interval '35 days');
  insert into public.history_workflow_scopes(lead_id,reason,current_period,latest_period,source_ids,source_filename,source_sha256)
    values(subject,'processed_prior_period','2026-09','2026-08','{}','contract',repeat('a',64));
  select count(*) into before_tasks from public.lead_next_actions;
  page:=public.list_student_record_workspace('awaiting_first_contact','all',subject::text,1,20,'','work');
  if (page->>'count')::integer<>0 then raise exception 'IMPORT_ADDED_TO_CURRENT_WORK'; end if;
  page:=public.list_student_record_workspace('awaiting_first_contact','all',subject::text,1,20,'','records');
  if (page->>'count')::integer<>1 or page->'rows'->0->>'note'<>'Earlier call, no answer'
    or page->'rows'->0->>'detail'<>'unreachable' then raise exception 'OLDER_CUSTOMER_NOT_SEARCHABLE'; end if;
  if (select count(*) from public.lead_next_actions)<>before_tasks then raise exception 'READ_CREATED_TASK'; end if;
  payload:=jsonb_build_object('studentId',null,'leadId',subject,'mode','contact','outcome','unreachable','note','This round actual call');
  result:=public.save_student_record_entry(request,payload);
  if result->'subject'->>'note'<>'This round actual call' then raise exception 'SAVE_REQUIRED_HISTORY_RESTORE'; end if;
  perform public.save_student_record_entry(request,payload);
  if (select count(*) from public.lead_communications where lead_id=subject)<>2 then raise exception 'RETRY_DUPLICATED_CONTACT'; end if;
  if not exists(select 1 from public.lead_communications where lead_id=subject and note='Earlier call, no answer') then raise exception 'OLDER_FACT_REWRITTEN'; end if;
  if (select count(*) from public.lead_next_actions)<>before_tasks then raise exception 'CALL_CREATED_UNREQUESTED_TASK'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  page:=public.list_student_record_workspace('awaiting_first_contact','all',subject::text,1,20,'','records');
  if (page->>'count')::integer<>0 then raise exception 'DIRECTORY_LEAKED_OTHER_OWNER'; end if;
  begin perform public.read_student_record_subject(null,subject); raise exception 'DETAIL_LEAKED_OTHER_OWNER';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.list_student_record_workspace('awaiting_first_contact','all','',1,20,'','records'); raise exception 'NONSTAFF_DIRECTORY_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  if has_function_privilege('anon','public.list_student_record_workspace(text,text,text,integer,integer,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])','EXECUTE')
    then raise exception 'INTERNAL_FACTS_EXPOSED'; end if;
end;
$test$;
rollback to savepoint unified_records_contract;
