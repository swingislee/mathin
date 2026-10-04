savepoint placement_change_contract;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid; pupil uuid:=current_setting('manual_entry_test.student')::uuid;
  teacher uuid:=current_setting('manual_entry_test.teacher')::uuid; request uuid:=gen_random_uuid(); course uuid; term uuid;
  original uuid:=gen_random_uuid(); target uuid:=gen_random_uuid(); child uuid; pupil_student uuid; other uuid; permanent_child uuid;
  member_id uuid; pupil_member uuid; permanent_member uuid; commercial uuid; opportunity uuid; moved_member uuid;
  source_one uuid; source_two uuid; target_one uuid; target_two uuid; target_three uuid; transfer_id uuid;
  options jsonb; payload jsonb; result jsonb; before_attendance jsonb; before_roster jsonb; err text; n integer; event_count bigint;
begin
  select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into term from public.school_terms order by id limit 1;
  if course is null or term is null then raise exception 'FIXED_LOCAL_COURSE_TERM_REQUIRED'; end if;
  insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id,purpose,offering_type,operational_status)
    values(original,'Transfer original contract',actor,replace(original::text,'-',''),6,course,term,'production','long_term_formal','active'),
      (target,'Transfer target contract',actor,replace(target::text,'-',''),6,course,term,'production','long_term_formal','active');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  child:=public.create_student(p_name=>'Transfer contract '||request,p_grade=>3::smallint,p_phone=>'');
  other:=public.create_student(p_name=>'Target occupant '||request,p_grade=>3::smallint,p_phone=>'');
  permanent_child:=public.create_student(p_name=>'Permanent contract '||request,p_grade=>3::smallint,p_phone=>'');
  execute 'reset role';
  select id into pupil_student from public.students where user_id=pupil and deleted_at is null order by id limit 1;
  if pupil_student is null then
    execute 'set local role authenticated';
    pupil_student:=public.create_student(p_name=>'Fixed pupil contract '||request,p_grade=>3::smallint,p_phone=>'');
    execute 'reset role';
    update public.students set user_id=pupil where id=pupil_student;
  end if;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(original,child,'active',term,1,now()-interval '1 day',actor) returning id into member_id;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(original,pupil_student,'active',term,2,now()-interval '1 day',actor) returning id into pupil_member;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(original,permanent_child,'active',term,3,now()-interval '1 day',actor) returning id into permanent_member;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(target,other,'active',term,1,now()-interval '1 day',actor);
  for n in 1..3 loop
    insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
      values(original,'Original lesson '||n,n,term,now()+n*interval '1 day') returning id into source_one;
    insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
      values(target,'Target lesson '||n,n,term,now()+n*interval '1 day'+interval '1 hour') returning id into target_one;
  end loop;
  select id into source_one from public.class_sessions where classroom_id=original and lecture_no=1;
  select id into source_two from public.class_sessions where classroom_id=original and lecture_no=2;
  select id into target_one from public.class_sessions where classroom_id=target and lecture_no=1;
  select id into target_two from public.class_sessions where classroom_id=target and lecture_no=2;
  select id into target_three from public.class_sessions where classroom_id=target and lecture_no=3;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at,started_at)
    values(target,'Started excluded',4,term,now(),now());
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id) values(target,'Missing original',99,term);
  insert into public.course_opportunities(student_id,course_id,term_id,stage,owner_id,created_by,updated_by)
    values(child,course,term,'committed',actor,actor,actor) returning id into opportunity;
  execute 'set local role authenticated';
  commercial:=public.confirm_course_enrollment(opportunity,'Contract enrollment');
  perform public.assign_course_enrollment(commercial,original,'Contract assignment',clock_timestamp());
  options:=public.preview_enrollment_session_transfer(member_id,target,2);
  if jsonb_array_length(options)<>4 or not exists(select 1 from jsonb_array_elements(options) o where o->>'blocked'='SOURCE_SESSION_MISSING') then raise exception 'UNSTARTED_OPTIONS_CONTRACT'; end if;
  payload:=jsonb_build_object('mode','temporary','enrollmentId',commercial,'membershipId',member_id,'fromClassroomId',original,'toClassroomId',target,
    'seat',2,'expectedSeat',1,'reason','Two lessons only','sessions',(select jsonb_agg(jsonb_build_object('sessionId',o->>'sessionId','version',o->>'version')) from jsonb_array_elements(options) o where (o->>'sessionId')::uuid in(target_one,target_two)));
  execute 'reset role';
  update public.class_sessions set scheduled_at=scheduled_at+interval '1 hour' where id=target_two;
  execute 'set local role authenticated';
  begin perform public.change_enrollment_placement(request,payload); raise exception 'STALE_OPTIONS_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'PLACEMENT_CHANGED' then raise; end if; end;
  options:=public.preview_enrollment_session_transfer(member_id,target,2);
  payload:=jsonb_set(payload,'{sessions}',(select jsonb_agg(jsonb_build_object('sessionId',o->>'sessionId','version',o->>'version')) from jsonb_array_elements(options) o where (o->>'sessionId')::uuid in(target_one,target_two)));
  result:=public.change_enrollment_placement(request,payload);
  if public.change_enrollment_placement(request,payload)<>result then raise exception 'RETRY_CHANGED_RESULT'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_session_roster(target_one)->'entries') e where e->>'studentId'=child::text)
    or exists(select 1 from jsonb_array_elements(public.get_session_roster(source_one)->'entries') e where e->>'studentId'=child::text)
    or not exists(select 1 from jsonb_array_elements(public.get_session_roster(target_two)->'entries') e where e->>'studentId'=child::text)
    or exists(select 1 from jsonb_array_elements(public.get_session_roster(target_three)->'entries') e where e->>'studentId'=child::text)
    then raise exception 'SELECTED_LESSON_ROSTER_FAILED'; end if;
  if not public.can_insert_session_attendance_v2(target_one,child) or public.can_insert_session_attendance_v2(source_one,child) then raise exception 'ATTENDANCE_INSERT_SCOPE_FAILED'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_session_attendance_roster_v2(target_one)) e where e->>'studentId'=child::text and not (e->>'historyMismatch')::boolean) then raise exception 'ATTENDANCE_DRAWER_MISSING'; end if;
  execute 'reset role';
  if (select count(*) from public.session_student_transfers where request_id=request)<>2
    or not exists(select 1 from public.enrollments where id=member_id and status='active' and classroom_id=original)
    or exists(select 1 from public.enrollments where classroom_id=target and student_id=child) then raise exception 'TEMPORARY_CHANGED_PERMANENT_MEMBERSHIP'; end if;
  begin update public.enrollments set placement_seat=2 where classroom_id=target and student_id=other; raise exception 'RESERVED_SEAT_REUSED';
    exception when others then get stacked diagnostics err=message_text; if err<>'TEMPORARY_SEAT_RESERVED' then raise; end if; end;
  execute 'set local role authenticated';
  options:=public.preview_enrollment_session_transfer(pupil_member,target,3);
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','temporary','membershipId',pupil_member,'fromClassroomId',original,'toClassroomId',target,'seat',3,'expectedSeat',2,'reason','Pupil scope',
    'sessions',(select jsonb_agg(jsonb_build_object('sessionId',o->>'sessionId','version',o->>'version')) from jsonb_array_elements(options) o where (o->>'sessionId')::uuid=target_one)));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pupil,'role','authenticated')::text,true);
  if not public.is_session_member(target_one,pupil) or public.is_session_member(target_two,pupil) or public.is_session_member(source_one,pupil)
    or not public.has_temporary_classroom_access(target) then raise exception 'STUDENT_SESSION_ACCESS_FAILED'; end if;
  if not exists(select 1 from public.class_sessions where id=target_one) or exists(select 1 from public.class_sessions where id in(target_two,source_one)) then raise exception 'SESSION_RLS_FAILED'; end if;
  if not exists(select 1 from public.get_my_schedule(now(),now()+interval '10 days') where session_id=target_one and student_id=pupil_student)
    or exists(select 1 from public.get_my_schedule(now(),now()+interval '10 days') where session_id=source_one and student_id=pupil_student) then raise exception 'FAMILY_SCHEDULE_TRANSFER_FAILED'; end if;
  begin perform public.change_enrollment_placement(gen_random_uuid(),payload); raise exception 'STUDENT_WRITE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.preview_enrollment_session_transfer(member_id,target,2); raise exception 'STUDENT_PREVIEW_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform public.freeze_session_roster(target_one,2::smallint);
  execute 'reset role';
  update public.class_sessions set started_at=clock_timestamp() where id=target_one;
  execute 'set local role authenticated';
  insert into public.session_attendance(session_id,student_id,status,note) values(target_one,child,'present','Original attendance');
  execute 'reset role';
  select to_jsonb(a) into before_attendance from public.session_attendance a where session_id=target_one and student_id=child;
  select jsonb_agg(to_jsonb(r) order by r.student_id) into before_roster from public.session_roster_entries r where session_id=target_one;
  select count(*) into event_count from public.domain_events;
  execute 'set local role authenticated';
  payload:=jsonb_build_object('mode','withdraw','enrollmentId',commercial,'membershipId',member_id,'fromClassroomId',original,'expectedSeat',1,'reason','Contract withdrawal');
  request:=gen_random_uuid(); result:=public.change_enrollment_placement(request,payload);
  if public.change_enrollment_placement(request,payload)<>result then raise exception 'WITHDRAW_RETRY_FAILED'; end if;
  if exists(select 1 from jsonb_array_elements(public.get_session_roster(target_two)->'entries') e where e->>'studentId'=child::text) then raise exception 'FUTURE_TRANSFER_NOT_CANCELLED'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_session_attendance_roster_v2(target_one)) e where e->>'studentId'=child::text and not (e->>'historyMismatch')::boolean) then raise exception 'FROZEN_ATTENDANCE_LOST'; end if;
  execute 'reset role';
  if (select status from public.enrollments where id=member_id)<>'withdrawn' or (select status from public.course_enrollments where id=commercial)<>'cancelled'
    or exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=commercial and status='active') then raise exception 'WITHDRAWAL_NOT_ATOMIC'; end if;
  if (select to_jsonb(a) from public.session_attendance a where session_id=target_one and student_id=child)<>before_attendance
    or (select jsonb_agg(to_jsonb(r) order by r.student_id) from public.session_roster_entries r where session_id=target_one)<>before_roster then raise exception 'HISTORY_CHANGED'; end if;
  execute 'set local role authenticated';
  payload:=jsonb_build_object('mode','permanent','membershipId',permanent_member,'fromClassroomId',original,'toClassroomId',target,'seat',4,'expectedSeat',3,'reason','Permanent transfer');
  request:=gen_random_uuid(); result:=public.change_enrollment_placement(request,payload);
  if public.change_enrollment_placement(request,payload)<>result then raise exception 'PERMANENT_RETRY_FAILED'; end if;
  execute 'reset role';
  select id into moved_member from public.enrollments where classroom_id=target and student_id=permanent_child and status='active' and placement_seat=4;
  if moved_member is null or (select status from public.enrollments where id=permanent_member)<>'transferred_out' then raise exception 'PERMANENT_MOVE_FAILED'; end if;
  execute 'set local role authenticated';
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','withdraw','membershipId',pupil_member,'fromClassroomId',original,'expectedSeat',2,'reason','Roster-only withdrawal'));
  execute 'reset role';
  if (select status from public.enrollments where id=pupil_member)<>'withdrawn' then raise exception 'LEGACY_WITHDRAW_FAILED'; end if;
  if has_table_privilege('authenticated','public.session_student_transfers','INSERT') or has_table_privilege('authenticated','mathin_internal.enrollment_placement_receipts','INSERT')
    or has_function_privilege('authenticated','mathin_internal.session_students(uuid,boolean)','EXECUTE')
    or has_function_privilege('anon','public.change_enrollment_placement(uuid,jsonb)','EXECUTE') then raise exception 'INTERNAL_WRITE_EXPOSED'; end if;
end $test$;
rollback to savepoint placement_change_contract;
release savepoint placement_change_contract;
