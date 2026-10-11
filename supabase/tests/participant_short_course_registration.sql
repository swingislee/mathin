-- The verified local runner encloses all fixtures in a rolled-back transaction.
create function pg_temp.expect_short_registration_error(statement text,expected text)
returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm=expected then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $setup$
declare a uuid; p uuid; outsider uuid; s uuid; foreign_s uuid; c uuid:=gen_random_uuid(); unlisted uuid:=gen_random_uuid();
  long_c uuid:=gen_random_uuid(); activity uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); term uuid;
begin
  select id into a from auth.users where email='test-admin@mathin.local';
  select id into p from auth.users where email='test-parent@mathin.local';
  select id into outsider from auth.users where email='test-parent-unbound@mathin.local';
  if a is null or p is null or outsider is null
    or not exists(select 1 from profiles where id=a and purpose='test' and role='admin') then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  select id into term from school_terms where is_current limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','aal','aal2')::text,true);
  s:=public.create_student('Short course registration check',5::smallint,'','','short-registration-fixture','','','');
  foreign_s:=public.create_student('Unrelated registration check',5::smallint,'','','short-registration-fixture','','','');
  insert into student_guardians(student_id,guardian_id,scope) values(s,p,array['activities']);
  insert into classrooms(id,owner_id,name,invite_code,grade,capacity,purpose,offering_type,operational_status) values
    (c,a,'Short course check',c::text,null,20,'production','short_term_topic','planning'),
    (unlisted,a,'Website only short course',unlisted::text,5,20,'production','short_term_topic','planning'),
    (long_c,a,'Long class check',long_c::text,5,20,'production','long_term_formal','planning');
  insert into class_sessions(classroom_id,title,scheduled_at,duration_min) values(c,'First lesson',now()+interval '7 days',90);
  insert into short_course_batches(id,topic,name,term_id,starts_on,session_count,duration_min,created_by,creation_input)
    values(batch,'数独运动','Mixed grade check',term,current_date+7,1,90,a,'{}');
  insert into short_course_class_details(classroom_id,batch_id,level,grades,weekly_slots)
    values(c,batch,'advanced',array[5,6]::smallint[],'[{"weekday":6,"time":"14:00"}]');
  insert into miniapp_short_course_publications(classroom_id,location,tags) values(c,'Check campus',array['短期课','数独运动']);
  insert into activities(id,kind,title,scheduled_at,capacity,created_by,target_grades)
    values(activity,'public_class','公益活动·大力士集结',now()+interval '7 days',20,a,null);
  perform public.set_activity_target_grades(activity,array[-1,0]::smallint[]);
  perform public.save_parent_registration_publication('class',c,'数独运动','Four sessions',now()+interval '6 days',true,0);
  perform public.save_parent_registration_publication('class',unlisted,'Unlisted','',now()+interval '6 days',true,0);
  perform public.save_parent_registration_publication('class',long_c,'Long class','',now()+interval '6 days',true,0);
  perform public.save_parent_registration_publication('activity',activity,'公益活动·大力士集结','',now()+interval '6 days',true,0);
  perform set_config('test.short.admin',a::text,true); perform set_config('test.short.parent',p::text,true);
  perform set_config('test.short.outsider',outsider::text,true); perform set_config('test.short.student',s::text,true);
  perform set_config('test.short.foreign',foreign_s::text,true); perform set_config('test.short.class',c::text,true);
  perform set_config('test.short.long',long_c::text,true); perform set_config('test.short.unlisted',unlisted::text,true);
  perform set_config('test.short.activity',activity::text,true); perform set_config('test.short.request',gen_random_uuid()::text,true);
  perform set_config('test.short.activity_request',gen_random_uuid()::text,true);
  if has_function_privilege('anon','public.miniapp_participant_apply_registration(uuid,uuid,integer,uuid)','execute')
    or has_function_privilege('anon','public.miniapp_participant_registration_applications()','execute')
    or has_table_privilege('authenticated','public.miniapp_short_course_publications','insert,update,delete')
    then raise exception 'PUBLIC_WRITE_GRANTED'; end if;
end $setup$;
set local role anon;
do $catalog$
declare c jsonb; a jsonb;
begin
  select x into c from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x where x->>'id'=current_setting('test.short.class');
  select x into a from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x where x->>'id'=current_setting('test.short.activity');
  if c is null or c#>'{activity,targetGrades}'<>'[5,6]'::jsonb or c#>>'{activity,location}'<>'Check campus'
    or c#>'{activity,tags}'<>'["短期课","数独运动"]'::jsonb or c->>'kind'<>'activity' then raise exception 'SHORT_COURSE_CATALOG'; end if;
  if a is null or a#>'{activity,targetGrades}'<>'[-1,0]'::jsonb then raise exception 'KINDERGARTEN_CATALOG'; end if;
  if exists(select 1 from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x
    where x->>'id' in (current_setting('test.short.long'),current_setting('test.short.unlisted'))) then raise exception 'UNPUBLISHED_CLASS_VISIBLE'; end if;
end $catalog$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.short.parent'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $apply$
declare s uuid:=current_setting('test.short.student')::uuid; c uuid:=current_setting('test.short.class')::uuid;
  r uuid:=current_setting('test.short.request')::uuid;
begin
  if public.miniapp_can_register(s,'class') or public.guardian_can(s,auth.uid(),'grades') or public.guardian_can(s,auth.uid(),'finance')
    then raise exception 'LEARNING_OR_FINANCE_SCOPE_EXPANDED'; end if;
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_apply_registration(%L,%L,1,%L)',gen_random_uuid(),c,current_setting('test.short.foreign')),'FORBIDDEN');
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_apply_registration(%L,%L,99,%L)',gen_random_uuid(),c,s),'FORM_CHANGED');
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_apply_registration(%L,%L,1,%L)',gen_random_uuid(),current_setting('test.short.long'),s),'BOOKING_CLOSED');
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_apply_registration(%L,%L,1,%L)',gen_random_uuid(),current_setting('test.short.unlisted'),s),'BOOKING_CLOSED');
  if public.miniapp_participant_apply_registration(r,c,1,s)<>r or public.miniapp_participant_apply_registration(r,c,1,s)<>r then raise exception 'RETRY_IDENTITY'; end if;
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_apply_registration(%L,%L,1,%L)',gen_random_uuid(),c,s),'CONFLICT');
  perform public.miniapp_participant_apply_registration(current_setting('test.short.activity_request')::uuid,current_setting('test.short.activity')::uuid,1,s);
  if not exists(select 1 from jsonb_array_elements(public.miniapp_participant_registration_applications()) x where x->>'id'=r::text and x->>'kind'='activity') then raise exception 'PARTICIPANT_HISTORY_MISSING'; end if;
end $apply$;
reset role;
do $persistence$
declare c uuid:=current_setting('test.short.class')::uuid; r uuid:=current_setting('test.short.request')::uuid; w jsonb;
begin
  if not exists(select 1 from parent_registration_applications where id=r and kind='class' and classroom_id=c and activity_id is null and snapshot->>'miniappShortCourse'='true') then raise exception 'NATIVE_CLASS_APPLICATION_MISSING'; end if;
  if exists(select 1 from enrollments where classroom_id=c) then raise exception 'REQUEST_CREATED_ENROLLMENT'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.short.admin'),'role','authenticated','aal','aal2')::text,true);
  w:=public.parent_registration_workbench('class',c);
  if not exists(select 1 from jsonb_array_elements(w->'applications') x where x->>'id'=r::text and x->>'kind'='class' and x->>'classroomId'=c::text) then raise exception 'BACKOFFICE_MISSING_REQUEST'; end if;
  update parent_class_publications set enabled=false where classroom_id=c;
end $persistence$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.short.outsider'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $isolation$
begin
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_cancel_registration(%L)',current_setting('test.short.request')),'FORBIDDEN');
  if exists(select 1 from jsonb_array_elements(public.miniapp_participant_registration_applications()) x where x->>'id'=current_setting('test.short.request')) then raise exception 'OTHER_FAMILY_READ'; end if;
end $isolation$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.short.parent'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $closed_retry$
declare r uuid:=current_setting('test.short.request')::uuid; c uuid:=current_setting('test.short.class')::uuid; s uuid:=current_setting('test.short.student')::uuid;
begin
  if public.miniapp_participant_apply_registration(r,c,1,s)<>r then raise exception 'CLOSED_RETRY_FAILED'; end if;
  perform public.miniapp_participant_cancel_registration(r);
  perform public.miniapp_participant_cancel_registration(r);
  if not exists(select 1 from jsonb_array_elements(public.miniapp_participant_registration_applications()) x where x->>'id'=r::text and x->>'status'='cancelled') then raise exception 'CANCELLED_HISTORY'; end if;
  perform pg_temp.expect_short_registration_error(format('select public.miniapp_participant_apply_registration(%L,%L,1,%L)',gen_random_uuid(),c,s),'BOOKING_CLOSED');
end $closed_retry$;
reset role;
