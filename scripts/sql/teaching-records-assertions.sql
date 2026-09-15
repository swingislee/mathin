-- 固定开发身份由本机 runner 注入；样例与权限对照全部随外层事务回滚。
do $$
declare
  admin_id uuid := current_setting('teaching.test.admin')::uuid;
  teacher_id uuid := current_setting('teaching.test.teacher')::uuid;
  supervisor_id uuid := current_setting('teaching.test.supervisor')::uuid;
  classroom_id uuid := gen_random_uuid();
  other_classroom uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  other_session uuid := gen_random_uuid();
  override_session uuid := gen_random_uuid();
  student_id uuid := gen_random_uuid();
  other_student uuid := gen_random_uuid();
  check_id uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.classrooms(id, owner_id, name, invite_code, purpose) values
    (classroom_id, teacher_id, 'Record assertion', gen_random_uuid()::text, 'production'),
    (other_classroom, supervisor_id, 'Other record assertion', gen_random_uuid()::text, 'production');
  insert into public.classroom_staff_assignments(classroom_id, user_id, responsibility) values
    (classroom_id, teacher_id, 'primary_teacher'), (other_classroom, supervisor_id, 'primary_teacher');
  insert into public.class_sessions(id, classroom_id, title, scheduled_at, teacher_override) values
    (session_id, classroom_id, 'Learning without starting', '2040-01-10T04:00:00Z', null),
    (other_session, other_classroom, 'Other lesson', '2040-01-10T04:00:00Z', null),
    (override_session, classroom_id, 'Substitute lesson', '2040-01-11T04:00:00Z', supervisor_id);
  insert into public.students(id, name, bind_code, assigned_to) values
    (student_id, 'Record student', gen_random_uuid()::text, teacher_id),
    (other_student, 'Other student', gen_random_uuid()::text, supervisor_id);
  insert into public.enrollments(classroom_id, student_id, status, joined_at) values
    (classroom_id, student_id, 'active', now()), (other_classroom, other_student, 'active', now());
  insert into public.session_learning_checks(id, session_id, title, position, created_by) values(check_id, session_id, 'Actual question', 0, teacher_id);
  insert into public.session_learning_check_results(check_id, student_id, status, marked_by)
    values(check_id, student_id, 'prompted', teacher_id);
  insert into public.session_attendance(session_id, student_id, status, note) values(session_id, student_id, 'late', 'Saved attendance');
  insert into public.session_reviews(session_id, student_id, comment, focus, created_by)
    values(session_id, student_id, 'Saved unpublished feedback', 3, teacher_id);
  insert into public.student_follow_ups(student_id, author_id, content, kind, created_at)
    select student_id, teacher_id, 'Contact ' || n, 'class', '2040-01-01Z'::timestamptz + n * interval '1 minute' from generate_series(1,21) n;
  insert into public.student_follow_ups(student_id, author_id, content, kind)
    values(other_student, supervisor_id, 'OUTSIDE_ROSTER_SECRET', 'class');
  insert into public.class_support_tasks(classroom_id, session_id, kind, status, assigned_to, note)
    values(classroom_id, session_id, 'postclass_followup', 'done', teacher_id, 'Saved support note');
  perform set_config('teaching.test.session', session_id::text, true);
  perform set_config('teaching.test.other', other_session::text, true);
  perform set_config('teaching.test.override', override_session::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  account_key text;
  account_id text;
  result jsonb;
  session_id uuid := current_setting('teaching.test.session')::uuid;
begin
  foreach account_key in array array['admin', 'supervisor', 'teacher'] loop
    account_id := current_setting('teaching.test.' || account_key);
    perform set_config('request.jwt.claim.sub', account_id, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', account_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    result := public.get_teaching_session_records(session_id, 1);
    if jsonb_array_length(result->'students') <> 1 or result #>> '{session,startedAt}' is not null
      or result #>> '{results,0,status}' <> 'prompted'
      or result #>> '{reviews,0,comment}' <> 'Saved unpublished feedback'
      or result #>> '{attendance,0,status}' <> 'late' then raise exception 'SAVED_RECORDS_NOT_RETURNED'; end if;
    if result::text like '%OUTSIDE_ROSTER_SECRET%' then raise exception 'UNRELATED_CONTACT_LEAK'; end if;
    if (result->>'canReadContacts')::boolean then
      if (result->>'contactTotal')::int <> 21 or jsonb_array_length(result->'contacts') <> 20
        or result #>> '{contacts,0,content}' <> 'Contact 21' then raise exception 'CONTACT_PAGE_MISMATCH'; end if;
      result := public.get_teaching_session_records(session_id, 99);
      if (result->>'contactPage')::int <> 2 or jsonb_array_length(result->'contacts') <> 1 then raise exception 'CONTACT_LAST_PAGE_MISMATCH'; end if;
    end if;
  end loop;
  foreach account_key in array array['other', 'override'] loop
    begin
      perform public.get_teaching_session_records(current_setting('teaching.test.' || account_key)::uuid, 1);
      raise exception 'UNRELATED_LESSON_ALLOWED';
    exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  end loop;
  begin
    perform public.get_teaching_session_records(session_id, 0); raise exception 'INVALID_PAGE_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'VALIDATION' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', current_setting('teaching.test.outsider'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('teaching.test.outsider'), 'role', 'authenticated')::text, true);
  begin
    perform public.get_teaching_session_records(session_id, 1); raise exception 'STUDENT_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_teaching_session_records(session_id, 1); raise exception 'ANONYMOUS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; end;
  if has_function_privilege('anon', 'public.get_teaching_session_records(uuid,integer)', 'execute') then raise exception 'ANONYMOUS_EXECUTE_GRANTED'; end if;
end;
$$;
reset role;

savepoint contact_permission_check;
delete from public.role_permissions where perm_key = 'followup.view';
set local role authenticated;
do $$
declare result jsonb; account_id text := current_setting('teaching.test.teacher');
begin
  perform set_config('request.jwt.claim.sub', account_id, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account_id, 'role', 'authenticated')::text, true);
  result := public.get_teaching_session_records(current_setting('teaching.test.session')::uuid, 1);
  if (result->>'canReadContacts')::boolean or jsonb_array_length(result->'contacts') <> 0 or jsonb_array_length(result->'supportNotes') <> 0
    then raise exception 'CONTACT_PERMISSION_BYPASSED'; end if;
  if jsonb_array_length(result->'results') <> 1 then raise exception 'LEARNING_READ_REQUIRES_CONTACT_PERMISSION'; end if;
end;
$$;
reset role;
rollback to contact_permission_check;
