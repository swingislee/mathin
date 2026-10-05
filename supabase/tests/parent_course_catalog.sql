-- Run inside a rollback transaction with fixed development actors supplied privately.
create function pg_temp.expect_course_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $setup$
declare a uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
  p uuid:=current_setting('test.parent_preview.parent_user_id')::uuid;
  v_course uuid; v_term uuid; v_student uuid; v_student2 uuid; v_other uuid;
  c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); v_offer uuid;
begin
  if not exists(select 1 from public.profiles where id=a and purpose='test' and role='admin')
    or not exists(select 1 from public.profiles where id=p and purpose='test' and role='parent') then raise exception 'FIXED_DEVELOPMENT_ACTORS_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','aal','aal2')::text,true);
  select v.id into v_course from public.courses v join public.course_families f on f.id=v.family_id
    where v.status='enabled' and v.purpose='production' and v.course_kind='curriculum' and v.trashed_at is null
      and f.purpose='production' and f.status='enabled' order by v.created_at,v.id limit 1;
  select id into v_term from public.school_terms order by is_current desc,starts_on desc nulls last,id limit 1;
  if v_course is null or v_term is null then raise exception 'COURSE_AND_TERM_REQUIRED'; end if;
  v_student:=public.create_student('Course application assertion A',4::smallint,'','','course-application-assertion','','','');
  v_student2:=public.create_student('Course application assertion B',4::smallint,'','','course-application-assertion','','','');
  v_other:=public.create_student('Course application assertion unrelated',4::smallint,'','','course-application-assertion','','','');
  insert into public.student_guardians(student_id,guardian_id,scope) values(v_student,p,array['grades']),(v_student2,p,array['grades']);
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
    select c,a,'Course application assertion',c::text,v_course,v_term,grade,1,'production','long_term_formal','active' from public.courses where id=v_course;
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
    select c2,a,'Unpublished application assertion',c2::text,v_course,v_term,grade,5,'production','long_term_formal','active' from public.courses where id=v_course;
  v_offer:=public.save_parent_course_publication(null,'Course application assertion','Public text only',315000,now()+interval '7 days',false,array[c]);
  if exists(select 1 from jsonb_array_elements(public.miniapp_course_catalog()) x where x->>'id'=v_offer::text) then raise exception 'DRAFT_EXPOSED'; end if;
  perform public.save_parent_course_publication(v_offer,'Course application assertion','Public text only',315000,now()+interval '7 days',true,array[c]);
  perform set_config('test.catalog.offer',v_offer::text,true);
  perform set_config('test.catalog.class',c::text,true);
  perform set_config('test.catalog.unpublished',c2::text,true);
  perform set_config('test.catalog.student',v_student::text,true);
  perform set_config('test.catalog.student2',v_student2::text,true);
  perform set_config('test.catalog.other',v_other::text,true);
  perform set_config('test.catalog.request',gen_random_uuid()::text,true);
  perform set_config('test.catalog.request2',gen_random_uuid()::text,true);
  if has_table_privilege('authenticated','public.parent_course_applications','insert,update,delete,select')
    or has_table_privilege('anon','public.parent_course_publications','select')
    or has_function_privilege('anon','public.miniapp_apply_course(uuid,uuid,integer,uuid,uuid)','execute')
    or has_function_privilege('authenticated','mathin_internal.parent_catalog_classes(uuid[])','execute') then raise exception 'RAW_ACCESS_GRANTED'; end if;
end $setup$;

set local role anon;
do $public$
declare offer jsonb;
begin
  select x into offer from jsonb_array_elements(public.miniapp_course_catalog()) x where x->>'id'=current_setting('test.catalog.offer');
  if offer is null or offer->>'priceCents'<>'315000' or jsonb_array_length(offer->'classes')<>1
    or offer#>>'{classes,0,id}'<>current_setting('test.catalog.class') or offer#>>'{classes,0,remaining}'<>'1'
    or offer::text like '%invite_code%' or offer::text like '%student_id%' then raise exception 'PUBLIC_PROJECTION_FAILED'; end if;
end $public$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $parent$
declare p uuid:=current_setting('test.catalog.offer')::uuid; c uuid:=current_setting('test.catalog.class')::uuid;
  s uuid:=current_setting('test.catalog.student')::uuid; r uuid:=current_setting('test.catalog.request')::uuid; r2 uuid:=current_setting('test.catalog.request2')::uuid;
begin
  perform pg_temp.expect_course_error('select public.parent_course_admissions_workbench()','FORBIDDEN');
  perform pg_temp.expect_course_error(format('select public.save_parent_course_publication(null,''Unauthorized'','''',100,now()+interval ''1 day'',true,array[%L::uuid])',c),'FORBIDDEN');
  perform pg_temp.expect_course_error(format('select public.miniapp_apply_course(%L,%L,2,%L,%L)',gen_random_uuid(),p,c,current_setting('test.catalog.other')),'FORBIDDEN');
  perform pg_temp.expect_course_error(format('select public.miniapp_apply_course(%L,%L,2,%L,%L)',gen_random_uuid(),p,current_setting('test.catalog.unpublished'),s),'NOT_FOUND');
  perform pg_temp.expect_course_error(format('select public.miniapp_apply_course(%L,%L,1,%L,%L)',gen_random_uuid(),p,c,s),'FORM_CHANGED');
  if public.miniapp_apply_course(r,p,2,c,s)<>r or public.miniapp_apply_course(r,p,2,c,s)<>r then raise exception 'APPLICATION_RETRY_FAILED'; end if;
  perform pg_temp.expect_course_error(format('select public.miniapp_apply_course(%L,%L,1,%L,%L)',r,p,c,s),'CONFLICT');
  perform pg_temp.expect_course_error(format('select public.miniapp_apply_course(%L,%L,2,%L,%L)',gen_random_uuid(),p,c,s),'CONFLICT');
  perform pg_temp.expect_course_error(format('select public.review_parent_course_application(%L,true,''Unauthorized'')',r),'FORBIDDEN');
  perform public.miniapp_apply_course(r2,p,2,c,current_setting('test.catalog.student2')::uuid);
  if (select x#>>'{classes,0,remaining}' from jsonb_array_elements(public.miniapp_course_catalog()) x where x->>'id'=p::text)<>'1' then raise exception 'APPLICATION_RESERVED_SEAT'; end if;
  if not exists(select 1 from jsonb_array_elements(public.miniapp_course_applications()) x where x->>'id'=r::text and x->>'status'='pending') then raise exception 'APPLICATION_HISTORY_MISSING'; end if;
end $parent$;
reset role;

do $staff$
declare r uuid:=current_setting('test.catalog.request')::uuid; r2 uuid:=current_setting('test.catalog.request2')::uuid; n integer; v_offer uuid;
begin
  if exists(select 1 from public.course_enrollments where student_id in(current_setting('test.catalog.student')::uuid,current_setting('test.catalog.student2')::uuid)) then raise exception 'PARENT_CREATED_FORMAL_ENROLLMENT'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
  if not exists(select 1 from jsonb_array_elements(public.parent_course_admissions_workbench()->'applications') x where x->>'id'=r::text) then raise exception 'STAFF_INBOX_MISSING'; end if;
  perform pg_temp.expect_course_error(format('select public.review_parent_course_application(%L,true,'''')',r),'VALIDATION');
  perform public.review_parent_course_application(r,true,'Enrollment and payment evidence reviewed');
  perform public.review_parent_course_application(r,true,'Enrollment and payment evidence reviewed');
  select count(*) into n from public.course_enrollments e join public.course_enrollment_assignments a on a.course_enrollment_id=e.id
    where e.student_id=current_setting('test.catalog.student')::uuid and a.classroom_id=current_setting('test.catalog.class')::uuid and a.status='active';
  if n<>1 then raise exception 'FORMAL_ENROLLMENT_AND_PLACEMENT_FAILED'; end if;
  perform pg_temp.expect_course_error(format('select public.review_parent_course_application(%L,true,''Reviewed'')',r2),'CLASS_FULL');
  if exists(select 1 from public.course_enrollments where student_id=current_setting('test.catalog.student2')::uuid)
    or (select status from public.parent_course_applications where id=r2)<>'pending' then raise exception 'FAILED_CONFIRMATION_PARTIALLY_SAVED'; end if;
  perform public.review_parent_course_application(r2,false,'Class full; please choose another class');
  v_offer:=public.save_parent_course_publication(null,'Withdrawal assertion','',null,now()+interval '7 days',true,array[current_setting('test.catalog.unpublished')::uuid]);
  perform set_config('test.catalog.withdrawalOffer',v_offer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.outsider_user_id'),'role','authenticated','aal','aal2')::text,true);
end $staff$;
set local role authenticated;
do $outsider$
declare v_request uuid:=gen_random_uuid(); v_offer uuid:=current_setting('test.catalog.withdrawalOffer')::uuid;
begin
  if exists(select 1 from jsonb_array_elements(public.miniapp_course_applications()) x where x->>'id' in(current_setting('test.catalog.request'),current_setting('test.catalog.request2'))) then raise exception 'OTHER_FAMILY_HISTORY_EXPOSED'; end if;
  perform pg_temp.expect_course_error(format('select public.miniapp_cancel_course_application(%L)',current_setting('test.catalog.request')),'FORBIDDEN');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_course_error(format('select public.miniapp_cancel_course_application(%L)',current_setting('test.catalog.request')),'CONFLICT');
  perform public.miniapp_apply_course(v_request,v_offer,1,current_setting('test.catalog.unpublished')::uuid,current_setting('test.catalog.student2')::uuid);
  perform public.miniapp_cancel_course_application(v_request);
  perform public.miniapp_cancel_course_application(v_request);
  if not exists(select 1 from jsonb_array_elements(public.miniapp_course_applications()) x where x->>'id'=v_request::text and x->>'status'='cancelled') then raise exception 'WITHDRAWAL_HISTORY_FAILED'; end if;
end $outsider$;
reset role;
