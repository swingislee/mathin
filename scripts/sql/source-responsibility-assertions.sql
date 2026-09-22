-- 仅在已核对的开发库事务中执行；固定身份与合成事实整体回滚。
set local role postgres;
do $test$
declare support_id uuid; admin_id uuid; lead_id uuid:=gen_random_uuid(); protected_lead uuid:=gen_random_uuid();
  source_id text:='responsibility-contract-'||gen_random_uuid(); activity_id uuid:=gen_random_uuid(); registration_id uuid:=gen_random_uuid();
  group_id uuid; other_group uuid; batch_id uuid; result jsonb; projected jsonb; source_label text;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into support_id from auth.users where email='test-teacher@mathin.local';
  if admin_id is null or support_id is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  select display_name into source_label from public.profiles where id=support_id;
  insert into public.history_import_batches(batch_key,payload_sha256,manifest) values(source_id,repeat('d',64),'{}') returning id into batch_id;
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text)
    values(source_id,repeat('d',64),'contract',source_id,repeat('e',64),'{"format":"feishu-base"}',
      jsonb_build_object('cells',jsonb_build_array(jsonb_build_object('fieldName','确认人员','text',source_label))),'unmatched','{}','synthetic');
  insert into public.leads(id,provisional_student_name,normalized_name,phone,status,source_record_id)
    values(lead_id,'synthetic responsibility','synthetic responsibility','','uncontacted',source_id);
  if (select owner_id from public.leads where id=lead_id) is distinct from support_id then raise exception 'CONFIRMATION_OWNER_MISSING'; end if;
  insert into public.leads(id,provisional_student_name,normalized_name,phone,status,source_record_id,owner_id)
    values(protected_lead,'synthetic protected','synthetic protected','','invalid',source_id,admin_id);
  if (select owner_id from public.leads where id=protected_lead) is distinct from admin_id then raise exception 'ASSIGNED_OWNER_OVERRIDDEN'; end if;
  insert into public.activities(id,kind,title,source_record_id,source_field_ids,history_key,history_batch_id,source_payload_sha256,history_imported_at)
    values(activity_id,'assessment_1v1','Synthetic assessment',source_id,array['field'],source_id||':activity',batch_id,repeat('f',64),now());
  insert into public.activity_registrations(id,activity_id,lead_id,status,source_record_id,source_field_ids,history_key,history_batch_id,source_payload_sha256,history_imported_at)
    values(registration_id,activity_id,lead_id,'attended',source_id,array['field'],source_id||':registration',batch_id,repeat('f',64),now());
  if (select status from public.leads where id=lead_id)<>'contacted' then raise exception 'ARRIVAL_STILL_UNCONTACTED'; end if;
  insert into public.assessment_results(activity_registration_id,lead_id,assessed_by,assessment_band,result_source,source_record_id,source_field_ids,history_key,history_batch_id,source_payload_sha256,history_imported_at)
    values(registration_id,lead_id,support_id,'a_plus','legacy',source_id,array['field'],source_id||':assessment',batch_id,repeat('f',64),now());
  perform public.refresh_imported_lead_contact_status(protected_lead);
  if (select status from public.leads where id=protected_lead)<>'invalid' then raise exception 'MANUAL_STATUS_OVERRIDDEN'; end if;
  insert into public.school_staff_business_roles(user_id,business_role) values(support_id,'teacher') on conflict(user_id) do update set business_role='teacher';
  insert into public.school_business_groups(name) values('synthetic current '||lead_id) returning id into group_id;
  insert into public.school_business_groups(name) values('synthetic historical '||lead_id) returning id into other_group;
  insert into public.school_business_group_members(group_id,user_id) values(group_id,support_id);
  insert into public.school_subject_groups(lead_id,group_id,source_key) values(lead_id,other_group,'synthetic-source');
  projected:=public.school_collaboration_projection(null,lead_id,admin_id);
  if not exists(select 1 from jsonb_array_elements(projected->'participants') p where p->>'userId'=support_id::text and p->>'role'='school_support')
    or not exists(select 1 from jsonb_array_elements(projected->'participants') p where p->>'userId'=support_id::text and p->>'role'='assessment_teacher') then raise exception 'DUAL_ROLE_LOST'; end if;
  if not exists(select 1 from jsonb_array_elements(projected->'groups') g where g->>'id'=group_id::text)
    or exists(select 1 from jsonb_array_elements(projected->'groups') g where g->>'id'=other_group::text) then raise exception 'HISTORICAL_GROUP_IN_CURRENT_FILTER'; end if;
  result:=public.school_list_apply_collaboration(jsonb_build_object('ownerId',support_id,'ownerName',source_label,'teacherId',support_id,'teacherName',source_label),projected);
  if result->>'ownerName'<>source_label or result->>'teacherName'<>source_label then raise exception 'DUAL_ROLE_NAME_LOST'; end if;
  if public.student_list_field(result,'owner','{}',admin_id,'Asia/Shanghai')->'values'<>jsonb_build_array(support_id) then raise exception 'CURRENT_OWNER_FILTER_MISMATCH'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  result:=public.read_base_lead_acquisition(array[lead_id]);
  if result->0->>'supportLabel'<>source_label then raise exception 'SOURCE_SUPPORT_LABEL_MISSING'; end if;
  result:=public.list_student_records_page('awaiting_enrollment','all',lead_id::text,'records',1,20,'{"version":2,"filters":{}}','zh','{}');
  if result->'rows'->0->>'stage'<>'awaiting_enrollment' then raise exception 'ASSESSMENT_STAGE_MISMATCH'; end if;
  result:=public.list_student_records_page('awaiting_enrollment','all',lead_id::text,'records',1,20,
    jsonb_build_object('version',2,'filters',jsonb_build_object('group',jsonb_build_object('kind','enum','values',jsonb_build_array(group_id)))),'zh','{}');
  if (result->>'count')::integer<>1 then raise exception 'SUPPORT_GROUP_PAGE_FILTER'; end if;
  if has_function_privilege('authenticated','public.refresh_imported_lead_contact_status(uuid)','execute') then raise exception 'PRIVATE_REPAIR_EXPOSED'; end if;
end;
$test$;
select '{"responsibilityContracts":"pass","syntheticDataRolledBack":true}'::jsonb;
