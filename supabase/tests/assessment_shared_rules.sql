-- Run only in a verified isolated development database, in BEGIN / ROLLBACK.
create function pg_temp.expect_shared_rule_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $fixture$
declare v_admin uuid; v_teacher uuid; v_role uuid:=gen_random_uuid(); v_campus uuid; v_group uuid;
begin
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id
    where u.email='test-admin@mathin.local' and p.purpose='test' and p.role='admin';
  select id into v_teacher from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required order by id limit 1;
  if v_admin is null or v_teacher is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  -- Only the fixed test employee has its capability narrowed inside this rollback.
  delete from public.staff_role_members where user_id=v_teacher;
  insert into public.staff_roles(id,key,name) values(v_role,'shared_rule_fixture_'||v_role,'共享规则事务岗位');
  insert into public.role_permissions(role_id,perm_key) values(v_role,'review.write');
  insert into public.staff_role_members(user_id,role_id) values(v_teacher,v_role);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  perform public.set_school_staff_business_role(v_teacher,'teacher');
  perform public.set_school_staff_business_role(v_admin,null);
  v_campus:=public.create_campus_v2('共享规则事务校区 '||gen_random_uuid(),'事务结束回滚');
  v_group:=public.save_school_business_group(null,'共享规则事务组 '||gen_random_uuid());
  perform public.set_school_business_group_member(v_group,v_teacher,true);
  perform set_config('test.shared.admin',v_admin::text,true);
  perform set_config('test.shared.teacher',v_teacher::text,true);
  perform set_config('test.shared.campus',v_campus::text,true);
  perform set_config('test.shared.group',v_group::text,true);
  perform set_config('test.shared.rule',gen_random_uuid()::text,true);
  perform set_config('test.shared.exclude',gen_random_uuid()::text,true);
end $fixture$;

do $family$
declare v_lease uuid:=gen_random_uuid(); v_family jsonb; v_reservation jsonb; v_user uuid; v_student uuid;
begin
  v_family:=jsonb_build_object('parentName','共享规则事务联系人','relation','mother','childName','共享规则事务参与人',
    'gender','','grade',3,'school','','interests',jsonb_build_array('activities'),
    'location',jsonb_build_object('status','declined'),'consent',true,
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_reservation:=public.miniapp_prepare_family('fixture:assessment-shared-rules','+8615500010171','15500010171',null,v_family,v_lease);
  v_user:=(v_reservation->>'userId')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500010171',now(),
      jsonb_build_object('miniapp_registration_id',v_reservation->>'id','provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),v_user,'custom:wechat','fixture:assessment-shared-rules','{"sub":"fixture:assessment-shared-rules"}');
  v_student:=(public.miniapp_complete_family((v_reservation->>'id')::uuid,'fixture:assessment-shared-rules',v_lease)->>'studentId')::uuid;
  perform set_config('test.shared.parent',v_user::text,true);
  perform set_config('test.shared.student',v_student::text,true);
end $family$;

set local role authenticated;
do $scoped_rules$
declare v_admin uuid:=current_setting('test.shared.admin')::uuid; v_teacher uuid:=current_setting('test.shared.teacher')::uuid;
  v_id uuid:=current_setting('test.shared.rule')::uuid; v_group uuid:=current_setting('test.shared.group')::uuid;
  v_day date:=(now() at time zone 'Asia/Shanghai')::date+3; v_def jsonb; v_scope jsonb; v_result jsonb; v_calendar jsonb; v_rule jsonb;
  v_slot uuid; v_booking jsonb; v_current jsonb; v_student uuid:=current_setting('test.shared.student')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  v_result:=public.get_assessment_rules_workspace();
  if exists(select 1 from jsonb_array_elements(v_result->'teachers') t where t->>'id'=v_admin::text)
    or not exists(select 1 from jsonb_array_elements(v_result->'teachers') t where t->>'id'=v_teacher::text)
    then raise exception 'BUSINESS_ROLE_ROSTER_FAILED'; end if;
  v_scope:=jsonb_build_object('kind','groups','ids',jsonb_build_array(v_group));
  v_def:=jsonb_build_object('kind','open','label','共享规则事务','campusId',current_setting('test.shared.campus'),
    'topics','["thinking"]'::jsonb,'grades','[]'::jsonb,'weekdays','[1,2,3,4,5,6,7]'::jsonb,
    'from',v_day,'until',v_day,'startMinute',75,'endMinute',155,'durationMinutes',40,'timeZone','Asia/Shanghai','enabled',true);
  perform pg_temp.expect_shared_rule_error(format('select public.save_assessment_shared_rule(%L,%L,%L,null)',v_id,'{"kind":null,"ids":[]}',v_def),'VALIDATION');
  v_result:=public.save_assessment_shared_rule(v_id,v_scope,v_def,null);
  select r into v_rule from jsonb_array_elements(v_result->'rules') r where r->>'id'=v_id::text;
  if v_rule->'scope'<>v_scope or v_rule->>'teacherId' is not null then raise exception 'SHARED_SCOPE_NOT_SAVED'; end if;
  v_calendar:=public.get_assessment_teacher_calendar(v_teacher,v_day,v_day);
  if (select count(*) from jsonb_array_elements(v_calendar) s where s->>'campusId'=current_setting('test.shared.campus') and (s->>'enabled')::boolean)<>2 then raise exception 'SHARED_SLOT_GENERATION_FAILED'; end if;
  perform pg_temp.expect_shared_rule_error(format('select public.save_assessment_shared_rule(%L,%L,%L,null)',v_id,v_scope,v_def),'CONFLICT');
  perform pg_temp.expect_shared_rule_error(format('select public.save_assessment_rule(%L,%L,%L,%L)',v_id,v_teacher,v_def,v_rule->>'updatedAt'),'FORBIDDEN');
  perform set_config('test.shared.definition',v_def::text,true);
  select (s->>'id')::uuid into v_slot from jsonb_array_elements(v_calendar) s where s->>'campusId'=current_setting('test.shared.campus') order by s->>'startsAt' limit 1;
  perform set_config('test.shared.slot',v_slot::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.shared.parent'),'role','authenticated')::text,true);
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(v_student,array['thinking'],3)->'slots') s
    where s->>'id'=v_slot::text and (s->>'available')::boolean) then raise exception 'PARENT_SCOPE_AVAILABILITY_FAILED'; end if;
  v_booking:=public.book_parent_assessment_slot(gen_random_uuid(),v_student,v_slot,array['thinking'],3);
  if v_booking->>'state'<>'confirmed' then raise exception 'SHARED_SLOT_BOOKING_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  -- Removing and restoring group membership changes openings without copying rules.
  perform public.set_school_business_group_member(v_group,v_teacher,false);
  if exists(select 1 from jsonb_array_elements(public.get_assessment_teacher_calendar(v_teacher,v_day,v_day)) s
    where s->>'campusId'=current_setting('test.shared.campus') and (s->>'enabled')::boolean) then raise exception 'REMOVED_GROUP_STILL_AVAILABLE'; end if;
  perform public.set_school_business_group_member(v_group,v_teacher,true);
  if not exists(select 1 from jsonb_array_elements(public.get_assessment_teacher_calendar(v_teacher,v_day,v_day)) s
    where s->>'id'=current_setting('test.shared.slot')) then raise exception 'RESTORED_SLOT_ID_CHANGED'; end if;
  -- A shared exclusion acts on personal/standalone openings too.
  perform public.save_assessment_shared_rule(current_setting('test.shared.exclude')::uuid,
    jsonb_build_object('kind','teachers','ids',jsonb_build_array(v_teacher)),
    v_def||'{"kind":"exclude","topics":[],"grades":[],"weekdays":[],"durationMinutes":null,"startMinute":75,"endMinute":115}'::jsonb,null);
  if not exists(select 1 from jsonb_array_elements(public.get_assessment_teacher_calendar(v_teacher,v_day,v_day)) s
    where s->>'id'=current_setting('test.shared.slot') and (s->>'blocked')::boolean) then raise exception 'SHARED_EXCLUSION_FAILED'; end if;
  -- All-teacher scope can be saved once even before anyone belongs to a group.
  perform public.save_assessment_shared_rule(gen_random_uuid(),'{"kind":"all","ids":[]}',
    v_def||'{"kind":"exclude","topics":[],"grades":[],"weekdays":[],"durationMinutes":null,"enabled":false}'::jsonb,null);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_shared_rule_error(format('select public.save_assessment_shared_rule(%L,%L,%L,null)',gen_random_uuid(),v_scope,v_def),'FORBIDDEN');
  perform pg_temp.expect_shared_rule_error(format('select public.get_assessment_teacher_calendar(%L,%L,%L)',v_admin,v_day,v_day),'FORBIDDEN');
  if exists(select 1 from jsonb_array_elements(public.get_assessment_rules_workspace()->'teachers') t where t->>'id'<>v_teacher::text) then raise exception 'OWN_TEACHER_READ_SCOPE_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  perform public.set_school_staff_business_role(v_teacher,null);
  if exists(select 1 from jsonb_array_elements(public.get_assessment_rules_workspace()->'teachers') t where t->>'id'=v_teacher::text) then raise exception 'REMOVED_TEACHER_STILL_LISTED'; end if;
  if exists(select 1 from jsonb_array_elements(public.get_assessment_teacher_calendar(v_teacher,v_day,v_day)) s
    where s->>'campusId'=current_setting('test.shared.campus') and (s->>'enabled')::boolean) then raise exception 'REMOVED_TEACHER_STILL_AVAILABLE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.shared.parent'),'role','authenticated')::text,true);
  select r into v_current from jsonb_array_elements(public.parent_assessment_overview(v_student)->'requests') r where r->>'id'=v_booking->>'id';
  if v_current is distinct from v_booking then raise exception 'BOOKING_CHANGED_WITH_GROUP_OR_ROLE'; end if;
  if public.book_parent_assessment_slot((v_booking->>'id')::uuid,v_student,v_slot,array['thinking'],3)<>v_booking then raise exception 'BOOKING_REPLAY_LOST'; end if;
  if exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(v_student,array['thinking'],3)->'teachers') t
    where t->>'id'=v_teacher::text) then raise exception 'PARENT_SEES_REMOVED_TEACHER'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  perform public.set_school_staff_business_role(v_teacher,'assessment_teacher');
  if jsonb_array_length(public.get_assessment_teacher_calendar(v_teacher,v_day,v_day))<2 then raise exception 'RESTORED_TEACHER_NOT_AVAILABLE'; end if;
end $scoped_rules$;
reset role;

do $acl$
begin
  if has_function_privilege('anon','public.save_assessment_shared_rule(uuid,jsonb,jsonb,timestamptz)','EXECUTE')
    or has_function_privilege('anon','public.get_assessment_teacher_calendar(uuid,date,date)','EXECUTE')
    or has_function_privilege('authenticated','public.validate_assessment_rule_definition(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.refresh_assessment_staff_scope()','EXECUTE')
    or has_table_privilege('authenticated','public.assessment_availability_rules','UPDATE')
    then raise exception 'SHARED_RULE_ACL_FAILED'; end if;
end $acl$;
