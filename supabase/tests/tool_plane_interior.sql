-- 本机回滚验证；固定开发身份由调用者从私有清单设置，不创建账号。
begin;
do $test$
declare
  scene jsonb := $fixture${"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v3","payload":{"title":"Interior exploration","initial":{"sceneId":"18-interior","params":{"nextId":2,"active":1,"dx":180,"dy":0,"turn":90,"axisAngle":90,"kind.1":0,"count.1":3,"angle.1":0,"rx.1":0,"ry.1":0,"life.1":0,"detail.1":0,"flip.1":1,"base.1":0,"fraction.1":0.5,"innerBase.1":0.5,"innerHeight.1":0.4},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360},"center.1":{"x":420,"y":345},"vertex.1.0":{"x":-200,"y":125},"vertex.1.1":{"x":200,"y":125},"vertex.1.2":{"x":-70,"y":-125}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false,"height.1":false,"division.1":false,"parallel.1":false,"diagonals.1":false,"midpoints.1":false,"interior.1":false,"collinear.1":false},"marks":[],"phase":0}}}$fixture$;
  bad jsonb; proc regprocedure; owner_id uuid; draft_id uuid; saved public.tool_scene_drafts;
begin
  if public.tool_scene_is_valid(scene) is not true or public.tool_scene_catalog_id(scene) is distinct from 'plane-area-relations' then raise exception 'INTERIOR_DEFAULT_REJECTED'; end if;
  foreach bad in array array[
    scene||'{"extra":true}',jsonb_set(scene,'{payload,extra}','true'),jsonb_set(scene,'{payload,title}','""'),
    jsonb_set(scene,'{payload,initial,params,extra}','1'),jsonb_set(scene,'{payload,initial,flags,extra}','true'),
    jsonb_set(scene,'{contentVersion}','"plane-area-relations-lesson-v2"')
  ] loop
    if public.tool_scene_is_valid(bad) is not false then raise exception 'INTERIOR_INVALID_ACCEPTED'; end if;
  end loop;
  foreach proc in array array['public.tool_plane_interior_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_interior_scene_is_valid(jsonb)'::regprocedure] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'INTERIOR_HELPER_EXPOSED'; end if;
  end loop;
  if public.tool_scene_catalog_id('{"contentVersion":"plane-area-relations-lesson-v2"}') is distinct from 'plane-area-relations'
    or public.tool_scene_catalog_id('{"contentVersion":"place-value-lesson-v3"}') is distinct from 'place-value'
    or strpos(pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure),'public.tool_plane_cover_match_scene_is_valid')=0 then raise exception 'INTERIOR_PREVIOUS_DISPATCH_LOST'; end if;
  owner_id:=nullif(current_setting('mathin.verify_owner',true),'')::uuid;
  if owner_id is null or not exists(select 1 from public.profiles where id=owner_id and is_active) then raise exception 'FIXED_DEVELOPMENT_ACCOUNT_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  scene:=jsonb_set(jsonb_set(scene,'{payload,initial,flags,interior.1}','true'),'{payload,initial,flags,collinear.1}','true');
  draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,scene,0);
  if saved.scene is distinct from scene or saved.revision<>1 or saved.catalog_id<>'plane-area-relations'
    or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'INTERIOR_SAVE_ROUNDTRIP'; end if;
  scene:=jsonb_set(scene,'{payload,initial,params,innerHeight.1}','0.7');
  saved:=public.save_tool_scene_draft(draft_id,scene,1);
  if saved.scene is distinct from scene or saved.revision<>2
    or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'INTERIOR_UPDATE_ROUNDTRIP'; end if;
  execute 'reset role';
end;
$test$;
rollback;
