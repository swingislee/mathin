\set ON_ERROR_STOP on
-- 管理补交的权限、冻结保护和资料保留合同。仅在已识别的隔离开发库执行。
-- 身份、岗位、班级、课次和 Storage 元数据均为本事务夹具，最后全部回滚。
begin;

create function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception '%', p_message; end if;
end;
$$;

create function pg_temp.expect_error(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm = p_message then return; end if;
    raise exception 'EXPECTED %, GOT %', p_message, sqlerrm;
  end;
  raise exception 'EXPECTED %, STATEMENT SUCCEEDED', p_message;
end;
$$;

do $$
#variable_conflict use_variable
declare
  fixture_id uuid;
  actor_key text;
  invite_code text;
  manager_role uuid := gen_random_uuid();
  viewer_role uuid := gen_random_uuid();
  scoped_role uuid := gen_random_uuid();
  class_id uuid := gen_random_uuid();
  empty_class_id uuid := gen_random_uuid();
  trashed_class_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  frozen_id uuid := gen_random_uuid();
  fallback_id uuid := gen_random_uuid();
  missing_teacher_id uuid := gen_random_uuid();
  deleted_id uuid := gen_random_uuid();
  voided_id uuid := gen_random_uuid();
  cancelled_id uuid := gen_random_uuid();
  trashed_id uuid := gen_random_uuid();
begin
  select code into invite_code from public.registration_invite_settings where id = 1 and is_active;
  if invite_code is null then raise exception 'ISOLATED_REGISTRATION_FIXTURE_REQUIRED'; end if;
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  foreach actor_key in array array['manager', 'teacher', 'viewer', 'scoped', 'inactive', 'substitute'] loop
    fixture_id := gen_random_uuid();
    insert into auth.users(id, email, raw_user_meta_data)
    values (fixture_id, 'material-' || fixture_id::text || '@example.invalid', jsonb_build_object(
      'registration_invite_code', invite_code, 'privacy_consent', true,
      'children_privacy_consent', true, 'display_name', 'Material assertion ' || actor_key
    ));
    update public.profiles set role = 'staff', is_active = actor_key <> 'inactive'
     where id = fixture_id;
    perform set_config('test.supplement.' || actor_key, fixture_id::text, true);
  end loop;

  insert into public.staff_roles(id, key, name, is_system) values
    (manager_role, 'material_assert_' || manager_role::text, 'Material manager assertion', false),
    (viewer_role, 'material_assert_' || viewer_role::text, 'Material viewer assertion', false),
    (scoped_role, 'material_assert_' || scoped_role::text, 'Material scoped assertion', false);
  insert into public.role_permissions(role_id, perm_key) values
    (manager_role, 'class.manage'), (manager_role, 'class.view.all'),
    (viewer_role, 'class.view.all'), (scoped_role, 'class.manage');
  insert into public.staff_role_members(user_id, role_id) values
    (current_setting('test.supplement.manager')::uuid, manager_role),
    (current_setting('test.supplement.inactive')::uuid, manager_role),
    (current_setting('test.supplement.viewer')::uuid, viewer_role),
    (current_setting('test.supplement.scoped')::uuid, scoped_role);

  insert into public.classrooms(id, owner_id, name, invite_code, purpose, trashed_at) values
    (class_id, current_setting('test.supplement.teacher')::uuid, 'Material assertion', class_id::text, 'test', null),
    (empty_class_id, current_setting('test.supplement.viewer')::uuid, 'Material no teacher', empty_class_id::text, 'test', null),
    (trashed_class_id, current_setting('test.supplement.teacher')::uuid, 'Material trashed class', trashed_class_id::text, 'test', now());
  insert into public.classroom_members(classroom_id, user_id, role)
    values (class_id, current_setting('test.supplement.teacher')::uuid, 'teacher');
  insert into public.classroom_staff_assignments(classroom_id, user_id, responsibility)
    values (class_id, current_setting('test.supplement.teacher')::uuid, 'primary_teacher');
  insert into public.class_sessions(id, classroom_id, title, teacher_override, deleted_at, voided_at) values
    (session_id, class_id, 'Existing materials', current_setting('test.supplement.teacher')::uuid, null, null),
    (frozen_id, class_id, 'First frozen supplement', current_setting('test.supplement.substitute')::uuid, null, null),
    (fallback_id, class_id, 'Class teacher reviewer', null, null, null),
    (missing_teacher_id, empty_class_id, 'No reviewer available', null, null, null),
    (deleted_id, class_id, 'Deleted assertion', null, now(), null),
    (voided_id, class_id, 'Voided assertion', null, null, now()),
    (trashed_id, trashed_class_id, 'Trashed class assertion', null, null, null);
  insert into public.class_sessions(id, classroom_id, title, cancelled_by)
    values (cancelled_id, class_id, 'Cancelled assertion', current_setting('test.supplement.manager')::uuid);
  perform set_config('test.supplement.class', class_id::text, true);
  perform set_config('test.supplement.session', session_id::text, true);
  perform set_config('test.supplement.frozen', frozen_id::text, true);
  perform set_config('test.supplement.fallback', fallback_id::text, true);
  perform set_config('test.supplement.missing_teacher', missing_teacher_id::text, true);
  perform set_config('test.supplement.deleted', deleted_id::text, true);
  perform set_config('test.supplement.voided', voided_id::text, true);
  perform set_config('test.supplement.cancelled', cancelled_id::text, true);
  perform set_config('test.supplement.trashed', trashed_id::text, true);
  insert into storage.objects(bucket_id, name) values
    ('prep-artifacts', session_id::text || '/solution/original.pdf'),
    ('prep-artifacts', session_id::text || '/lesson-plan/original.pdf'),
    ('prep-artifacts', frozen_id::text || '/lesson-plan/first.pdf');
  insert into storage.objects(bucket_id, name)
    select 'prep-artifacts', session_id::text || '/solution/extra-' || n || '.pdf'
      from generate_series(1, 9) n;

  -- 既有试用迁移会开启归档修改；追加本事务的关闭版本，单独验证补交例外。
  insert into public.feature_flag_versions(organization_id, flag_key, version, enabled, effective_from, reason)
  select organization_row.id, 'teaching.preparation_archive_edit',
         coalesce((select max(version) from public.feature_flag_versions
                    where organization_id = organization_row.id and campus_id is null
                      and flag_key = 'teaching.preparation_archive_edit'), 0) + 1,
         false, now(), 'Transaction-only material supplement assertion'
    from public.organizations organization_row where singleton_key = 1;
  perform pg_temp.assert_true(not public.is_feature_enabled('teaching.preparation_archive_edit'), 'ARCHIVE_FLAG_FIXTURE_FAILED');

  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.teacher'), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform public.save_session_preparation_artifacts(session_id, 'Original explanation',
    jsonb_build_array(jsonb_build_object('path', session_id::text || '/solution/original.pdf', 'name', 'original.pdf', 'type', 'application/pdf', 'size', 128)),
    jsonb_build_array(jsonb_build_object('path', session_id::text || '/lesson-plan/original.pdf', 'name', 'original.pdf', 'type', 'application/pdf', 'size', 256)),
    'https://example.invalid/original-video');
  update public.session_preparation_reviews set status = 'approved',
    reviewed_by = current_setting('test.supplement.teacher')::uuid,
    reviewed_at = now() - interval '1 day', review_note = 'Original approval'
    where session_preparation_reviews.session_id = session_id;
  update public.class_sessions set courseware_frozen_at = now(),
    started_at = now() - interval '2 hours', ended_at = now() - interval '1 hour'
    where id in (session_id, frozen_id);
  perform set_config('test.supplement.original_session',
    (select to_jsonb(session_row)::text from public.class_sessions session_row where id = session_id), true);
  perform set_config('test.supplement.original_reviewer',
    (select jsonb_build_object('id', reviewer_id, 'source', reviewer_assignment_source,
      'by', reviewer_assigned_by, 'at', reviewer_assigned_at)::text
      from public.session_preparations where session_preparations.session_id = session_id), true);
  perform set_config('test.supplement.original_other_reviews',
    (select jsonb_agg(to_jsonb(review_row) order by artifact_kind)::text
      from public.session_preparation_reviews review_row
      where review_row.session_id = session_id and artifact_kind <> 'solution'), true);
end;
$$;

do $$
#variable_conflict use_variable
declare
  session_id uuid := current_setting('test.supplement.session')::uuid;
  target_id uuid;
  actor_key text;
begin
  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.manager'), true);
  perform pg_temp.assert_true(public.can_supplement_session_materials(session_id), 'MANAGER_SUPPLEMENT_REJECTED');
  perform pg_temp.assert_true(not public.is_session_teacher(session_id, auth.uid()), 'MANAGER_FIXTURE_IS_TEACHER');
  perform pg_temp.assert_true(not public.has_perm(auth.uid(), 'courseware.overlay.edit'), 'MANAGER_FIXTURE_HAS_OVERLAY_PERMISSION');
  foreach actor_key in array array['teacher', 'viewer', 'scoped', 'inactive'] loop
    perform set_config('request.jwt.claim.sub', current_setting('test.supplement.' || actor_key), true);
    perform pg_temp.assert_true(not public.can_supplement_session_materials(session_id), actor_key || '_SUPPLEMENT_ALLOWED');
    perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)',
      session_id, 'solution', '[]', 'Denied note'), 'FORBIDDEN');
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.assert_true(not public.can_supplement_session_materials(session_id), 'ANONYMOUS_CAPABILITY_ALLOWED');
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)',
    session_id, 'solution', '[]', 'Denied note'), 'UNAUTHENTICATED');

  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.manager'), true);
  foreach target_id in array array[gen_random_uuid(), current_setting('test.supplement.deleted')::uuid,
    current_setting('test.supplement.voided')::uuid, current_setting('test.supplement.trashed')::uuid,
    current_setting('test.supplement.cancelled')::uuid] loop
    perform pg_temp.assert_true(not public.can_supplement_session_materials(target_id), 'INVALID_SESSION_CAPABILITY_ALLOWED');
    perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)',
      target_id, 'solution', '[]', 'Denied note'), 'SESSION_NOT_FOUND');
  end loop;
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)',
    current_setting('test.supplement.missing_teacher'), 'solution', '[]', 'Reviewer required'), 'REVIEWER_NOT_AVAILABLE');
  perform pg_temp.assert_true(not exists(select 1 from public.session_preparation_artifacts
    where session_preparation_artifacts.session_id = current_setting('test.supplement.missing_teacher')::uuid),
    'FAILED_REVIEWER_LOOKUP_LEFT_MATERIALS');
end;
$$;

-- 真正以 authenticated 调用新 RPC，验证授权角色及 Storage RLS。
set local role authenticated;
do $$
#variable_conflict use_variable
declare
  session_id uuid := current_setting('test.supplement.session')::uuid;
  new_file jsonb := jsonb_build_object('path', session_id::text || '/solution/supplement.pdf', 'name', 'supplement.pdf', 'type', 'application/pdf', 'size', 512);
  result jsonb;
  first_result jsonb;
  affected integer;
begin
  insert into storage.objects(bucket_id, name)
    values ('prep-artifacts', session_id::text || '/solution/supplement.pdf');
  result := public.supplement_session_preparation_artifact(session_id, 'solution', jsonb_build_array(new_file), 'Additional explanation');
  perform pg_temp.assert_true((result->>'changed')::boolean and (result->>'revision')::integer = 2
    and nullif(result->>'submittedAt', '') is not null, 'FIRST_SUPPLEMENT_RESULT_INVALID');
  first_result := result;
  result := public.supplement_session_preparation_artifact(session_id, 'solution', jsonb_build_array(new_file), 'Additional explanation');
  perform pg_temp.assert_true(not (result->>'changed')::boolean
    and result->>'revision' = first_result->>'revision'
    and result->>'submittedAt' = first_result->>'submittedAt', 'RETRY_CHANGED_REVISION');
  result := public.supplement_session_preparation_artifact(session_id, 'solution', '[]', 'Additional explanation');
  perform pg_temp.assert_true(not (result->>'changed')::boolean, 'REPEATED_NOTE_NOT_IDEMPOTENT');

  insert into storage.objects(bucket_id, name)
    values ('prep-artifacts', session_id::text || '/solution/manager-upload.pdf');
  begin
    delete from storage.objects where bucket_id = 'prep-artifacts'
      and name = session_id::text || '/solution/manager-upload.pdf';
    get diagnostics affected = row_count;
    perform pg_temp.assert_true(affected = 0, 'SUPPLEMENT_MANAGER_STORAGE_DELETE_EXPANDED');
  exception when others then
    if sqlerrm <> 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' then raise; end if;
  end;
  perform pg_temp.assert_true(exists(select 1 from storage.objects where bucket_id = 'prep-artifacts'
    and name = session_id::text || '/solution/manager-upload.pdf'), 'SUPPLEMENT_MANAGER_STORAGE_OBJECT_REMOVED');
  begin
    insert into storage.objects(bucket_id, name)
      values ('prep-artifacts', session_id::text || '/other/manager-upload.pdf');
    raise exception 'INVALID_STORAGE_FOLDER_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.viewer'), true);
  begin
    insert into storage.objects(bucket_id, name)
      values ('prep-artifacts', session_id::text || '/solution/viewer-upload.pdf');
    raise exception 'VIEWER_STORAGE_UPLOAD_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.manager'), true);
end;
$$;
reset role;

do $$
#variable_conflict use_variable
declare
  session_id uuid := current_setting('test.supplement.session')::uuid;
  artifact public.session_preparation_artifacts%rowtype;
  review_row public.session_preparation_reviews%rowtype;
  frozen_id uuid := current_setting('test.supplement.frozen')::uuid;
  result jsonb;
  existing_files jsonb;
  too_many_files jsonb;
  before_payload jsonb;
  candidate jsonb;
  sql_text text;
begin
  select * into artifact from public.session_preparation_artifacts where session_preparation_artifacts.session_id = session_id;
  perform pg_temp.assert_true(artifact.updated_by = current_setting('test.supplement.manager')::uuid
    and jsonb_array_length(artifact.solution_files) = 2
    and artifact.solution_files->0->>'name' = 'original.pdf'
    and position('Original explanation' in artifact.solution_notes) > 0
    and position('Additional explanation' in artifact.solution_notes) > 0
    and artifact.lesson_plan_files = jsonb_build_array(jsonb_build_object('path', session_id::text || '/lesson-plan/original.pdf', 'name', 'original.pdf', 'type', 'application/pdf', 'size', 256))
    and artifact.rehearsal_video_url = 'https://example.invalid/original-video', 'ORIGINAL_MATERIALS_OR_ACTOR_LOST');
  select * into review_row from public.session_preparation_reviews where session_preparation_reviews.session_id = session_id and artifact_kind = 'solution';
  perform pg_temp.assert_true(review_row.status = 'pending' and review_row.revision = 2
    and review_row.submitted_by = current_setting('test.supplement.manager')::uuid
    and review_row.reviewed_by is null and review_row.reviewed_at is null and review_row.review_note = '', 'REVIEW_NOT_RESET');
  perform pg_temp.assert_true((select jsonb_agg(to_jsonb(r) order by artifact_kind) from public.session_preparation_reviews r
    where r.session_id = session_id and artifact_kind <> 'solution')
    = current_setting('test.supplement.original_other_reviews')::jsonb, 'UNRELATED_REVIEW_CHANGED');
  perform pg_temp.assert_true((select to_jsonb(s) from public.class_sessions s where id = session_id)
    = current_setting('test.supplement.original_session')::jsonb, 'FROZEN_SESSION_OR_TEACHER_CHANGED');
  perform pg_temp.assert_true((select jsonb_build_object('id', reviewer_id, 'source', reviewer_assignment_source,
    'by', reviewer_assigned_by, 'at', reviewer_assigned_at) from public.session_preparations p where p.session_id = session_id)
    = current_setting('test.supplement.original_reviewer')::jsonb, 'EXISTING_REVIEWER_CHANGED');
  perform pg_temp.assert_true(exists(select 1 from public.solution_records r where r.session_id = session_id
    and solution_source = 'upload' and r.created_by = current_setting('test.supplement.teacher')::uuid
    and r.updated_by = current_setting('test.supplement.manager')::uuid and r.revision = 2
    and r.content->'files' = artifact.solution_files and r.content->>'notes' = artifact.solution_notes), 'UPLOAD_PROJECTION_OR_CREATOR_LOST');
  perform pg_temp.assert_true((select count(*) = 1 from public.domain_events e
    where e.entity_id = session_id and e.event_type = 'session.preparation.supplemented'
      and e.actor_id = current_setting('test.supplement.manager')::uuid
      and e.target_user_id = current_setting('test.supplement.teacher')::uuid
      and e.payload->>'artifactKind' = 'solution' and e.payload->>'revision' = '2'),
    'SUPPLEMENT_AUDIT_ACTOR_OR_IDEMPOTENCY_INVALID');

  result := public.supplement_session_preparation_artifact(frozen_id, 'lesson_plan', jsonb_build_array(
    jsonb_build_object('path', frozen_id::text || '/lesson-plan/first.pdf', 'name', 'first.pdf', 'type', 'application/pdf', 'size', 64)));
  perform pg_temp.assert_true((result->>'changed')::boolean and (result->>'revision')::integer = 1, 'FIRST_FROZEN_INSERT_FAILED');
  perform pg_temp.assert_true(exists(select 1 from public.session_preparations p where p.session_id = frozen_id
    and reviewer_id = current_setting('test.supplement.substitute')::uuid
    and reviewer_assignment_source = 'supervisor_assigned'
    and reviewer_assigned_by = current_setting('test.supplement.manager')::uuid), 'REVIEWER_IGNORED_ACTUAL_TEACHER');
  result := public.supplement_session_preparation_artifact(current_setting('test.supplement.fallback')::uuid,
    'solution', '[]', 'Notes-only solution');
  perform pg_temp.assert_true((result->>'changed')::boolean and exists(select 1 from public.session_preparations p
    where p.session_id = current_setting('test.supplement.fallback')::uuid
    and reviewer_id = current_setting('test.supplement.teacher')::uuid), 'CLASS_TEACHER_REVIEWER_FALLBACK_FAILED');

  result := public.supplement_session_preparation_artifact(frozen_id, 'rehearsal_video', '[]', '', 'https://example.invalid/new-video');
  perform pg_temp.assert_true((result->>'changed')::boolean, 'VIDEO_SUPPLEMENT_FAILED');
  result := public.supplement_session_preparation_artifact(frozen_id, 'rehearsal_video', '[]', '', 'https://example.invalid/new-video');
  perform pg_temp.assert_true(not (result->>'changed')::boolean and (result->>'revision')::integer = 1, 'VIDEO_RETRY_NOT_IDEMPOTENT');
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L, %L)',
    frozen_id, 'rehearsal_video', '[]', '', 'https://example.invalid/replacement'), 'MATERIAL_CONFLICT');

  -- 所有失败请求保留完整当前行，且不会追加审核版本。
  before_payload := to_jsonb(artifact);
  existing_files := artifact.solution_files;
  candidate := jsonb_build_array(jsonb_build_object('path', session_id::text || '/solution/supplement.pdf', 'name', 'changed-name.pdf', 'type', 'application/pdf', 'size', 512));
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L)',
    session_id, 'solution', candidate), 'MATERIAL_CONFLICT');
  candidate := jsonb_build_array(jsonb_build_object('path', session_id::text || '/solution/missing-object.pdf',
    'name', 'missing-object.pdf', 'type', 'application/pdf', 'size', 512));
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L)',
    session_id, 'solution', candidate), 'VALIDATION');
  select jsonb_agg(jsonb_build_object('path', session_id::text || '/solution/extra-' || n || '.pdf',
    'name', 'extra-' || n || '.pdf', 'type', 'application/pdf', 'size', 1)) into too_many_files from generate_series(1, 9) n;
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L)',
    session_id, 'solution', too_many_files), 'FILES_LIMIT');
  perform pg_temp.expect_error(format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)',
    session_id, 'solution', '[]', repeat('x', 5000)), 'NOTES_LIMIT');
  foreach sql_text in array array[
    format('select public.supplement_session_preparation_artifact(%L, %L)', session_id, 'solution'),
    format('select public.supplement_session_preparation_artifact(%L, %L)', session_id, 'lesson_plan'),
    format('select public.supplement_session_preparation_artifact(%L, %L)', session_id, 'rehearsal_video'),
    format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)', session_id, 'unknown', '[]', 'note'),
    format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L, %L)', session_id, 'solution', existing_files, '', 'https://example.invalid/extraneous'),
    format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L)', session_id, 'lesson_plan', '[]', 'extraneous'),
    format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L, %L)', session_id, 'rehearsal_video', existing_files, '', 'https://example.invalid/extraneous'),
    format('select public.supplement_session_preparation_artifact(%L, %L, %L, %L, %L)', session_id, 'rehearsal_video', '[]', '', 'http://example.invalid/insecure'),
    format('select public.supplement_session_preparation_artifact(%L, %L, %L)', frozen_id, 'solution', existing_files)
  ] loop
    perform pg_temp.expect_error(sql_text, 'VALIDATION');
  end loop;
  perform pg_temp.assert_true((select to_jsonb(a) from public.session_preparation_artifacts a where a.session_id = session_id) = before_payload,
    'FAILED_SUPPLEMENT_CHANGED_EXISTING_ROW');
  perform pg_temp.assert_true((select revision from public.session_preparation_reviews r
    where r.session_id = session_id and artifact_kind = 'solution') = 2, 'FAILED_SUPPLEMENT_CHANGED_REVIEW');

  -- 精确授权消费后无残留。客户端 GUC 不能模拟私有授权记录。
  perform pg_temp.assert_true(not exists(select 1 from mathin_internal.session_material_supplement_writes
    where transaction_id = txid_current()), 'SUPPLEMENT_PERMIT_NOT_CONSUMED');
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'mathin_internal.session_material_supplement_writes', 'INSERT')
    and not has_table_privilege('anon', 'mathin_internal.session_material_supplement_writes', 'INSERT')
    and not has_table_privilege('service_role', 'mathin_internal.session_material_supplement_writes', 'INSERT'), 'PRIVATE_PERMIT_INSERT_GRANTED');
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.session_preparation_artifacts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.session_preparation_artifacts', 'DELETE'), 'DIRECT_MATERIAL_MUTATION_GRANTED');
  perform pg_temp.assert_true(not exists(select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and cmd in ('DELETE', 'UPDATE', 'ALL')
    and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%can_supplement_session_materials%'),
    'STORAGE_SUPPLEMENT_POLICY_EXPANDED_TO_MUTATION');
  perform set_config('app.session_material_supplement', 'true', true);
  perform set_config('app.session_material_supplement_session_id', session_id::text, true);
  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.teacher'), true);
  perform pg_temp.expect_error(format('select public.save_session_preparation_artifacts(%L, %L, %L, %L, %L)',
    session_id, 'forged replacement', existing_files, artifact.lesson_plan_files, artifact.rehearsal_video_url), 'PREPARATION_LOCKED');
  perform set_config('request.jwt.claim.sub', current_setting('test.supplement.manager'), true);
  perform pg_temp.expect_error(format('update public.session_preparation_artifacts set solution_notes = %L where session_id = %L',
    'forged direct update', session_id), 'PREPARATION_LOCKED');
  perform pg_temp.expect_error(format('delete from public.session_preparation_artifacts where session_id = %L', session_id), 'PREPARATION_LOCKED');
  perform pg_temp.expect_error(format('insert into public.session_preparation_artifacts(session_id, updated_by) values (%L, %L)',
    session_id, current_setting('test.supplement.manager')), 'PREPARATION_LOCKED');
  perform pg_temp.assert_true((select to_jsonb(a) from public.session_preparation_artifacts a where a.session_id = session_id) = before_payload,
    'FROZEN_LOCK_TEST_CHANGED_ROW');
end;
$$;

set local role anon;
do $$
begin
  perform pg_temp.assert_true(not has_function_privilege(current_user,
    'public.supplement_session_preparation_artifact(uuid,text,jsonb,text,text)', 'EXECUTE'), 'ANON_RPC_EXECUTE_GRANTED');
  begin
    perform public.supplement_session_preparation_artifact(current_setting('test.supplement.session')::uuid, 'solution', '[]', 'anonymous');
    raise exception 'ANON_RPC_EXECUTED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
