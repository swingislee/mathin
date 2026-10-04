savepoint confirmed_mismatch_contract;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid; pupil uuid:=current_setting('manual_entry_test.student')::uuid;
  course uuid; other_course uuid; term uuid; other_term uuid;
  origin uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); next_class uuid:=gen_random_uuid();
  child uuid; temporary_child uuid; pending_child uuid; member_id uuid; temporary_member uuid; moved uuid;
  commercial uuid; pending_enrollment uuid; opportunity uuid; source_session uuid; target_session uuid;
  request uuid; payload jsonb; options jsonb; result jsonb; err text;
begin
  select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into other_course from public.courses where id<>course and status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into term from public.school_terms order by id limit 1;
  select id into other_term from public.school_terms where id<>term order by id limit 1;
  if other_course is null or other_term is null then raise exception 'FIXED_LOCAL_COURSES_TERMS_REQUIRED'; end if;
  insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id,purpose,offering_type,operational_status)
    values(origin,'Mismatch source contract',actor,replace(origin::text,'-',''),6,course,term,'production','long_term_formal','active'),
      (target,'Mismatch target contract',actor,replace(target::text,'-',''),6,other_course,other_term,'production','long_term_formal','active'),
      (next_class,'Mismatch continuation contract',actor,replace(next_class::text,'-',''),6,other_course,other_term,'production','long_term_formal','active');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  child:=public.create_student(p_name=>'Mismatch permanent contract',p_grade=>3::smallint,p_phone=>'');
  temporary_child:=public.create_student(p_name=>'Mismatch temporary contract',p_grade=>3::smallint,p_phone=>'');
  pending_child:=public.create_student(p_name=>'Mismatch pending contract',p_grade=>3::smallint,p_phone=>'');
  execute 'reset role';
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(origin,child,'active',term,1,now()-interval '1 day',actor) returning id into member_id;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(origin,temporary_child,'active',term,2,now()-interval '1 day',actor) returning id into temporary_member;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
    values(origin,'Original lesson',1,term,now()+interval '1 day') returning id into source_session;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
    values(target,'Different course lesson',1,other_term,now()+interval '1 day') returning id into target_session;
  insert into public.course_opportunities(student_id,course_id,term_id,stage,owner_id,created_by,updated_by)
    values(pending_child,course,term,'committed',actor,actor,actor) returning id into opportunity;
  execute 'set local role authenticated';
  pending_enrollment:=public.confirm_course_enrollment(opportunity,'Pending mismatch contract');
  commercial:=public.move_enrollment_placement(null,member_id,origin,origin);
  payload:=jsonb_build_object('mode','permanent','membershipId',member_id,'enrollmentId',commercial,'fromClassroomId',origin,'toClassroomId',target,'seat',1,'expectedSeat',1,'reason','Teacher reviewed suitability');
  begin perform public.change_enrollment_placement(gen_random_uuid(),payload); raise exception 'UNCONFIRMED_MISMATCH_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'CLASS_TARGET_MISMATCH' then raise; end if; end;
  begin perform public.change_enrollment_placement(gen_random_uuid(),payload||'{"allowMismatch":true,"reason":""}'); raise exception 'EMPTY_OVERRIDE_REASON_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  begin perform public.change_enrollment_placement(gen_random_uuid(),payload||'{"allowMismatch":"true"}'); raise exception 'STRING_OVERRIDE_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  begin perform public.preview_enrollment_session_transfer(temporary_member,target,2); raise exception 'DEFAULT_PREVIEW_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'CLASS_TARGET_MISMATCH' then raise; end if; end;
  options:=public.preview_enrollment_session_transfer(temporary_member,target,2,true);
  if jsonb_array_length(options)<>1 or options->0->>'blocked' is not null then raise exception 'CONFIRMED_PREVIEW_FAILED'; end if;
  request:=gen_random_uuid(); payload:=payload||'{"allowMismatch":true}';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pupil,'role','authenticated')::text,true);
  begin perform public.change_enrollment_placement(request,payload); raise exception 'OVERRIDE_BYPASSED_PERMISSION';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.preview_enrollment_session_transfer(temporary_member,target,2,true); raise exception 'OVERRIDE_PREVIEW_BYPASSED_PERMISSION';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  result:=public.change_enrollment_placement(request,payload);
  if public.change_enrollment_placement(request,payload)<>result then raise exception 'OVERRIDE_RETRY_CHANGED'; end if;
  execute 'reset role';
  select id into moved from public.enrollments where classroom_id=target and student_id=child and status='active';
  if moved is null or (select term_id from public.enrollments where id=moved)<>other_term
    or (select status from public.enrollments where id=member_id)<>'transferred_out'
    or not exists(select 1 from public.course_enrollments where id=commercial and course_id=course and term_id=term and status='active')
    or not exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=commercial and classroom_membership_id=moved and status='active')
    then raise exception 'CONFIRMED_MEMBERSHIP_OR_COMMERCIAL_FACT_FAILED'; end if;
  if not exists(select 1 from mathin_internal.enrollment_placement_receipts where request_id=request and payload->>'allowMismatch'='true' and payload->>'reason'='Teacher reviewed suitability') then raise exception 'OVERRIDE_RECEIPT_MISSING'; end if;
  execute 'set local role authenticated';
  -- 已插班的成员继续在同课程同学期内调班，仍复用原报名。
  result:=public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','permanent','membershipId',moved,'enrollmentId',commercial,'fromClassroomId',target,'toClassroomId',next_class,'seat',1,'expectedSeat',1,'reason','Normal continuation'));
  if result->>'enrollmentId'<>commercial::text then raise exception 'CONTINUATION_REPLACED_ENROLLMENT'; end if;
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','permanent','membershipId',null,'enrollmentId',pending_enrollment,'fromClassroomId',null,'toClassroomId',target,'seat',1,'expectedSeat',null,'reason','Pending placement reviewed','allowMismatch',true));
  options:=public.preview_enrollment_session_transfer(temporary_member,target,2,true);
  payload:=jsonb_build_object('mode','temporary','membershipId',temporary_member,'fromClassroomId',origin,'toClassroomId',target,'seat',2,'expectedSeat',2,'reason','Single lesson suitability reviewed','allowMismatch',true,'sessions',jsonb_build_array(jsonb_build_object('sessionId',target_session,'version',options->0->>'version')));
  perform public.change_enrollment_placement(gen_random_uuid(),payload);
  execute 'reset role';
  if not exists(select 1 from public.session_student_transfers where membership_id=temporary_member and to_session_id=target_session and cancelled_at is null)
    or not exists(select 1 from public.enrollments where id=temporary_member and classroom_id=origin and status='active') then raise exception 'CONFIRMED_TEMPORARY_TRANSFER_FAILED'; end if;
  update public.class_sessions set started_at=clock_timestamp() where id=source_session;
  execute 'set local role authenticated';
  options:=public.preview_enrollment_session_transfer(temporary_member,target,3,true);
  if options->0->>'blocked'<>'SESSION_LOCKED' then raise exception 'OVERRIDE_BYPASSED_SESSION_LOCK'; end if;
  execute 'reset role';
  update public.classrooms set capacity=1 where id=next_class;
  execute 'set local role authenticated';
  begin perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','permanent','membershipId',temporary_member,'fromClassroomId',origin,'toClassroomId',next_class,'seat',2,'expectedSeat',2,'reason','Capacity remains enforced','allowMismatch',true)); raise exception 'OVERRIDE_BYPASSED_CAPACITY';
    exception when others then get stacked diagnostics err=message_text; if err not in ('INVALID_SEAT','CLASS_FULL') then raise; end if; end;
  execute 'reset role';
  if not exists(select 1 from public.session_student_transfers where membership_id=temporary_member and cancelled_at is null) then raise exception 'FAILED_OVERRIDE_CANCELLED_TRANSFER'; end if;
  if has_function_privilege('authenticated','mathin_internal.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer,boolean,text)','EXECUTE')
    or has_function_privilege('authenticated','mathin_internal.assign_course_enrollment(uuid,uuid,text,timestamptz,boolean)','EXECUTE')
    or has_function_privilege('anon','public.preview_enrollment_session_transfer(uuid,uuid,integer,boolean)','EXECUTE') then raise exception 'INTERNAL_OVERRIDE_EXPOSED'; end if;
end $test$;
rollback to savepoint confirmed_mismatch_contract;
release savepoint confirmed_mismatch_contract;
