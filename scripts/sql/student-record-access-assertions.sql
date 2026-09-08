savepoint student_record_access_contract;
do $test$
declare actor uuid; teacher uuid; outsider uuid; subject uuid:=gen_random_uuid(); blank_phone uuid:=gen_random_uuid();
  assigned uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); result jsonb; page jsonb; payload jsonb; request uuid:=gen_random_uuid();
  student_id uuid; invitation_id uuid; err text; before_contacts bigint; source_id text:='__record_access__'||gen_random_uuid();
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into teacher from auth.users where email='test-teacher@mathin.local';
  select id into outsider from auth.users where email='test-student@mathin.local';
  if actor is null or teacher is null or outsider is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if not public.has_perm(actor,'student.view.all') or not public.has_perm(actor,'followup.write')
    or public.has_perm(teacher,'student.view.all') or not public.has_perm(teacher,'followup.write') then
    raise exception 'FIXED_PERMISSION_CONTRACT_CHANGED'; end if;
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role postgres';
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,
    source_data,record_data,match_status,match_data,search_text)
    values(source_id,repeat('a',64),'access-contract',source_id,repeat('b',64),'{}','{"original":"synthetic"}','unmatched','{}','access-contract');
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by,source_record_id)
    values(subject,'access-contract-'||subject,'access-contract-'||subject,'600000008895','600000008895','uncontacted',null,actor,null),
      (blank_phone,'access-contract-'||blank_phone,'access-contract-'||blank_phone,'',null,'uncontacted',null,actor,source_id),
      (assigned,'access-contract-'||assigned,'access-contract-'||assigned,'600000008896','600000008896','uncontacted',teacher,actor,null),
      (other_owner,'access-contract-'||other_owner,'access-contract-'||other_owner,'600000008897','600000008897','uncontacted',actor,actor,null);
  execute 'reset role';
  select count(*) into before_contacts from public.lead_communications;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.read_student_record_subject(null,subject);
  if result->>'canWrite' is distinct from 'true' or result->>'canContact' is distinct from 'true' or result->>'ownerId' is not null then
    raise exception 'ADMIN_UNASSIGNED_DETAIL_BLOCKED'; end if;
  result:=public.read_student_stage_subject(null,subject);
  if result->>'canWrite' is distinct from 'true' or result->>'canContact' is distinct from 'true' then raise exception 'LEGACY_DETAIL_PERMISSION_DRIFT'; end if;
  page:=public.list_student_record_summaries('awaiting_first_contact','all',subject::text,'records');
  if page->'rows'->0->>'canWrite' is distinct from 'true' or page->'rows'->0->>'canContact' is distinct from 'true' then
    raise exception 'SUMMARY_PERMISSION_DRIFT'; end if;
  page:=public.list_student_records_page('awaiting_first_contact','all',subject::text,'records',1,20,
    '{"version":2,"filters":{}}','zh','{}');
  result:=page->'rows'->0;
  if result->>'canWrite' is distinct from 'true' or result->>'canContact' is distinct from 'true' then raise exception 'PAGE_PERMISSION_DRIFT'; end if;
  execute 'reset role';
  if (select count(*) from public.lead_communications)<>before_contacts then raise exception 'READ_CREATED_COMMUNICATION'; end if;

  execute 'set local role authenticated';
  payload:=jsonb_build_object('studentId',null,'leadId',subject,'mode','contact','outcome','unreachable','note','Actual attempted contact',
    'nextContactAt',now()+interval '2 days');
  result:=public.save_student_record_entry(request,payload);
  perform public.save_student_record_entry(request,payload);
  execute 'reset role';
  if (select count(*) from public.lead_communications where lead_id=subject)<>1 or not exists(
    select 1 from public.lead_communications where lead_id=subject and recorded_by=actor and owner_id_at_contact is null
  ) then raise exception 'CONTACT_ACTOR_OR_IDEMPOTENCY_CHANGED'; end if;
  if (select owner_id from public.leads where id=subject) is not null then raise exception 'CONTACT_ASSIGNED_ADMIN'; end if;
  if not exists(select 1 from public.lead_next_actions where lead_id=subject and status='open' and kind='retry') then
    raise exception 'ADMIN_REMINDER_BLOCKED'; end if;
  execute 'set local role authenticated';
  perform public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',blank_phone,
    'mode','contact','outcome','unreachable','note','Contact information to confirm'));
  execute 'reset role';
  if (select phone from public.leads where id=blank_phone)<>'' then raise exception 'PHONE_FABRICATED'; end if;

  execute 'set local role authenticated';
  result:=public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',subject,
    'mode','invitation','note','Discussed a future activity','nextContactAt',now()+interval '3 days',
    'invitation',jsonb_build_object('kind','waiting_activity','state','waiting_activity')));
  student_id:=(result->'subject'->>'studentId')::uuid;
  invitation_id:=(result->'subject'->'invitation'->>'id')::uuid;
  if student_id is null or invitation_id is null then raise exception 'ADMIN_INVITATION_OR_PROFILE_BLOCKED'; end if;
  execute 'reset role';
  if (select assigned_to from public.students where id=student_id) is not null
    or (select owner_id from public.leads where id=subject) is not null
    or (select owner_id_at_open from public.lead_invitation_threads where id=invitation_id) is not null then
    raise exception 'INVITATION_OR_PROFILE_ASSIGNED_ADMIN'; end if;
  if not exists(select 1 from public.students where id=student_id and created_by=actor) then
    raise exception 'PROFILE_OPERATOR_LOST'; end if;
  execute 'set local role authenticated';
  perform public.update_lead_invitation(invitation_id,'waiting_activity','waiting_activity',null,null,'','','phone','Administrative follow-up');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  result:=public.read_student_record_subject(null,blank_phone);
  if result->>'canWrite' is distinct from 'false' or result->>'canContact' is distinct from 'false' then
    raise exception 'SCOPED_STAFF_UNASSIGNED_WRITE_CAPABILITY'; end if;
  begin perform public.read_student_record_subject(null,other_owner); raise exception 'SCOPED_STAFF_READ_OTHER_OWNER';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',blank_phone,
    'mode','contact','outcome','unreachable','note','Out of scope')); raise exception 'SCOPED_STAFF_WRITE_UNASSIGNED';
    exception when others then get stacked diagnostics err=message_text; if err<>'LEAD_UNASSIGNED' then raise; end if; end;
  begin perform public.record_lead_contact_v4(blank_phone,'unreachable','Out of scope',null,null,null,null,null,null,'{}','{}',null,'',null);
    raise exception 'DIRECT_RPC_BYPASSED_UNASSIGNED_GUARD';
    exception when others then get stacked diagnostics err=message_text; if err<>'LEAD_UNASSIGNED' then raise; end if; end;
  begin perform public.ensure_lead_student_profile(subject); raise exception 'PROFILE_SCOPE_BYPASS';
    exception when insufficient_privilege then null; end;
  result:=public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',assigned,
    'mode','contact','outcome','unreachable','note','Assigned staff contact'));
  execute 'reset role';
  if result->'subject'->>'canWrite' is distinct from 'true' or (select owner_id from public.leads where id=assigned)<>teacher then
    raise exception 'ASSIGNED_STAFF_REGRESSION'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin perform public.save_student_record_entry(gen_random_uuid(),payload); raise exception 'NONSTAFF_WRITE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.save_student_record_entry(gen_random_uuid(),payload); raise exception 'ANONYMOUS_WRITE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'UNAUTHENTICATED' then raise; end if; end;
  execute 'set local role anon';
  begin perform public.save_student_record_entry(gen_random_uuid(),payload); raise exception 'ANON_RPC_EXPOSED';
    exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
rollback to savepoint student_record_access_contract;
