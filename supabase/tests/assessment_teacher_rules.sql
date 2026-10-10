-- Run in BEGIN / ROLLBACK on the verified isolated development database.
create function pg_temp.expect_assessment_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $setup$
declare v_admin uuid; v_family jsonb; v_reservation jsonb; v_user uuid; v_student uuid; v_other uuid;
  v_lease uuid:=gen_random_uuid(); v_campus uuid; v_slot uuid:=gen_random_uuid();
  v_start timestamptz:=((now() at time zone 'Asia/Shanghai')::date+2+time '15:35') at time zone 'Asia/Shanghai';
begin
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id
    where u.email='test-admin@mathin.local' and p.purpose='test' and p.role='admin';
  if v_admin is null then raise exception 'FIXED_DEVELOPMENT_ADMIN_REQUIRED'; end if;
  v_family:=jsonb_build_object('parentName','预约规则事务联系人','relation','mother','childName','预约规则事务参与人',
    'gender','','grade',3,'school','','interests',jsonb_build_array('activities'),
    'location',jsonb_build_object('status','declined'),'consent',true,
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_reservation:=public.miniapp_prepare_family('fixture:assessment-rules','+8615500010161','15500010161',null,v_family,v_lease);
  v_user:=(v_reservation->>'userId')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500010161',now(),
      jsonb_build_object('miniapp_registration_id',v_reservation->>'id','provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),v_user,'custom:wechat','fixture:assessment-rules','{"sub":"fixture:assessment-rules"}');
  v_student:=(public.miniapp_complete_family((v_reservation->>'id')::uuid,'fixture:assessment-rules',v_lease)->>'studentId')::uuid;
  insert into public.students(name,bind_code,created_by) values('无关联预约事务参与人',gen_random_uuid()::text,v_admin) returning id into v_other;
  if not exists(select 1 from public.student_guardians where student_id=v_student and guardian_id=v_user and scope=array['activities'])
    or public.is_staff(v_user) then raise exception 'ORDINARY_ACTIVITY_PARTICIPANT_REQUIRED'; end if;
  perform set_config('test.assessment.user',v_user::text,true);
  perform set_config('test.assessment.student',v_student::text,true);
  perform set_config('test.assessment.other',v_other::text,true);
  perform set_config('test.assessment.slot',v_slot::text,true);
  perform set_config('test.assessment.admin',v_admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  v_campus:=public.create_campus_v2('预约规则事务校区 '||gen_random_uuid()::text,'事务结束回滚');
  perform public.save_assessment_slot(v_slot,v_admin,v_campus,array['math'],array[3],v_start,v_start+interval '40 minutes',true);
  perform set_config('test.assessment.campus',v_campus::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
end $setup$;

do $teacher_fixture$
declare v_teacher uuid; v_role uuid:=gen_random_uuid();
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_teacher from public.profiles where role='staff' and purpose='test' and is_active and account_status='active' and not password_change_required order by id limit 1;
  if v_teacher is null then raise exception 'FIXED_DEVELOPMENT_TEACHER_REQUIRED'; end if;
  -- Narrow only the verified development teacher inside this rollback transaction.
  delete from public.staff_role_members where user_id=v_teacher;
  insert into public.staff_roles(id,key,name) values(v_role,'rule_fixture_'||v_role::text,'规则事务权限');
  insert into public.role_permissions(role_id,perm_key) values(v_role,'review.write');
  insert into public.staff_role_members(user_id,role_id) values(v_teacher,v_role);
  perform set_config('test.rules.teacher',v_teacher::text,true);
  perform set_config('test.rules.id',gen_random_uuid()::text,true);
  perform set_config('test.rules.exclude',gen_random_uuid()::text,true);
  perform set_config('test.rules.topic',gen_random_uuid()::text,true);
end $teacher_fixture$;

set local role authenticated;
do $admin_topic$
declare v_admin uuid:=current_setting('test.assessment.admin')::uuid; v_result jsonb; v_topic text:=current_setting('test.rules.topic');
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  v_result:=public.save_assessment_topic(v_topic,'科学','Science',true,null);
  if not exists(select 1 from jsonb_array_elements(v_result->'topics') t where t->>'id'=v_topic and t->>'name'='科学') then raise exception 'TOPIC_SAVE_FAILED'; end if;
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_topic(%L,''changed'','''',true,null)',v_topic),'CONFLICT');
end $admin_topic$;

do $teacher_rules$
declare v_teacher uuid:=current_setting('test.rules.teacher')::uuid; v_admin uuid:=current_setting('test.assessment.admin')::uuid;
  v_id uuid:=current_setting('test.rules.id')::uuid; v_exclude uuid:=current_setting('test.rules.exclude')::uuid;
  v_day date:=(now() at time zone 'Asia/Shanghai')::date+3; v_result jsonb; v_definition jsonb; v_rule jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
  v_result:=public.get_assessment_rules_workspace();
  if (v_result->>'canManageAll')::boolean or exists(select 1 from jsonb_array_elements(v_result->'teachers') t where t->>'id'<>v_teacher::text) then raise exception 'TEACHER_READ_SCOPE_FAILED'; end if;
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_topic(%L,''unallowed'','''',true,null)',gen_random_uuid()::text),'FORBIDDEN');
  v_definition:=jsonb_build_object('kind','open','label','事务开放','campusId',current_setting('test.assessment.campus'),
    'topics',jsonb_build_array('thinking',current_setting('test.rules.topic')),'grades','[3]'::jsonb,'weekdays','[1,2,3,4,5,6,7]'::jsonb,
    'from',v_day,'until',v_day,'startMinute',60,'endMinute',180,'durationMinutes',40,'timeZone','Asia/Shanghai','enabled',true);
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_rule(%L,%L,%L,null)',v_id,v_admin,v_definition),'FORBIDDEN');
  v_result:=public.save_assessment_rule(v_id,v_teacher,v_definition,null);
  select r into v_rule from jsonb_array_elements(v_result->'rules') r where r->>'id'=v_id::text;
  if (v_rule->>'availableCount')::integer<>3 then raise exception 'RULE_GENERATION_FAILED'; end if;
  perform set_config('test.rules.definition',v_definition::text,true);
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_rule(%L,%L,%L,null)',v_id,v_teacher,v_definition),'CONFLICT');
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_rule(%L,%L,%L,null)',gen_random_uuid(),v_teacher,v_definition),'TIME_UNAVAILABLE');
  if jsonb_array_length(public.get_assessment_rules_workspace()->'rules')<>1 then raise exception 'CONFLICTING_RULE_NOT_ROLLED_BACK'; end if;
  v_definition:=v_definition||jsonb_build_object('kind','exclude','label','事务部分排除','campusId',null,'topics','[]'::jsonb,'grades','[]'::jsonb,
    'weekdays','[]'::jsonb,'startMinute',100,'endMinute',140,'durationMinutes',null);
  v_result:=public.save_assessment_rule(v_exclude,v_teacher,v_definition,null);
  select r into v_rule from jsonb_array_elements(v_result->'rules') r where r->>'id'=v_id::text;
  if (v_rule->>'availableCount')::integer<>2 then raise exception 'PARTIAL_EXCLUSION_FAILED'; end if;
end $teacher_rules$;

do $participant_book$
declare v_user uuid:=current_setting('test.assessment.user')::uuid; v_student uuid:=current_setting('test.assessment.student')::uuid;
  v_teacher text:=current_setting('test.rules.teacher'); v_topic text:=current_setting('test.rules.topic');
  v_result jsonb; v_slot jsonb; v_blocked jsonb; v_id uuid:=gen_random_uuid(); v_booked jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  perform pg_temp.expect_assessment_error('select public.get_assessment_rules_workspace()','FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_rule(%L,%L,%L,null)',gen_random_uuid(),v_teacher,current_setting('test.rules.definition')),'FORBIDDEN');
  v_result:=public.parent_assessment_overview(v_student);
  if not exists(select 1 from jsonb_array_elements(v_result->'topics') t where t->>'id'=v_topic and t#>>'{label,zh}'='科学' and (t->>'available')::boolean) then raise exception 'DYNAMIC_TOPIC_NOT_VISIBLE'; end if;
  v_result:=public.parent_assessment_availability(v_student,array[v_topic],3);
  select s into v_slot from jsonb_array_elements(v_result->'slots') s where s->>'teacherId'=v_teacher and (s->>'available')::boolean order by s->>'startsAt' limit 1;
  select s into v_blocked from jsonb_array_elements(v_result->'slots') s where s->>'teacherId'=v_teacher and not (s->>'available')::boolean limit 1;
  if v_slot is null or v_blocked is null then raise exception 'SLOT_AVAILABILITY_FAILED'; end if;
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[%L],3)',gen_random_uuid(),v_student,v_blocked->>'id',v_topic),'SLOT_UNAVAILABLE');
  v_booked:=public.book_parent_assessment_slot(v_id,v_student,(v_slot->>'id')::uuid,array[v_topic],3);
  if v_booked->>'state'<>'confirmed' or public.book_parent_assessment_slot(v_id,v_student,(v_slot->>'id')::uuid,array[v_topic],3)<>v_booked then raise exception 'NEW_TOPIC_BOOK_OR_REPLAY_FAILED'; end if;
  perform set_config('test.rules.booking',v_booked::text,true);
  perform set_config('test.rules.booked_slot',v_slot->>'id',true);
end $participant_book$;

do $update_rules$
declare v_teacher uuid:=current_setting('test.rules.teacher')::uuid; v_rule jsonb; v_result jsonb;
  v_id uuid:=current_setting('test.rules.id')::uuid; v_exclude uuid:=current_setting('test.rules.exclude')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
  select r into v_rule from jsonb_array_elements(public.get_assessment_rules_workspace()->'rules') r where r->>'id'=v_id::text;
  v_result:=public.save_assessment_rule(v_id,v_teacher,current_setting('test.rules.definition')::jsonb||jsonb_build_object('startMinute',70,'endMinute',190),(v_rule->>'updatedAt')::timestamptz);
  select r into v_rule from jsonb_array_elements(v_result->'rules') r where r->>'id'=v_id::text;
  if (v_rule->>'bookedCount')::integer<>1 then raise exception 'BOOKING_COUNT_LOST'; end if;
  select r into v_rule from jsonb_array_elements(v_result->'rules') r where r->>'id'=v_exclude::text;
  v_result:=public.save_assessment_rule(v_exclude,v_teacher,(v_rule-array['id','teacherId','updatedAt','availableCount','bookedCount'])||jsonb_build_object('startMinute',0,'endMinute',1440),(v_rule->>'updatedAt')::timestamptz);
  if exists(select 1 from jsonb_array_elements(v_result->'rules') r where r->>'kind'='open' and (r->>'availableCount')::integer<>0) then raise exception 'WHOLE_DAY_EXCLUSION_FAILED'; end if;
end $update_rules$;

do $preservation$
declare v_booked jsonb:=current_setting('test.rules.booking')::jsonb; v_current jsonb; v_student uuid:=current_setting('test.assessment.student')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.assessment.user'),'role','authenticated')::text,true);
  select r into v_current from jsonb_array_elements(public.parent_assessment_overview(v_student)->'requests') r where r->>'id'=v_booked->>'id';
  if v_current<>v_booked then raise exception 'EXISTING_BOOKING_CHANGED'; end if;
  if exists(select 1 from jsonb_array_elements(public.parent_assessment_overview(v_student)->'topics') t where t->>'id'=current_setting('test.rules.topic') and (t->>'available')::boolean) then raise exception 'EXCLUDED_TOPIC_STILL_AVAILABLE'; end if;
  if public.book_parent_assessment_slot((v_booked->>'id')::uuid,v_student,current_setting('test.rules.booked_slot')::uuid,array[current_setting('test.rules.topic')],3)<>v_booked then raise exception 'BOOKING_REPLAY_AFTER_RULE_CHANGE_FAILED'; end if;
end $preservation$;
reset role;

do $acl_and_standalone$
declare sig text; v_rule public.assessment_availability_rules%rowtype; v_slot public.assessment_slots%rowtype;
  v_teacher uuid:=current_setting('test.rules.teacher')::uuid; v_admin uuid:=current_setting('test.assessment.admin')::uuid;
  v_user uuid:=current_setting('test.assessment.user')::uuid; v_student uuid:=current_setting('test.assessment.student')::uuid; v_result jsonb;
begin
  foreach sig in array array['public.get_assessment_rules_workspace()','public.save_assessment_topic(text,text,text,boolean,timestamptz)','public.save_assessment_rule(uuid,uuid,jsonb,timestamptz)'] loop
    if has_function_privilege('anon',sig,'execute') or not has_function_privilege('authenticated',sig,'execute') then raise exception 'RULE_RPC_ACL_FAILED'; end if;
  end loop;
  foreach sig in array array['public.refresh_assessment_rule_slots(uuid,uuid)','public.assessment_public_topics()','public.assessment_topic_projection()'] loop
    if has_function_privilege('authenticated',sig,'execute') then raise exception 'PRIVATE_RULE_HELPER_EXPOSED'; end if;
  end loop;
  if has_table_privilege('authenticated','public.assessment_topics','insert,update,delete')
    or has_table_privilege('authenticated','public.assessment_availability_rules','insert,update,delete') then raise exception 'RULE_TABLE_WRITES_EXPOSED'; end if;
  select * into v_slot from public.assessment_slots where id=current_setting('test.rules.booked_slot')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_slot(%L,%L,%L,%L,%L,%L,%L,false,%L)',v_slot.id,v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,v_slot.updated_at),'RULE_MANAGED');
  select * into v_rule from public.assessment_availability_rules where id=current_setting('test.rules.exclude')::uuid;
  perform public.save_assessment_rule(v_rule.id,v_teacher,v_rule.definition||'{"enabled":false}'::jsonb,v_rule.updated_at);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  select * into v_slot from public.assessment_slots where id=current_setting('test.assessment.slot')::uuid;
  perform public.save_assessment_rule(gen_random_uuid(),v_admin,v_rule.definition||jsonb_build_object('enabled',true,'from',(v_slot.starts_at at time zone 'Asia/Shanghai')::date,'until',(v_slot.starts_at at time zone 'Asia/Shanghai')::date),null);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  v_result:=public.parent_assessment_availability(v_student,array['math'],3);
  if exists(select 1 from jsonb_array_elements(v_result->'slots') s where s->>'id'=v_slot.id::text and (s->>'available')::boolean) then raise exception 'STANDALONE_EXCLUSION_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  perform public.save_assessment_topic(current_setting('test.rules.topic'),'科学','Science',false,(select updated_at from public.assessment_topics where id=current_setting('test.rules.topic')));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  if exists(select 1 from jsonb_array_elements(public.parent_assessment_overview(v_student)->'topics') t where t->>'id'=current_setting('test.rules.topic') and (t->>'available')::boolean) then raise exception 'DISABLED_TOPIC_AVAILABLE'; end if;
  if public.book_parent_assessment_slot((current_setting('test.rules.booking')::jsonb->>'id')::uuid,v_student,current_setting('test.rules.booked_slot')::uuid,array[current_setting('test.rules.topic')],3)<>current_setting('test.rules.booking')::jsonb then raise exception 'DISABLED_TOPIC_REPLAY_FAILED'; end if;
  -- Cancelling the fixture booking releases the current rule's overlapping
  -- candidate immediately, even after the rule's time has changed.
  update public.lead_invitation_threads set state='cancelled',closed_at=now(),closed_by=v_admin where id=(current_setting('test.rules.booking')::jsonb->>'id')::uuid;
  v_result:=public.parent_assessment_availability(v_student,array['thinking'],3);
  if not exists(select 1 from jsonb_array_elements(v_result->'slots') s where s->>'teacherId'=v_teacher::text
    and (s->>'startsAt')::timestamptz=(current_setting('test.rules.booking')::jsonb->>'scheduledAt')::timestamptz+interval '10 minutes'
    and (s->>'available')::boolean) then raise exception 'CANCELLED_BOOKING_DID_NOT_RELEASE_CURRENT_RULE'; end if;
end $acl_and_standalone$;
