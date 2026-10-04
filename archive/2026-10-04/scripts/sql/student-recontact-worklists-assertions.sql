savepoint recontact_contract;
do $test$
declare actor uuid; teacher uuid; outsider uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); list_id uuid:=gen_random_uuid(); assigned_list uuid:=gen_random_uuid();
  marker text:='recontact-contract-'||gen_random_uuid(); work_date date:=(now() at time zone 'Asia/Shanghai')::date+2;
  result jsonb; subjects jsonb; selected uuid; returned uuid; err text; before_contacts bigint; before_tasks bigint;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into teacher from auth.users where email='test-teacher@mathin.local';
  select id into outsider from auth.users where email='test-student@mathin.local';
  if actor is null or teacher is null or outsider is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(a,marker||' A',marker||' A','600000008871','600000008871','uncontacted',actor,actor),
      (b,marker||' B',marker||' B','600000008871','600000008871','uncontacted',actor,actor),
      (c,marker||' C',marker||' C','600000008872','600000008872','nurture',actor,actor);
  insert into public.lead_communications(lead_id,outcome,note,recorded_by,occurred_at)
    values(a,'unreachable','Earlier attempt A',actor,now()-interval '35 days'),(b,'unreachable','Earlier attempt B',actor,now()-interval '36 days'),
      (c,'declined','do not contact',actor,now()-interval '35 days');
  insert into public.history_workflow_scopes(lead_id,reason,current_period,latest_period,source_ids,source_filename,source_sha256)
    select id,'processed_prior_period','2026-09','2026-08','{}','contract',repeat('b',64) from unnest(array[a,b,c]) id;
  select count(*) into before_contacts from public.lead_communications;
  select count(*) into before_tasks from public.lead_next_actions;
  result:=public.list_student_recontact_summaries('all',marker,'unreachable');
  if jsonb_array_length(result->'rows')<>1 or (result->'rows'->0->>'sharedPhoneCount')::integer<>2 then raise exception 'CONTACT_ROUND_DEDUP_FAILED'; end if;
  if jsonb_array_length(public.list_student_recontact_summaries('all',marker,'dormant')->'rows')<>0 then raise exception 'DNC_SUGGESTION_INCLUDED'; end if;
  selected:=(result->'rows'->0->>'leadId')::uuid;
  subjects:=jsonb_build_array(jsonb_build_object('studentId',null,'leadId',selected,'expectedOwnerId',actor));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  if jsonb_array_length(public.list_student_recontact_summaries('all',marker,'unreachable')->'rows')<>0 then raise exception 'OTHER_OWNER_CONTACTS_EXPOSED'; end if;
  begin perform public.plan_student_recontact_worklist(gen_random_uuid(),'Wrong owner',work_date,teacher,subjects); raise exception 'OTHER_OWNER_PLAN_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  begin perform public.plan_student_recontact_worklist(gen_random_uuid(),'Stale owner',work_date,actor,
    jsonb_build_array(jsonb_build_object('studentId',null,'leadId',selected,'expectedOwnerId',teacher))); raise exception 'STALE_OWNER_PLAN_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'ASSIGNMENT_CONFLICT' then raise; end if; end;
  returned:=public.plan_student_recontact_worklist(list_id,'Contract contact purpose',work_date,actor,subjects);
  if returned<>list_id then raise exception 'WORKLIST_ID_CHANGED'; end if;
  perform public.plan_student_recontact_worklist(list_id,'Contract contact purpose',work_date,actor,subjects);
  if (select count(*) from public.communication_worklist_items where worklist_id=list_id)<>1 then raise exception 'REPLAY_DUPLICATED_WORK'; end if;
  if (select count(*) from public.lead_communications)<>before_contacts or (select count(*) from public.lead_next_actions)<>before_tasks then raise exception 'PLAN_CREATED_CONTACT_OR_REMINDER'; end if;
  if (select count(*) from public.leads where id in (a,b))<>2 then raise exception 'SHARED_PHONE_MERGED_IDENTITIES'; end if;
  if public.business_subject_is_current(null,selected) then raise exception 'PLAN_REWROTE_IMPORT_SCOPE'; end if;
  result:=public.list_student_record_summaries('awaiting_first_contact','all',selected::text,'work');
  if jsonb_array_length(result->'rows')<>1 then raise exception 'PLAN_NOT_IN_WORK_ROSTER'; end if;
  if exists(select 1 from jsonb_array_elements(public.get_scheduled_communication_tasks(work_date-2)) t where t->>'key'='lead:'||selected) then raise exception 'FUTURE_PLAN_IN_TODAY'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_scheduled_communication_tasks(work_date)) t where t->>'key'='lead:'||selected) then raise exception 'PLAN_MISSING_ON_DATE'; end if;
  begin perform public.plan_student_recontact_worklist(gen_random_uuid(),'Duplicate round',work_date,actor,subjects); raise exception 'DUPLICATE_PHONE_WORK_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'RECONTACT_CHANGED' then raise; end if; end;
  perform public.complete_communication_worklist_item(list_id,'lead:'||selected,true);
  if exists(select 1 from jsonb_array_elements(public.get_scheduled_communication_tasks(work_date+1)) t where t->>'key'='lead:'||selected) then raise exception 'COMPLETED_WORK_RETURNED'; end if;
  perform public.plan_student_recontact_worklist(assigned_list,'Assigned round',work_date,teacher,subjects);
  if (select owner_id from public.leads where id=selected)<>teacher or (select count(*) from public.lead_communications)<>before_contacts then raise exception 'ASSIGNMENT_CHANGED_CONTACT_FACTS'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  if jsonb_array_length(public.get_communication_worklist(assigned_list)->'items')<>1 then raise exception 'ASSIGNEE_CANNOT_CONTINUE'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_scheduled_communication_tasks(work_date)) t where t->>'key'='lead:'||selected) then raise exception 'ASSIGNEE_PLAN_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.list_student_recontact_summaries('all',marker,'unreachable'); raise exception 'NONSTAFF_SUGGESTIONS_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.plan_student_recontact_worklist(gen_random_uuid(),'Forbidden',work_date,outsider,subjects); raise exception 'NONSTAFF_PLAN_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  if has_function_privilege('anon','public.plan_student_recontact_worklist(uuid,text,date,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.student_recontact_candidates(text,text,public.business_course_enrollment_subjects[])','EXECUTE') then raise exception 'PRIVATE_CANDIDATES_EXPOSED'; end if;
end;
$test$;
rollback to savepoint recontact_contract;
