-- 固定开发账号与已核对的隔离数据库；所有测试草稿在本事务回滚。
begin;
do $test$
declare
  fixtures jsonb := $fixtures$[{"toolId":"plane-area","contentVersion":"plane-area-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"14-create","params":{"nextId":2,"active":1,"dx":180,"dy":0,"turn":90,"axisAngle":90,"kind.1":0,"count.1":4,"angle.1":0,"rx.1":0,"ry.1":0,"life.1":0,"detail.1":0,"flip.1":1},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360},"center.1":{"x":420,"y":290},"vertex.1.0":{"x":-155,"y":90},"vertex.1.1":{"x":85,"y":90},"vertex.1.2":{"x":155,"y":-90},"vertex.1.3":{"x":-85,"y":-90}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false},"marks":[],"phase":0}}},{"toolId":"plane-folding","contentVersion":"plane-folding-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"32-create","params":{"paperCount":4,"creaseSet":0,"side":1,"cutCount":0},"points":{"paper.0":{"x":260,"y":180},"paper.1":{"x":700,"y":180},"paper.2":{"x":700,"y":560},"paper.3":{"x":260,"y":560},"creaseA":{"x":300,"y":370},"creaseB":{"x":660,"y":370}},"flags":{"grid":false,"measures":false,"crease":true,"edit":false},"marks":[],"phase":0}}},{"toolId":"plane-tiling","contentVersion":"plane-tiling-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"36-create","params":{"nextId":2,"active":1,"dx":180,"dy":0,"turn":90,"axisAngle":90,"kind.1":0,"count.1":3,"angle.1":0,"rx.1":0,"ry.1":0,"life.1":0,"detail.1":0,"flip.1":1},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360},"center.1":{"x":390,"y":324.43375672974065},"vertex.1.0":{"x":50,"y":-43.30127018922195},"vertex.1.1":{"x":0,"y":43.30127018922195},"vertex.1.2":{"x":-50,"y":-43.301270189221896}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":true},"marks":[],"phase":0}}},{"toolId":"plane-patterns","contentVersion":"plane-patterns-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"47-create","params":{"nextNode":2,"nextEdge":1,"nextRecord":1,"nextStroke":1,"activeNode":-1,"activeEdge":-1,"currentStroke":-1,"figureMode":0,"rays":5,"columns":3,"rows":2,"levels":3,"a.0":0,"b.0":1},"points":{"node.0":{"x":280,"y":360},"node.1":{"x":600,"y":360}},"flags":{"grid":false,"measures":false,"names":false,"degrees":false,"intersections":true,"edit":false,"snap":false,"repeat":false,"highlights":true},"marks":[],"phase":1}}},{"toolId":"plane-graph-path","contentVersion":"plane-graph-path-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"52-create","params":{"nextNode":2,"nextEdge":1,"nextRecord":1,"nextStroke":1,"activeNode":-1,"activeEdge":-1,"currentStroke":-1,"figureMode":0,"rays":5,"columns":3,"rows":2,"levels":3,"a.0":0,"b.0":1},"points":{"node.0":{"x":280,"y":360},"node.1":{"x":600,"y":360}},"flags":{"grid":false,"measures":false,"names":false,"degrees":false,"intersections":true,"edit":false,"snap":false,"repeat":false,"highlights":true},"marks":[],"phase":1}}}]$fixtures$;
  scene jsonb; bad jsonb; copied jsonb; draft_id uuid; owner_id uuid; saved public.tool_scene_drafts;
  proc regprocedure;
begin
  for scene in select value from jsonb_array_elements(fixtures) loop
    if public.tool_scene_is_valid(scene) is not true or public.tool_scene_catalog_id(scene) is distinct from scene->>'toolId' then raise exception 'OPEN_MATERIAL_DEFAULT_REJECTED_%',scene->>'toolId'; end if;
    foreach bad in array array[
      scene||'{"extra":true}',jsonb_set(scene,'{payload,draftId}','"live-reference"'),
      jsonb_set(scene,'{payload,title}','""'),jsonb_set(scene,'{payload,initial,phase}','1.1'),
      jsonb_set(scene,'{contentVersion}',to_jsonb((scene->>'toolId')||'-lesson-v1')),
      jsonb_set(scene,'{payload,initial,params,unexpected}','1'),
      jsonb_set(scene,'{payload,initial,flags,unexpected}','false'),
      jsonb_set(scene,'{payload,initial,marks}','["unknown"]'),
      jsonb_set(scene,'{payload,initial,points,unknown}','{"x":0,"y":0}')
    ] loop
      if public.tool_scene_is_valid(bad) is not false then raise exception 'INVALID_OPEN_MATERIAL_ACCEPTED_%',scene->>'toolId'; end if;
    end loop;
  end loop;
  foreach proc in array array[
    'public.tool_plane_open_scene_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_tiling_state_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_paper_state_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_paper_folding_state_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_network_state_is_valid(jsonb)'::regprocedure
  ] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'OPEN_MATERIAL_HELPER_EXPOSED'; end if;
  end loop;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  if owner_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNT_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  for scene in select value from jsonb_array_elements(fixtures) loop
    draft_id:=gen_random_uuid(); copied:=scene;
    saved:=public.save_tool_scene_draft(draft_id,scene,0);
    if saved.scene is distinct from scene or saved.catalog_id is distinct from scene->>'toolId' or saved.revision<>1
      or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'OPEN_MATERIAL_SAVE_ROUNDTRIP'; end if;
    saved:=public.save_tool_scene_draft(draft_id,jsonb_set(scene,'{payload,title}','"Updated preparation"'),1);
    if saved.revision<>2 or copied is distinct from scene then raise exception 'OPEN_MATERIAL_FROZEN_COPY_CHANGED'; end if;
  end loop;
  execute 'reset role';
end;
$test$;
rollback;
