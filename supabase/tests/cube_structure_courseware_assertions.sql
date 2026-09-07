-- 本机定向合同：复用固定开发身份，全部新建业务对象与发布操作随事务回滚。
begin;
do $test$
declare
  teacher_id uuid;
  reviewer_id uuid;
  classroom_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  microcourse_id uuid;
  page_id uuid;
  revision_id uuid;
  next_revision_id uuid;
  revision_no integer;
  cycle_id uuid;
  release_id uuid;
  result jsonb;
  doc jsonb;
  legacy_tool jsonb;
  saved_tool jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-structures-lesson-v1","payload":{"title":"Cube fixture","history":{"version":"cube-structures-draft-v3","cursor":0,"initial":{"cubes":[{"id":"cube-1","position":{"x":0,"y":0,"z":0},"color":"#8fbf88","faces":{}}],"hiddenCubeIds":[],"groups":[],"origin":{"x":-0.5,"y":-0.5,"z":-0.5},"axesVisible":true,"view":"angle","frame":{"center":{"x":0,"y":0,"z":0},"radius":2},"nextCubeId":2,"nextNumber":1,"hiddenEdgesVisible":true},"operations":[{"kind":"axes","visible":false}]}}}'::jsonb;
begin
  legacy_tool := saved_tool;
  if current_setting('mathin.cube_toolbar_check', true) = 'on' then
    saved_tool := jsonb_set(jsonb_set(saved_tool, '{contentVersion}', '"cube-structures-lesson-v2"'), '{payload,toolbar}', '["orbit","cut","recording"]');
    if not public.cw_cube_structures_tool_is_valid(legacy_tool)
      or not public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,toolbar}', '[]'))
      or public.cw_cube_structures_tool_is_valid(jsonb_set(legacy_tool, '{payload,toolbar}', '[]'))
      or public.cw_cube_structures_tool_is_valid(saved_tool #- '{payload,toolbar}')
      or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,toolbar}', '["cut","cut"]'))
      or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,toolbar}', '["account-drafts"]'))
      or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,toolbar}', '[null]'))
      or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,toolbar}', '"orbit"'))
    then raise exception 'CUBE_TOOLBAR_CONTRACT_FAILED'; end if;
  end if;
  if not public.cw_cube_structures_tool_is_valid(saved_tool)
    or public.cw_cube_structures_tool_is_valid(null)
    or public.cw_cube_structures_tool_is_valid(saved_tool - 'payload')
    or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{contentVersion}', '"future"'))
    or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{toolId}', '"motion-lab"'))
    or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,history,cursor}', '1'))
    or public.cw_cube_structures_tool_is_valid(jsonb_set(saved_tool, '{payload,history,operations}', '[{"kind":"unknown"}]'))
    or public.cw_cube_structures_tool_is_valid(saved_tool || '{"ownerId":"private"}')
  then raise exception 'CUBE_TOOL_WHITELIST_FAILED'; end if;

  if has_function_privilege('authenticated', 'public.save_teacher_courseware_composition_page(uuid,uuid,jsonb,integer,text,text)', 'execute')
    or has_function_privilege('anon', 'public.save_teacher_courseware_composition_page(uuid,uuid,jsonb,integer,text,text)', 'execute')
  then raise exception 'CUBE_SAVE_BOUNDARY_FAILED'; end if;

  select id into teacher_id from public.profiles where display_name = '测试-教师' and is_active limit 1;
  select id into reviewer_id from public.profiles where display_name = '测试-教研' and is_active limit 1;
  if teacher_id is null or reviewer_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then raise exception 'EXISTING_MICROCOURSE_FEATURE_REQUIRED'; end if;
  insert into public.classrooms(id, owner_id, name, invite_code)
    values(classroom_id, teacher_id, '__CUBE_COURSEWARE_TRANSACTION__', upper(left(replace(classroom_id::text, '-', ''), 6)));
  insert into public.classroom_members(classroom_id, user_id, role) values(classroom_id, teacher_id, 'teacher');
  insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min)
    values(session_id, classroom_id, '__CUBE_COURSEWARE_TRANSACTION__', now() + interval '2 days', 60);

  perform set_config('request.jwt.claim.sub', teacher_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  microcourse_id := public.create_teacher_microcourse(session_id, '__CUBE_COURSEWARE_TRANSACTION__', '', 4::smallint, null::smallint, '', 'integrated-practice', '{}');
  page_id := public.create_teacher_microcourse_composition_page(microcourse_id, null, 'Cube fixed copy', null, null, null);
  select r.doc, r.revision_no into doc, revision_no
    from public.cw_page_docs p join public.cw_page_revisions r on r.id = p.draft_revision_id where p.id = page_id;
  doc := jsonb_set(doc, '{layout,blocks}', jsonb_build_array(jsonb_build_object(
    'id', 'tool-1', 'type', 'tool', 'tool', saved_tool,
    'placement', jsonb_build_object('column', 0, 'row', 0, 'columnSpan', 12, 'rowSpan', 9)
  )));
  if not public.cw_courseware_composition_doc_is_valid(doc)
    or public.cw_courseware_composition_doc_is_valid(jsonb_set(doc, '{layout,blocks,0,tool,contentVersion}', '"tool-embed-v1"'))
    or public.cw_courseware_composition_doc_is_valid(jsonb_set(doc, '{layout,blocks,0,placement,columnSpan}', '1'))
  then raise exception 'CUBE_COMPOSITION_WHITELIST_FAILED'; end if;
  if not public.cw_courseware_composition_doc_is_valid(jsonb_set(doc, '{layout,blocks,0,tool}', '{"toolId":"spatial-lab","contentVersion":"tool-embed-v1"}'))
  then raise exception 'LEGACY_TOOL_REGRESSION'; end if;
  begin
    perform public.save_teacher_courseware_composition_page(teacher_id, page_id, doc, revision_no, null, '');
    raise exception 'CUBE_SAVE_REQUIRED_SERVICE_ROLE';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select saved.revision_id, saved.revision_no into revision_id, revision_no
    from public.save_teacher_courseware_composition_page(teacher_id, page_id, doc, revision_no, null, '') saved;
  if (select r.doc #> '{layout,blocks,0,tool}' from public.cw_page_revisions r where r.id = revision_id) is distinct from saved_tool
  then raise exception 'CUBE_SAVE_ROUNDTRIP_FAILED'; end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  cycle_id := public.submit_teacher_microcourse_review(microcourse_id, 'Cube transactional verification');
  -- 提交后的草稿可以继续编辑；已提交及随后发布的 revision 必须保持固定。
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if current_setting('mathin.cube_toolbar_check', true) = 'on' then
    doc := jsonb_set(doc, '{layout,blocks,0,tool,payload,toolbar}', '["number"]');
  end if;
  select saved.revision_id into next_revision_id from public.save_teacher_courseware_composition_page(
    teacher_id, page_id, jsonb_set(doc, '{layout,blocks,0,tool,payload,title}', '"Later draft"'), revision_no, null, '') saved;
  if (select c.content_snapshot -> 0 ->> 'revisionId' from public.cw_review_cycles c where c.id = cycle_id) is distinct from revision_id::text
  then raise exception 'CUBE_REVIEW_NOT_PINNED'; end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', reviewer_id::text, true);
  for round in 1..5 loop
    result := public.approve_teacher_microcourse_review(cycle_id, 'Cube transactional verification', array[1]);
    if result ->> 'status' = 'published' then exit; end if;
    cycle_id := (result ->> 'reviewCycleId')::uuid;
  end loop;
  release_id := (result ->> 'releaseId')::uuid;
  if release_id is null or result ->> 'status' <> 'published'
    or (select r.snapshot -> 0 ->> 'revisionId' from public.cw_lecture_releases r where r.id = release_id) is distinct from revision_id::text
    or (select r.doc #> '{layout,blocks,0,tool}' from public.cw_page_revisions r where r.id = revision_id) is distinct from saved_tool
    or (select p.draft_revision_id from public.cw_page_docs p where p.id = page_id) is distinct from next_revision_id
  then raise exception 'CUBE_PUBLICATION_NOT_IMMUTABLE'; end if;
end;
$test$;
rollback;
