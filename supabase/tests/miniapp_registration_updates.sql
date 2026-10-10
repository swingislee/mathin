-- Execute only inside an identified isolated development transaction; caller rolls back all fixtures.
do $$
declare uid uuid; outsider uuid; fid uuid; contact uuid; original uuid; child uuid; unrelated uuid;
  request_id uuid:=gen_random_uuid(); new_request uuid:=gen_random_uuid(); result jsonb; replay jsonb;
  form public.miniapp_forms%rowtype; answers jsonb; before_original jsonb; before_student jsonb; before_guardian jsonb;
  before_students integer; before_sources integer; before_worklist integer; new_student uuid;
begin
  select id into uid from auth.users where email='test-admin@mathin.local';
  select id into outsider from auth.users where email='test-parent-unbound@mathin.local';
  if uid is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  if exists(select 1 from public.miniapp_intakes where intake_kind='family' and registration_user_id=uid)
    then raise exception 'DEVELOPMENT_OWNER_ALREADY_REGISTERED'; end if;
  insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source)
    select account,account,policy_kind,version,'account','granted','registration'
    from public.consent_policies cross join unnest(array[uid,outsider]) account where required;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  update public.miniapp_forms set enabled=true,
    fields=(select jsonb_agg(jsonb_set(field,'{mode}','"optional"')) from jsonb_array_elements(fields) field)
    where slug='family-onboarding';
  select * into form from public.miniapp_forms where slug='family-onboarding';
  if form.slug is null then raise exception 'FAMILY_FORM_REQUIRED'; end if;
  insert into public.families(display_name,created_by) values('事务登记家庭',uid) returning id into fid;
  insert into public.contacts(display_name,phone,phone_normalized,profile_id,created_by)
    values('事务登记联系人','+8615500090984','8615500090984',uid,uid) returning id into contact;
  insert into public.family_contacts(family_id,contact_id,is_primary,created_by) values(fid,contact,true,uid);
  insert into public.students(name,bind_code,created_by) values('事务已有参与人',gen_random_uuid()::text,uid) returning id into child;
  insert into public.student_guardians(student_id,guardian_id,relation,scope,is_primary)
    values(child,uid,'监护人',array['activities'],true);
  insert into public.students(name,bind_code,user_id,created_by) values('事务无关参与人',gen_random_uuid()::text,outsider,uid) returning id into unrelated;
  answers:=jsonb_build_object('parentName','原登记联系人','relation','mother','childName','原登记称呼','gender','female','grade',3,
    'school','','interests','[]'::jsonb,'formVersion',form.version,'consent',true,'location',jsonb_build_object('status','declined'),
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required));
  answers:=answers||jsonb_build_object('children',jsonb_build_array(jsonb_build_object('key','child-1','participantId',child,
    'childName','原登记称呼','gender','female','grade',3,'school','','interests','[]'::jsonb)));
  insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,intake_kind,
    registration_user_id,wechat_subject,verified_phone,local_phone,uses_existing_account,profile_created_at,family_id)
    values(gen_random_uuid(),form.slug,form.version,to_jsonb(form),answers,'family-onboarding','family',uid,
      'fixture:registration-update:'||gen_random_uuid(),'+8615500090984','15500090984',true,now(),fid) returning id into original;
  perform public.miniapp_attach_family_child(original,answers->'children'->0,answers->>'parentName',answers->>'relation');
  update public.miniapp_intakes set completed_at=now()-interval '1 day' where id=original;
  select to_jsonb(i) into before_original from public.miniapp_intakes i where id=original;
  select to_jsonb(s) into before_student from public.students s where id=child;
  select to_jsonb(g) into before_guardian from public.student_guardians g where student_id=child and guardian_id=uid;
  select count(*) into before_students from public.students;
  select count(*) into before_sources from public.lead_source_records;
  select count(*) into before_worklist from public.school_source_worklist_entries;
  answers:=jsonb_set(answers,'{parentName}','"补充联系人"');
  result:=public.miniapp_submit_registration_update(request_id,form.version,answers);
  replay:=public.miniapp_submit_registration_update(request_id,form.version,answers);
  if result<>replay or result->>'participantId'<>child::text or (select count(*) from public.students)<>before_students
    or (select count(*) from public.lead_source_records)<>before_sources+1
    or (select count(*) from public.school_source_worklist_entries)<>before_worklist
    or (select to_jsonb(i) from public.miniapp_intakes i where id=original)<>before_original
    or (select to_jsonb(s) from public.students s where id=child)<>before_student
    or (select to_jsonb(g) from public.student_guardians g where student_id=child and guardian_id=uid)<>before_guardian
    then raise exception 'RETRY_OR_ORIGINAL_DATA_CHANGED'; end if;
  if public.miniapp_family_for_subject(child,null)->>'id'<>result->>'id' then raise exception 'LATEST_SUPPLEMENT_NOT_VISIBLE'; end if;
  begin perform public.miniapp_submit_registration_update(request_id,form.version,jsonb_set(answers,'{parentName}','"changed"'));
    raise exception 'REQUEST_KEY_REUSED'; exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,jsonb_set(answers,'{children,0,participantId}',to_jsonb(unrelated::text)));
    raise exception 'FOREIGN_PARTICIPANT_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  update public.student_guardians set scope=array['grades'] where student_id=child and guardian_id=uid;
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,answers);
    raise exception 'REVOKED_PARTICIPATION_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  update public.student_guardians set scope=array['activities'] where student_id=child and guardian_id=uid;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin perform public.miniapp_submit_registration_update(request_id,form.version,answers);
    raise exception 'FOREIGN_RECEIPT_ALLOWED'; exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,answers);
    raise exception 'UNREGISTERED_ACCOUNT_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,answers);
    raise exception 'ANONYMOUS_ALLOWED'; exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  update public.profiles set is_active=false where id=uid;
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,answers);
    raise exception 'DISABLED_ACCOUNT_ALLOWED'; exception when raise_exception then if sqlerrm<>'ACCOUNT_SECURITY' then raise; end if; end;
  update public.profiles set is_active=true where id=uid;
  update public.miniapp_forms set enabled=false where slug=form.slug;
  if public.miniapp_submit_registration_update(request_id,form.version,answers)<>result then raise exception 'SAVED_RECEIPT_CHANGED'; end if;
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,answers);
    raise exception 'DISABLED_FORM_ALLOWED'; exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  update public.miniapp_forms set enabled=true where slug=form.slug;
  select * into form from public.miniapp_forms where slug='family-onboarding';
  answers:=jsonb_set(answers,'{formVersion}',to_jsonb(form.version));
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version+1,answers);
    raise exception 'STALE_FORM_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  begin perform public.miniapp_submit_registration_update(gen_random_uuid(),form.version,jsonb_set(answers,'{privacyVersion}','"stale"'));
    raise exception 'STALE_CONSENT_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  answers:=answers #- '{children,0,participantId}';
  answers:=jsonb_set(answers,'{children,0,childName}','"事务新增参与人"');
  result:=public.miniapp_submit_registration_update(new_request,form.version,answers);
  new_student:=(result->>'participantId')::uuid;
  if new_student is null or new_student=child or (select count(*) from public.students)<>before_students+1
    or not exists(select 1 from public.student_guardians where student_id=new_student and guardian_id=uid and scope=array['activities'])
    then raise exception 'NEW_PARTICIPANT_ATTACHMENT_FAILED'; end if;
  if has_function_privilege('anon','public.miniapp_submit_registration_update(uuid,integer,jsonb)','execute')
    or not has_function_privilege('authenticated','public.miniapp_submit_registration_update(uuid,integer,jsonb)','execute')
    then raise exception 'REGISTRATION_RPC_GRANTS_INVALID'; end if;
end $$;
