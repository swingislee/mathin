-- 使用既有固定开发身份；本文件只在本机隔离目标的回滚事务执行。
begin;
do $test$
declare
  teacher_id uuid; reviewer_id uuid; classroom_id uuid := gen_random_uuid(); session_id uuid := gen_random_uuid();
  microcourse_id uuid; page_id uuid; revision_id uuid; next_revision_id uuid; revision_no integer; cycle_id uuid;
  doc jsonb; result jsonb; item jsonb; fixed_blocks jsonb;
  dice jsonb := '{"toolId":"fraction-line","contentVersion":"fraction-line-lesson-v1","payload":{"title":"Fractions","initial":{"rows":[{"denominator":3,"count":5,"color":"var(--rose)"}],"denomText":"3","zoomPow":2,"showTicks":true,"showGuides":true,"zeroX":56}}}';
  net jsonb := '{"toolId":"motion-lab","contentVersion":"motion-lab-lesson-v1","payload":{"title":"Three tracks","initial":{"length":100,"runways":[{"id":1,"head":"/assets/tools/motion/head.png","vehicle":"/assets/tools/motion/01-walk.png","facingRight":true,"x":0,"solve":"speed","distance":100,"time":10,"speed":10},{"id":2,"head":"/assets/tools/motion/head.png","vehicle":"/assets/tools/motion/01-walk.png","facingRight":true,"x":0,"solve":"speed","distance":100,"time":20,"speed":5},{"id":3,"head":"/assets/tools/motion/head.png","vehicle":"/assets/tools/motion/01-walk.png","facingRight":false,"x":100,"solve":"speed","distance":100,"time":30,"speed":3.3333333333333335}],"showRuler":true,"allTime":10,"allSpeed":10,"playback":{"phase":"idle","elapsedMs":0,"startedAt":0}}}}';
begin
  foreach item in array array[dice,net] loop
    if public.tool_scene_is_valid(item) is not true
      or public.tool_scene_is_valid(null)
      or public.tool_scene_is_valid(item - 'payload')
      or public.tool_scene_is_valid(item || '{"draftId":"private"}')
      or public.tool_scene_is_valid(jsonb_set(item,'{contentVersion}','"unknown-v9"'))
      or public.tool_scene_is_valid(jsonb_set(item,'{payload,initial}','{}'))
    then raise exception 'TOOLS_CONTENT_WHITELIST_FAILED'; end if;
  end loop;
  if has_function_privilege('anon','public.tool_scene_is_valid(jsonb)','execute')
    or has_function_privilege('authenticated','public.tool_scene_is_valid(jsonb)','execute')
    or has_function_privilege('authenticated','public.save_teacher_courseware_composition_page(uuid,uuid,jsonb,integer,text,text)','execute')
  then raise exception 'TOOLS_PRIVILEGE_REGRESSION'; end if;
  select id into teacher_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into reviewer_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if teacher_id is null or reviewer_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  insert into public.classrooms(id,owner_id,name,invite_code) values(classroom_id,teacher_id,'__TOOLS_CONTENT_TRANSACTION__',upper(left(replace(classroom_id::text,'-',''),6)));
  insert into public.classroom_members(classroom_id,user_id,role) values(classroom_id,teacher_id,'teacher');
  insert into public.class_sessions(id,classroom_id,title,scheduled_at,duration_min) values(session_id,classroom_id,'__TOOLS_CONTENT_TRANSACTION__',now()+interval '2 days',60);
  perform set_config('request.jwt.claim.sub',teacher_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  microcourse_id := public.create_teacher_microcourse(session_id,'__TOOLS_CONTENT_TRANSACTION__','',4::smallint,null::smallint,'','integrated-practice','{}');
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
  then raise exception 'TOOLS_PAGE_VALIDATION_FAILED'; end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  select saved.revision_id,saved.revision_no into revision_id,revision_no from public.save_teacher_courseware_composition_page(teacher_id,page_id,doc,revision_no,null,'') saved;
  if (select r.doc #> '{layout,blocks}' from public.cw_page_revisions r where r.id=revision_id) is distinct from fixed_blocks then raise exception 'TOOLS_SAVE_ROUNDTRIP_FAILED'; end if;
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
  then raise exception 'TOOLS_RELEASE_NOT_FROZEN'; end if;
end;
$test$;

do $drafts$
declare owner_id uuid; other_id uuid; draft_id uuid := gen_random_uuid(); saved public.tool_scene_drafts; before_scene jsonb;
  scene jsonb := '{"toolId":"motion-lab","contentVersion":"motion-lab-lesson-v1","payload":{"title":"Three tracks","initial":{"length":100,"runways":[{"id":1,"head":"/assets/tools/motion/head.png","vehicle":"/assets/tools/motion/01-walk.png","facingRight":true,"x":0,"solve":"speed","distance":100,"time":10,"speed":10},{"id":2,"head":"/assets/tools/motion/head.png","vehicle":"/assets/tools/motion/01-walk.png","facingRight":true,"x":0,"solve":"speed","distance":100,"time":20,"speed":5},{"id":3,"head":"/assets/tools/motion/head.png","vehicle":"/assets/tools/motion/01-walk.png","facingRight":false,"x":100,"solve":"speed","distance":100,"time":30,"speed":3.3333333333333335}],"showRuler":true,"allTime":10,"allSpeed":10,"playback":{"phase":"idle","elapsedMs":0,"startedAt":0}}}}';
begin
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if public.tool_scene_is_valid(jsonb_set(scene,'{payload,initial,playback,phase}','"running"'))
    or public.tool_scene_is_valid(jsonb_set(scene,'{payload,initial,runways,0,head}','"https://example.org/private.png"'))
    or public.tool_scene_is_valid(jsonb_set(scene,'{payload,initial,runways,1,id}','1'))
    or public.tool_scene_is_valid(jsonb_set(scene,'{payload,initial,length}','-1'))
    or public.tool_scene_is_valid(jsonb_set(scene,'{toolId}','"fraction-line"'))
  then raise exception 'TOOLS_INVALID_PARAMETERS_ACCEPTED'; end if;
  execute 'set local role authenticated';
  saved := public.save_tool_scene_draft(draft_id,scene,0);
  if saved.revision <> 1 or saved.catalog_id <> 'motion-lab' or saved.scene <> scene then raise exception 'TOOLS_DRAFT_ROUNDTRIP_FAILED'; end if;
  saved := public.save_tool_scene_draft(draft_id,jsonb_set(scene,'{payload,title}','"Updated"'),1);
  begin
    perform public.save_tool_scene_draft(draft_id,scene,1);
    raise exception 'TOOLS_STALE_WRITE_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm <> 'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  if (select count(*) from public.tool_scene_drafts where id=draft_id) <> 1 then raise exception 'TOOLS_OWNER_READ_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if (select count(*) from public.tool_scene_drafts where id=draft_id) <> 0 then raise exception 'TOOLS_OTHER_OWNER_READ'; end if;
  begin
    perform public.save_tool_scene_draft(draft_id,scene,2);
    raise exception 'TOOLS_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  begin
    update public.tool_scene_drafts set name='Direct' where id=draft_id;
    raise exception 'TOOLS_DIRECT_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select d.scene #>> '{payload,title}' from public.tool_scene_drafts d where d.id=draft_id) <> 'Updated' then raise exception 'TOOLS_DRAFT_CHANGED_AFTER_FAILURE'; end if;
  if has_table_privilege('anon','public.tool_scene_drafts','select')
    or has_function_privilege('anon','public.save_tool_scene_draft(uuid,jsonb,integer)','execute')
  then raise exception 'TOOLS_ANON_PRIVILEGE_REGRESSION'; end if;
end;
$drafts$;
rollback;
