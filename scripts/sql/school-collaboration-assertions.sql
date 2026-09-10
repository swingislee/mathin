-- 固定开发身份，合成业务事实均在 savepoint 中回滚。
savepoint school_collaboration_contract;
do $test$
declare admin_id uuid; participant uuid; viewer uuid; outsider uuid; director uuid; child uuid;
  subject uuid:=gen_random_uuid(); group_only uuid:=gen_random_uuid(); unrelated uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
  source_lead uuid:=gen_random_uuid(); source_id text:='__collaboration__'||gen_random_uuid(); group_id uuid; source_group uuid;
  contact_id uuid:=gen_random_uuid(); historical_note uuid:=gen_random_uuid(); history_context jsonb;
  result jsonb; page jsonb; err text; original_owner uuid; membership uuid;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into participant from auth.users where email='test-teacher@mathin.local';
  select id into viewer from auth.users where email='test-sales@mathin.local';
  select id into outsider from auth.users where email='test-research@mathin.local';
  select id into director from auth.users where email='test-multirole@mathin.local';
  select id into child from auth.users where email='test-student@mathin.local';
  if num_nonnulls(admin_id,participant,viewer,outsider,director,child)<>6 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if public.has_perm(viewer,'student.view.all') or not public.has_perm(viewer,'followup.write')
    or not public.has_perm(participant,'followup.write') then raise exception 'FIXED_PERMISSION_CONTRACT_CHANGED'; end if;
  select id into source_group from public.school_business_groups where source_code='1';
  if source_group is null then raise exception 'SOURCE_GROUPS_MISSING'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role postgres';
  insert into public.staff_role_members(user_id,role_id,granted_by)
    select director,id,admin_id from public.staff_roles where key='director' on conflict do nothing;
  insert into public.students(id,name,phone,assigned_to,created_by,bind_code) values(sid,'collaboration-contract-'||sid,'600000009991',admin_id,admin_id,public.generate_student_bind_code());
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(subject,'collaboration-contract-'||subject,'collaboration-contract-'||subject,'600000009992','600000009992','uncontacted',admin_id,admin_id),
      (group_only,'collaboration-contract-'||group_only,'collaboration-contract-'||group_only,'600000009993','600000009993','uncontacted',admin_id,admin_id),
      (unrelated,'collaboration-contract-'||unrelated,'collaboration-contract-'||unrelated,'600000009994','600000009994','uncontacted',admin_id,admin_id),
      (source_lead,'collaboration-contract-'||source_lead,'collaboration-contract-'||source_lead,'600000009995','600000009995','uncontacted',null,admin_id);
  insert into public.lead_communications(id,lead_id,channel,outcome,note,recorded_by,owner_id_at_contact)
    values(gen_random_uuid(),subject,'phone','unreachable','Synthetic prior participation',participant,admin_id),
      (contact_id,subject,'phone','unreachable','Synthetic other author',admin_id,admin_id);
  update public.leads set student_id=sid,identity_confirmed_by=admin_id,identity_confirmed_at=now() where id=group_only;
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,lead_id,entity_data)
    values(source_id,repeat('a',64),'collaboration-contract',source_id,repeat('b',64),'{"format":"feishu-base"}',
      jsonb_build_object('cells',jsonb_build_array(jsonb_build_object('fieldName','确认人员','text',(select display_name from public.profiles where id=participant)),
      jsonb_build_object('fieldName','确认组别','text','一组'))),'matched','{}','collaboration-contract',source_lead,'{}');
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  group_id:=public.save_school_business_group(null,'contract-'||gen_random_uuid());
  perform public.set_school_business_group_member(group_id,viewer,true);
  perform public.add_school_subject_collaborator(null,group_only,null,'participant',group_id);
  perform public.set_school_staff_business_role(participant,'assessment_teacher');
  execute 'reset role';
  perform public.refresh_school_source_collaboration();

  perform set_config('request.jwt.claims',jsonb_build_object('sub',participant,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not exists(select 1 from public.leads where id=subject) then raise exception 'PARTICIPANT_LEAD_RLS'; end if;
  result:=public.read_student_record_subject(null,subject);
  if result->>'canWrite'<>'true' or result->>'canContact'<>'true' or result->>'isParticipant'<>'true' then raise exception 'PARTICIPANT_DETAIL_CAPABILITY'; end if;
  page:=public.list_student_records_page('awaiting_first_contact','mine',subject::text,'records',1,20,'{"version":2,"filters":{}}','zh','{}');
  if jsonb_array_length(page->'rows')<>1 or page->'rows'->0->>'isParticipant'<>'true' or page->'rows'->0->>'canWrite'<>'true' then raise exception 'PARTICIPANT_MINE_PAGE'; end if;
  result:=public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',subject,'mode','contact','outcome','unreachable','note','Participant update'));
  if result->'subject'->>'canWrite'<>'true' then raise exception 'PARTICIPANT_WRITE_ENTRY'; end if;
  perform public.record_lead_contact(subject,'unreachable','Participant direct RPC',null,null,null,null);
  if not public.can_access_communication_row('lead:'||subject,true) or not public.can_revise_communication_record('contact',contact_id) then raise exception 'PARTICIPANT_COMMUNICATION_REVISION_SCOPE'; end if;
  perform public.revise_communication_record('contact',contact_id,null,'{"note":"Participant correction of an earlier record"}');
  result:=public.read_student_record_subject(null,source_lead);
  if result->>'canWrite'<>'true' or result->>'ownerName'<>'' or nullif(result->>'teacherName','') is null then raise exception 'SOURCE_STAFF_ROLE_OR_ACCESS'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'groups') g where g->>'id'=source_group::text) then raise exception 'SOURCE_GROUP_NOT_LINKED'; end if;
  -- 参与人不得自建组、自加成员或直接伪造参与事实。
  begin perform public.save_school_business_group(null,'forbidden'); raise exception 'STAFF_MANAGED_GROUP';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.set_school_business_group_member(group_id,participant,true); raise exception 'STAFF_ADDED_SELF';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin insert into public.school_subject_participants(lead_id,user_id,business_role,source_key) values(unrelated,participant,'participant','forged'); raise exception 'DIRECT_PARTICIPANT_INSERT';
    exception when insufficient_privilege then null; end;
  begin perform public.refresh_school_source_collaboration(); raise exception 'PRIVATE_RECONCILIATION_EXPOSED';
    exception when insufficient_privilege then null; end;
  execute 'reset role';

  execute 'set local role postgres';
  update public.leads set owner_id=outsider where id=subject;
  execute 'reset role';
  execute 'set local role authenticated';
  if not public.can_edit_school_lead(subject,participant) then raise exception 'REASSIGNMENT_REMOVED_PARTICIPANT'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.can_access_student(sid,viewer) or not public.can_view_school_student(sid,viewer) then raise exception 'GROUP_READ_EDIT_SEPARATION'; end if;
  if not exists(select 1 from public.students where id=sid) or not exists(select 1 from public.leads where id=group_only) then raise exception 'GROUP_RLS_READ'; end if;
  result:=public.read_student_record_subject(sid,group_only);
  if result->>'canWrite'<>'false' or result->>'canContact'<>'false' or result->>'inMyGroups'<>'true' then raise exception 'GROUP_DETAIL_WRITABLE'; end if;
  page:=public.list_student_records_page('awaiting_first_contact','group',sid::text,'records',1,20,
    jsonb_build_object('version',2,'filters',jsonb_build_object('group',jsonb_build_object('kind','enum','values',jsonb_build_array(group_id::text)))),'zh','{}');
  if jsonb_array_length(page->'rows')<>1 or page->'rows'->0->>'canWrite'<>'false' then raise exception 'GROUP_PAGE_FILTER_OR_CAPABILITY'; end if;
  if exists(select 1 from public.leads where id=unrelated) then raise exception 'GROUP_READ_UNRELATED'; end if;
  begin perform public.read_student_record_subject(null,unrelated); raise exception 'GROUP_DETAIL_UNRELATED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',sid,'leadId',group_only,'mode','note','note','Group reader attempted write'));
      raise exception 'GROUP_NOTE_WRITE'; exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.record_lead_contact_v4(group_only,'unreachable','Group reader direct RPC',null,null,null,null,null,null,'{}','{}',null,'',null);
      raise exception 'GROUP_DIRECT_RPC_WRITE'; exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin insert into public.student_follow_ups(student_id,author_id,content) values(sid,viewer,'Forbidden group note'); raise exception 'GROUP_DIRECT_FOLLOWUP_WRITE';
    exception when insufficient_privilege then null; end;
  update public.students set name='Forbidden group edit' where id=sid;
  if found then raise exception 'GROUP_STUDENT_RLS_WRITE'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',director,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not public.can_manage_school_groups() then raise exception 'DIRECTOR_MANAGEMENT'; end if;
  perform public.save_school_business_group(group_id,'renamed-'||group_id);
  perform public.set_school_business_group_member(group_id,viewer,false);
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.leads where id=group_only) or public.can_view_school_student(sid,viewer) then raise exception 'REMOVED_MEMBER_RETAINED_GROUP_ACCESS'; end if;
  execute 'reset role';

  -- 组内查看不会制造参与经历；离组和停用账号分别验证。
  if exists(select 1 from public.school_subject_participants where user_id=viewer and (lead_id=group_only or student_id=sid)) then raise exception 'READ_CREATED_PARTICIPATION'; end if;

  -- 复用本机导入批次作为外键；合成历史事实遵循现有导入入口，随后完整回滚。
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role postgres';
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,student_id,entity_data)
    values(source_id||':history',repeat('a',64),'collaboration-contract',source_id||':history',repeat('b',64),'{"format":"feishu-base"}',
      '{"cells":[{"fieldId":"contract-content","fieldName":"沟通","text":"Synthetic history"}]}','matched','{}','collaboration-contract',sid,'{}');
  insert into public.student_follow_ups(id,student_id,author_id,content,record_state,history_key,history_batch_id,source_record_id,source_field_ids,source_payload_sha256,history_imported_at)
    values(historical_note,sid,admin_id,'Synthetic history','historical',source_id||':history',
      (select id from public.history_import_batches order by imported_at limit 1),source_id||':history',array['contract-content'],repeat('b',64),now());
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.add_school_subject_collaborator(sid,null,participant,'participant',null);
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',participant,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  history_context:=public.get_business_record_revision('communication',historical_note);
  perform public.revise_business_record('communication',historical_note,history_context->>'version',
    '{"student_follow_ups":{"content":"Participant corrected historical note"}}','Confirmed by participant');
  begin perform public.revise_business_record('communication',historical_note,history_context->>'version',
    '{"student_follow_ups":{"content":"Stale overwrite"}}',''); raise exception 'REVISION_CONFLICT_IGNORED';
    exception when others then get stacked diagnostics err=message_text; if err<>'REVISION_CONFLICT' then raise; end if; end;
  execute 'reset role';
  if not exists(select 1 from public.business_record_revisions where record_id=historical_note and recorded_by=participant)
    or (select content from public.student_follow_ups where id=historical_note)<>'Participant corrected historical note' then raise exception 'HISTORY_REVISION_OR_AUDIT_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin perform public.get_business_record_revision('communication',historical_note); raise exception 'GROUP_HISTORY_REVISION_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';

  execute 'set local role postgres';
  update public.profiles set is_active=false where id=participant;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',participant,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.can_edit_school_lead(subject,participant) or exists(select 1 from public.leads where id=subject) then raise exception 'INACTIVE_PARTICIPANT_ACCESS'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',child,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin perform public.read_school_collaboration_settings(); raise exception 'CHILD_GROUP_SETTINGS';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role anon';
  begin perform public.read_school_collaboration_settings(); raise exception 'ANONYMOUS_GROUP_SETTINGS';
    exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
rollback to savepoint school_collaboration_contract;
