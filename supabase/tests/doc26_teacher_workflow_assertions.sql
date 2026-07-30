\set ON_ERROR_STOP on
-- doc 26 teacher preparation: vector annotation, unified solution records,
-- structured lesson plan, page notes, review reuse, and negative authorization.
begin;

do $$
declare
  failures text[] := '{}';
  save_annotation_definition text := pg_get_functiondef('public.save_courseware_annotation(uuid,uuid,jsonb,integer)'::regprocedure);
  generate_solution_definition text := pg_get_functiondef('public.generate_solution_record_from_board(uuid,uuid)'::regprocedure);
  save_plan_definition text := pg_get_functiondef('public.save_session_lesson_plan(uuid,text,jsonb,integer)'::regprocedure);
  completion_definition text := pg_get_functiondef('public.assert_session_preparation_complete(uuid)'::regprocedure);
begin
  if not exists(select 1 from pg_class where oid = 'public.lesson_plans'::regclass and relrowsecurity) then
    failures := array_append(failures, 'lesson_plans RLS disabled');
  end if;
  if not exists(select 1 from pg_class where oid = 'public.lesson_page_notes'::regclass and relrowsecurity) then
    failures := array_append(failures, 'lesson_page_notes RLS disabled');
  end if;
  if not exists(select 1 from pg_class where oid = 'public.courseware_annotations'::regclass and relrowsecurity) then
    failures := array_append(failures, 'courseware_annotations RLS disabled');
  end if;
  if not exists(select 1 from pg_class where oid = 'public.solution_records'::regclass and relrowsecurity) then
    failures := array_append(failures, 'solution_records RLS disabled');
  end if;
  if has_table_privilege('authenticated', 'public.lesson_plans', 'INSERT')
     or has_table_privilege('authenticated', 'public.courseware_annotations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.solution_records', 'DELETE') then
    failures := array_append(failures, 'direct preparation mutations granted');
  end if;
  if save_annotation_definition not ilike '%is_session_teacher%'
     or save_annotation_definition not ilike '%is_session_page_doc%'
     or save_annotation_definition not ilike '%VERSION_CONFLICT%'
     or save_annotation_definition not ilike '%PREPARATION_LOCKED%' then
    failures := array_append(failures, 'annotation RPC lacks scope/version/lock guards');
  end if;
  if generate_solution_definition not ilike '%solution_records%'
     or generate_solution_definition not ilike '%notify_session_preparation_reviewers%'
     or generate_solution_definition not ilike '%annotationVersion%' then
    failures := array_append(failures, 'board solution does not reuse review notifications or vector snapshot');
  end if;
  if save_plan_definition not ilike '%mathin-teaching-plan-v1%'
     or save_plan_definition not ilike '%VERSION_CONFLICT%'
     or save_plan_definition not ilike '%delete from public.session_preparation_reviews%' then
    failures := array_append(failures, 'lesson-plan save does not version/invalidate review');
  end if;
  if completion_definition not ilike '%solution_records%'
     or completion_definition not ilike '%lesson_plans%' then
    failures := array_append(failures, 'completion gate ignores doc 26 production paths');
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.session_preparation_reviews'::regclass
       and tgname = 'session_preparation_reviews_sync_lesson_plan'
       and not tgisinternal
  ) then failures := array_append(failures, 'lesson plan review status trigger missing'); end if;
  if cardinality(failures) > 0 then
    raise exception 'doc 26 structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

select profile.id as teacher_id from public.profiles profile
 where profile.display_name = '测试-教师' limit 1 \gset
select profile.id as student_id from public.profiles profile
 where profile.display_name = '测试-学生' limit 1 \gset
select profile.id as admin_id from public.profiles profile
 where profile.display_name = '测试-管理员' limit 1 \gset

\if :{?teacher_id}
\else
  \echo doc 26 fixtures missing: 测试-教师
  select 1 / 0;
\endif
\if :{?student_id}
\else
  \echo doc 26 fixtures missing: 测试-学生
  select 1 / 0;
\endif
\if :{?admin_id}
\else
  \echo doc 26 fixtures missing: 测试-管理员
  select 1 / 0;
\endif

select session_row.id as session_id,
       (entry.value ->> 'pageDocId')::uuid as page_doc_id
  from public.class_sessions session_row
  join public.course_lectures lecture on lecture.id = session_row.lecture_id
  join public.cw_lecture_releases release on release.id = lecture.current_release_id
  cross join lateral jsonb_array_elements(release.snapshot) entry
 where session_row.deleted_at is null
   and session_row.courseware_frozen_at is null
   and session_row.started_at is null
   and public.is_session_teacher(session_row.id, :'teacher_id'::uuid)
 order by session_row.scheduled_at desc
 limit 1 \gset

\if :{?session_id}
\else
  \echo doc 26 fixtures missing: scheduled teacher session with a release page
  select 1 / 0;
\endif

select set_config('test.doc26_session_id', :'session_id', true);
select set_config('test.doc26_page_doc_id', :'page_doc_id', true);

select set_config('request.jwt.claim.sub', :'teacher_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lesson_plan_id, revision as lesson_plan_revision
  from public.save_session_lesson_plan(
    current_setting('test.doc26_session_id')::uuid,
    'mathin-teaching-plan-v1',
    '[{"type":"heading","props":{"level":1},"content":"测试教案"}]'::jsonb,
    0
  ) \gset
select set_config('test.doc26_lesson_plan_id', :'lesson_plan_id', true);
select set_config('test.doc26_lesson_plan_revision', :'lesson_plan_revision', true);

select public.save_lesson_page_note(
  current_setting('test.doc26_session_id')::uuid,
  current_setting('test.doc26_page_doc_id')::uuid,
  '先观察规律，再给公式。'
);

select annotation_id, version as annotation_version
  from public.save_courseware_annotation(
    current_setting('test.doc26_session_id')::uuid,
    current_setting('test.doc26_page_doc_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'mode', 'ink',
      'color', 'ink',
      'wNorm', 0.006,
      'points', jsonb_build_array(jsonb_build_array(0.1, 0.2), jsonb_build_array(0.4, 0.5))
    )),
    0
  ) \gset
select set_config('test.doc26_annotation_version', :'annotation_version', true);

select solution_record_id, revision as solution_revision
  from public.generate_solution_record_from_board(current_setting('test.doc26_session_id')::uuid, current_setting('test.doc26_page_doc_id')::uuid) \gset
select set_config('test.doc26_solution_record_id', :'solution_record_id', true);
select public.submit_session_lesson_plan(current_setting('test.doc26_session_id')::uuid, current_setting('test.doc26_lesson_plan_revision')::integer);

select public.save_session_preparation_artifacts(
  current_setting('test.doc26_session_id')::uuid,
  '上传解析投影',
  jsonb_build_array(jsonb_build_object(
    'path', current_setting('test.doc26_session_id') || '/solution/doc26-test.pdf',
    'name', 'doc26-test.pdf',
    'size', 128
  )),
  '[]'::jsonb,
  'https://example.com/rehearsal-a'
);
select revision as upload_solution_revision
  from public.solution_records
 where session_id = current_setting('test.doc26_session_id')::uuid
   and solution_source = 'upload' \gset
select set_config('test.doc26_upload_solution_revision', :'upload_solution_revision', true);

-- Only the rehearsal payload changes. The upload projection must retain its
-- revision while the rehearsal review follows its own revision lifecycle.
select public.save_session_preparation_artifacts(
  current_setting('test.doc26_session_id')::uuid,
  '上传解析投影',
  jsonb_build_array(jsonb_build_object(
    'path', current_setting('test.doc26_session_id') || '/solution/doc26-test.pdf',
    'name', 'doc26-test.pdf',
    'size', 128
  )),
  '[]'::jsonb,
  'https://example.com/rehearsal-b'
);

do $$
begin
  if not exists (
    select 1 from public.solution_records record
     where record.id = current_setting('test.doc26_solution_record_id')::uuid
       and record.solution_source = 'board'
       and record.content ->> 'annotationVersion' = current_setting('test.doc26_annotation_version')
  ) then raise exception 'board solution snapshot missing'; end if;
  if not exists (
    select 1 from public.lesson_page_notes note
     where note.lesson_plan_id = current_setting('test.doc26_lesson_plan_id')::uuid
       and note.page_doc_id = current_setting('test.doc26_page_doc_id')::uuid
       and note.content = '先观察规律，再给公式。'
  ) then raise exception 'page note missing'; end if;
  if (select status from public.session_preparation_reviews
       where session_id = current_setting('test.doc26_session_id')::uuid and artifact_kind = 'lesson_plan') <> 'pending' then
    raise exception 'lesson plan did not enter existing review queue';
  end if;
  if (select revision from public.solution_records
       where session_id = current_setting('test.doc26_session_id')::uuid and solution_source = 'upload')
       <> current_setting('test.doc26_upload_solution_revision')::integer then
    raise exception 'unrelated artifact save incremented upload solution revision';
  end if;
end
$$;

do $$
begin
  perform public.save_courseware_annotation(
    current_setting('test.doc26_session_id')::uuid, current_setting('test.doc26_page_doc_id')::uuid, '[]'::jsonb, 0
  );
  raise exception 'stale annotation version was accepted';
exception when others then
  if sqlerrm not ilike '%VERSION_CONFLICT%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', :'student_id', true);
do $$
begin
  perform public.save_session_lesson_plan(
    current_setting('test.doc26_session_id')::uuid, 'mathin-teaching-plan-v1', '[]'::jsonb, current_setting('test.doc26_lesson_plan_revision')::integer
  );
  raise exception 'student edited a teacher lesson plan';
exception when others then
  if sqlerrm not ilike '%FORBIDDEN%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.review_session_preparation_artifact(
  current_setting('test.doc26_session_id')::uuid, 'lesson_plan', 'approved', 'doc 26 assertion'
);

do $$
begin
  if (select status from public.lesson_plans where id = current_setting('test.doc26_lesson_plan_id')::uuid) <> 'approved' then
    raise exception 'review decision did not synchronize structured plan status';
  end if;
end
$$;

rollback;
