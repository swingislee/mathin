-- 复用固定开发身份；任意姿态、旧版本和场景保存断言均在调用方事务中回滚。
begin;
do $free$
declare s jsonb; legacy jsonb; bad jsonb; initial jsonb; piece jsonb; q jsonb;
  owner_id uuid; draft_id uuid; saved public.tool_scene_drafts; frozen jsonb; a jsonb; b jsonb;
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
begin
  q := '[0,0.3826834323650898,0,0.9238795325112867]';
  piece := jsonb_build_object('id','bao-1','position','{"x":0,"y":3,"z":0}'::jsonb,'quaternion',q);
  initial := jsonb_build_object('pieces',jsonb_build_array(piece),'selectedId','bao-1','mode','assemble','view','angle','grid',true,'axes',false,'labels',true,
    'frame','{"center":{"x":0,"y":3.5,"z":0.5},"radius":4}'::jsonb,'cameraRevision',0);
  s := jsonb_build_object('toolId','soma-cube','contentVersion','soma-cube-lesson-v2','payload',jsonb_build_object('title','Free Soma','initial',initial));
  if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s)<>'soma-cube' then raise exception 'SOMA_FREE_REGISTRATION_FAILED'; end if;
  legacy := jsonb_set(jsonb_set(s,'{contentVersion}','"soma-cube-lesson-v1"'),'{payload,initial,pieces}',jsonb_build_array((piece-'quaternion')||'{"orientation":0}'));
  if public.tool_scene_is_valid(legacy) is not true or public.tool_scene_is_valid(jsonb_set(legacy,'{contentVersion}','"soma-cube-lesson-v2"')) is not true then raise exception 'SOMA_LEGACY_BOUNDARY_LOST'; end if;
  if public.tool_scene_is_valid(jsonb_set(s,'{contentVersion}','"soma-cube-lesson-v1"')) then raise exception 'SOMA_FREE_POSE_ACCEPTED_IN_V1'; end if;
  if public.tool_scene_is_valid(jsonb_set(jsonb_set(s,'{payload,initial,pieces,0,position,y}','-2'),'{payload,initial,frame,center,y}','-1.5')) is not true then raise exception 'SOMA_FREE_SPACE_CLIPPED_BY_GRID'; end if;
  foreach bad in array array[
    s||'{"extra":true}',s-'contentVersion',jsonb_set(s,'{toolId}','"spatial-lab"'),jsonb_set(s,'{contentVersion}','"soma-cube-lesson-v999"'),
    jsonb_set(s,'{payload,initial,pieces,0,orientation}','0'),jsonb_set(s,'{payload,initial,pieces,0,quaternion}','[0,0,0,0]'),
    jsonb_set(s,'{payload,initial,pieces,0,quaternion}','[0,0,0,2]'),jsonb_set(s,'{payload,initial,pieces,0,quaternion}','[0,0,0,1,0]'),
    jsonb_set(s,'{payload,initial,pieces,0,quaternion}','["NaN",0,0,1]'),jsonb_set(s,'{payload,initial,pieces,0,quaternion}','null'),
    jsonb_set(s,'{payload,initial,pieces,0,position,x}','12'),jsonb_set(s,'{payload,initial,pieces,0,position,z}','99'),
    jsonb_set(s,'{payload,initial,pieces}',jsonb_build_array(piece,piece||'{"id":"bao-2"}')),
    jsonb_set(s,'{payload,initial,pieces}',jsonb_build_array(piece,piece)),jsonb_set(s,'{payload,initial,selectedId}','"bao-7"')
  ] loop if public.tool_scene_is_valid(bad) then raise exception 'SOMA_FREE_INVALID_ACCEPTED: %',bad; end if; end loop;
  -- AABB 相交不等于实体相交；实际 OBB 检查与前端一致。
  a := jsonb_build_object('center',array[0,0,0],'axes',public.tool_soma_pose_axes('[0,0,0.3826834323650898,0.9238795325112867]'));
  b := '{"center":[1.1,1.1,0],"axes":[1,0,0,0,1,0,0,0,1]}';
  if public.tool_soma_boxes_overlap(a,b) then raise exception 'SOMA_AABB_FALSE_COLLISION'; end if;
  if public.tool_soma_boxes_overlap(a,jsonb_set(b,'{center}','[1,0,0]')) is not true then raise exception 'SOMA_OBB_OVERLAP_MISSED'; end if;
  a := '{"center":[0,0,0],"axes":[1,0,0,0,1,0,0,0,1]}';
  if public.tool_soma_boxes_overlap(a,jsonb_set(b,'{center}','[1,0,0]')) then raise exception 'SOMA_CONTACT_REJECTED'; end if;
  doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','soma-free','type','tool','tool',s,
    'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
  if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'SOMA_FREE_COURSEWARE_REJECTED'; end if;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  if owner_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  draft_id := gen_random_uuid(); frozen := s;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  saved := public.save_tool_scene_draft(draft_id,s,0);
  if saved.scene<>s or saved.revision<>1 or saved.catalog_id<>'soma-cube' then raise exception 'SOMA_FREE_SAVE_FAILED'; end if;
  if (select scene from public.tool_scene_drafts where id=draft_id)<>frozen then raise exception 'SOMA_FREE_REOPEN_LOST_POSE'; end if;
  saved := public.save_tool_scene_draft(draft_id,jsonb_set(s,'{payload,initial,pieces,0,quaternion}','[0,0,0,1]'),1);
  if saved.revision<>2 or saved.scene=frozen or doc#>'{layout,blocks,0,tool}'<>frozen then raise exception 'SOMA_FREE_FROZEN_COPY_CHANGED'; end if;
  execute 'reset role';
  if has_function_privilege('authenticated','public.tool_soma_free_scene_is_valid(jsonb)','execute')
    or has_function_privilege('anon','public.tool_soma_boxes_overlap(jsonb,jsonb)','execute') then raise exception 'SOMA_FREE_VALIDATOR_EXPOSED'; end if;
end;
$free$;
rollback;
