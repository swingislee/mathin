savepoint lead_profile_continuation_test;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid;
  outsider uuid:=current_setting('manual_entry_test.student')::uuid;
  lead uuid:=gen_random_uuid(); contact_lead uuid:=gen_random_uuid(); room uuid:=gen_random_uuid(); course uuid; term uuid;
  payload jsonb; result jsonb; again jsonb; sid uuid; version text; request uuid:=gen_random_uuid(); err text; n bigint; outcome text; entry uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by)
    values(lead,'Historical profile contract','historical profile contract','600000007701','600000007701',actor,actor);
  insert into public.history_workflow_scopes(lead_id,reason,current_period,source_ids,source_filename,source_sha256)
    values(lead,'processed_prior_period','2026-09','{}','contract',repeat('a',64));
  execute 'set local role authenticated';
  if not exists(select 1 from jsonb_array_elements(public.search_school_support_subjects('600000007701')) c
    where c->>'leadId'=lead::text and (c->>'historical')::boolean and c->>'studentId' is null) then raise exception 'HISTORY_LEAD_NOT_SEARCHABLE'; end if;
  version:=public.read_school_support_profile(null,lead)->>'version';
  execute 'reset role';
  select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into term from public.school_terms order by id limit 1;
  insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id,purpose,offering_type,operational_status)
    values(room,'Historical lead placement',actor,replace(room::text,'-',''),3,course,term,'production','long_term_formal','active');
  payload:=jsonb_build_object('workspace','enrollments','subject',jsonb_build_object('studentId',null,'leadId',lead,'version',version),'newPerson',null,
    'acknowledgeDuplicate',false,'work',jsonb_build_object('note','','classroomId',room,'courseId',course,'termId',term,'seat',2));
  execute 'set local role authenticated';
  begin perform public.add_school_support_work_item(request,payload); raise exception 'UNCONFIRMED_LEAD_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'IDENTITY_NOT_CONFIRMED' then raise; end if; end;
  payload:=payload||jsonb_build_object('confirmLeadProfile',true,'profileEdit',jsonb_build_object('version',version,'values',
    jsonb_build_object('name','Historical profile contract','phone','600000007701','grade',2,'remark','','school','Reviewed school','wechat','contract-parent')));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.add_school_support_work_item(request,payload); raise exception 'UNAUTHORIZED_PROFILE_CREATED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  result:=public.add_school_support_work_item(request,payload);
  again:=public.add_school_support_work_item(request,payload);
  sid:=(result->>'studentId')::uuid;
  if sid is null or again->>'id' is distinct from result->>'id' then raise exception 'HISTORY_PLACEMENT_RETRY_FAILED'; end if;
  execute 'reset role';
  if (select student_id from public.leads where id=lead) is distinct from sid
    or not exists(select 1 from public.students where id=sid and school='Reviewed school' and wechat='contract-parent' and grade=2)
    or not exists(select 1 from public.enrollments where student_id=sid and classroom_id=room and placement_seat=2)
    or not public.business_subject_is_current(sid,lead) then raise exception 'HISTORY_PLACEMENT_INCOMPLETE'; end if;
  if exists(select 1 from public.lead_communications where lead_id=lead) then raise exception 'PLACEMENT_INVENTED_CONTACT'; end if;

  -- 导入的历史有效首联可补建，建档本身继续保留历史范围。
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by,manual_entry,manual_identity_pending)
    values(contact_lead,'Historical valid contact','historical valid contact','600000007702','600000007702',actor,actor,true,true);
  insert into public.history_workflow_scopes(lead_id,reason,current_period,source_ids,source_filename,source_sha256)
    values(contact_lead,'processed_prior_period','2026-09','{}','contract',repeat('a',64));
  if public.ensure_lead_student_profile(contact_lead)->>'studentProfileStatus'<>'pending_contact' then raise exception 'UNCONTACTED_PROFILE_CREATED'; end if;
  insert into public.lead_communications(lead_id,outcome,note,recorded_by,owner_id_at_contact,occurred_at)
    values(contact_lead,'connected','Historical phone confirmation',actor,actor,'2026-04-02');
  result:=public.ensure_lead_student_profile(contact_lead);sid:=(result->>'studentId')::uuid;
  if sid is null or result->>'studentProfileStatus'<>'created' then raise exception 'HISTORY_CONTACT_NOT_PROFILED'; end if;
  if public.business_subject_is_current(sid,null) or public.business_subject_is_current(null,contact_lead) then raise exception 'PROFILE_RESUMED_HISTORY'; end if;
  select count(*) into n from public.students;
  again:=public.ensure_lead_student_profile(contact_lead);
  if again->>'studentId'<>sid::text or (select count(*) from public.students)<>n then raise exception 'BACKFILL_NOT_IDEMPOTENT'; end if;
  -- 首联提交的自动副作用仅覆盖已沟通、暂缓；未接通与无效号码保留为线索。
  foreach outcome in array array['unreachable','connected','declined','invalid_number'] loop
    entry:=gen_random_uuid();
    insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by)
      values(entry,'profile-'||entry,'profile-'||entry,'600000007703','600000007703',actor,actor);
    execute 'set local role authenticated';
    result:=public.record_lead_contact_v4(entry,outcome,'contact contract',null,null,null,null,null,null,'{}','{}',null,'',null);
    if outcome in ('connected','declined') then
      if result->>'studentId' is null or result->>'studentProfileStatus'<>'created' then raise exception 'VALID_CONTACT_NOT_PROFILED'; end if;
    elsif result->>'studentId' is not null then raise exception 'INEFFECTIVE_CONTACT_PROFILED'; end if;
    execute 'reset role';
  end loop;
  -- 姓名+电话仅作为冲突提示，既有同名档案不自动合并。
  entry:=gen_random_uuid();
  insert into public.students(name,parent_phone,bind_code,assigned_to,created_by)
    values('duplicate-'||entry,'600000007704',public.generate_student_bind_code(),actor,actor);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by)
    values(entry,'duplicate-'||entry,'duplicate-'||entry,'600000007704','600000007704',actor,actor);
  execute 'set local role authenticated';
  result:=public.record_lead_contact_v4(entry,'connected','duplicate contract',null,null,null,null,null,null,'{}','{}',null,'',null);
  if result->>'studentId' is not null or result->>'studentProfileStatus'<>'needs_review' then raise exception 'DUPLICATE_IDENTITY_AUTO_LINKED'; end if;
  execute 'reset role';
  if not exists(select 1 from public.lead_communications where lead_id=entry) then raise exception 'DUPLICATE_CONTACT_LOST'; end if;
end $test$;
rollback to savepoint lead_profile_continuation_test;
release savepoint lead_profile_continuation_test;
