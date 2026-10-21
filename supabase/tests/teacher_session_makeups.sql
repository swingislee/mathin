-- Run in one rolled-back transaction on the identified development database.
create function pg_temp.makeup_expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
<<makeup_check>>
declare teacher uuid; admin_id uuid; outsider uuid; cid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
  first_student uuid:=gen_random_uuid(); second_student uuid:=gen_random_uuid(); other_student uuid:=gen_random_uuid();
  check_id uuid:=gen_random_uuid(); makeup_id uuid:=gen_random_uuid(); second_makeup uuid:=gen_random_uuid();
  value jsonb; changed jsonb; result jsonb; original_ids uuid[];
begin
  select p.id into teacher from public.profiles p join auth.users u on u.id=p.id where u.email='test-teacher@mathin.local' and p.purpose='test';
  select p.id into admin_id from public.profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.purpose='test';
  select p.id into outsider from public.profiles p join auth.users u on u.id=p.id where u.email='test-parent@mathin.local' and p.purpose='test';
  if teacher is null or admin_id is null or outsider is null then raise exception 'FIXED_TEST_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  insert into public.classrooms(id,owner_id,name,invite_code,purpose) values(cid,teacher,'Makeup transaction class',cid::text,'test');
  insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values(cid,teacher,'primary_teacher') on conflict do nothing;
  insert into public.students(id,name,bind_code,purpose,created_by) values
    (first_student,'Makeup child one',first_student::text,'test',admin_id),
    (second_student,'Makeup child two',second_student::text,'test',admin_id),
    (other_student,'Outside the lesson',other_student::text,'test',admin_id);
  insert into public.enrollments(classroom_id,student_id,status,operated_by) values(cid,first_student,'active',admin_id),(cid,second_student,'active',admin_id);
  insert into public.class_sessions(id,classroom_id,title,ended_at) values(sid,cid,'Original makeup source',now());
  insert into public.session_attendance(session_id,student_id,status) values(sid,first_student,'absent'),(sid,second_student,'leave');
  insert into public.session_learning_checks(id,session_id,position,title,created_by) values(check_id,sid,0,'Original checkpoint',teacher);
  insert into public.session_learning_check_results(check_id,student_id,status,marked_by) values(check_id,first_student,'incomplete',teacher);
  original_ids:=public.session_communication_student_ids(sid);
  value:=jsonb_build_object('scheduledAt',now(),'durationMin',45,'status','completed','note','Makeup only',
    'checks',jsonb_build_array(jsonb_build_object('id',check_id,'title','Makeup checkpoint')),
    'students',jsonb_build_array(jsonb_build_object('studentId',first_student,'name','Untrusted name','attendance','present','note','Individual note',
      'results',jsonb_build_array(jsonb_build_object('checkId',check_id,'status','independent')))));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated','aal','aal1')::text,true);
  execute 'set local role authenticated';
  if not public.can_record_session_makeup(sid,teacher) then raise exception 'OWN_TEACHER_BLOCKED'; end if;
  result:=public.save_session_makeup(makeup_id,sid,0,value);
  if jsonb_array_length(result->'records')<>1 or result->'records'->0->>'revision'<>'1' then raise exception 'TEACHER_SAVE_FAILED'; end if;
  if result->'records'->0->'students'->0->>'name'<>'Makeup child one' then raise exception 'FORGED_NAME_SAVED'; end if;
  result:=public.save_session_makeup(makeup_id,sid,0,value);
  if jsonb_array_length(result->'records')<>1 or result->'records'->0->>'revision'<>'1' then raise exception 'RETRY_DUPLICATED_RECORD'; end if;
  perform pg_temp.makeup_expect_error('insert into public.session_makeup_records(id) values(gen_random_uuid())','permission denied');
  changed:=jsonb_set(value,'{students,0,studentId}',to_jsonb(other_student));
  perform pg_temp.makeup_expect_error(format('select public.save_session_makeup(%L,%L,0,%L::jsonb)',second_makeup,sid,changed),'STUDENT_NOT_IN_SESSION');
  changed:=jsonb_set(value,'{students}',(value->'students')||(value->'students'));
  perform pg_temp.makeup_expect_error(format('select public.save_session_makeup(%L,%L,0,%L::jsonb)',second_makeup,sid,changed),'STUDENT_NOT_IN_SESSION');
  changed:=jsonb_set(value,'{students,0,results,0,checkId}',to_jsonb(gen_random_uuid()));
  perform pg_temp.makeup_expect_error(format('select public.save_session_makeup(%L,%L,0,%L::jsonb)',second_makeup,sid,changed),'VALIDATION');
  changed:=jsonb_set(value,'{note}','"Updated makeup note"');
  result:=public.save_session_makeup(makeup_id,sid,1,changed);
  if result->'records'->0->>'revision'<>'2' then raise exception 'REVISION_NOT_INCREMENTED'; end if;
  perform pg_temp.makeup_expect_error(format('select public.save_session_makeup(%L,%L,1,%L::jsonb)',makeup_id,sid,value),'CONFLICT');
  changed:=jsonb_set(value,'{students,0,studentId}',to_jsonb(second_student));
  result:=public.save_session_makeup(second_makeup,sid,0,changed);
  if jsonb_array_length(result->'records')<>2 then raise exception 'SECOND_MAKEUP_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','aal','aal1')::text,true);
  perform pg_temp.makeup_expect_error(format('select public.read_session_makeups(%L)',sid),'FORBIDDEN');
  perform pg_temp.makeup_expect_error(format('select public.save_session_makeup(%L,%L,0,%L::jsonb)',gen_random_uuid(),sid,value),'FORBIDDEN');
  if exists(select 1 from public.session_makeup_records where session_id=sid) then raise exception 'OUTSIDER_RLS_LEAK'; end if;
  execute 'reset role';
  if public.session_communication_student_ids(sid) is distinct from original_ids then raise exception 'ORIGINAL_ROSTER_CHANGED'; end if;
  if (select status from public.session_attendance where session_id=sid and student_id=first_student)<>'absent'
    or (select status from public.session_attendance where session_id=sid and student_id=second_student)<>'leave'
    or (select status from public.session_learning_check_results where session_learning_check_results.check_id=makeup_check.check_id and student_id=first_student)<>'incomplete'
    or (select title from public.session_learning_checks where id=check_id)<>'Original checkpoint'
    or (select count(*) from public.class_sessions where classroom_id=cid)<>1 then raise exception 'ORIGINAL_LESSON_CHANGED'; end if;
end $check$;
select 'PASS: teacher direct save, partial roster, independent learning, retries, revisions, input scope, read/write isolation and original records preserved';
