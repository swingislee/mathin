begin;

do $$
declare
  actor_id uuid;
  classroom_id uuid;
  session_id uuid;
  first_student_id uuid;
  second_student_id uuid;
  first_check_id uuid;
  second_check_id uuid;
begin
  select id into actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'CLASSROOM_MATRIX_ADMIN_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  classroom_id := public.create_classroom('Classroom matrix assertion');
  first_student_id := public.create_student(
    'Classroom matrix student one', 3::smallint, '', '', 'matrix-assertion-one', '', '', ''
  );
  second_student_id := public.create_student(
    'Classroom matrix student two', 3::smallint, '', '', 'matrix-assertion-two', '', '', ''
  );
  insert into public.enrollments(classroom_id, student_id, status, operated_by)
  values
    (classroom_id, first_student_id, 'active', actor_id),
    (classroom_id, second_student_id, 'active', actor_id);
  insert into public.class_sessions(classroom_id, title)
  values (classroom_id, 'Classroom matrix assertion session')
  returning id into session_id;
  insert into public.session_learning_checks(session_id, position, title, created_by)
  values (session_id, 0, 'Question one', actor_id)
  returning id into first_check_id;
  insert into public.session_learning_checks(session_id, position, title, created_by)
  values (session_id, 1, 'Question two', actor_id)
  returning id into second_check_id;

  perform public.mark_session_learning_matrix_cells(
    session_id,
    jsonb_build_array(
      jsonb_build_object('check_id', first_check_id, 'student_id', first_student_id),
      jsonb_build_object('check_id', first_check_id, 'student_id', second_student_id),
      jsonb_build_object('check_id', second_check_id, 'student_id', first_student_id)
    ),
    'prompted'
  );
  if (
    select count(*)
      from public.session_learning_check_results result_row
     where result_row.check_id in (first_check_id, second_check_id)
       and result_row.status = 'prompted'
  ) <> 3 then
    raise exception 'CLASSROOM_MATRIX_WRITE_INVALID';
  end if;

  perform public.mark_session_learning_matrix_cells(
    session_id,
    jsonb_build_array(
      jsonb_build_object('check_id', first_check_id, 'student_id', first_student_id),
      jsonb_build_object('check_id', second_check_id, 'student_id', first_student_id)
    ),
    'unchecked'
  );
  if exists(
    select 1
      from public.session_learning_check_results result_row
     where result_row.student_id = first_student_id
       and result_row.check_id in (first_check_id, second_check_id)
  ) or not exists(
    select 1
      from public.session_learning_check_results result_row
     where result_row.student_id = second_student_id
       and result_row.check_id = first_check_id
       and result_row.status = 'prompted'
  ) then
    raise exception 'CLASSROOM_MATRIX_UNDO_INVALID';
  end if;
end;
$$;

rollback;
