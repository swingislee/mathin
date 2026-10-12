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
  v_family:=jsonb_build_object('parentName','预约权限事务联系人','relation','mother','childName','预约权限事务参与人',
    'gender','','grade',3,'school','','interests',jsonb_build_array('activities'),
    'location',jsonb_build_object('status','declined'),'consent',true,
    'privacyVersion',(select version from public.consent_policies where policy_kind='privacy' and required),
    'childrenPrivacyVersion',(select version from public.consent_policies where policy_kind='children_privacy' and required));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_reservation:=public.miniapp_prepare_family('fixture:assessment-participation','+8615500010151','15500010151',null,v_family,v_lease);
  v_user:=(v_reservation->>'userId')::uuid;
  insert into auth.users(id,instance_id,aud,role,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','8615500010151',now(),
      jsonb_build_object('miniapp_registration_id',v_reservation->>'id','provider','phone','providers',jsonb_build_array('phone')),'{}',now(),now());
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),v_user,'custom:wechat','fixture:assessment-participation','{"sub":"fixture:assessment-participation"}');
  v_student:=(public.miniapp_complete_family((v_reservation->>'id')::uuid,'fixture:assessment-participation',v_lease)->>'studentId')::uuid;
  insert into public.students(name,bind_code,created_by) values('无关联预约事务参与人',gen_random_uuid()::text,v_admin) returning id into v_other;
  if not exists(select 1 from public.student_guardians where student_id=v_student and guardian_id=v_user and scope=array['activities'])
    or public.is_staff(v_user) then raise exception 'ORDINARY_ACTIVITY_PARTICIPANT_REQUIRED'; end if;
  perform set_config('test.assessment.admin',v_admin::text,true);
  perform set_config('test.assessment.user',v_user::text,true);
  perform set_config('test.assessment.student',v_student::text,true);
  perform set_config('test.assessment.other',v_other::text,true);
  perform set_config('test.assessment.slot',v_slot::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  v_campus:=public.create_campus_v2('预约权限事务校区 '||gen_random_uuid()::text,'事务结束回滚');
  perform public.set_school_staff_business_role(v_admin,'assessment_teacher');
  perform public.save_assessment_topic('booking_policy_fixture','预约事务主题','Booking fixture',true);
  perform set_config('test.assessment.campus',v_campus::text,true);
  perform public.save_assessment_slot(v_slot,v_admin,v_campus,array['booking_policy_fixture'],array[3],v_start,v_start+interval '40 minutes',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
end $setup$;

do $policy$
declare cfg jsonb; r integer; admin_id uuid:=current_setting('test.assessment.admin')::uuid; campus_id uuid:=current_setting('test.assessment.campus')::uuid;
  online_id uuid:=gen_random_uuid(); near_id uuid:=gen_random_uuid(); late_id uuid:=gen_random_uuid();
  start_at timestamptz:=((now() at time zone 'Asia/Shanghai')::date+21+time '15:35') at time zone 'Asia/Shanghai';
  new_rule_id uuid:=gen_random_uuid(); definition jsonb; rule_date date:=(now() at time zone 'Asia/Shanghai')::date+5;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  cfg:=jsonb_build_object('version',1,'brand',jsonb_build_object('name',jsonb_build_object('zh','预约规则事务','en','Booking policy fixture'),
    'introduction',jsonb_build_object('zh','','en',''),'image','','theme','paper'),'home','[]'::jsonb,'floating','[]'::jsonb,'accountGroups','[]'::jsonb,
    'stages',jsonb_build_array(jsonb_build_object('id','stages','label',jsonb_build_object('zh','阶段','en','Stages'),
      'stages',(select jsonb_agg(jsonb_build_object('id',case when n<1 then 'k'||(n+3)::text else 'g'||n::text end,
        'stageNumber',n,'label',jsonb_build_object('zh',n::text,'en',n::text),'visible',true)) from generate_series(-1,12) n))),
    'booking','{"windowDays":28,"modes":["campus","online"],"bookingCutoffMinutes":30,"selfCancellation":true,"cancellationCutoffMinutes":60,"instructions":{"zh":"预约说明","en":"Booking instructions"}}'::jsonb);
  r:=(public.miniapp_settings_workbench()->>'revision')::integer;
  perform public.save_miniapp_settings(cfg,r,true);
  perform public.save_miniapp_settings(jsonb_set(cfg,'{booking,windowDays}','7'),r+1,false);
  if public.miniapp_booking_policy()->>'windowDays'<>'28' then raise exception 'UNPUBLISHED_POLICY_LEAK'; end if;
  perform pg_temp.expect_assessment_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(cfg,'{booking,windowDays}','57'),r+2),'VALIDATION');
  perform set_config('test.booking.config',cfg::text,true);
  perform public.save_assessment_slot_v2(online_id,admin_id,campus_id,array['booking_policy_fixture'],array[3],start_at,start_at+interval '40 minutes',true,null,'online','仅已预约家庭可见的参加说明');
  perform public.save_assessment_slot_v2(near_id,admin_id,campus_id,array['booking_policy_fixture'],array[3],date_trunc('minute',now())+interval '20 minutes',date_trunc('minute',now())+interval '30 minutes',true,null,'online','测试近场时段');
  perform public.save_assessment_slot_v2(late_id,admin_id,campus_id,array['booking_policy_fixture'],array[3],date_trunc('minute',now())+interval '50 minutes',date_trunc('minute',now())+interval '60 minutes',true,null,'online','测试取消截止');
  perform set_config('test.booking.online',online_id::text,true); perform set_config('test.booking.near',near_id::text,true); perform set_config('test.booking.late',late_id::text,true);
  definition:=jsonb_build_object('kind','open','label','线上事务规则','campusId',campus_id,'topics',jsonb_build_array('booking_policy_fixture'),'grades',jsonb_build_array(3),
    'weekdays',jsonb_build_array(extract(isodow from rule_date)::integer),'from',rule_date,'until',rule_date,'startMinute',600,'endMinute',660,
    'durationMinutes',30,'timeZone','Asia/Shanghai','enabled',true,'mode','online','joiningInstructions','规则参加说明');
  perform public.save_assessment_rule(new_rule_id,admin_id,definition);
  if (select count(*) from public.assessment_slots where assessment_slots.rule_id=new_rule_id and mode='online' and joining_instructions='规则参加说明')<2 then raise exception 'ONLINE_RULE_SLOTS_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.assessment.user'),'role','authenticated')::text,true);
end $policy$;
set local role authenticated;
do $participant$
declare student_id uuid:=current_setting('test.assessment.student')::uuid; other_id uuid:=current_setting('test.assessment.other')::uuid;
  slot_id uuid:=current_setting('test.booking.online')::uuid; request_id uuid:=gen_random_uuid(); a jsonb; booked jsonb;
begin
  a:=public.parent_assessment_availability_v2(student_id,array['booking_policy_fixture'],3,'online');
  if (a->>'to')::date-(a->>'from')::date<>27 or not exists(select 1 from jsonb_array_elements(a->'slots') s where s->>'id'=slot_id::text and (s->>'available')::boolean)
    then raise exception 'CONFIGURED_WINDOW_NOT_APPLIED'; end if;
  if a::text like '%仅已预约家庭%' or exists(select 1 from jsonb_array_elements(a->'slots') s where s ? 'joiningInstructions' or s->>'mode'<>'online') then raise exception 'AVAILABILITY_DISCLOSES_JOINING_DETAILS'; end if;
  if exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(student_id,array['booking_policy_fixture'],3)->'slots') s where s->>'mode'<>'campus') then raise exception 'LEGACY_MODE_CHANGED'; end if;
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot_v2(%L,%L,%L,array[''booking_policy_fixture''],3,''online'')',request_id,other_id,slot_id),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.parent_assessment_availability_v2(%L,array[''booking_policy_fixture''],3,''online'')',other_id),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''booking_policy_fixture''],3)',request_id,student_id,slot_id),'SLOT_UNAVAILABLE');
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot_v2(%L,%L,%L,array[''booking_policy_fixture''],3,''online'')',request_id,student_id,current_setting('test.booking.near')),'SLOT_UNAVAILABLE');
  booked:=public.book_parent_assessment_slot_v2(request_id,student_id,slot_id,array['booking_policy_fixture'],3,'online');
  if booked#>>'{booking,mode}'<>'online' or booked#>>'{booking,joiningInstructions}'<>'仅已预约家庭可见的参加说明' or not (booked->>'canCancel')::boolean
    or booked<>public.book_parent_assessment_slot_v2(request_id,student_id,slot_id,array['booking_policy_fixture'],3,'online') then raise exception 'ONLINE_BOOKING_SNAPSHOT_OR_RETRY'; end if;
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot_v2(%L,%L,%L,array[''booking_policy_fixture''],3,''campus'')',request_id,student_id,slot_id),'CONFLICT');
  perform pg_temp.expect_assessment_error(format('select public.cancel_parent_assessment_slot(%L,%L)',request_id,other_id),'FORBIDDEN');
  perform set_config('test.booking.request',request_id::text,true); perform set_config('test.booking.snapshot',booked::text,true);
end $participant$;
reset role;
do $edit$
declare cfg jsonb:=current_setting('test.booking.config')::jsonb; admin_id uuid:=current_setting('test.assessment.admin')::uuid; s public.assessment_slots;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  select * into s from public.assessment_slots where id=current_setting('test.booking.online')::uuid;
  perform pg_temp.expect_assessment_error(format('select public.save_assessment_slot_v2(%L,%L,%L,array[''booking_policy_fixture''],array[3],%L,%L,true,%L,''online'',''changed'')',s.id,s.teacher_id,s.campus_id,s.starts_at,s.ends_at,s.updated_at),'SLOT_BOOKED');
  cfg:=jsonb_set(jsonb_set(jsonb_set(cfg,'{booking,windowDays}','7'),'{booking,modes}','["campus"]'),'{booking,selfCancellation}','false');
  perform public.save_miniapp_settings(cfg,(public.miniapp_settings_workbench()->>'revision')::integer,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.assessment.user'),'role','authenticated')::text,true);
end $edit$;
set local role authenticated;
do $frozen$
declare student_id uuid:=current_setting('test.assessment.student')::uuid; request_id uuid:=current_setting('test.booking.request')::uuid; r jsonb;
begin
  r:=public.book_parent_assessment_slot_v2(request_id,student_id,current_setting('test.booking.online')::uuid,array['booking_policy_fixture'],3,'online');
  if r<>current_setting('test.booking.snapshot')::jsonb then raise exception 'PUBLISHED_POLICY_REWROTE_BOOKING'; end if;
  r:=public.cancel_parent_assessment_slot(request_id,student_id);
  if r->>'state'<>'cancelled' or (r->>'canCancel')::boolean or r<>public.cancel_parent_assessment_slot(request_id,student_id) then raise exception 'CANCEL_NOT_IDEMPOTENT'; end if;
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot_v2(%L,%L,%L,array[''booking_policy_fixture''],3,''online'')',gen_random_uuid(),student_id,current_setting('test.booking.late')),'SLOT_UNAVAILABLE');
end $frozen$;
reset role;
do $restore$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.assessment.admin'),'role','authenticated','aal','aal2')::text,true);
  perform public.save_miniapp_settings(current_setting('test.booking.config')::jsonb,(public.miniapp_settings_workbench()->>'revision')::integer,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.assessment.user'),'role','authenticated')::text,true);
end $restore$;
set local role authenticated;
do $deadline$
declare student_id uuid:=current_setting('test.assessment.student')::uuid; request_id uuid:=gen_random_uuid(); r jsonb; signature text;
begin
  r:=public.book_parent_assessment_slot(request_id,student_id,current_setting('test.assessment.slot')::uuid,array['booking_policy_fixture'],3);
  if r#>>'{booking,mode}'<>'campus' or r<>public.book_parent_assessment_slot(request_id,student_id,current_setting('test.assessment.slot')::uuid,array['booking_policy_fixture'],3) then raise exception 'LEGACY_CAMPUS_BOOKING_CHANGED'; end if;
  perform public.cancel_parent_assessment_slot(request_id,student_id);
  request_id:=gen_random_uuid();
  r:=public.book_parent_assessment_slot_v2(request_id,student_id,current_setting('test.booking.late')::uuid,array['booking_policy_fixture'],3,'online');
  if (r->>'canCancel')::boolean then raise exception 'EXPIRED_CANCELLATION_AVAILABLE'; end if;
  perform pg_temp.expect_assessment_error(format('select public.cancel_parent_assessment_slot(%L,%L)',request_id,student_id),'BOOKING_CLOSED');
  foreach signature in array array['public.parent_assessment_availability_v2(uuid,text[],integer,text)',
    'public.book_parent_assessment_slot_v2(uuid,uuid,uuid,text[],integer,text)','public.cancel_parent_assessment_slot(uuid,uuid)'] loop
    if has_function_privilege('anon',signature,'execute') or not has_function_privilege('authenticated',signature,'execute') then raise exception 'BOOKING_ACL'; end if;
  end loop;
end $deadline$;
reset role;
