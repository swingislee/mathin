-- Transaction-scoped local assertions: no real roster, enrollment or payment writes.
create function pg_temp.expect_registration_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if; raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;
do $setup$
declare a uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
  p uuid:=current_setting('test.parent_preview.parent_user_id')::uuid;
  s uuid; other_student uuid; c uuid:=gen_random_uuid(); act uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); ra uuid:=gen_random_uuid();
begin
  if not exists(select 1 from profiles where id=a and purpose='test' and role='admin')
    or not exists(select 1 from profiles where id=p and purpose='test' and role='parent') then raise exception 'FIXED_DEVELOPMENT_ACTORS_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','aal','aal2')::text,true);
  s:=public.create_student('Pre-registration assertion',4::smallint,'','','preregistration-assertion','','','');
  other_student:=public.create_student('Unrelated pre-registration assertion',4::smallint,'','','preregistration-assertion','','','');
  insert into student_guardians(student_id,guardian_id,scope) values(s,p,array['grades']);
  insert into classrooms(id,owner_id,name,invite_code,grade,capacity,purpose,offering_type,operational_status)
    values(c,a,'Short class assertion',c::text,4,1,'production','short_term_topic','active');
  insert into activities(id,kind,title,scheduled_at,capacity,created_by,target_grades)
    values(act,'lecture','Activity assertion',now()+interval '7 days',1,a,array[4]::smallint[]);
  perform public.save_parent_registration_publication('class',c,'Short class assertion','Public description',now()+interval '6 days',false,0);
  if exists(select 1 from jsonb_array_elements(public.miniapp_registration_catalog()) x where x->>'id'=c::text) then raise exception 'DRAFT_EXPOSED'; end if;
  perform public.save_parent_registration_publication('class',c,'Short class assertion','Public description',now()+interval '6 days',true,1);
  perform public.save_parent_registration_publication('activity',act,'Activity assertion','Public activity description',now()+interval '6 days',true,0);
  perform set_config('test.registration.student',s::text,true); perform set_config('test.registration.other',other_student::text,true);
  perform set_config('test.registration.class',c::text,true); perform set_config('test.registration.activity',act::text,true);
  perform set_config('test.registration.request',r::text,true); perform set_config('test.registration.activity_request',ra::text,true);
  if has_table_privilege('authenticated','public.parent_registration_applications','select,insert,update,delete')
    or has_table_privilege('anon','public.parent_advisor_contacts','select')
    or has_function_privilege('anon','public.miniapp_apply_registration(uuid,text,uuid,integer,uuid)','execute')
    or has_function_privilege('authenticated','public.miniapp_book_activity(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.review_parent_course_application(uuid,boolean,text)','execute') then raise exception 'RAW_OR_FORMAL_WRITE_GRANTED'; end if;
end $setup$;
set local role anon;
do $public$
declare c jsonb; a jsonb;
begin
  select x into c from jsonb_array_elements(public.miniapp_registration_catalog()) x where x->>'id'=current_setting('test.registration.class');
  select x into a from jsonb_array_elements(public.miniapp_registration_catalog()) x where x->>'id'=current_setting('test.registration.activity');
  if c#>>'{classes,0,offeringType}'<>'short_term_topic' or c#>'{classes,0,courseId}'<>'null'::jsonb
    or a->>'kind'<>'activity' or c::text like '%invite_code%' or a::text like '%created_by%' then raise exception 'PUBLIC_PROJECTION_FAILED'; end if;
  if c->'priceCents'<>'null'::jsonb then raise exception 'PAYMENT_PROJECTED'; end if;
end $public$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $family$
declare s uuid:=current_setting('test.registration.student')::uuid; c uuid:=current_setting('test.registration.class')::uuid;
  act uuid:=current_setting('test.registration.activity')::uuid; r uuid:=current_setting('test.registration.request')::uuid; ra uuid:=current_setting('test.registration.activity_request')::uuid;
begin
  perform pg_temp.expect_registration_error(format('select public.miniapp_apply_registration(%L,''class'',%L,2,%L)',gen_random_uuid(),c,current_setting('test.registration.other')),'FORBIDDEN');
  perform pg_temp.expect_registration_error(format('select public.parent_registration_workbench(''class'',%L)',c),'FORBIDDEN');
  perform pg_temp.expect_registration_error('select public.parent_advisor_settings()','FORBIDDEN');
  perform pg_temp.expect_registration_error(format('select public.save_parent_registration_publication(''class'',%L,''Unauthorized'','''',now()+interval ''1 day'',true,2)',c),'FORBIDDEN');
  perform pg_temp.expect_registration_error(format('select public.miniapp_apply_registration(%L,''class'',%L,1,%L)',r,c,s),'FORM_CHANGED');
  if public.miniapp_apply_registration(r,'class',c,2,s)<>r or public.miniapp_apply_registration(r,'class',c,2,s)<>r then raise exception 'RETRY_FAILED'; end if;
  perform pg_temp.expect_registration_error(format('select public.miniapp_apply_registration(%L,''activity'',%L,1,%L)',r,act,s),'CONFLICT');
  perform public.miniapp_apply_registration(ra,'activity',act,1,s);
  perform pg_temp.expect_registration_error(format('select public.review_parent_registration(%L,true,''Unauthorized'')',r),'FORBIDDEN');
  if (select count(*) from jsonb_array_elements(public.miniapp_registration_applications()) x where x->>'id' in (r::text,ra::text))<>2 then raise exception 'APPLICATION_HISTORY_FAILED'; end if;
end $family$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $staff$
declare c uuid:=current_setting('test.registration.class')::uuid; act uuid:=current_setting('test.registration.activity')::uuid;
begin
  perform public.review_parent_registration(current_setting('test.registration.request')::uuid,true,'Advisor contacted family offline');
  perform public.review_parent_registration(current_setting('test.registration.activity_request')::uuid,true,'Advisor contacted family offline');
  if public.parent_registration_workbench('class',c)#>>'{applications,0,status}'<>'contacted'
    or public.parent_registration_workbench('activity',act)#>>'{applications,0,status}'<>'contacted' then raise exception 'CONTACT_OUTCOME_FAILED'; end if;
  perform pg_temp.expect_registration_error(format('select public.save_parent_registration_publication(''class'',%L,''Changed'','''',now()+interval ''1 day'',true,1)',c),'FORM_CHANGED');
end $staff$;
reset role;
do $no_business_writes$
declare s uuid:=current_setting('test.registration.student')::uuid; c uuid:=current_setting('test.registration.class')::uuid; act uuid:=current_setting('test.registration.activity')::uuid;
begin
  if exists(select 1 from enrollments where student_id=s) or exists(select 1 from course_enrollments where student_id=s)
    or exists(select 1 from activity_registrations where student_id=s) then raise exception 'PRE_REGISTRATION_CREATED_ROSTER_OR_ENROLLMENT'; end if;
  if (select count(*) from parent_registration_applications where student_id=s and status='contacted')<>2 then raise exception 'PRE_REGISTRATION_NOT_RETAINED'; end if;
  perform public.save_parent_registration_publication('class',c,'Short class assertion','Public description',now()+interval '6 days',false,2);
  if exists(select 1 from jsonb_array_elements(public.miniapp_registration_catalog()) x where x->>'id'=c::text) then raise exception 'HIDDEN_CLASS_EXPOSED'; end if;
  update activities set scheduled_at=now()-interval '1 day' where id=act;
  perform pg_temp.expect_registration_error(format('select public.save_parent_registration_publication(''activity'',%L,''Unscheduled'','''',now()+interval ''6 days'',true,1)',act),'BOOKING_CLOSED');
  if (public.parent_registration_workbench('activity',act)->>'publishable')::boolean then raise exception 'PAST_ACTIVITY_PUBLISHABLE'; end if;
  perform pg_temp.expect_registration_error(format('select public.save_parent_advisor_contact(4::smallint,''Advisor'',''12345678901'',''5/%s.png'',true)',gen_random_uuid()),'VALIDATION');
  insert into storage.objects(bucket_id,name) values('parent-advisor-qrcodes','4/10000000-0000-4000-8000-000000000004.png'),('parent-advisor-qrcodes','5/10000000-0000-4000-8000-000000000005.png');
  perform public.save_parent_advisor_contact(4::smallint,'Grade 4 advisor','00000000004','4/10000000-0000-4000-8000-000000000004.png',true);
  perform public.save_parent_advisor_contact(5::smallint,'Grade 5 advisor','00000000005','5/10000000-0000-4000-8000-000000000005.png',false);
  if not exists(select 1 from jsonb_array_elements(public.miniapp_advisor_contacts()) x where x->>'grade'='4' and x->>'phone'='00000000004')
    or exists(select 1 from jsonb_array_elements(public.miniapp_advisor_contacts()) x where x->>'grade'='5') then raise exception 'ADVISOR_GRADE_OR_VISIBILITY_FAILED'; end if;
end $no_business_writes$;
