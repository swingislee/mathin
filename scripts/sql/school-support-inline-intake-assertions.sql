savepoint inline_intake_contract;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid;
  outsider uuid:=current_setting('manual_entry_test.student')::uuid;
  request uuid:=gen_random_uuid(); room uuid:=gen_random_uuid(); course uuid; term uuid;
  payload jsonb; saved jsonb; again jsonb; student uuid; membership uuid; n bigint; err text; before_students bigint;
begin
  select id into course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into term from public.school_terms order by id limit 1;
  if course is null or term is null then raise exception 'LOCAL_COURSE_AND_TERM_REQUIRED'; end if;
  insert into public.classrooms(id,name,owner_id,invite_code,capacity,course_id,term_id,purpose,offering_type,operational_status)
    values(room,'Inline intake contract',actor,replace(room::text,'-',''),3,course,term,'production','long_term_formal','active');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  payload:=jsonb_build_object('workspace','enrollments','subject',null,'newPerson',
    jsonb_build_object('name','inline-contract-'||request,'phone','','grade',3,'createStudent',true,'identityPending',false),
    'acknowledgeDuplicate',false,'work',jsonb_build_object('note','Manual roster entry','classroomId',room,'courseId',course,'termId',term,'seat',2));
  saved:=public.add_school_support_work_item(request,payload);
  student:=(saved->>'studentId')::uuid;
  again:=public.add_school_support_work_item(request,payload);
  if saved->>'id' is distinct from again->>'id' or student is null or saved->>'closedAt' is null then raise exception 'SEAT_RETRY_CONTRACT'; end if;
  execute 'reset role';
  select id into membership from public.enrollments where student_id=student and classroom_id=room and placement_seat=2 and term_id=term and status='active';
  if membership is null then raise exception 'SEAT_NOT_PERSISTED'; end if;
  if exists(select 1 from public.orders where student_id=student) or exists(select 1 from public.account_ledger where student_id=student)
    or exists(select 1 from public.course_enrollments where student_id=student) then raise exception 'ROSTER_ENTRY_INVENTED_PAYMENT_OR_CONFIRMATION'; end if;
  select count(*) into before_students from public.students;
  execute 'set local role authenticated';
  begin perform public.add_school_support_work_item(gen_random_uuid(),jsonb_set(payload,'{newPerson,name}','"Second child"')); raise exception 'OCCUPIED_SEAT_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'SEAT_OCCUPIED' then raise; end if; end;
  payload:=jsonb_set(payload,'{work,seat}','1');
  payload:=jsonb_set(payload,'{newPerson,name}','"Unconfirmed child"');
  payload:=jsonb_set(payload,'{newPerson,createStudent}','false');
  payload:=jsonb_set(payload,'{newPerson,identityPending}','true');
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'UNCONFIRMED_SEAT_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'IDENTITY_NOT_CONFIRMED' then raise; end if; end;
  execute 'reset role';
  select count(*) into n from public.students;
  if n<>before_students or exists(select 1 from public.leads where provisional_student_name='Unconfirmed child') then raise exception 'FAILED_INTAKE_LEFT_IDENTITY'; end if;
  payload:=jsonb_set(payload,'{newPerson}','null');
  payload:=jsonb_set(payload,'{subject}',jsonb_build_object('studentId',student,'leadId',null,'version',(select md5(to_jsonb(s)::text) from public.students s where id=student)));
  execute 'set local role authenticated';
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'DUPLICATE_ROSTER_ACCEPTED';
    exception when others then get stacked diagnostics err=message_text; if err<>'ALREADY_ENROLLED' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'STUDENT_ROLE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
end $test$;
rollback to savepoint inline_intake_contract;
release savepoint inline_intake_contract;
