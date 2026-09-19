-- 本机隔离库、既有开发身份、回滚事务；不改正式业务或发布内容。
begin;
do $projection$
declare owner_id uuid; other_id uuid; draft_id uuid := gen_random_uuid(); saved public.tool_scene_drafts; bad jsonb;
  scene jsonb := '{"toolId":"projection","contentVersion":"projection-lesson-v1","payload":{"title":"Projection","initial":{"structure":{"cubes":[{"id":"cube-1","position":{"x":0,"y":0,"z":0},"color":"#8fbf88","faces":{}}],"hiddenCubeIds":[],"groups":[],"origin":{"x":-0.5,"y":-0.5,"z":-0.5},"axesVisible":true,"view":"angle","frame":{"center":{"x":0,"y":0,"z":0},"radius":2.5},"nextCubeId":2,"nextNumber":1,"hiddenEdgesVisible":true},"views":["front","right","top"],"guides":false}}}';
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"nodes":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
begin
  doc := jsonb_set(jsonb_set(doc,'{overlay,canvas,backgroundBindingKey}','null'),'{overlay,interactions}','[]');
  if public.tool_scene_is_valid(scene) is not true or public.tool_scene_catalog_id(scene) <> 'projection'
    or public.tool_scene_is_valid(jsonb_set(scene,'{payload,initial,views}','[]')) is not true then raise exception 'PROJECTION_SCENE_REJECTED'; end if;
  foreach bad in array array[
    scene - 'payload', scene || '{"draftId":"private"}', jsonb_set(scene,'{toolId}','"spatial-lab"'),
    jsonb_set(scene,'{payload,initial,views}','["front","front"]'), jsonb_set(scene,'{payload,initial,views}','["left"]'),
    jsonb_set(scene,'{payload,initial,guides}','1'), scene #- '{payload,initial,guides}',
    jsonb_set(scene,'{payload,initial,structure}','{}'), jsonb_set(scene,'{payload,initial,private}','true')
  ] loop
    if public.tool_scene_is_valid(bad) then raise exception 'PROJECTION_INVALID_SCENE_ACCEPTED'; end if;
  end loop;
  doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','projection-1','type','tool','tool',scene,
    'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
  if public.cw_courseware_composition_doc_is_valid(doc) is not true
    or public.cw_manual_composition_doc_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'PROJECTION_COURSEWARE_REJECTED'; end if;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  saved := public.save_tool_scene_draft(draft_id,scene,0);
  if saved.catalog_id <> 'projection' or saved.scene <> scene or saved.revision <> 1 then raise exception 'PROJECTION_DRAFT_ROUNDTRIP_FAILED'; end if;
  saved := public.save_tool_scene_draft(draft_id,jsonb_set(scene,'{payload,initial,guides}','true'),1);
  if saved.revision <> 2 or doc #> '{layout,blocks,0,tool,payload,initial,guides}' <> 'false'::jsonb then raise exception 'PROJECTION_FIXED_COPY_CHANGED'; end if;
  begin
    perform public.save_tool_scene_draft(draft_id,scene,1);
    raise exception 'PROJECTION_STALE_WRITE_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm <> 'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if (select count(*) from public.tool_scene_drafts where id=draft_id) <> 0 then raise exception 'PROJECTION_OTHER_OWNER_READ'; end if;
  begin
    perform public.save_tool_scene_draft(draft_id,scene,2);
    raise exception 'PROJECTION_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  execute 'reset role';
  if has_function_privilege('anon','public.tool_projection_scene_is_valid(jsonb)','execute')
    or has_function_privilege('authenticated','public.tool_projection_scene_is_valid(jsonb)','execute') then raise exception 'PROJECTION_VALIDATOR_PRIVILEGE'; end if;
end;
$projection$;
rollback;
