savepoint reserved_seat_capacity;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  course uuid; term uuid; child uuid; occupant uuid; extra uuid; m uuid; s uuid; d uuid; options jsonb; err text;
begin
  select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into term from public.school_terms order by id limit 1;
  insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id,purpose,offering_type,operational_status)
    values(a,'Reservation source',actor,replace(a::text,'-',''),2,course,term,'production','long_term_formal','active'),
      (b,'Reservation target',actor,replace(b::text,'-',''),2,course,term,'production','long_term_formal','active');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  child:=public.create_student(p_name=>'Temporary capacity contract',p_grade=>3::smallint,p_phone=>'');
  occupant:=public.create_student(p_name=>'Existing capacity contract',p_grade=>3::smallint,p_phone=>'');
  extra:=public.create_student(p_name=>'Additional capacity contract',p_grade=>3::smallint,p_phone=>'');
  execute 'reset role';
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,operated_by)
    values(a,child,'active',term,1,actor) returning id into m;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,operated_by) values(b,occupant,'active',term,1,actor);
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id) values(a,'One',1,term) returning id into s;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id) values(b,'One',1,term) returning id into d;
  execute 'set local role authenticated';
  options:=public.preview_enrollment_session_transfer(m,b,2);
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','temporary','membershipId',m,'fromClassroomId',a,'toClassroomId',b,'seat',2,'expectedSeat',1,'reason','Capacity contract',
    'sessions',jsonb_build_array(jsonb_build_object('sessionId',d,'version',options->0->>'version'))));
  execute 'reset role';
  begin
    insert into public.enrollments(classroom_id,student_id,status,term_id,operated_by) values(b,extra,'active',term,actor);
    raise exception 'CAPACITY_EXCEEDED_WITH_RESERVATION';
  exception when others then get stacked diagnostics err=message_text; if err<>'TEMPORARY_SEAT_RESERVED' then raise; end if; end;
  if exists(select 1 from public.enrollments where classroom_id=b and student_id=extra) then raise exception 'PARTIAL_ENROLLMENT_LEFT'; end if;
end $test$;
rollback to savepoint reserved_seat_capacity;
release savepoint reserved_seat_capacity;
