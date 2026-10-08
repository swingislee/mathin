-- The verified local runner wraps migration and synthetic rows in BEGIN / ROLLBACK.
do $$
declare admin_id uuid; outside_id uuid; first_scene text; second_scene text; family jsonb; reservation jsonb; again jsonb;
  uid uuid; intake uuid; lease uuid:=gen_random_uuid(); result jsonb; sid uuid; dash jsonb; old_lead uuid; second jsonb; second_user uuid;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into outside_id from auth.users where email='test-parent-unbound@mathin.local';
  if admin_id is null or outside_id is null or not public.has_perm(admin_id,'registration.invite.manage') then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if has_function_privilege('anon','public.miniapp_prepare_family(text,text,text,text,jsonb,uuid)','execute')
    or has_function_privilege('authenticated','public.miniapp_prepare_family(text,text,text,text,jsonb,uuid)','execute')
    or has_function_privilege('authenticated','public.miniapp_complete_family(uuid,text,uuid)','execute')
    or has_function_privilege('authenticated','public.miniapp_create_parent_profile(uuid,text,text)','execute')
    or has_table_privilege('authenticated','public.miniapp_intakes','insert') then raise exception 'ONBOARDING_PERMISSION_LEAK'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outside_id,'role','authenticated')::text,true);
  begin perform public.miniapp_manage_promotion(null,'Denied',true); raise exception 'PARENT_CAN_CREATE_PROMOTION';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.miniapp_promotion_dashboard(); raise exception 'PARENT_CAN_READ_PROMOTIONS';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  first_scene:=public.miniapp_manage_promotion(null,'事务验证推广甲',true);
  second_scene:=public.miniapp_manage_promotion(null,'事务验证推广乙',true);
  if first_scene=second_scene or first_scene !~ '^[a-f0-9]{24}$' then raise exception 'PROMOTION_ID_COLLISION'; end if;
  family:=jsonb_build_object('parentName','事务验证家长','relation','mother','childName','事务验证孩子','gender','',
    'grade',-1,'school','','interests',jsonb_build_array('activities'),'location',jsonb_build_object('status','declined'),
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required),'consent',true);
  begin perform public.miniapp_prepare_family('fixture:family-one','+8615500009011','15500009011',first_scene,family||'{"consent":false}',lease); raise exception 'CONSENT_BYPASSED';
    exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform public.miniapp_prepare_family('fixture:family-one','+8615500009011','15500009011',first_scene,family||'{"privacyVersion":"1900-01-01"}',lease); raise exception 'STALE_CONSENT_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  reservation:=public.miniapp_prepare_family('fixture:family-one','+8615500009011','15500009011',first_scene,family,lease);
  uid:=(reservation->>'userId')::uuid; intake:=(reservation->>'id')::uuid;
  if exists(select 1 from public.profiles where id=uid) then raise exception 'PREPARE_CREATED_ACCOUNT'; end if;
  begin perform public.miniapp_prepare_family('fixture:family-one','+8615500009011','15500009011',second_scene,family,gen_random_uuid()); raise exception 'CONCURRENT_CLAIM_ALLOWED';
    exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500009011',now(),
      jsonb_build_object('miniapp_registration_id',intake,'provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  if not exists(select 1 from public.profiles where id=uid and role='parent' and is_active and not password_change_required)
    or not public.has_current_required_consents(uid) then raise exception 'PARENT_ACCOUNT_NOT_READY'; end if;
  if public.has_perm(uid,'registration.invite.manage') or public.is_staff(uid) then raise exception 'REGISTRATION_GRANTED_STAFF'; end if;
  if not exists(select 1 from public.account_identifier_assurances where user_id=uid and attestation_source='wechat_phone' and provider_verified) then raise exception 'PHONE_PROOF_NOT_RECORDED'; end if;
  begin perform public.miniapp_complete_family(intake,'fixture:family-one',lease); raise exception 'UNLINKED_IDENTITY_COMPLETED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),uid,'custom:wechat','fixture:family-one','{"sub":"fixture:family-one"}');
  result:=public.miniapp_complete_family(intake,'fixture:family-one',lease);
  sid:=(result->>'studentId')::uuid;
  if (public.miniapp_complete_family(intake,'fixture:family-one',lease)->>'studentId')::uuid<>sid then raise exception 'RETRY_DUPLICATED_CHILD'; end if;
  if (select count(*) from public.student_guardians where guardian_id=uid)<>1 then raise exception 'REGISTRATION_LINKED_OTHER_CHILD'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  if not public.miniapp_can_register(sid,'activity') or public.miniapp_can_register(sid,'class')
    or public.guardian_can(sid,uid,'grades') or public.guardian_can(sid,uid,'finance') or public.guardian_can(sid,uid,'video') then raise exception 'ACTIVITY_ONLY_SCOPE_FAILED'; end if;
  if exists(select 1 from public.consent_records where student_id=sid and scope in ('learning','video')) then raise exception 'UNREQUESTED_CHILD_CONSENT'; end if;
  if (select count(*) from public.get_my_students())<>1 then raise exception 'FAMILY_CANNOT_READ_OWN_CHILD'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outside_id,'role','authenticated')::text,true);
  if public.miniapp_can_register(sid,'activity') then raise exception 'OTHER_PARENT_CAN_REGISTER_CHILD'; end if;
  perform public.miniapp_record_promotion_touch(second_scene,uid);
  update public.miniapp_intakes set lease_until=null,lease_key=null where id=intake;
  again:=public.miniapp_prepare_family('fixture:family-one','+8615500009011','15500009011',second_scene,family||'{"childName":"改名后的同一孩子"}',lease);
  if again->>'id'<>reservation->>'id' or not (again->>'completed')::boolean then raise exception 'RENAME_CREATED_SECOND_FAMILY'; end if;
  if (select form_slug from public.miniapp_intakes where id=intake)<>first_scene then raise exception 'LATER_PROMOTER_REPLACED_CREDIT'; end if;
  begin perform public.miniapp_prepare_family('fixture:other-wechat','+8615500009011','15500009011',second_scene,family,gen_random_uuid()); raise exception 'PHONE_TAKEOVER_ALLOWED';
    exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,status,created_by)
    values('历史事务孩子',public.normalize_lead_name('历史事务孩子'),'15500009012','15500009012','uncontacted',admin_id) returning id into old_lead;
  second:=public.miniapp_prepare_family('fixture:family-two','+8615500009012','15500009012',second_scene,family||'{"childName":"历史事务孩子","grade":3}',lease);
  second_user:=(second->>'userId')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(second_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500009012',now(),
      jsonb_build_object('miniapp_registration_id',second->>'id','provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),second_user,'custom:wechat','fixture:family-two','{"sub":"fixture:family-two"}');
  perform public.miniapp_complete_family((second->>'id')::uuid,'fixture:family-two',lease);
  if (select student_id is not null from public.leads where id=old_lead) then raise exception 'HISTORICAL_IDENTITY_AUTO_MERGED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  dash:=public.miniapp_promotion_dashboard(null,1);
  if not exists(select 1 from jsonb_array_elements(dash->'promotions') p where p->>'scene'=first_scene and (p->>'newCount')::integer=1)
    or not exists(select 1 from jsonb_array_elements(dash->'promotions') p where p->>'scene'=second_scene and (p->>'newCount')::integer=0 and (p->>'repeatCount')::integer=2) then raise exception 'ACQUISITION_COUNTS_WRONG'; end if;
  perform public.miniapp_manage_promotion(first_scene,'No rename',false);
  begin perform public.miniapp_prepare_family('fixture:disabled','+8615500009013','15500009013',first_scene,family,lease); raise exception 'DISABLED_PROMOTION_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
end $$;
