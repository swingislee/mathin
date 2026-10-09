-- Run after miniapp_family_onboarding.sql and miniapp_promotion_forms.sql in one rollback transaction.
do $$
declare actor uuid; outsider uuid; sales uuid; r public.miniapp_intakes%rowtype; sid uuid; lid uuid; detail jsonb;
  sources integer; links jsonb; uid uuid; intake uuid; lease uuid:=gen_random_uuid(); prepared jsonb; family_answers jsonb;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into outsider from auth.users where email='test-parent-unbound@mathin.local';
  select id into sales from auth.users where email='test-sales@mathin.local';
  if actor is null or outsider is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if has_function_privilege('anon','public.miniapp_family_for_subject(uuid,uuid)','execute')
    or has_function_privilege('anon','public.miniapp_promotion_settings()','execute')
    or has_function_privilege('authenticated','public.miniapp_sync_lead_sources(uuid)','execute')
    or has_function_privilege('service_role','public.miniapp_sync_lead_sources(uuid)','execute') then raise exception 'PRIVATE_SOURCE_ACCESS_EXPOSED'; end if;
  select * into strict r from public.miniapp_intakes where wechat_subject='fixture:form-family' and intake_kind='family';
  sid:=(r.child_participants->>'child-1')::uuid; lid:=(r.child_leads->>'child-1')::uuid;
  if lid is null or (select status from public.leads where id=lid)<>'uncontacted' then raise exception 'REGISTRATION_NOT_READY_FOR_FIRST_CONTACT'; end if;
  if (select count(*) from public.lead_source_records where miniapp_intake_id=r.id)<>3
    or (select count(*) from public.school_source_worklist_entries where miniapp_intake_id=r.id)<>3
    or (select count(*) from public.lead_interest_selections where lead_id=lid and label='阅读')<>2 then raise exception 'REGISTRATION_SOURCE_NOT_PROJECTED'; end if;
  select count(*) into sources from public.lead_source_records where lead_id=lid;
  perform public.miniapp_sync_lead_sources(r.id);
  if (select count(*) from public.lead_source_records where lead_id=lid)<>sources then raise exception 'SOURCE_RETRY_DUPLICATED'; end if;
  if (select count(distinct lead_id) from public.lead_source_records where miniapp_child_key='child-1' and miniapp_intake_id in
    (select id from public.miniapp_intakes where registration_user_id=r.registration_user_id))<>1 then raise exception 'REPEAT_SCAN_DUPLICATED_LEAD'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.miniapp_family_for_subject(sid,lid); raise exception 'PARENT_READ_STAFF_SOURCE';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.miniapp_promotion_settings(); raise exception 'PARENT_READ_PROMOTION_SETTINGS';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  detail:=public.miniapp_family_for_subject(sid,lid);
  if detail->>'registrationId'<>r.id::text or detail#>>'{children,0,childName}'<>'小太阳'
    or not exists(select 1 from jsonb_array_elements(detail->'participants') p where p->>'name'='沟通核实孩子')
    or not (detail->>'canVerify')::boolean then raise exception 'SOURCE_AND_VERIFIED_DETAILS_NOT_SEPARATE'; end if;
  begin perform public.miniapp_family_for_subject((r.child_participants->>'child-2')::uuid,lid); raise exception 'MISMATCHED_SUBJECT_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if not exists(select 1 from public.school_visible_source_layout('acquisition') w where w.lead_id=lid
    and w.group_label='微信扫码' and w.subgroup_label='事务验证阅读场景') then raise exception 'LEAD_WORKLIST_SOURCE_MISSING'; end if;
  if not exists(select 1 from jsonb_array_elements(public.miniapp_promotion_settings()) p
    where p->>'scene'=r.form_slug and (p->>'newCount')::integer=2) then raise exception 'PROMOTION_SETTINGS_COUNTS_WRONG'; end if;
  if sales is null or not public.has_perm(sales,'followup.view') or public.has_perm(sales,'student.view.all') then raise exception 'SCOPED_STAFF_REQUIRED'; end if;
  update public.leads set owner_id=sales where id=lid;
  update public.students set assigned_to=sales where id=sid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',sales,'role','authenticated')::text,true);
  detail:=public.miniapp_family_for_subject(sid,lid);
  if jsonb_array_length(detail->'children')<>1 or jsonb_array_length(detail->'participants')<>1
    or (detail->>'canVerify')::boolean then raise exception 'SIBLING_SCOPE_LEAKED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);

  -- Hidden/optional child names produce distinct pending leads, without invented student identities.
  family_answers:=r.answers||'{"childName":"","grade":null,"school":"","children":[{"key":"child-1","childName":"","grade":null,"school":"","gender":"","interests":["reading"]},{"key":"child-2","childName":"","grade":null,"school":"","gender":"","interests":["reading"]}]}';
  prepared:=public.miniapp_prepare_family('fixture:pending-siblings','+8615500090913','15500090913',r.form_slug,family_answers,lease);
  intake:=(prepared->>'id')::uuid; uid:=(prepared->>'userId')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500090913',now(),
      jsonb_build_object('miniapp_registration_id',intake,'provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),uid,'custom:wechat','fixture:pending-siblings','{"sub":"fixture:pending-siblings"}');
  perform public.miniapp_complete_family(intake,'fixture:pending-siblings',lease);
  select child_leads into links from public.miniapp_intakes where id=intake;
  if (select count(*) from jsonb_each_text(links))<>2 or links->>'child-1'=links->>'child-2'
    or exists(select 1 from public.student_guardians where guardian_id=uid) then raise exception 'PENDING_CHILDREN_COLLAPSED_OR_CREATED_STUDENTS'; end if;
  lid:=(links->>'child-1')::uuid;
  update public.leads set owner_id=actor where id=lid;
  perform public.record_lead_contact_v4(lid,'connected','回滚事务首联验证',null,null,null,null,null,null,'{}','{}',null,'',null);
  if (select student_id from public.leads where id=lid) is not null then raise exception 'CONTACT_CREATED_PLACEHOLDER_STUDENT'; end if;
  perform public.miniapp_verify_family(intake,null,'{"parentName":"已核实家长","children":[{"key":"child-1","childName":"补充孩子甲","grade":3,"school":"","gender":"","interests":[]},{"key":"child-2","childName":"补充孩子乙","grade":5,"school":"","gender":"","interests":[]}]}');
  if (select child_leads from public.miniapp_intakes where id=intake)<>links
    or (select status from public.leads where id=lid)<>'contacted'
    or (select student_id from public.leads where id=lid) is null
    or (select answers#>>'{children,0,childName}' from public.miniapp_intakes where id=intake)<>''
    or (select count(*) from public.lead_source_records where miniapp_intake_id=intake)<>2 then raise exception 'VERIFICATION_CHANGED_LEAD_SOURCE_OR_CONTACT'; end if;
end $$;
