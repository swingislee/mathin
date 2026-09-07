-- 固定开发身份；所有业务夹具在保存点内回滚，应用迁移时也不会留下测试记录。
savepoint student_stage_contract;
create function pg_temp.assert_student_stage_index(p_student uuid,p_lead uuid) returns void
language plpgsql as $$
declare snapshot jsonb; indexed record; page jsonb;
begin
  snapshot:=public.read_student_stage_subject(p_student,p_lead);
  select * into indexed from public.student_stage_workspace_index('all',coalesce(p_student,p_lead)::text);
  if indexed.key is distinct from snapshot->>'key' or indexed.stage is distinct from snapshot->>'stage'
    or indexed.detail is distinct from snapshot->>'detail' then raise exception 'BATCH_INDEX_SNAPSHOT_MISMATCH'; end if;
  page:=public.list_student_stage_workspace(indexed.stage,'all',coalesce(p_student,p_lead)::text,1,20,indexed.detail);
  if (page->>'count')::integer<>1 or page->'rows'->0->>'key' is distinct from snapshot->>'key' then raise exception 'DETAIL_BEFORE_PAGINATION'; end if;
end;
$$;
do $test$
#variable_conflict use_variable
declare actor uuid; outsider uuid; subject_lead uuid; subject_student uuid; request_id uuid;
  result jsonb; again jsonb; payload jsonb; page jsonb; before_contacts bigint; error_text text;
  teacher uuid; invitation_id uuid; previous_invitation uuid; registration_id uuid; original_registration uuid;
  at_time timestamptz; slot text; course_id uuid; term_id uuid; enrollment_id uuid; opportunity_id uuid;
  second_course uuid; second_enrollment uuid; second_opportunity uuid;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into outsider from auth.users where email='test-student@mathin.local';
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  subject_lead:=gen_random_uuid();
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(subject_lead,'stage-contract-'||subject_lead,'stage-contract-'||subject_lead,'600000008800','600000008800','uncontacted',actor,actor);
  if public.read_student_stage_subject(null,subject_lead)->>'stage'<>'awaiting_first_contact' then raise exception 'FIRST_CONTACT_STAGE'; end if;
  perform pg_temp.assert_student_stage_index(null,subject_lead);
  request_id:=gen_random_uuid();
  payload:=jsonb_build_object('studentId',null,'leadId',subject_lead,'mode','contact','outcome','connected','note','stage contact');
  result:=public.save_student_stage_entry(request_id,payload);
  subject_student:=(result->'subject'->>'studentId')::uuid;
  if subject_student is null or result->'subject'->>'stage'<>'awaiting_assessment' then raise exception 'CONTACT_ADVANCEMENT'; end if;
  perform pg_temp.assert_student_stage_index(subject_student,subject_lead);
  select count(*) into before_contacts from public.lead_communications where lead_id=subject_lead;
  again:=public.save_student_stage_entry(request_id,payload);
  if again<>result or (select count(*) from public.lead_communications where lead_id=subject_lead)<>before_contacts then raise exception 'IDEMPOTENT_REPLAY'; end if;
  begin
    perform public.save_student_stage_entry(request_id,payload||'{"note":"different"}'::jsonb);
    raise exception 'CHANGED_RETRY_ACCEPTED';
  exception when others then
    get stacked diagnostics error_text=message_text;
    if error_text<>'REQUEST_CONFLICT' then raise; end if;
  end;
  page:=public.list_student_stage_workspace('awaiting_first_contact','all','stage-contract-'||subject_lead,1,20,'');
  if (page->>'count')::integer<>1 or jsonb_array_length(page->'rows')<>1 then raise exception 'CANONICAL_IDENTITY_DUPLICATE'; end if;
  if page->'rows'->0->>'stage'<>'awaiting_assessment' then raise exception 'CROSS_STAGE_SEARCH'; end if;
  result:=public.save_student_stage_entry(gen_random_uuid(),jsonb_build_object('studentId',subject_student,'leadId',subject_lead,
    'mode','note','note','independent note','nextContactAt',null));
  if result->'subject'->>'stage'<>'awaiting_assessment' or result->'subject'->>'note'<>'independent note'
    or result->'subject'->>'nextContactAt' is not null then raise exception 'INDEPENDENT_NOTE'; end if;

  select id into teacher from auth.users where email='test-teacher@mathin.local';
  if teacher is null then raise exception 'FIXED_TEACHER_REQUIRED'; end if;
  at_time:=((now() at time zone 'Asia/Shanghai')::date+2+time '10:00') at time zone 'Asia/Shanghai';
  slot:=to_char(at_time at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  payload:=jsonb_build_object('studentId',subject_student,'leadId',subject_lead,'mode','invitation','note','first appointment',
    'invitation',jsonb_build_object('kind','assessment_1v1','state','confirmed','activityId',null,'assessorId',teacher,
      'parentTimeOptions',jsonb_build_array(slot),'assessorTimeOptions',jsonb_build_array(slot),'scheduledAt',at_time,'locationText',''));
  result:=public.save_student_stage_entry(gen_random_uuid(),payload);
  invitation_id:=(result->'subject'->'invitation'->>'id')::uuid;
  if invitation_id is null or result->'subject'->>'stage'<>'awaiting_assessment' then raise exception 'BOOKING_ADVANCED_STAGE'; end if;
  result:=public.save_assessment_workflow(null,invitation_id,'classify',0,'{"classification":null,"parentResponse":"Awaiting assessment","reasons":[],"nextContactAt":null,"trialIntent":false}'::jsonb);
  registration_id:=(result->>'registrationId')::uuid;
  if public.read_student_stage_subject(subject_student,subject_lead)->>'stage'<>'awaiting_assessment' then raise exception 'EMPTY_ASSESSMENT_ADVANCED'; end if;
  update public.activity_registrations set status='no_show' where id=registration_id;
  result:=public.read_student_stage_subject(subject_student,subject_lead);
  if result->>'stage'<>'awaiting_assessment' or result->>'detail'<>'no_show' then raise exception 'NO_SHOW_LOST_STUDENT'; end if;
  perform pg_temp.assert_student_stage_index(subject_student,subject_lead);
  original_registration:=registration_id; previous_invitation:=invitation_id;
  result:=public.save_student_stage_entry(gen_random_uuid(),payload||'{"note":"rebook after no show"}'::jsonb);
  invitation_id:=(result->'subject'->'invitation'->>'id')::uuid;
  if invitation_id=previous_invitation or (select status from public.activity_registrations where id=original_registration)<>'no_show'
    or result->'subject'->>'detail'<>'booked' then raise exception 'REBOOK_REWROTE_ATTEMPT'; end if;
  select count(*) into before_contacts from public.lead_communications where lead_id=subject_lead;
  begin
    perform public.save_student_stage_entry(gen_random_uuid(),payload);
    raise exception 'STALE_INVITATION_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'INVITATION_CONFLICT' then raise; end if; end;
  if (select count(*) from public.lead_communications where lead_id=subject_lead)<>before_contacts then raise exception 'CONFLICT_LEFT_NOTE'; end if;
  result:=public.save_assessment_workflow(null,invitation_id,'classify',0,'{"classification":null,"parentResponse":"Awaiting assessment","reasons":[],"nextContactAt":null,"trialIntent":false}'::jsonb);
  registration_id:=(result->>'registrationId')::uuid;
  update public.activity_registrations set status='attended',assessment_started_at=now(),assessment_completed_at=now() where id=registration_id;
  insert into public.assessment_results(activity_registration_id,student_id,score,assessment_band,assessed_by)
    values(registration_id,subject_student,82,'a_plus',teacher);
  if public.read_student_stage_subject(subject_student,subject_lead)->>'stage'<>'awaiting_enrollment' then raise exception 'RESULT_NOT_IN_ENROLLMENT'; end if;
  perform pg_temp.assert_student_stage_index(subject_student,subject_lead);
  select id into course_id from public.courses where grade>0 order by id limit 1;
  select id into term_id from public.school_terms where ends_on>=current_date order by ends_on desc,id limit 1;
  if course_id is null or term_id is null then raise exception 'DEVELOPMENT_COURSE_AND_TERM_REQUIRED'; end if;
  payload:=jsonb_build_object('studentId',subject_student,'leadId',subject_lead,'mode','enrollment','note','Considering enrollment',
    'enrollment',jsonb_build_object('courseId',course_id,'termId',term_id,'type','new','stage','considering','confirm',false,'paymentEvidence',''));
  result:=public.save_student_stage_entry(gen_random_uuid(),payload);
  opportunity_id:=(result->>'opportunityId')::uuid;
  if result->'subject'->>'stage'<>'awaiting_enrollment' or result->>'enrollmentId' is not null then raise exception 'INTENT_CREATED_ENROLLMENT'; end if;
  payload:=jsonb_set(payload,'{enrollment}',(payload->'enrollment')||jsonb_build_object('confirm',true,'paymentEvidence','Fixture payment verification','expectedOpportunityId',opportunity_id));
  result:=public.save_student_stage_entry(gen_random_uuid(),payload);
  enrollment_id:=(result->>'enrollmentId')::uuid;
  if enrollment_id is null or result->'subject'->>'stage'<>'awaiting_renewal' or result->'subject'->>'detail'<>'awaiting_class' then raise exception 'CONFIRMED_ENROLLMENT_STAGE'; end if;
  perform pg_temp.assert_student_stage_index(subject_student,subject_lead);
  select id into second_course from public.courses where grade>0 and id<>course_id order by id limit 1;
  if second_course is null then raise exception 'SECOND_DEVELOPMENT_COURSE_REQUIRED'; end if;
  second_opportunity:=public.save_course_opportunity(null,null,subject_student,null,'new',second_course,term_id,'committed',null,'',null,'Fixture second course');
  second_enrollment:=public.confirm_course_enrollment(second_opportunity,'Fixture second course payment verification');
  perform public.cancel_course_enrollment(enrollment_id,'Fixture withdrawal',now());
  if public.read_student_stage_subject(subject_student,subject_lead)->>'stage'<>'awaiting_renewal' then raise exception 'PARTIAL_WITHDRAWAL_ENDED_STUDENT'; end if;
  -- 同一事务内 now() 固定，显式排列夹具时间以模拟之后登记的不续班意向。
  insert into public.course_opportunities(student_id,opportunity_type,course_id,term_id,stage,owner_id,created_by,updated_by,note,updated_at)
    values(subject_student,'renewal',second_course,term_id,'not_enrolled',actor,actor,actor,'Fixture nonrenewal intent',now()+interval '1 millisecond');
  result:=public.read_student_stage_subject(subject_student,subject_lead);
  if result->>'stage'<>'awaiting_renewal' or result->>'detail'<>'not_renewing' then raise exception 'NONRENEWAL_ENDED_CURRENT_STUDENT'; end if;
  perform pg_temp.assert_student_stage_index(subject_student,subject_lead);
  perform public.cancel_course_enrollment(second_enrollment,'Fixture final withdrawal',now());
  if public.read_student_stage_subject(subject_student,subject_lead)->>'stage'<>'former_student' then raise exception 'WITHDRAWAL_STAGE'; end if;
  perform pg_temp.assert_student_stage_index(subject_student,subject_lead);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  begin
    perform public.read_student_stage_subject(subject_student,null);
    raise exception 'OTHER_STAFF_SCOPE_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin
    perform public.save_student_stage_entry(gen_random_uuid(),jsonb_build_object('studentId',subject_student,'leadId',null,'mode','note','note','Outside scope'));
    raise exception 'OTHER_STAFF_WRITE_ACCEPTED';
  exception when others then get stacked diagnostics error_text=message_text; if error_text not in ('FORBIDDEN','FORBIDDEN_SCOPE') then raise; end if; end;
  if has_table_privilege('authenticated','public.student_stage_entry_receipts','SELECT')
    or has_table_privilege('anon','public.student_stage_entry_receipts','SELECT') then raise exception 'RECEIPT_EXPOSED'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin
    perform public.list_student_stage_workspace('awaiting_assessment','all','',1,20,'');
    raise exception 'STUDENT_ROLE_ACCEPTED';
  exception when others then
    get stacked diagnostics error_text=message_text;
    if error_text<>'FORBIDDEN' then raise; end if;
  end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.list_student_stage_workspace('awaiting_assessment','all','',1,20,'');
    raise exception 'ANONYMOUS_ACCEPTED';
  exception when others then
    get stacked diagnostics error_text=message_text;
    if error_text<>'UNAUTHENTICATED' then raise; end if;
  end;
end;
$test$;
rollback to savepoint student_stage_contract;
release savepoint student_stage_contract;
