\set ON_ERROR_STOP on
-- 当前版本完成时间与真实提交审计分离；只在已识别的本地隔离库运行。
begin;
create function pg_temp.assert_completion(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception '%', p_message; end if;
end;
$$;

do $$
declare
  manager_id uuid := gen_random_uuid();
  teacher_id uuid := gen_random_uuid();
  manager_role uuid := gen_random_uuid();
  class_id uuid := gen_random_uuid();
  lesson_id uuid := gen_random_uuid();
  invite text;
  actor uuid;
  result jsonb;
  before_row public.session_preparation_reviews%rowtype;
  after_row public.session_preparation_reviews%rowtype;
  completed timestamptz := date_trunc('minute', now() - interval '14 days');
  rejected boolean;
  event_count bigint;
begin
  select code into invite from public.registration_invite_settings where id = 1 and is_active;
  if invite is null then raise exception 'ISOLATED_REGISTRATION_FIXTURE_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  foreach actor in array array[manager_id, teacher_id] loop
    insert into auth.users(id, email, raw_user_meta_data) values (
      actor, actor::text || '@example.invalid', jsonb_build_object('registration_invite_code', invite,
        'privacy_consent', true, 'children_privacy_consent', true, 'display_name', 'Completion fixture'));
    update public.profiles set role = 'staff', is_active = true where id = actor;
  end loop;
  insert into public.staff_roles(id, key, name, is_system)
    values(manager_role, 'completion_' || manager_role::text, 'Completion fixture', false);
  insert into public.role_permissions(role_id, perm_key) values(manager_role, 'class.manage'), (manager_role, 'class.view.all');
  insert into public.staff_role_members(user_id, role_id) values(manager_id, manager_role);
  insert into public.classrooms(id, owner_id, name, invite_code, purpose)
    values(class_id, teacher_id, 'Completion fixture', class_id::text, 'test');
  insert into public.classroom_members(classroom_id, user_id, role) values(class_id, teacher_id, 'teacher');
  insert into public.classroom_staff_assignments(classroom_id, user_id, responsibility)
    values(class_id, teacher_id, 'primary_teacher');
  insert into public.class_sessions(id, classroom_id, title, scheduled_at)
    values(lesson_id, class_id, 'Completion fixture', now() + interval '1 day');
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', manager_id::text, true);

  result := public.supplement_session_preparation_artifact(lesson_id, 'solution', '[]', 'Completed earlier', '', completed);
  select * into before_row from public.session_preparation_reviews where session_id = lesson_id and artifact_kind = 'solution';
  perform pg_temp.assert_completion(before_row.completed_at = completed and before_row.submitted_at >= now()
    and before_row.submitted_by = manager_id and before_row.status = 'pending', 'COMPLETION_REPLACED_SUBMISSION_AUDIT');
  perform pg_temp.assert_completion((result->>'completedAt')::timestamptz = completed and (result->>'timeChanged')::boolean,
    'COMPLETION_RESULT_MISSING');
  perform pg_temp.assert_completion(before_row.completed_at <= now() - interval '6 days'
    and before_row.submitted_at > now() - interval '6 days', 'COMPLETION_CANNOT_DISTINGUISH_BACKFILL_LATENESS');
  perform pg_temp.assert_completion(exists(select 1 from public.domain_events where entity_id = lesson_id
    and event_type = 'session.preparation.completion_recorded' and actor_id = manager_id
    and (payload->>'completedAt')::timestamptz = completed
    and (payload->>'submittedAt')::timestamptz = before_row.submitted_at), 'COMPLETION_AUDIT_MISSING');

  select count(*) into event_count from public.domain_events where entity_id = lesson_id;
  result := public.supplement_session_preparation_artifact(lesson_id, 'solution', '[]', 'Completed earlier', '', completed);
  perform pg_temp.assert_completion(not (result->>'changed')::boolean and not (result->>'timeChanged')::boolean
    and (select count(*) from public.domain_events where entity_id = lesson_id) = event_count, 'RETRY_CHANGED_AUDIT');

  update public.session_preparation_reviews set status = 'approved', reviewed_at = now(), reviewed_by = teacher_id
    where session_id = lesson_id and artifact_kind = 'solution';
  perform pg_temp.assert_completion((select completed_at = completed from public.session_preparation_reviews
    where session_id = lesson_id and artifact_kind = 'solution'), 'APPROVAL_CLEARED_COMPLETION');
  result := public.supplement_session_preparation_artifact(lesson_id, 'solution', '[]', 'Completed earlier', '', completed + interval '1 day');
  select * into after_row from public.session_preparation_reviews where session_id = lesson_id and artifact_kind = 'solution';
  perform pg_temp.assert_completion(after_row.completed_at = completed + interval '1 day'
    and after_row.submitted_at = before_row.submitted_at and after_row.revision = before_row.revision
    and after_row.status = 'approved', 'TIME_CORRECTION_CHANGED_MATERIAL_REVIEW');

  rejected := false;
  begin
    perform public.supplement_session_preparation_artifact(lesson_id, 'solution', '[]', 'Invalid future addition', '', now() + interval '1 day');
  exception when others then
    if sqlerrm <> 'COMPLETION_TIME_INVALID' then raise; end if;
    rejected := true;
  end;
  perform pg_temp.assert_completion(rejected and (select solution_notes = 'Completed earlier'
    from public.session_preparation_artifacts where session_id = lesson_id), 'FUTURE_TIME_WROTE_MATERIAL');
  foreach completed in array array[null::timestamptz, 'infinity'::timestamptz, '-infinity'::timestamptz] loop
    rejected := false;
    begin
      perform public.supplement_session_preparation_artifact(lesson_id, 'solution', '[]', 'Invalid time', '', completed);
    exception when others then
      if sqlerrm <> 'COMPLETION_TIME_INVALID' then raise; end if;
      rejected := true;
    end;
    perform pg_temp.assert_completion(rejected, 'INVALID_COMPLETION_TIME_ACCEPTED');
  end loop;

  perform set_config('request.jwt.claim.sub', teacher_id::text, true);
  rejected := false;
  begin
    perform public.supplement_session_preparation_artifact(lesson_id, 'solution', '[]', 'Teacher backdate', '', now() - interval '14 days');
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
    rejected := true;
  end;
  perform pg_temp.assert_completion(rejected, 'TEACHER_CAN_BACKDATE_COMPLETION');
  perform pg_temp.assert_completion(not has_column_privilege('authenticated', 'public.session_preparation_reviews', 'completed_at', 'UPDATE')
    and not has_function_privilege('anon', 'public.supplement_session_preparation_artifact(uuid,text,jsonb,text,text,timestamptz)', 'EXECUTE'),
    'DIRECT_OR_ANONYMOUS_COMPLETION_WRITE_GRANTED');

  perform public.save_session_preparation_artifacts(lesson_id, 'Teacher revised material',
    jsonb_build_array(jsonb_build_object('path', lesson_id::text || '/solution/revised.pdf',
      'name', 'revised.pdf', 'type', 'application/pdf', 'size', 64)), '[]', '');
  select * into after_row from public.session_preparation_reviews where session_id = lesson_id and artifact_kind = 'solution';
  perform pg_temp.assert_completion(after_row.completed_at is null and after_row.revision > before_row.revision
    and after_row.submitted_by = teacher_id and after_row.status = 'pending', 'NEW_REVISION_REUSED_OLD_COMPLETION');
end;
$$;
rollback;
