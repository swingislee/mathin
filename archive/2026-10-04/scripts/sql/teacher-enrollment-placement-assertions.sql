savepoint teacher_placement_contract;
do $test$
#variable_conflict use_variable
declare admin_id uuid:=current_setting('manual_entry_test.admin')::uuid;
  teacher_id uuid:=current_setting('manual_entry_test.teacher')::uuid;
  student_actor uuid:=current_setting('manual_entry_test.student')::uuid;
  research_id uuid:=current_setting('manual_entry_test.research')::uuid;
  principal_id uuid:=current_setting('manual_entry_test.principal')::uuid;
  course uuid; term uuid; origin uuid:=gen_random_uuid(); destination uuid:=gen_random_uuid(); unrelated uuid:=gen_random_uuid();
  children uuid[]:='{}'; memberships uuid[]:='{}'; child uuid; member_id uuid; opportunity uuid; commercial uuid; pending_enrollment uuid;
  unrelated_enrollment uuid; unrelated_member uuid; source_session uuid; target_session uuid; unrelated_session uuid;
  request uuid; payload jsonb; result jsonb; options jsonb; board jsonb; transfer_id uuid; unrelated_transfer uuid; n integer; err text;
begin
  if public.has_perm(teacher_id,'enrollment.manage') or public.has_perm(teacher_id,'class.manage') then raise exception 'FIXED_TEACHER_MUST_HAVE_TEACHER_ONLY_PERMISSIONS'; end if;
  select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into term from public.school_terms order by id limit 1;
  if course is null or term is null then raise exception 'FIXED_LOCAL_COURSE_TERM_REQUIRED'; end if;
  insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id,purpose,offering_type,operational_status)
  values(origin,'Teacher transfer original',admin_id,replace(origin::text,'-',''),12,course,term,'production','long_term_formal','active'),
    (destination,'Teacher transfer destination',admin_id,replace(destination::text,'-',''),12,course,term,'production','long_term_formal','active'),
    (unrelated,'Teacher transfer unrelated',admin_id,replace(unrelated::text,'-',''),12,course,term,'production','long_term_formal','active');
  insert into public.classroom_members(classroom_id,user_id,role) values(origin,teacher_id,'teacher');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  for n in 1..6 loop
    child:=public.create_student(p_name=>'Teacher transfer contract '||n||' '||origin,p_grade=>3::smallint,p_phone=>'');
    children:=array_append(children,child);
  end loop;
  execute 'reset role';
  for n in 1..4 loop
    insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
      values(origin,children[n],'active',term,n,now()-interval '1 day',admin_id) returning id into member_id;
    memberships:=array_append(memberships,member_id);
  end loop;
  insert into public.enrollments(classroom_id,student_id,status,term_id,placement_seat,joined_at,operated_by)
    values(unrelated,children[6],'active',term,1,now()-interval '1 day',admin_id) returning id into unrelated_member;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
    values(origin,'Teacher transfer lesson',1,term,now()+interval '1 day') returning id into source_session;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
    values(destination,'Teacher transfer lesson',1,term,now()+interval '1 day') returning id into target_session;
  insert into public.class_sessions(classroom_id,title,lecture_no,term_id,scheduled_at)
    values(unrelated,'Teacher transfer lesson',1,term,now()+interval '1 day') returning id into unrelated_session;
  for n in 4..6 loop
    insert into public.course_opportunities(student_id,course_id,term_id,stage,owner_id,created_by,updated_by)
      values(children[n],course,term,'committed',admin_id,admin_id,admin_id) returning id into opportunity;
    execute 'set local role authenticated';
    commercial:=public.confirm_course_enrollment(opportunity,'Teacher permission contract');
    if n=4 then perform public.assign_course_enrollment(commercial,origin,'Link existing roster',clock_timestamp());
    elsif n=5 then pending_enrollment:=commercial;
    else unrelated_enrollment:=commercial; perform public.assign_course_enrollment(commercial,unrelated,'Link unrelated roster',clock_timestamp()); end if;
    execute 'reset role';
  end loop;

  -- 仅原班任课：页面可读、临时调班与无商业关联的完全调班均可完成。
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not public.can_access_enrollment_placement() or public.can_manage_classroom(origin,teacher_id) then raise exception 'TEACHER_ENTRY_OR_CLASS_MANAGEMENT_SCOPE'; end if;
  board:=public.get_enrollment_placement_board();
  if (board->'access'->>'canManageEnrollments')::boolean or not (board->'access'->'teacherClassroomIds' @> jsonb_build_array(origin))
    or not exists(select 1 from jsonb_array_elements(board->'options'->'classrooms') c where c->>'id'=destination::text)
    or not exists(select 1 from jsonb_array_elements(board->'members') m where m->>'membershipId'=unrelated_member::text and m->>'note'='' and m->>'phone'='' and not (m->>'canViewDetails')::boolean)
    or not exists(select 1 from jsonb_array_elements(board->'enrollments') e where e->>'id'=pending_enrollment::text) then raise exception 'TEACHER_BOARD_SCOPE'; end if;
  options:=public.preview_enrollment_session_transfer(memberships[1],destination,1);
  payload:=jsonb_build_object('mode','temporary','membershipId',memberships[1],'fromClassroomId',origin,'toClassroomId',destination,
    'seat',1,'expectedSeat',1,'reason','Source teacher transfer','sessions',(select jsonb_agg(jsonb_build_object('sessionId',o->>'sessionId','version',o->>'version')) from jsonb_array_elements(options) o));
  request:=gen_random_uuid(); result:=public.change_enrollment_placement(request,payload);
  if public.change_enrollment_placement(request,payload)<>result then raise exception 'TEACHER_RETRY_CHANGED_RESULT'; end if;
  select (t->>'id')::uuid into transfer_id from jsonb_array_elements(public.get_enrollment_session_transfers()) t where t->>'membershipId'=memberships[1]::text;
  if transfer_id is null then raise exception 'SOURCE_TEACHER_TRANSFER_NOT_VISIBLE'; end if;
  options:=public.preview_enrollment_session_transfer(memberships[3],unrelated,2);
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','temporary','membershipId',memberships[3],'fromClassroomId',origin,'toClassroomId',unrelated,
    'seat',2,'expectedSeat',3,'reason','Another temporary destination','sessions',(select jsonb_agg(jsonb_build_object('sessionId',o->>'sessionId','version',o->>'version')) from jsonb_array_elements(options) o)));
  select (t->>'id')::uuid into unrelated_transfer from jsonb_array_elements(public.get_enrollment_session_transfers()) t where t->>'membershipId'=memberships[3]::text;
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','permanent','membershipId',memberships[2],
    'fromClassroomId',origin,'toClassroomId',destination,'seat',2,'expectedSeat',2,'reason','Source teacher permanent transfer'));
  execute 'reset role';
  if not exists(select 1 from public.enrollments where student_id=children[2] and classroom_id=destination and status='active' and placement_seat=2)
    or (select status from public.enrollments where id=memberships[2])<>'transferred_out' then raise exception 'SOURCE_TEACHER_PERMANENT_FAILED'; end if;

  -- 仅目标班任课：能取消真实两端的临时安排，也能接收未关联及已关联商业报名。
  update public.classroom_members set classroom_id=destination where classroom_id=origin and user_id=teacher_id;
  execute 'set local role authenticated';
  if not exists(select 1 from jsonb_array_elements(public.get_enrollment_session_transfers()) t where t->>'id'=transfer_id::text)
    or exists(select 1 from jsonb_array_elements(public.get_enrollment_session_transfers()) t where t->>'id'=unrelated_transfer::text) then raise exception 'DESTINATION_TEACHER_TRANSFER_SCOPE'; end if;
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','cancel_temporary','membershipId',memberships[1],
    'fromClassroomId',origin,'toClassroomId',destination,'expectedSeat',1,'transferId',transfer_id));
  begin
    perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','cancel_temporary','membershipId',memberships[3],
      'fromClassroomId',origin,'toClassroomId',destination,'expectedSeat',3,'transferId',unrelated_transfer));
    raise exception 'SPOOFED_CANCEL_DESTINATION_ACCEPTED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  options:=public.preview_enrollment_session_transfer(memberships[1],destination,1);
  payload:=jsonb_build_object('mode','temporary','membershipId',memberships[1],'fromClassroomId',origin,'toClassroomId',destination,
    'seat',1,'expectedSeat',1,'reason','Destination teacher transfer','sessions',(select jsonb_agg(jsonb_build_object('sessionId',o->>'sessionId','version',o->>'version')) from jsonb_array_elements(options) o));
  perform public.change_enrollment_placement(gen_random_uuid(),payload);
  request:=gen_random_uuid();
  payload:=jsonb_build_object('mode','permanent','membershipId',memberships[1],'fromClassroomId',origin,'toClassroomId',destination,'seat',1,'expectedSeat',1,'reason','Destination teacher permanent');
  result:=public.change_enrollment_placement(request,payload);
  if public.change_enrollment_placement(request,payload)<>result then raise exception 'DESTINATION_RETRY_FAILED'; end if;
  perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','permanent','membershipId',memberships[4],
    'fromClassroomId',origin,'toClassroomId',destination,'seat',4,'expectedSeat',4,'reason','Existing commercial enrollment'));
  perform public.move_enrollment_to_seat(pending_enrollment,null,null,destination,5,null);
  execute 'reset role';
  if (select count(*) from public.enrollments where classroom_id=destination and student_id=any(array[children[1],children[4],children[5]]) and status='active')<>3 then raise exception 'DESTINATION_TEACHER_PERMANENT_FAILED'; end if;
  update public.classroom_members set classroom_id=unrelated where classroom_id=destination and user_id=teacher_id;
  execute 'set local role authenticated';
  begin perform public.change_enrollment_placement(request,payload); raise exception 'REVOKED_TEACHER_RETRY_ACCEPTED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  execute 'reset role';
  update public.classroom_members set classroom_id=destination where classroom_id=unrelated and user_id=teacher_id;
  execute 'set local role authenticated';

  -- 无关两班、伪造原班、伪造无 membership 的同班更新都被拒绝。
  begin perform public.preview_enrollment_session_transfer(memberships[3],unrelated,3); raise exception 'UNRELATED_PREVIEW_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','permanent','membershipId',memberships[3],
    'fromClassroomId',origin,'toClassroomId',unrelated,'seat',3,'expectedSeat',3)); raise exception 'UNRELATED_MOVE_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.move_enrollment_to_seat(null,unrelated_member,destination,origin,6,1); raise exception 'SPOOFED_MEMBER_SOURCE_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'PLACEMENT_CHANGED' then raise; end if; end;
  begin perform public.move_enrollment_to_seat(unrelated_enrollment,null,destination,unrelated,6,null); raise exception 'SPOOFED_EMPTY_MEMBER_SOURCE_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'PLACEMENT_CHANGED' then raise; end if; end;
  begin perform public.change_enrollment_placement(gen_random_uuid(),jsonb_build_object('mode','withdraw','membershipId',memberships[3],
    'fromClassroomId',origin,'toClassroomId',destination,'expectedSeat',3,'reason','Unrelated business permission')); raise exception 'TEACHER_COMMERCIAL_WITHDRAW_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.confirm_course_enrollment(opportunity,'Teacher must use scoped placement'); raise exception 'TEACHER_COMMERCIAL_CONFIRM_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  if has_function_privilege('authenticated','mathin_internal.confirm_course_enrollment(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','mathin_internal.assign_course_enrollment(uuid,uuid,text,timestamptz,boolean)','EXECUTE')
    or has_function_privilege('authenticated','mathin_internal.get_teacher_enrollment_placement_board()','EXECUTE')
    or has_function_privilege('anon','public.can_access_enrollment_placement()','EXECUTE') then raise exception 'PRIVATE_HELPER_EXPOSED'; end if;

  -- 当前本人身份有效性仍适用；学生与无关员工没有调班入口。
  execute 'reset role';
  update public.profiles set is_active=false where id=teacher_id;
  execute 'set local role authenticated';
  if public.can_access_enrollment_placement() then raise exception 'INACTIVE_TEACHER_ALLOWED'; end if;
  begin perform public.get_enrollment_placement_board(); raise exception 'INACTIVE_TEACHER_BOARD_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  update public.profiles set is_active=true where id=teacher_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',student_actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.can_access_enrollment_placement() then raise exception 'STUDENT_PLACEMENT_ALLOWED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',research_id,'role','authenticated')::text,true);
  begin perform public.move_enrollment_to_seat(unrelated_enrollment,unrelated_member,unrelated,destination,6,1); raise exception 'UNRELATED_STAFF_MOVE_ALLOWED';
  exception when others then get stacked diagnostics err=message_text; if err not in('FORBIDDEN','FORBIDDEN_SCOPE') then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',principal_id,'role','authenticated')::text,true);
  if not public.can_access_enrollment_placement() then raise exception 'MANAGER_ACCESS_REGRESSION'; end if;
  perform public.move_enrollment_to_seat(unrelated_enrollment,unrelated_member,unrelated,destination,6,1);
  execute 'reset role';
end $test$;
rollback to savepoint teacher_placement_contract;
release savepoint teacher_placement_contract;
