savepoint manual_entry_contract;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid;
  teacher uuid:=current_setting('manual_entry_test.teacher')::uuid;
  outsider uuid:=current_setting('manual_entry_test.student')::uuid;
  request uuid:=gen_random_uuid(); payload jsonb; saved jsonb; again jsonb; profile jsonb; before_profile jsonb;
  lead_id uuid; student_id uuid; sibling_id uuid; before_leads bigint; before_contacts bigint;
  candidates jsonb; err text; n bigint; entry_id uuid; assessment jsonb;
  target_course uuid; target_term uuid; minimal jsonb; confirmed jsonb; formal jsonb; manual_opportunity uuid; baseline_lead uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  payload:=jsonb_build_object('workspace','communication','subject',null,
    'newPerson',jsonb_build_object('name','manual-contract-'||request,'phone','','grade',3,'createStudent',false,'identityPending',true),
    'work',jsonb_build_object('date',current_date,'note','Call after checking the family'),'acknowledgeDuplicate',false);
  saved:=public.add_school_support_work_item(request,payload);
  lead_id:=(saved->>'leadId')::uuid; entry_id:=(saved->>'id')::uuid;
  if saved->>'studentId' is not null or saved->>'identityPending' is distinct from 'true' or saved->>'worklistId' is null then
    raise exception 'MINIMAL_INTAKE_FAILED'; end if;
  again:=public.add_school_support_work_item(request,payload);
  if again->>'id'<>saved->>'id' then raise exception 'RETRY_DUPLICATED_WORK'; end if;
  begin perform public.add_school_support_work_item(request,jsonb_set(payload,'{work,note}','"different"')); raise exception 'REQUEST_REUSE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'REQUEST_CONFLICT' then raise; end if; end;
  execute 'reset role';
  select count(*) into before_contacts from public.lead_communications where lead_communications.lead_id=lead_id;
  if before_contacts<>0 then raise exception 'INTAKE_INVENTED_CONTACT'; end if;
  if not exists(select 1 from public.leads l where l.id=lead_id and l.phone='' and l.phone_normalized is null and l.student_id is null) then
    raise exception 'INTAKE_FABRICATED_IDENTITY'; end if;
  execute 'set local role authenticated';
  profile:=public.read_school_support_profile(null,lead_id);
  before_profile:=profile;
  profile:=public.update_school_support_profile(null,lead_id,profile->>'version',
    jsonb_set(profile->'values','{phone}','"600000009321"'));
  if profile->'values'->>'phone'<>'600000009321' or jsonb_array_length(profile->'changes')<>1 then raise exception 'PROFILE_REVISION_MISSING'; end if;
  begin perform public.update_school_support_profile(null,lead_id,before_profile->>'version',before_profile->'values'); raise exception 'STALE_PROFILE_OVERWRITE';
    exception when others then get stacked diagnostics err=message_text; if err<>'PROFILE_CONFLICT' then raise; end if; end;
  candidates:=public.search_school_support_subjects('600000009321');
  if not exists(select 1 from jsonb_array_elements(candidates) c where c->>'leadId'=lead_id::text) then raise exception 'UPDATED_PHONE_NOT_SEARCHABLE'; end if;

  student_id:=public.create_student('manual-known-'||request,3::smallint,'','','manual contract','','600000009321','');
  sibling_id:=public.create_student('manual-sibling-'||request,5::smallint,'','','manual contract','','600000009321','');
  candidates:=public.search_school_support_subjects('600000009321');
  if not exists(select 1 from jsonb_array_elements(candidates) c where c->>'studentId'=student_id::text)
    or not exists(select 1 from jsonb_array_elements(candidates) c where c->>'studentId'=sibling_id::text) then raise exception 'SHARED_PHONE_COLLAPSED_CHILDREN'; end if;
  profile:=public.resolve_school_support_identity(lead_id,student_id,profile->>'version');
  again:=public.read_school_support_work_item(entry_id);
  if again->>'studentId'<>student_id::text or again->>'identityPending'<>'false' or again->>'worklistId'<>saved->>'worklistId' then raise exception 'IDENTITY_WORK_CONTINUITY_BROKEN'; end if;
  profile:=public.read_school_support_profile(student_id,null);
  before_profile:=profile;
  profile:=public.update_school_support_profile(student_id,null,profile->>'version',jsonb_set(profile->'values','{school}','"Updated school"'));
  if profile->'values'->>'school'<>'Updated school' then raise exception 'STUDENT_PROFILE_NOT_UPDATED'; end if;

  select count(*) into before_leads from public.leads;
  payload:=jsonb_build_object('workspace','assessments','subject',null,
    'newPerson',jsonb_build_object('name','manual-rollback-'||request,'phone','','grade',null,'identityPending',true),
    'work',jsonb_build_object('activityId',gen_random_uuid(),'arrived',true));
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'INVALID_ACTIVITY_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'ACTIVITY_NOT_AVAILABLE' then raise; end if; end;
  if (select count(*) from public.leads)<>before_leads then raise exception 'FAILED_INTAKE_LEFT_ORPHAN'; end if;
  profile:=public.read_school_support_profile(student_id,null);
  payload:=jsonb_build_object('workspace','assessments','subject',jsonb_build_object('studentId',student_id,'leadId',null,'version',profile->>'version'),
    'newPerson',null,'work',jsonb_build_object('scheduledAt',now(),'arrived',true,'note','Unscheduled arrival'));
  assessment:=public.add_school_support_work_item(gen_random_uuid(),payload);
  again:=public.add_school_support_work_item(gen_random_uuid(),payload);
  if again->>'id'<>assessment->>'id' or again->>'registrationId' is null then raise exception 'ASSESSMENT_INTAKE_DUPLICATED'; end if;
  execute 'reset role';
  if not exists(select 1 from public.activity_registrations r where r.id=(assessment->>'registrationId')::uuid
    and r.student_id=student_id and r.status='attended') then raise exception 'ARRIVAL_NOT_SAVED'; end if;
  if exists(select 1 from public.lead_communications where lead_communications.lead_id=lead_id) then raise exception 'ARRIVAL_INVENTED_FIRST_CONTACT'; end if;
  execute 'set local role authenticated';
  payload:=jsonb_set(payload,'{workspace}','"renewals"');
  payload:=jsonb_set(payload,'{work}','{"note":"Previous class to confirm"}');
  saved:=public.add_school_support_work_item(gen_random_uuid(),payload);
  candidates:=public.list_school_support_work_items('renewals');
  if not exists(select 1 from jsonb_array_elements(candidates) c where c->>'id'=saved->>'id') then raise exception 'INCOMPLETE_RENEWAL_DISAPPEARED'; end if;
  if saved->>'enrollmentId' is not null then raise exception 'INTAKE_INVENTED_ENROLLMENT'; end if;
  again:=public.update_school_support_work_item((saved->>'id')::uuid,(saved->>'revision')::integer,
    jsonb_build_object('note','No action this round','closed',true));
  if again->>'closedAt' is null then raise exception 'WORK_CANNOT_BE_REMOVED'; end if;

  -- 仅有电话也可以先保存，后续确认身份接续原工作和课程机会。
  payload:=jsonb_build_object('workspace','renewals','subject',null,'newPerson',
    jsonb_build_object('name','','phone','600000009322','grade',null,'createStudent',false,'identityPending',true),
    'work',jsonb_build_object('note','Confirm name and previous course'));
  minimal:=public.add_school_support_work_item(gen_random_uuid(),payload);
  profile:=public.read_school_support_profile(null,(minimal->>'leadId')::uuid);
  begin perform public.confirm_school_support_identity((minimal->>'leadId')::uuid,profile->>'version'); raise exception 'NAMELESS_STUDENT_CREATED';
    exception when others then get stacked diagnostics err=message_text; if err<>'IDENTITY_CHANGE_REQUIRED' then raise; end if; end;
  profile:=public.update_school_support_profile(null,(minimal->>'leadId')::uuid,profile->>'version',
    jsonb_set(profile->'values','{name}',to_jsonb('manual-phone-only-'||request)));
  select c.id into target_course from public.courses c where c.status='enabled' and c.purpose='production' and c.course_kind='curriculum' and c.trashed_at is null order by c.id limit 1;
  select t.id into target_term from public.school_terms t order by t.is_current desc,t.starts_on desc limit 1;
  if target_course is null or target_term is null then raise exception 'CURRENT_COURSE_FIXTURE_REQUIRED'; end if;
  minimal:=public.update_school_support_work_item((minimal->>'id')::uuid,(minimal->>'revision')::integer,
    jsonb_build_object('note','Confirmed course','courseId',target_course,'termId',target_term));
  manual_opportunity:=(minimal->>'opportunityId')::uuid;
  if manual_opportunity is null then raise exception 'COURSE_NOT_MATERIALIZED'; end if;
  confirmed:=public.confirm_school_support_identity((minimal->>'leadId')::uuid,profile->>'version');
  minimal:=public.read_school_support_work_item((minimal->>'id')::uuid);
  if minimal->>'studentId' is null or minimal->>'opportunityId'<>manual_opportunity::text then raise exception 'CONFIRMATION_LOST_WORK'; end if;
  execute 'reset role';
  if not exists(select 1 from public.course_opportunities o where o.id=manual_opportunity and o.student_id=(minimal->>'studentId')::uuid
    and o.lead_id is null and o.opportunity_type='renewal' and o.stage='planning') then raise exception 'IDENTITY_DID_NOT_RELINK_OPPORTUNITY'; end if;
  execute 'set local role authenticated';
  formal:=public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',minimal->>'studentId','leadId',null,
    'mode','enrollment','note','Contract test rolled back','nextContactAt',null,'outcome',null,'wechatAdded',null,'interestLevel',null,
    'invitation',null,'expectedInvitationId',null,'expectedInvitationUpdatedAt',null,'enrollment',jsonb_build_object(
      'courseId',target_course,'termId',target_term,'type','renewal','stage','committed','confirm',true,
      'paymentEvidence','Contract verification; entire transaction rolled back','expectedOpportunityId',manual_opportunity)));
  if formal->>'enrollmentId' is null then raise exception 'FORMAL_ENROLLMENT_NOT_AVAILABLE'; end if;
  candidates:=public.list_school_support_work_items('renewals');
  if exists(select 1 from jsonb_array_elements(candidates) c where c->>'id'=minimal->>'id') then raise exception 'FORMAL_ENROLLMENT_LEFT_PENDING_COPY'; end if;

  -- 普通首联保留原有成功沟通后建档的行为。
  execute 'reset role';
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values('manual-baseline-'||request,'manual-baseline-'||request,'600000009323','600000009323','uncontacted',actor,actor)
    returning id into baseline_lead;
  execute 'set local role authenticated';
  formal:=public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',baseline_lead,
    'mode','contact','outcome','connected','note','Baseline contract; transaction rolled back','nextContactAt',null));
  if formal->'subject'->>'studentId' is null then raise exception 'FIRST_CONTACT_BASELINE_REGRESSED'; end if;

  profile:=public.read_school_support_profile(student_id,null);
  saved:=public.add_school_support_work_item(gen_random_uuid(),jsonb_build_object('workspace','renewals','subject',
    jsonb_build_object('studentId',student_id,'leadId',null,'version',profile->>'version'),'newPerson',null,'work',jsonb_build_object('note','Existing work')));
  minimal:=public.add_school_support_work_item(gen_random_uuid(),jsonb_build_object('workspace','renewals','subject',null,'newPerson',
    jsonb_build_object('name','manual-association-'||request,'phone','','grade',null,'createStudent',false,'identityPending',true),'work',jsonb_build_object('note','Uncertain duplicate')));
  profile:=public.read_school_support_profile(null,(minimal->>'leadId')::uuid);
  begin perform public.resolve_school_support_identity((minimal->>'leadId')::uuid,student_id,profile->>'version'); raise exception 'DUPLICATE_WORK_ASSOCIATED';
    exception when others then get stacked diagnostics err=message_text; if err<>'ASSOCIATION_CONFLICT' then raise; end if; end;
  again:=public.read_school_support_work_item((minimal->>'id')::uuid);
  if again->>'studentId' is not null then raise exception 'FAILED_ASSOCIATION_CHANGED_IDENTITY'; end if;

  -- 恢复原测评主体作为越权写入目标。
  profile:=public.read_school_support_profile(student_id,null);
  payload:=jsonb_build_object('workspace','communication','subject',jsonb_build_object('studentId',student_id,'leadId',null,'version',profile->>'version'),
    'newPerson',null,'work',jsonb_build_object('date',current_date,'note','Scope check'));

  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  begin perform public.read_school_support_work_item(entry_id); raise exception 'OTHER_OWNER_READ_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'OTHER_OWNER_WRITE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  execute 'reset role';
  update public.students s set assigned_to=teacher where s.id=student_id;
  update public.leads l set owner_id=teacher where l.id=lead_id;
  execute 'set local role authenticated';
  profile:=public.read_school_support_profile(student_id,null);
  payload:=jsonb_set(payload,'{subject,version}',profile->'version');
  again:=public.add_school_support_work_item(gen_random_uuid(),payload);
  if again->>'studentId'<>student_id::text then raise exception 'ASSIGNED_STAFF_CANNOT_HANDLE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.search_school_support_subjects('manual'); raise exception 'NONSTAFF_SEARCH_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  if exists(select 1 from public.school_support_work_items) then raise exception 'WORK_TABLE_RLS_EXPOSED'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role anon';
  begin perform public.search_school_support_subjects('manual'); raise exception 'ANON_SEARCH_ALLOWED'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
rollback to savepoint manual_entry_contract;
release savepoint manual_entry_contract;
