-- Only run inside the identified local database's BEGIN / ROLLBACK transaction.
do $$
declare uid uuid; subject text; phone text; family jsonb; reservation jsonb; intake uuid; lease uuid:=gen_random_uuid();
  child_id uuid; self_id uuid; other_id uuid; old_auth jsonb; old_profile jsonb; count_before integer;
begin
  select id into uid from auth.users where email='test-admin@mathin.local';
  if uid is null or not public.is_staff(uid) then raise exception 'FIXED_DEVELOPMENT_ADMIN_REQUIRED'; end if;
  select to_jsonb(u),coalesce(nullif(regexp_replace(u.phone,'[^0-9]','','g'),''),'8615500090961') into old_auth,phone from auth.users u where id=uid;
  select to_jsonb(p) into old_profile from public.profiles p where id=uid;
  select count(*) into count_before from auth.users;
  select identity_data->>'sub' into subject from auth.identities where user_id=uid and provider='custom:wechat' limit 1;
  if subject is null then
    subject:='fixture:multi-identity';
    insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(gen_random_uuid(),uid,'custom:wechat',subject,jsonb_build_object('sub',subject));
  end if;
  family:=jsonb_build_object('parentName','事务家长','relation','father','childName','事务孩子','gender','',
    'grade',3,'school','','interests',jsonb_build_array('math'),'location',jsonb_build_object('status','declined'),
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required),'consent',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  reservation:=public.miniapp_prepare_family(subject,'+'||phone,right(phone,11),null,family,lease);
  intake:=(reservation->>'id')::uuid;
  if (reservation->>'userId')::uuid<>uid or not (reservation->>'created')::boolean
    or not (select uses_existing_account from public.miniapp_intakes where id=intake) then raise exception 'EXISTING_IDENTITY_NOT_REUSED'; end if;
  child_id:=(public.miniapp_complete_family(intake,subject,lease)->>'studentId')::uuid;
  if child_id is null or (public.miniapp_complete_family(intake,subject,lease)->>'studentId')::uuid<>child_id then raise exception 'FAMILY_RETRY_CHANGED_CHILD'; end if;
  if (select count(*) from auth.users)<>count_before or (select to_jsonb(u) from auth.users u where id=uid)<>old_auth
    or (select to_jsonb(p) from public.profiles p where id=uid)<>old_profile then raise exception 'EXISTING_ACCOUNT_MUTATED'; end if;
  if not exists(select 1 from public.student_guardians where student_id=child_id and guardian_id=uid and scope=array['activities']) then raise exception 'CHILD_SCOPE_WRONG'; end if;
  insert into public.students(name,bind_code,created_by) values('无关联事务学生',gen_random_uuid()::text,uid) returning id into other_id;
  insert into public.students(name,bind_code,user_id,created_by) values('工作人员本人事务学生',gen_random_uuid()::text,uid,uid) returning id into self_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  if not public.miniapp_family_ready() or not public.miniapp_can_register(child_id,'activity')
    or public.miniapp_can_participate(child_id,'grades') or public.miniapp_can_participate(child_id,'video')
    or public.miniapp_can_register(other_id,'activity') or public.miniapp_can_participate(other_id)
    or not public.miniapp_can_participate(self_id) then raise exception 'WORK_ROLE_REPLACED_RELATIONSHIP_SCOPE'; end if;
  if not exists(select 1 from public.get_my_students() where id=self_id)
    or not exists(select 1 from public.get_my_students() where id=child_id)
    or exists(select 1 from public.get_my_students() where id=other_id) then raise exception 'PARTICIPANT_LIST_SCOPE_WRONG'; end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin perform public.miniapp_prepare_family('fixture:unrelated-wechat','+'||phone,right(phone,11),null,family,gen_random_uuid());
    raise exception 'PHONE_TAKEOVER_ALLOWED'; exception when raise_exception then if sqlerrm<>'CONFLICT' then raise; end if; end;
  begin perform public.miniapp_complete_family(intake,'fixture:unrelated-wechat',lease);
    raise exception 'WRONG_IDENTITY_COMPLETED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if has_function_privilege('authenticated','public.miniapp_prepare_family(text,text,text,text,jsonb,uuid)','execute')
    or has_function_privilege('anon','public.miniapp_complete_family(uuid,text,uuid)','execute')
    or has_table_privilege('authenticated','public.miniapp_intakes','update') then raise exception 'SERVICE_RESERVATION_EXPOSED'; end if;
end $$;
