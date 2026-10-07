\set ON_ERROR_STOP on
-- Permission assertions in an identified isolated development database.
-- All identities, students, classes, labels and role assignments roll back together.
begin;

create function pg_temp.assert_label(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%', p_message; end if; end;
$$;
create function pg_temp.expect_label_error(p_sql text, p_expected text)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then return; end if;
    raise exception 'EXPECTED %, GOT %', p_expected, sqlerrm;
  end;
  raise exception 'EXPECTED %, STATEMENT SUCCEEDED', p_expected;
end;
$$;

do $$
declare
  actor_id uuid; actor_key text; invite text;
  class_a uuid := gen_random_uuid(); class_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid(); member_b uuid := gen_random_uuid();
  student_id uuid := gen_random_uuid(); course_id uuid; term_id uuid;
begin
  select code into invite from public.registration_invite_settings where id = 1 and is_active;
  if invite is null then raise exception 'ISOLATED_REGISTRATION_FIXTURE_REQUIRED'; end if;
  select c.course_id, c.term_id into course_id, term_id from public.classrooms c
    where c.course_id is not null and c.term_id is not null limit 1;
  if course_id is null then raise exception 'ISOLATED_COURSE_AND_TERM_REFERENCE_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  foreach actor_key in array array['teacher', 'other', 'assistant', 'support', 'admin', 'outsider'] loop
    actor_id := gen_random_uuid();
    insert into auth.users(id, email, raw_user_meta_data) values (actor_id, 'label-' || actor_id::text || '@example.invalid',
      jsonb_build_object('registration_invite_code', invite, 'privacy_consent', true, 'children_privacy_consent', true, 'display_name', 'Label assertion ' || actor_key));
    update public.profiles set role = case when actor_key = 'admin' then 'admin' when actor_key = 'outsider' then 'parent' else 'staff' end,
      is_active = true, purpose = 'test' where id = actor_id;
    perform set_config('test.label.' || actor_key, actor_id::text, true);
  end loop;
  insert into public.classrooms(id, owner_id, name, invite_code, purpose, offering_type, operational_status, course_id, term_id) values
    (class_a, current_setting('test.label.teacher')::uuid, 'Label assertion A', class_a::text, 'production', 'long_term_formal', 'active', course_id, term_id),
    (class_b, current_setting('test.label.other')::uuid, 'Label assertion B', class_b::text, 'production', 'long_term_formal', 'active', course_id, term_id);
  insert into public.classroom_members(classroom_id, user_id, role) values
    (class_a, current_setting('test.label.teacher')::uuid, 'teacher'), (class_b, current_setting('test.label.other')::uuid, 'teacher');
  insert into public.classroom_staff_assignments(classroom_id, user_id, responsibility) values
    (class_a, current_setting('test.label.teacher')::uuid, 'primary_teacher'),
    (class_b, current_setting('test.label.other')::uuid, 'primary_teacher'),
    (class_a, current_setting('test.label.assistant')::uuid, 'assistant_teacher'),
    (class_a, current_setting('test.label.support')::uuid, 'learning_support');
  insert into public.students(id, name, bind_code, purpose) values (student_id, 'Label assertion student', upper(substr(replace(student_id::text, '-', ''), 1, 8)), 'test');
  insert into public.enrollments(id, classroom_id, student_id) values (member_a, class_a, student_id), (member_b, class_b, student_id);
  perform set_config('test.label.class_a', class_a::text, true);
  perform set_config('test.label.class_b', class_b::text, true);
  perform set_config('test.label.member_a', member_a::text, true);
  perform set_config('test.label.member_b', member_b::text, true);
end;
$$;

set local role authenticated;
do $$
declare member_id uuid := current_setting('test.label.member_a')::uuid; state jsonb; tag text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.label.teacher'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  foreach tag in array array['A','B','C','D'] loop
    state := public.set_class_student_label(member_id, tag);
    perform pg_temp.assert_label(state->>'label' = tag and (state->>'canEdit')::boolean, 'TEACHER_SET_FAILED');
    state := public.get_class_student_labels(array[current_setting('test.label.class_a')::uuid]);
    perform pg_temp.assert_label(state @> jsonb_build_array(jsonb_build_object('enrollmentId', member_id, 'label', tag, 'canEdit', true)), 'LABEL_READ_AFTER_SAVE_FAILED');
  end loop;
  perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', member_id, 'E'), 'VALIDATION');
  perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', current_setting('test.label.member_b'), 'A'), 'FORBIDDEN');
  state := public.set_class_student_label(member_id, null);
  perform pg_temp.assert_label(state->'label' = 'null'::jsonb, 'LABEL_CLEAR_FAILED');
  perform public.set_class_student_label(member_id, 'B');
  perform pg_temp.expect_label_error(format('update public.class_student_labels set label=%L where enrollment_id=%L', 'D', member_id), 'permission denied');
  perform pg_temp.expect_label_error(format('delete from public.class_student_labels where enrollment_id=%L', member_id), 'permission denied');
end;
$$;

do $$
declare member_id uuid := current_setting('test.label.member_a')::uuid; actor_key text; state jsonb;
begin
  -- Staff with roster visibility, including another class teacher, share the same label.
  foreach actor_key in array array['other', 'support', 'admin'] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.label.' || actor_key), 'role', 'authenticated', 'aal', 'aal2')::text, true);
    state := public.get_class_student_labels(array[current_setting('test.label.class_a')::uuid]);
    perform pg_temp.assert_label(state @> jsonb_build_array(jsonb_build_object('enrollmentId', member_id, 'label', 'B', 'canEdit', false)), 'SHARED_READ_OR_READONLY_FAILED');
    perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', member_id, 'A'), 'FORBIDDEN');
    perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,null)', member_id), 'FORBIDDEN');
  end loop;
  -- An assistant with a current teaching assignment can edit without enrollment-management rights.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.label.assistant'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.set_class_student_label(member_id, 'C');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.label.outsider'), 'role', 'authenticated')::text, true);
  perform pg_temp.expect_label_error(format('select public.get_class_student_labels(array[%L]::uuid[])', current_setting('test.label.class_a')), 'FORBIDDEN');
  perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', member_id, 'A'), 'FORBIDDEN');
  perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', member_id, 'A'), 'UNAUTHENTICATED');
end;
$$;
reset role;

do $$
declare member_id uuid := current_setting('test.label.member_a')::uuid; state jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.label.teacher'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform pg_temp.assert_label((select label = 'C' and updated_by = current_setting('test.label.assistant')::uuid from public.class_student_labels where enrollment_id = member_id), 'AUTHOR_OR_PERSISTENCE_FAILED');
  perform pg_temp.assert_label(not exists(select 1 from public.class_student_labels where enrollment_id = current_setting('test.label.member_b')::uuid), 'LABEL_LEAKED_TO_ANOTHER_CLASS');
  update public.enrollments set status = 'withdrawn', left_at = now() where id = member_id;
  perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', member_id, 'A'), 'CLASS_MEMBERSHIP_NOT_ACTIVE');
  update public.enrollments set status = 'active', left_at = null where id = member_id;
  update public.classrooms set archived_at = now() where id = current_setting('test.label.class_a')::uuid;
  perform pg_temp.expect_label_error(format('select public.set_class_student_label(%L,%L)', member_id, 'A'), 'CLASS_NOT_EDITABLE');
  state := public.get_class_student_labels(array[current_setting('test.label.class_a')::uuid]);
  perform pg_temp.assert_label(state @> jsonb_build_array(jsonb_build_object('enrollmentId', member_id, 'label', 'C', 'canEdit', false)), 'ARCHIVED_LABEL_CHANGED');
end;
$$;

rollback;
select 'class_student_labels: permission and persistence checks passed';
