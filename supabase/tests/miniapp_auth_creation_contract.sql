-- Run inside a verified local rollback transaction. Simulate Auth's actual
-- insert -> identity -> metadata -> phone confirmation transaction sequence.
do $$
declare family jsonb; reserved jsonb; uid uuid; intake uuid; lease uuid:=gen_random_uuid(); linked uuid;
  bad_reserved jsonb; bad_uid uuid; bad_intake uuid; phone text:='8615500090921';
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  family:=jsonb_build_object('parentName','事务时序家长','relation','mother','childName','事务时序孩子','gender','',
    'grade',5,'school','','interests',jsonb_build_array('math'),'location',jsonb_build_object('status','declined'),
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required),'consent',true);
  reserved:=public.miniapp_prepare_family('fixture:auth-order','+'||phone,'15500090921',null,family,lease);
  uid:=(reserved->>'userId')::uuid; intake:=(reserved->>'id')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',phone,
      '{"provider":"phone","providers":["phone"]}','{}',now(),now());
  if not exists(select 1 from public.profiles where id=uid and role='parent' and is_active)
    or (select profile_created_at from public.miniapp_intakes where id=intake) is null
    or public.is_staff(uid) then raise exception 'AUTH_INSERT_PROFILE_FAILED'; end if;
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),uid,'phone',uid::text,jsonb_build_object('sub',uid,'phone',phone)),
      (gen_random_uuid(),uid,'custom:wechat','fixture:auth-order','{"sub":"fixture:auth-order"}');
  begin perform public.miniapp_complete_family(intake,'fixture:auth-order',lease); raise exception 'UNCONFIRMED_AUTH_COMPLETED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('miniapp_registration_id',intake) where id=uid;
  begin perform public.miniapp_complete_family(intake,'fixture:auth-order',lease); raise exception 'UNCONFIRMED_PHONE_COMPLETED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  update auth.users set phone_confirmed_at=now() where id=uid;
  linked:=(public.miniapp_complete_family(intake,'fixture:auth-order',lease)->>'studentId')::uuid;
  if linked is null or not exists(select 1 from public.student_guardians where student_id=linked and guardian_id=uid and scope=array['activities'])
    or (public.miniapp_complete_family(intake,'fixture:auth-order',lease)->>'studentId')::uuid<>linked then raise exception 'AUTH_FINAL_STATE_NOT_RESUMABLE'; end if;

  bad_reserved:=public.miniapp_prepare_family('fixture:auth-rejected','+8615500090922','15500090922',null,family,gen_random_uuid());
  bad_uid:=(bad_reserved->>'userId')::uuid; bad_intake:=(bad_reserved->>'id')::uuid;
  begin
    insert into auth.users(id,aud,role,phone,raw_app_meta_data,raw_user_meta_data)
      values(bad_uid,'authenticated','authenticated','8615500090999','{"provider":"phone"}','{}');
    raise exception 'WRONG_RESERVED_PHONE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'INVALID_REGISTRATION' then raise; end if; end;
  begin
    insert into auth.users(id,aud,role,email,phone,raw_app_meta_data,raw_user_meta_data)
      values(bad_uid,'authenticated','authenticated','fixture@example.test','8615500090922','{"provider":"phone"}','{}');
    raise exception 'EMAIL_TAKEN_AS_PHONE_ACCOUNT';
  exception when raise_exception then if sqlerrm<>'INVALID_REGISTRATION' then raise; end if; end;
  begin
    insert into auth.users(id,aud,role,phone,raw_app_meta_data,raw_user_meta_data)
      values(gen_random_uuid(),'authenticated','authenticated','8615500090922','{"provider":"phone"}',jsonb_build_object('miniapp_registration_id',bad_intake));
    raise exception 'USER_METADATA_GRANTED_ONBOARDING';
  exception when raise_exception then if sqlerrm<>'INVALID_REGISTRATION_INVITE' then raise; end if; end;
  begin
    insert into auth.users(id,aud,role,phone,raw_app_meta_data,raw_user_meta_data)
      values(gen_random_uuid(),'authenticated','authenticated','8615500090922',jsonb_build_object('miniapp_registration_id',bad_intake),'{}');
    raise exception 'WRONG_RESERVED_UUID_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'INVALID_REGISTRATION' then raise; end if; end;
  update public.miniapp_intakes set lease_until=now()-interval '1 second' where id=bad_intake;
  begin
    insert into auth.users(id,aud,role,phone,raw_app_meta_data,raw_user_meta_data)
      values(bad_uid,'authenticated','authenticated','8615500090922','{"provider":"phone"}','{}');
    raise exception 'EXPIRED_LEASE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'INVALID_REGISTRATION' then raise; end if; end;
  if exists(select 1 from public.profiles where id=bad_uid) then raise exception 'REJECTED_PROFILE_SURVIVED'; end if;
end $$;
