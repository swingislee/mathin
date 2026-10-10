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
  perform set_config('test.assessment.user',v_user::text,true);
  perform set_config('test.assessment.student',v_student::text,true);
  perform set_config('test.assessment.other',v_other::text,true);
  perform set_config('test.assessment.slot',v_slot::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  v_campus:=public.create_campus_v2('预约权限事务校区 '||gen_random_uuid()::text,'事务结束回滚');
  perform public.save_assessment_slot(v_slot,v_admin,v_campus,array['math'],array[3],v_start,v_start+interval '40 minutes',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
end $setup$;

set local role authenticated;
do $participant$
declare v_user uuid:=current_setting('test.assessment.user')::uuid; v_student uuid:=current_setting('test.assessment.student')::uuid;
  v_other uuid:=current_setting('test.assessment.other')::uuid; v_slot uuid:=current_setting('test.assessment.slot')::uuid;
  v_id uuid:=gen_random_uuid(); v_booked jsonb; v_overview jsonb; v_signature text;
begin
  if not public.miniapp_family_ready() or public.miniapp_can_participate(v_student,'grades')
    or public.guardian_can(v_student,v_user,'video') or public.guardian_can(v_student,v_user,'finance')
    then raise exception 'PARTICIPANT_SCOPE_EXPANDED'; end if;
  v_overview:=public.parent_assessment_overview(v_student);
  if v_overview->>'participantId'<>v_student::text or not (v_overview#>>'{eligibility,canRequest}')::boolean then
    raise exception 'ORDINARY_PARTICIPANT_CANNOT_OPEN_BOOKING'; end if;
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(v_student,array['math'],3)->'slots') s
    where s->>'id'=v_slot::text and (s->>'available')::boolean) then raise exception 'PUBLISHED_SLOT_NOT_AVAILABLE'; end if;
  perform pg_temp.expect_assessment_error(format('select public.parent_assessment_overview(%L)',v_other),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.parent_assessment_availability(%L,array[''math''],3)',v_other),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math''],3)',v_id,v_other,v_slot),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.request_parent_assessment(%L,%L,%L,array[''2099-01-01@10:00''])',v_id,v_other,v_user),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.confirm_parent_assessment(%L,%L,''2099-01-01@10:00'',now())',v_id,v_other),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.confirm_parent_assessment(%L,%L,''2099-01-01@10:00'',now())',v_id,v_student),'NOT_FOUND');
  v_booked:=public.book_parent_assessment_slot(v_id,v_student,v_slot,array['math'],3);
  if v_booked->>'state'<>'confirmed' or v_booked#>>'{booking,slotId}'<>v_slot::text
    or public.book_parent_assessment_slot(v_id,v_student,v_slot,array['math'],3)<>v_booked
    then raise exception 'ORDINARY_PARTICIPANT_BOOKING_FAILED'; end if;
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_overview(v_student)->'requests') r where r->>'id'=v_id::text)
    then raise exception 'OWN_BOOKING_NOT_VISIBLE'; end if;
  perform pg_temp.expect_assessment_error(format('select public.request_parent_assessment(%L,%L,%L,array[''2099-01-01@10:00''])',gen_random_uuid(),v_student,v_user),'ACTIVE_INVITATION');
  foreach v_signature in array array['public.parent_assessment_overview(uuid)',
    'public.parent_assessment_availability(uuid,text[],integer)','public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)',
    'public.request_parent_assessment(uuid,uuid,uuid,text[])','public.confirm_parent_assessment(uuid,uuid,text,timestamptz)'] loop
    if has_function_privilege('anon',v_signature,'execute') or not has_function_privilege('authenticated',v_signature,'execute')
      then raise exception 'ASSESSMENT_FUNCTION_ACL_CHANGED'; end if;
  end loop;
end $participant$;
reset role;

do $boundaries$
declare v_user uuid:=current_setting('test.assessment.user')::uuid; v_student uuid:=current_setting('test.assessment.student')::uuid;
begin
  update public.student_guardians set scope=array['grades'] where student_id=v_student and guardian_id=v_user;
  -- Legacy grades access still works without adding activity scope to stored relationships.
  perform public.parent_assessment_overview(v_student);
  update public.student_guardians set scope='{}' where student_id=v_student and guardian_id=v_user;
  perform pg_temp.expect_assessment_error(format('select public.parent_assessment_overview(%L)',v_student),'FORBIDDEN');
  perform pg_temp.expect_assessment_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math''],3)',
    gen_random_uuid(),v_student,current_setting('test.assessment.slot')::uuid),'FORBIDDEN');
  update public.student_guardians set scope=array['activities'] where student_id=v_student and guardian_id=v_user;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update public.profiles set is_active=false where id=v_user;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  perform pg_temp.expect_assessment_error(format('select public.parent_assessment_overview(%L)',v_student),'FORBIDDEN');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update public.profiles set is_active=true where id=v_user;
  update public.students set deleted_at=now() where id=v_student;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  perform pg_temp.expect_assessment_error(format('select public.parent_assessment_overview(%L)',v_student),'FORBIDDEN');
end $boundaries$;
