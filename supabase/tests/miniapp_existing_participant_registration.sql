-- Run with the migration in an identified local BEGIN / ROLLBACK transaction.
do $$
declare uid uuid; outsider uuid; fid uuid; intake uuid; child uuid; own_self uuid; unrelated uuid;
  before_student jsonb; before_guardian jsonb; before_count integer; result uuid;
begin
  select id into uid from auth.users where email='test-admin@mathin.local';
  select id into outsider from auth.users where email='test-parent-unbound@mathin.local';
  if uid is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  insert into public.students(name,bind_code,created_by) values('事务已有参与人',gen_random_uuid()::text,uid) returning id into child;
  insert into public.student_guardians(student_id,guardian_id,relation,scope,is_primary)
    values(child,uid,'监护人',array['activities'],true);
  insert into public.students(name,bind_code,user_id,created_by) values('事务本人参与人',gen_random_uuid()::text,uid,uid) returning id into own_self;
  insert into public.students(name,bind_code,user_id,created_by) values('事务无关参与人',gen_random_uuid()::text,outsider,uid) returning id into unrelated;
  insert into public.families(display_name,created_by) values('事务补填登记',uid) returning id into fid;
  insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,intake_kind,
    registration_user_id,wechat_subject,verified_phone,local_phone,uses_existing_account,profile_created_at,family_id)
    values(gen_random_uuid(),'family-onboarding',1,'{}','{}','family-onboarding','family',uid,
      'fixture:existing-participant:'||gen_random_uuid(),'+8615500090983','15500090983',true,now(),fid) returning id into intake;
  select to_jsonb(s) into before_student from public.students s where id=child;
  select to_jsonb(g) into before_guardian from public.student_guardians g where student_id=child and guardian_id=uid;
  select count(*) into before_count from public.students;
  result:=public.miniapp_attach_family_child(intake,jsonb_build_object('key','existing','participantId',child,'childName','补填称呼'),'', 'father');
  if result<>child or (select count(*) from public.students)<>before_count
    or (select to_jsonb(s) from public.students s where id=child)<>before_student
    or (select to_jsonb(g) from public.student_guardians g where student_id=child and guardian_id=uid)<>before_guardian
    then raise exception 'EXISTING_PARTICIPANT_OR_SCOPE_CHANGED'; end if;
  if public.miniapp_attach_family_child(intake,jsonb_build_object('key','existing','participantId',child),'','father')<>child
    or public.miniapp_attach_family_child(intake,jsonb_build_object('key','self','participantId',own_self),'','guardian')<>own_self
    then raise exception 'RETRY_OR_SELF_IDENTITY_FAILED'; end if;
  if (select child_participants->>'existing' from public.miniapp_intakes where id=intake)<>child::text
    or exists(select 1 from public.family_students where family_id=fid and is_primary)
    then raise exception 'ORIGINAL_HOUSEHOLD_REPLACED'; end if;
  begin perform public.miniapp_attach_family_child(intake,jsonb_build_object('key','foreign','participantId',unrelated),'','guardian');
    raise exception 'UNRELATED_PARTICIPANT_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  update public.students set deleted_at=now() where id=own_self;
  begin perform public.miniapp_attach_family_child(intake,jsonb_build_object('key','deleted','participantId',own_self),'','guardian');
    raise exception 'DELETED_PARTICIPANT_ALLOWED'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  update public.miniapp_intakes set uses_existing_account=false where id=intake;
  begin perform public.miniapp_attach_family_child(intake,jsonb_build_object('key','new-account','participantId',child),'','guardian');
    raise exception 'NEW_ACCOUNT_REUSED_PARTICIPANT'; exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if has_function_privilege('authenticated','public.miniapp_attach_family_child(uuid,jsonb,text,text,boolean)','execute')
    or has_function_privilege('service_role','public.miniapp_attach_family_child(uuid,jsonb,text,text,boolean)','execute')
    then raise exception 'INTERNAL_ATTACHMENT_EXPOSED'; end if;
end $$;
