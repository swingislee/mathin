-- 在本机已核对数据库的事务内检验；草稿只用于回滚检查，不创建身份或课次。
begin;
do $test$
declare
  fixtures jsonb := $fixtures$[{"toolId":"plane-perimeter","contentVersion":"plane-perimeter-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"10-create","params":{"nextId":1,"active":0,"dx":180,"dy":0,"turn":90,"axisAngle":90,"kind.0":1,"count.0":4,"angle.0":0,"rx.0":0,"ry.0":0,"life.0":0,"detail.0":0,"flip.0":1,"walk.0":0,"straight.0":0},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360},"center.0":{"x":380,"y":270},"vertex.0.0":{"x":-90,"y":-60},"vertex.0.1":{"x":90,"y":-60},"vertex.0.2":{"x":90,"y":60},"vertex.0.3":{"x":-90,"y":60}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false},"marks":[],"phase":0}}},{"toolId":"plane-geoboard","contentVersion":"plane-geoboard-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"34-create","params":{"nextId":2,"active":1,"unit":0,"kind.1":0,"count.1":4,"base.1":0,"apex.1":2,"split.1":0},"points":{"v.1.0":{"x":3,"y":3},"v.1.1":{"x":9,"y":3},"v.1.2":{"x":9,"y":7},"v.1.3":{"x":3,"y":7}},"flags":{"grid":false,"lattice":true,"boundary":false,"points":false,"measures":false,"relation":false,"units":false,"height":false,"triangles":false,"snap":true,"coverage":false},"marks":[],"phase":0}}},{"toolId":"plane-measurement","contentVersion":"plane-measurement-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"11-create","params":{"nextId":2,"active":1,"unit":1,"kind.1":0,"count.1":4,"base.1":0,"apex.1":2,"split.1":0},"points":{"v.1.0":{"x":3,"y":3},"v.1.1":{"x":9,"y":3},"v.1.2":{"x":9,"y":7},"v.1.3":{"x":3,"y":7}},"flags":{"grid":false,"lattice":true,"boundary":false,"points":false,"measures":false,"relation":false,"units":false,"height":false,"triangles":false,"snap":true,"coverage":false},"marks":[],"phase":0}}},{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"18-create","params":{"nextId":2,"active":1,"dx":180,"dy":0,"turn":90,"axisAngle":90,"kind.1":0,"count.1":3,"angle.1":0,"rx.1":0,"ry.1":0,"life.1":0,"detail.1":0,"flip.1":1,"base.1":0,"fraction.1":0.5},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360},"center.1":{"x":420,"y":345},"vertex.1.0":{"x":-200,"y":125},"vertex.1.1":{"x":200,"y":125},"vertex.1.2":{"x":-70,"y":-125}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false,"height.1":false,"division.1":false,"parallel.1":false,"diagonals.1":false,"midpoints.1":false},"marks":[],"phase":0}}},{"toolId":"plane-overlap","contentVersion":"plane-overlap-lesson-v2","payload":{"title":"Editable teaching material","initial":{"sceneId":"33-create","params":{"nextId":2,"active":1,"dx":180,"dy":0,"turn":90,"axisAngle":90,"kind.0":1,"count.0":4,"angle.0":0,"rx.0":0,"ry.0":0,"life.0":0,"detail.0":0,"flip.0":1,"kind.1":0,"count.1":3,"angle.1":0,"rx.1":0,"ry.1":0,"life.1":0,"detail.1":0,"flip.1":1,"pairA":0,"pairB":1,"region":0},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360},"center.0":{"x":380,"y":340},"vertex.0.0":{"x":-130,"y":-84},"vertex.0.1":{"x":130,"y":-84},"vertex.0.2":{"x":130,"y":84},"vertex.0.3":{"x":-130,"y":84},"center.1":{"x":547.5,"y":340},"vertex.1.0":{"x":-117.5,"y":-135},"vertex.1.1":{"x":117.5,"y":20},"vertex.1.2":{"x":-72.5,"y":135}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false},"marks":[],"phase":0}}}]$fixtures$;
  scene jsonb; bad jsonb; proc regprocedure; owner_id uuid; draft_id uuid; saved public.tool_scene_drafts;
begin
  if jsonb_array_length(fixtures)<>5 then raise exception 'PLANE_DEEP_FIXTURES_REQUIRED'; end if;
  for scene in select value from jsonb_array_elements(fixtures) loop
    if public.tool_scene_is_valid(scene) is not true or public.tool_scene_catalog_id(scene) is distinct from scene->>'toolId' then
      raise exception 'PLANE_DEEP_DEFAULT_REJECTED_%',scene->>'toolId';
    end if;
    foreach bad in array array[
      scene||'{"extra":true}',jsonb_set(scene,'{payload,extra}','true'),jsonb_set(scene,'{payload,title}','""'),
      jsonb_set(scene,'{contentVersion}',to_jsonb((scene->>'toolId')||'-lesson-v1')),
      jsonb_set(scene,'{payload,initial,params,unexpected}','1'),jsonb_set(scene,'{payload,initial,points,unknown}','{"x":0,"y":0}'),
      jsonb_set(scene,'{payload,initial,flags,unexpected}','false'),jsonb_set(scene,'{payload,initial,phase}','1.1'),
      jsonb_set(scene,'{payload,initial,marks}','["unknown"]')
    ] loop
      if public.tool_scene_is_valid(bad) is not false then raise exception 'PLANE_DEEP_INVALID_ACCEPTED_%',scene->>'toolId'; end if;
    end loop;
  end loop;
  foreach proc in array array[
    'public.tool_plane_perimeter_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_perimeter_scene_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_grid_measure_polygon_is_valid(jsonb,boolean)'::regprocedure,
    'public.tool_plane_grid_measure_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_grid_measure_scene_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_relations_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_relations_scene_is_valid(jsonb)'::regprocedure,
    'public.tool_plane_overlap_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_overlap_scene_is_valid(jsonb)'::regprocedure
  ] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'PLANE_DEEP_HELPER_EXPOSED'; end if;
  end loop;
  if public.tool_scene_catalog_id('{"contentVersion":"place-value-lesson-v3"}') is distinct from 'place-value'
    or strpos(pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure),'public.tool_place_value_mapping_scene_is_valid')=0 then raise exception 'PLANE_DEEP_PREVIOUS_DISPATCH_LOST'; end if;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  if owner_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNT_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  for scene in select value from jsonb_array_elements(fixtures) loop
    draft_id:=gen_random_uuid();
    saved:=public.save_tool_scene_draft(draft_id,scene,0);
    if saved.scene is distinct from scene or saved.catalog_id is distinct from scene->>'toolId' or saved.revision<>1
      or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'PLANE_DEEP_SAVE_ROUNDTRIP'; end if;
    saved:=public.save_tool_scene_draft(draft_id,jsonb_set(scene,'{payload,title}','"Updated editable preparation"'),1);
    if saved.revision<>2 then raise exception 'PLANE_DEEP_SAVE_REVISION'; end if;
  end loop;
  execute 'reset role';
end;
$test$;
rollback;
