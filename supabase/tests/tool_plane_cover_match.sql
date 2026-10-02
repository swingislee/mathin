-- 本机回滚检查；调用者从固定开发账号清单设置 mathin.verify_owner，不创建身份。
begin;
do $test$
declare
  fixtures jsonb := $fixtures$[{"toolId":"plane-matchsticks","contentVersion":"plane-matchsticks-lesson-v2","payload":{"title":"Open classroom materials","initial":{"sceneId":"51-create","params":{"nextId":1,"active":0,"turn":45,"angle.0":0},"points":{"stick.0":{"x":400,"y":330}},"flags":{"grid":false,"measures":false,"snap":true,"reference":false,"labels":false},"marks":[],"phase":0}}},{"toolId":"plane-covering","contentVersion":"plane-covering-lesson-v2","payload":{"title":"Open classroom materials","initial":{"sceneId":"57-create","params":{"columns":8,"rows":8,"nextId":0,"active":-1},"points":{},"flags":{"grid":false,"measures":false,"coloring":true,"editCells":false,"labels":false},"marks":[],"phase":0}}}]$fixtures$;
  scene jsonb; bad jsonb; proc regprocedure; owner_id uuid; draft_id uuid; saved public.tool_scene_drafts;
begin
  if jsonb_array_length(fixtures)<>2 then raise exception 'COVER_MATCH_DEFAULT_FIXTURES_REQUIRED'; end if;
  for scene in select value from jsonb_array_elements(fixtures) loop
    if public.tool_scene_is_valid(scene) is not true or public.tool_scene_catalog_id(scene) is distinct from scene->>'toolId' then raise exception 'COVER_MATCH_DEFAULT_REJECTED'; end if;
    foreach bad in array array[
      scene||'{"extra":true}',jsonb_set(scene,'{payload,extra}','true'),jsonb_set(scene,'{payload,title}','""'),
      jsonb_set(scene,'{payload,initial,params,extra}','1'),jsonb_set(scene,'{payload,initial,flags,extra}','true'),
      jsonb_set(scene,'{contentVersion}',to_jsonb((scene->>'toolId')||'-lesson-v1'))
    ] loop
      if public.tool_scene_is_valid(bad) is not false then raise exception 'COVER_MATCH_INVALID_ACCEPTED'; end if;
    end loop;
  end loop;
  foreach proc in array array['public.tool_plane_match_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_cover_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_cover_match_scene_is_valid(jsonb)'::regprocedure] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'COVER_MATCH_HELPER_EXPOSED'; end if;
  end loop;
  if public.tool_scene_catalog_id('{"contentVersion":"place-value-lesson-v3"}') is distinct from 'place-value'
    or strpos(pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure),'public.tool_plane_overlap_scene_is_valid')=0 then raise exception 'COVER_MATCH_PREVIOUS_DISPATCH_LOST'; end if;
  owner_id:=nullif(current_setting('mathin.verify_owner',true),'')::uuid;
  if owner_id is null or not exists(select 1 from public.profiles where id=owner_id and is_active) then raise exception 'FIXED_DEVELOPMENT_ACCOUNT_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  for scene in select value from jsonb_array_elements(fixtures) loop
    draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,scene,0);
    if saved.scene is distinct from scene or saved.catalog_id is distinct from scene->>'toolId' or saved.revision<>1
      or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'COVER_MATCH_SAVE_ROUNDTRIP'; end if;
    saved:=public.save_tool_scene_draft(draft_id,jsonb_set(scene,'{payload,title}','"Updated open materials"'),1);
    if saved.revision<>2 then raise exception 'COVER_MATCH_SAVE_REVISION'; end if;
  end loop;
  execute 'reset role';
end;
$test$;
rollback;
