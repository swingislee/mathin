-- 使用既有固定开发身份；本文件只在本机隔离目标的回滚事务执行。
begin;
do $test$
declare
  teacher_id uuid; reviewer_id uuid; classroom_id uuid := gen_random_uuid(); session_id uuid := gen_random_uuid();
  microcourse_id uuid; page_id uuid; revision_id uuid; next_revision_id uuid; revision_no integer; cycle_id uuid;
  doc jsonb; result jsonb; item jsonb; fixed_blocks jsonb;
  dice jsonb := '{"toolId":"spatial-lab","contentVersion":"dice-lesson-v1","payload":{"title":"Dice fixture","initial":{"scene":{"version":"dice-teaching-v1","dice":[{"id":"dice-1","hand":"left","position":{"x":0,"y":0.5,"z":0},"rotation":{"x":0,"y":0,"z":0,"w":1},"hidden":["y-"],"offsets":{"y-":0.9}}],"trail":[],"nextId":2,"puzzle":null},"view":"bottom","frame":{"center":{"x":0,"y":0,"z":0},"radius":3},"axes":false,"grid":true,"floor":true,"arrows":true,"selectedId":"dice-1"}}}';
  net jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-net-lesson-v1","payload":{"title":"Net fixture","initial":{"source":{"entryId":"cube-net-gallery.19","cuts":null},"angles":{"edge.v000-v001":0,"edge.v010-v110":0,"edge.v011-v111":0,"edge.v100-v101":0,"edge.v110-v111":0},"anchor":null,"surfaces":{"faces":{},"nextNumber":1},"labels":{},"cutting":null,"faceOffsets":{},"revealEnabled":false,"view":"angle","axesVisible":true,"frame":{"min":{"x":-3,"y":0,"z":-3},"max":{"x":3,"y":1,"z":3},"center":{"x":0,"y":0,"z":0},"radius":4}}}}';
begin
  foreach item in array array[dice,net] loop
    if public.cw_spatial_teaching_tool_is_valid(item) is not true
      or public.cw_spatial_teaching_tool_is_valid(null)
      or public.cw_spatial_teaching_tool_is_valid(item - 'payload')
      or public.cw_spatial_teaching_tool_is_valid(item || '{"draftId":"private"}')
      or public.cw_spatial_teaching_tool_is_valid(jsonb_set(item,'{contentVersion}','"unknown-v9"'))
      or public.cw_spatial_teaching_tool_is_valid(jsonb_set(item,'{payload,initial}','{}'))
    then raise exception 'SPATIAL_CONTENT_WHITELIST_FAILED'; end if;
  end loop;
  if has_function_privilege('anon','public.cw_spatial_teaching_tool_is_valid(jsonb)','execute')
    or has_function_privilege('authenticated','public.cw_spatial_teaching_tool_is_valid(jsonb)','execute')
    or has_function_privilege('authenticated','public.save_teacher_courseware_composition_page(uuid,uuid,jsonb,integer,text,text)','execute')
  then raise exception 'SPATIAL_PRIVILEGE_REGRESSION'; end if;
  select id into teacher_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into reviewer_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if teacher_id is null or reviewer_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  insert into public.classrooms(id,owner_id,name,invite_code) values(classroom_id,teacher_id,'__SPATIAL_CONTENT_TRANSACTION__',upper(left(replace(classroom_id::text,'-',''),6)));
  insert into public.classroom_members(classroom_id,user_id,role) values(classroom_id,teacher_id,'teacher');
  insert into public.class_sessions(id,classroom_id,title,scheduled_at,duration_min) values(session_id,classroom_id,'__SPATIAL_CONTENT_TRANSACTION__',now()+interval '2 days',60);
  perform set_config('request.jwt.claim.sub',teacher_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  microcourse_id := public.create_teacher_microcourse(session_id,'__SPATIAL_CONTENT_TRANSACTION__','',4::smallint,null::smallint,'','integrated-practice','{}');
  page_id := public.create_teacher_microcourse_composition_page(microcourse_id,null,'Spatial fixed copy',null,null,null);
  select r.doc,r.revision_no into doc,revision_no from public.cw_page_docs p join public.cw_page_revisions r on r.id=p.draft_revision_id where p.id=page_id;
  fixed_blocks := jsonb_build_array(
    jsonb_build_object('id','dice-1','type','tool','tool',dice,'placement',jsonb_build_object('column',0,'row',0,'columnSpan',6,'rowSpan',9)),
    jsonb_build_object('id','net-1','type','tool','tool',net,'placement',jsonb_build_object('column',6,'row',0,'columnSpan',6,'rowSpan',9)));
  doc := jsonb_set(doc,'{layout,blocks}',fixed_blocks);
  if public.cw_courseware_composition_doc_is_valid(doc) is not true
    or public.cw_manual_composition_doc_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(doc) is not true
    or public.cw_courseware_composition_doc_is_valid(jsonb_set(doc,'{layout,blocks,0,placement,columnSpan}','1'))
    or public.cw_courseware_composition_doc_is_valid(jsonb_set(doc,'{layout,blocks,0,tool,contentVersion}','"future"'))
  then raise exception 'SPATIAL_PAGE_VALIDATION_FAILED'; end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  select saved.revision_id,saved.revision_no into revision_id,revision_no from public.save_teacher_courseware_composition_page(teacher_id,page_id,doc,revision_no,null,'') saved;
  if (select r.doc #> '{layout,blocks}' from public.cw_page_revisions r where r.id=revision_id) is distinct from fixed_blocks then raise exception 'SPATIAL_SAVE_ROUNDTRIP_FAILED'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  cycle_id := public.submit_teacher_microcourse_review(microcourse_id,'Spatial transactional verification');
  perform set_config('request.jwt.claim.role','service_role',true);
  select saved.revision_id into next_revision_id from public.save_teacher_courseware_composition_page(teacher_id,page_id,jsonb_set(doc,'{layout,blocks,0,tool,payload,title}','"Later draft"'),revision_no,null,'') saved;
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',reviewer_id::text,true);
  for round in 1..5 loop
    result := public.approve_teacher_microcourse_review(cycle_id,'Spatial transactional verification',array[1]);
    exit when result ->> 'status' = 'published';
    cycle_id := (result ->> 'reviewCycleId')::uuid;
  end loop;
  if result ->> 'status' is distinct from 'published'
    or (select r.snapshot -> 0 ->> 'revisionId' from public.cw_lecture_releases r where r.id=(result ->> 'releaseId')::uuid) is distinct from revision_id::text
    or (select r.doc #> '{layout,blocks}' from public.cw_page_revisions r where r.id=revision_id) is distinct from fixed_blocks
    or (select p.draft_revision_id from public.cw_page_docs p where p.id=page_id) is distinct from next_revision_id
  then raise exception 'SPATIAL_RELEASE_NOT_FROZEN'; end if;
end;
$test$;
rollback;
