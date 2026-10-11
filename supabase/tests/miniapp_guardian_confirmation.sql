-- Run only inside an identified local BEGIN / ROLLBACK transaction.
do $$
declare staff uuid; child uuid; other_child uuid; invitation jsonb; revoked jsonb; expired jsonb; preview jsonb;
  reservation jsonb; confirmed jsonb; uid uuid; intake uuid; lease uuid:=gen_random_uuid(); answers jsonb;
  child_before jsonb; student_count integer; guardian_count integer; staff_before jsonb; staff_auth jsonb;
  staff_subject text; staff_phone text; second jsonb; unknown_owner uuid:=gen_random_uuid();
begin
  select id into staff from auth.users where email='test-admin@mathin.local';
  if staff is null or not public.is_staff(staff) then raise exception 'FIXED_DEVELOPMENT_ADMIN_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  insert into public.students(name,grade,school,parent_phone,bind_code,created_by)
    values('事务关联孩子',3,'保密学校','15500009171',gen_random_uuid()::text,staff) returning id into child;
  insert into public.students(name,grade,parent_phone,bind_code,created_by)
    values('同手机号其他孩子',5,'15500009171',gen_random_uuid()::text,staff) returning id into other_child;
  select count(*) into student_count from public.students;
  select to_jsonb(s) into child_before from public.students s where id=child;
  invitation:=public.issue_miniapp_guardian_invite(child);
  if length(invitation->>'code')<>32 then raise exception 'WEAK_INVITATION'; end if;
  preview:=public.miniapp_guardian_preview(invitation->>'code');
  if preview->>'maskedName'<>'事＊' or preview::text like '%事务关联孩子%' or preview ? 'studentId'
    or preview::text like '%保密学校%' or preview::text like '%15500009171%' then raise exception 'PREVIEW_LEAKED_PROFILE'; end if;
  if public.miniapp_guardian_preview(repeat('0',32)) is not null then raise exception 'UNKNOWN_CODE_VISIBLE'; end if;
  revoked:=public.issue_miniapp_guardian_invite(child);
  perform public.revoke_miniapp_guardian_invite((revoked->>'id')::uuid);
  expired:=public.issue_miniapp_guardian_invite(child);
  update public.guardian_bind_invitations set expires_at=now()-interval '1 second' where id=(expired->>'id')::uuid;
  if public.miniapp_guardian_preview(revoked->>'code') is not null or public.miniapp_guardian_preview(expired->>'code') is not null then raise exception 'DEAD_INVITATION_VISIBLE'; end if;
  answers:=jsonb_build_object('parentName','事务监护人','relation','mother','consent',true,
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin perform public.miniapp_prepare_guardian(invitation->>'code','fixture:guardian-one','+8615500009171','15500009171',answers||'{"consent":false}',lease);
    raise exception 'MISSING_CONSENT_ALLOWED'; exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
  begin perform public.miniapp_prepare_guardian(invitation->>'code','fixture:guardian-one','+8615500009171','15500009171',answers||'{"privacyVersion":"stale"}',lease);
    raise exception 'STALE_POLICY_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORM_CHANGED' then raise; end if; end;
  begin perform public.miniapp_prepare_guardian(revoked->>'code','fixture:guardian-one','+8615500009171','15500009171',answers,lease);
    raise exception 'REVOKED_CODE_ALLOWED'; exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
  reservation:=public.miniapp_prepare_guardian(invitation->>'code','fixture:guardian-one','+8615500009171','15500009171',answers,lease);
  uid:=(reservation->>'userId')::uuid; intake:=(reservation->>'id')::uuid;
  if exists(select 1 from public.student_guardians where student_id in(child,other_child)) or exists(select 1 from public.profiles where id=uid)
    then raise exception 'PREPARATION_BOUND_OR_CREATED_ACCOUNT'; end if;
  begin perform public.miniapp_prepare_guardian(invitation->>'code','fixture:guardian-two','+8615500009172','15500009172',answers,gen_random_uuid());
    raise exception 'INVITATION_RESERVATION_STOLEN'; exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.miniapp_prepare_guardian(invitation->>'code','fixture:guardian-one','+8615500009171','15500009171',answers,gen_random_uuid());
    raise exception 'CONCURRENT_CONFIRM_ALLOWED'; exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500009171',now(),
      jsonb_build_object('miniapp_registration_id',intake,'provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  if not exists(select 1 from public.profiles where id=uid and role='parent') or public.is_staff(uid) then raise exception 'NEW_ACCOUNT_ROLE_WRONG'; end if;
  begin perform public.miniapp_complete_guardian(intake,'fixture:guardian-one',lease);
    raise exception 'UNVERIFIED_IDENTITY_CONFIRMED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),uid,'custom:wechat','fixture:guardian-one','{"sub":"fixture:guardian-one"}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  if public.bind_guardian(invitation->>'code','妈妈') is not null then raise exception 'LEGACY_PATH_SKIPPED_CONFIRMATION'; end if;
  if public.miniapp_can_participate(child) or exists(select 1 from public.get_my_students()) then raise exception 'PRE_CONFIRM_PROFILE_VISIBLE'; end if;
  begin perform public.issue_miniapp_guardian_invite(child); raise exception 'PARENT_ISSUED_INVITE';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  confirmed:=public.miniapp_complete_guardian(intake,'fixture:guardian-one',lease);
  if (confirmed->>'studentId')::uuid<>child or (select count(*) from public.students)<>student_count
    or (select to_jsonb(s) from public.students s where id=child)<>child_before then raise exception 'EXISTING_STUDENT_CHANGED_OR_DUPLICATED'; end if;
  if (select count(*) from public.student_guardians where guardian_id=uid)<>1
    or exists(select 1 from public.student_guardians where student_id=other_child) then raise exception 'PHONE_AUTO_LINKED_OTHER_CHILD'; end if;
  if (select count(*) from public.guardian_consents where guardian_id=uid and student_id=child and consented)<>2 then raise exception 'CHILD_CONSENT_MISSING'; end if;
  select count(*) into guardian_count from public.guardian_consents;
  update public.miniapp_intakes set lease_key=null,lease_until=null where id=intake;
  second:=public.miniapp_prepare_guardian(invitation->>'code','fixture:guardian-one','+8615500009171','15500009171',answers,lease);
  if not (second->>'completed')::boolean or second->>'id'<>reservation->>'id'
    or public.miniapp_complete_guardian(intake,'fixture:guardian-one',lease)<>confirmed
    or (select count(*) from public.guardian_consents)<>guardian_count then raise exception 'RETRY_NOT_IDEMPOTENT'; end if;
  begin perform public.miniapp_complete_guardian(intake,'fixture:guardian-other',lease); raise exception 'OTHER_IDENTITY_REPLAYED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  if not public.miniapp_can_participate(child,'grades') or not public.miniapp_can_register(child,'activity')
    or public.miniapp_can_participate(child,'video') or public.miniapp_can_participate(child,'finance')
    or public.miniapp_can_participate(other_child) or not exists(select 1 from public.get_my_students() where id=child)
    then raise exception 'CONFIRMED_SCOPE_WRONG'; end if;
  -- An existing work account keeps its role and credentials when explicitly linking a child.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  invitation:=public.issue_miniapp_guardian_invite(child);
  select to_jsonb(p) into staff_before from public.profiles p where id=staff;
  select to_jsonb(u),coalesce(nullif(regexp_replace(u.phone,'[^0-9]','','g'),''),'8615500009173') into staff_auth,staff_phone from auth.users u where id=staff;
  select identity_data->>'sub' into staff_subject from auth.identities where user_id=staff and provider='custom:wechat' limit 1;
  if staff_subject is null then
    staff_subject:='fixture:guardian-work';
    insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(gen_random_uuid(),staff,'custom:wechat',staff_subject,jsonb_build_object('sub',staff_subject));
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  reservation:=public.miniapp_prepare_guardian(invitation->>'code',staff_subject,'+'||staff_phone,right(staff_phone,11),answers,lease);
  if (reservation->>'userId')::uuid<>staff then raise exception 'EXISTING_ACCOUNT_NOT_REUSED'; end if;
  perform public.miniapp_complete_guardian((reservation->>'id')::uuid,staff_subject,lease);
  if (select to_jsonb(p) from public.profiles p where id=staff)<>staff_before or (select to_jsonb(u) from auth.users u where id=staff)<>staff_auth
    then raise exception 'EXISTING_ACCOUNT_CHANGED'; end if;
  if has_function_privilege('anon','public.miniapp_guardian_preview(text)','execute')
    or has_function_privilege('authenticated','public.miniapp_prepare_guardian(text,text,text,text,jsonb,uuid)','execute')
    or has_function_privilege('authenticated','public.miniapp_complete_guardian(uuid,text,uuid)','execute')
    then raise exception 'GUARDIAN_SERVICE_RPC_EXPOSED'; end if;
end $$;
