-- 固定开发身份由本机 runner 注入；所有业务样例只存在于调用方回滚事务。
do $$
declare
  admin_id uuid := current_setting('teaching.test.admin')::uuid;
  teacher_id uuid := current_setting('teaching.test.teacher')::uuid;
  supervisor_id uuid := current_setting('teaching.test.supervisor')::uuid;
  classroom_id uuid := gen_random_uuid();
  other_classroom_id uuid := gen_random_uuid();
  test_classroom_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  override_session_id uuid := gen_random_uuid();
  other_session_id uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.classrooms(id, owner_id, name, invite_code, purpose) values
    (classroom_id, teacher_id, 'Teaching assertion', gen_random_uuid()::text, 'production'),
    (other_classroom_id, supervisor_id, 'Other teaching assertion', gen_random_uuid()::text, 'production'),
    (test_classroom_id, teacher_id, 'Excluded teaching assertion', gen_random_uuid()::text, 'test');
  insert into public.classroom_staff_assignments(classroom_id, user_id, responsibility) values
    (classroom_id, teacher_id, 'primary_teacher'),
    (other_classroom_id, supervisor_id, 'primary_teacher'),
    (test_classroom_id, teacher_id, 'primary_teacher');
  insert into public.class_sessions(id, classroom_id, title, scheduled_at, teacher_override) values
    (session_id, classroom_id, 'Teaching assertion', '2040-01-10T04:00:00Z', null),
    (override_session_id, classroom_id, 'Override assertion', '2040-01-11T04:00:00Z', supervisor_id),
    (other_session_id, other_classroom_id, 'Other assertion', '2040-01-12T04:00:00Z', null),
    (gen_random_uuid(), test_classroom_id, 'Excluded test', '2040-01-10T04:00:00Z', null);
  insert into public.class_sessions(classroom_id, title, scheduled_at, deleted_at) values
    (classroom_id, 'Excluded deleted', '2040-01-10T04:00:00Z', now());
  insert into public.session_preparations(session_id, status, reviewer_id) values (session_id, 'in_progress', teacher_id);
  insert into public.session_preparation_artifacts(session_id, rehearsal_video_url, updated_by)
    values (session_id, 'https://example.test/private-rehearsal', teacher_id);
  insert into public.lesson_plans(session_id, template_version, content, created_by, updated_by)
    values (session_id, 'mathin-teaching-plan-v1', '[]', teacher_id, teacher_id);
  insert into public.session_preparation_reviews(session_id, artifact_kind, status, submitted_by, review_note) values
    (session_id, 'solution', 'approved', teacher_id, 'PRIVATE_REVIEW_NOTE'),
    (session_id, 'rehearsal_video', 'pending', teacher_id, '');
  insert into public.session_completion_tasks(session_id, kind, status, assigned_to, required) values
    (session_id, 'attendance', 'done', teacher_id, true),
    (session_id, 'assignment', 'skipped', teacher_id, true),
    (session_id, 'summary', 'pending', teacher_id, true);
  insert into public.class_support_tasks(classroom_id, session_id, kind, status, assigned_to, note)
    values (classroom_id, session_id, 'postclass_followup', 'pending', supervisor_id, 'PRIVATE_CONTACT_NOTE');
  perform set_config('teaching.test.session', session_id::text, true);
  perform set_config('teaching.test.override', override_session_id::text, true);
  perform set_config('teaching.test.other', other_session_id::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  account_key text;
  account_id text;
  result jsonb;
  row_data jsonb;
  session_id text := current_setting('teaching.test.session');
  override_id text := current_setting('teaching.test.override');
  other_id text := current_setting('teaching.test.other');
begin
  foreach account_key in array array['admin', 'supervisor'] loop
    account_id := current_setting('teaching.test.' || account_key);
    perform set_config('request.jwt.claim.sub', account_id, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', account_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    result := public.get_teaching_workbench('2040-01-01Z', '2040-02-01Z', 'team');
    select value into row_data from jsonb_array_elements(result->'sessions') where value->>'id' = session_id;
    if row_data is null then raise exception 'MANAGER_SESSION_MISSING'; end if;
    if row_data #>> '{artifacts,solution,status}' <> 'approved'
       or row_data #>> '{artifacts,lesson_plan,status}' <> 'draft'
       or row_data #>> '{artifacts,rehearsal_video,status}' <> 'pending' then
      raise exception 'MATERIAL_STATUS_MISMATCH';
    end if;
    if (select count(*) from jsonb_array_elements(row_data->'tasks') where value->>'status' = 'done') <> 1
       or (select count(*) from jsonb_array_elements(row_data->'tasks') where value->>'status' = 'skipped') <> 1
       or (select count(*) from jsonb_array_elements(row_data->'tasks') where value->>'source' = 'support') <> 1 then
      raise exception 'TASK_STATUS_MISMATCH';
    end if;
    if result::text like '%PRIVATE_%' or result::text like '%example.test%' or result::text like '%Excluded%' then
      raise exception 'PRIVATE_OR_INACTIVE_DATA_LEAKED';
    end if;
    select value into row_data from jsonb_array_elements(result->'sessions') where value->>'id' = override_id;
    if jsonb_array_length(row_data->'teachers') <> 1
       or row_data #>> '{teachers,0,id}' <> current_setting('teaching.test.supervisor') then
      raise exception 'OVERRIDE_ATTRIBUTION_MISMATCH';
    end if;
  end loop;

  account_id := current_setting('teaching.test.teacher');
  perform set_config('request.jwt.claim.sub', account_id, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.get_teaching_workbench('2040-01-01Z', '2040-02-01Z', 'mine');
  if not exists(select 1 from jsonb_array_elements(result->'sessions') where value->>'id' = session_id)
     or exists(select 1 from jsonb_array_elements(result->'sessions') where value->>'id' in (override_id, other_id)) then
    raise exception 'TEACHER_SCOPE_MISMATCH';
  end if;
  begin
    perform public.get_teaching_workbench('2040-01-01Z', '2040-02-01Z', 'team');
    raise exception 'TEACHER_TEAM_ACCESS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin
    perform public.get_teaching_workbench('2040-01-01Z', '2040-04-01Z', 'mine');
    raise exception 'OVERSIZED_WINDOW_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'VALIDATION' then raise; end if; end;
  result := public.get_teaching_workbench('2040-01-10T04:00:00Z', '2040-01-11T04:00:00Z', 'mine');
  if not exists(select 1 from jsonb_array_elements(result->'sessions') where value->>'id' = session_id) then
    raise exception 'INCLUSIVE_START_MISMATCH';
  end if;
  result := public.get_teaching_workbench('2040-01-09T04:00:00Z', '2040-01-10T04:00:00Z', 'mine');
  if exists(select 1 from jsonb_array_elements(result->'sessions') where value->>'id' = session_id) then
    raise exception 'EXCLUSIVE_END_MISMATCH';
  end if;

  account_id := current_setting('teaching.test.outsider');
  perform set_config('request.jwt.claim.sub', account_id, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account_id, 'role', 'authenticated')::text, true);
  begin
    perform public.get_teaching_workbench('2040-01-01Z', '2040-02-01Z', 'mine');
    raise exception 'NON_STAFF_ACCESS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_teaching_workbench('2040-01-01Z', '2040-02-01Z', 'team');
    raise exception 'ANONYMOUS_ACCESS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; end;
  if has_function_privilege('anon', 'public.get_teaching_workbench(timestamptz,timestamptz,text)', 'execute') then
    raise exception 'ANONYMOUS_EXECUTE_GRANTED';
  end if;
end;
$$;
reset role;
select jsonb_build_object('managerAndTeacherScope', true, 'materialAndTaskStates', true,
  'overrideAttribution', true, 'dateBounds', true, 'privatePayloadExcluded', true, 'anonymousAndStudentDenied', true);
