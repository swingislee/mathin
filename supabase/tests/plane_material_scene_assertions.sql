-- 本机已核实的隔离目标；使用固定开发身份，全部新增测试草稿在事务结束时回滚。
begin;
do $test$
declare
  s jsonb := $shape${"toolId":"plane-shapes","contentVersion":"plane-shapes-lesson-v1","payload":{"title":"Basic shapes","initial":{"sceneId":"01-basic","params":{"count":1,"active":0,"kind0":2,"scale0":1,"angle0":0,"detail0":0},"points":{"object0":{"x":480,"y":360}},"flags":{"grid":false,"measures":true,"edges":false,"vertices":false,"names":false},"marks":[],"phase":0}}}$shape$;
  tangram jsonb := $tangram${"toolId":"plane-tangram","contentVersion":"plane-tangram-lesson-v1","payload":{"title":"Tangram","initial":{"sceneId":"02","params":{"active":0,"rotation":0,"count":7,"reflection0":1,"angle0":0,"reflection1":1,"angle1":0,"reflection2":1,"angle2":0,"reflection3":1,"angle3":0,"reflection4":1,"angle4":0,"reflection5":1,"angle5":0,"reflection6":1,"angle6":0},"points":{"piece0":{"x":290,"y":180},"piece1":{"x":290,"y":180},"piece2":{"x":290,"y":180},"piece3":{"x":290,"y":180},"piece4":{"x":290,"y":180},"piece5":{"x":290,"y":180},"piece6":{"x":290,"y":180}},"flags":{"measures":true,"grid":false,"outline":true},"marks":[],"phase":0}}}$tangram$;
  bad jsonb; sample jsonb; mark jsonb; kind integer; proc regprocedure; frozen jsonb;
  owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts;
begin
  if public.tool_scene_is_valid(s) is not true or public.tool_scene_catalog_id(s)<>'plane-shapes'
    or public.tool_scene_is_valid(tangram) is not true or public.tool_scene_catalog_id(tangram)<>'plane-tangram'
    then raise exception 'PLANE_MATERIAL_DEFAULT_REJECTED'; end if;
  for kind in 0..11 loop
    sample:=jsonb_set(s,'{payload,initial,params,kind0}',to_jsonb(kind));
    if kind>=7 then sample:=jsonb_set(sample,'{payload,initial,params,detail0}','0.45'); end if;
    mark:=case when kind in (5,6,10,11) then '["boundary.0"]'::jsonb else '["edge.0.0","vertex.0.0"]'::jsonb end;
    sample:=jsonb_set(sample,'{payload,initial,marks}',mark);
    if public.tool_scene_is_valid(sample) is not true then raise exception 'PLANE_MATERIAL_KIND_REJECTED: %',kind; end if;
    if kind in (5,6,10,11) and (public.tool_scene_is_valid(jsonb_set(sample,'{payload,initial,marks}','["edge.0.0"]')) is not false
      or public.tool_scene_is_valid(jsonb_set(sample,'{payload,initial,marks}','["vertex.0.0"]')) is not false)
      then raise exception 'CURVED_BOUNDARY_HAS_FALSE_SIDES_OR_VERTICES'; end if;
  end loop;
  sample:=jsonb_set(jsonb_set(s,'{payload,initial,params}','{"count":0,"active":-1}'),'{payload,initial,points}','{}');
  if public.tool_scene_is_valid(sample) is not true then raise exception 'EMPTY_SHAPE_STAGE_REJECTED'; end if;
  foreach bad in array array[
    s||'{"extra":true}', jsonb_set(s,'{payload,draftId}','"live-reference"'),
    jsonb_set(s,'{payload,initial,extra}','0'), jsonb_set(s,'{payload,title}','""'),
    jsonb_set(s,'{toolId}','"plane-tangram"'), jsonb_set(s,'{contentVersion}','"plane-tangram-lesson-v1"'),
    jsonb_set(s,'{payload,initial,sceneId}','"01"'), jsonb_set(s,'{payload,initial,phase}','0.1'),
    jsonb_set(s,'{payload,initial,params,count}','9'), jsonb_set(s,'{payload,initial,params,count}','1.5'),
    jsonb_set(s,'{payload,initial,params,active}','1'), jsonb_set(s,'{payload,initial,params,kind0}','12'),
    jsonb_set(s,'{payload,initial,params,scale0}','0.49'), jsonb_set(s,'{payload,initial,params,scale0}','2.01'),
    jsonb_set(s,'{payload,initial,params,angle0}','36001'), jsonb_set(s,'{payload,initial,params,detail0}','0.5'),
    jsonb_set(s,'{payload,initial,params,angle1}','0'), jsonb_set(s,'{payload,initial,params}',(s#>'{payload,initial,params}')-'kind0'),
    jsonb_set(s,'{payload,initial,points,object0,x}','59'), jsonb_set(s,'{payload,initial,points,object0,y}','661'),
    jsonb_set(s,'{payload,initial,points,object1}','{"x":500,"y":400}'), jsonb_set(s,'{payload,initial,points,object0,z}','0'),
    jsonb_set(s,'{payload,initial,flags,random}','false'), jsonb_set(s,'{payload,initial,flags,edges}','1'),
    jsonb_set(s,'{payload,initial,marks}','["edge.0.0","edge.0.0"]'), jsonb_set(s,'{payload,initial,marks}','["boundary.0"]'),
    jsonb_set(s,'{payload,initial,marks}','["vertex.1.0"]'), jsonb_set(s,'{payload,initial,marks}','["edge.0.4"]'),
    jsonb_set(s,'{payload,initial,marks}','[3]'), jsonb_set(sample,'{payload,initial,params,active}','0'),
    jsonb_set(tangram,'{payload,initial,sceneId}','"01"'), jsonb_set(tangram,'{payload,initial}',s#>'{payload,initial}')
  ] loop if public.tool_scene_is_valid(bad) is not false then raise exception 'PLANE_MATERIAL_INVALID_ACCEPTED'; end if; end loop;
  sample:=jsonb_set(jsonb_set(tangram,'{toolId}','"plane-pieces"'),'{contentVersion}','"plane-pieces-lesson-v1"');
  if public.tool_scene_is_valid(sample) is not true or public.tool_scene_catalog_id(sample)<>'plane-pieces'
    then raise exception 'LEGACY_PIECES_ID_CHANGED'; end if;
  foreach proc in array array['public.tool_plane_shapes_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_material_scene_is_valid(jsonb)'::regprocedure] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute')
      or has_function_privilege('service_role',proc,'execute') then raise exception 'PLANE_MATERIAL_VALIDATOR_EXPOSED'; end if;
  end loop;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  foreach sample in array array[s,tangram] loop
    draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,sample,0);
    if saved.scene is distinct from sample or saved.catalog_id<>sample->>'toolId' or saved.revision<>1
      or (select scene from public.tool_scene_drafts where id=draft_id) is distinct from sample
      then raise exception 'PLANE_MATERIAL_SAVE_ROUNDTRIP'; end if;
  end loop;
  frozen:=jsonb_build_object('tool',sample);
  saved:=public.save_tool_scene_draft(draft_id,jsonb_set(sample,'{payload,title}','"Later preparation"'),1);
  if saved.revision<>2 or frozen->'tool' is distinct from sample then raise exception 'PLANE_MATERIAL_FROZEN_COPY_CHANGED'; end if;
  begin perform public.save_tool_scene_draft(draft_id,sample,1); raise exception 'PLANE_MATERIAL_CONFLICT_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if exists(select 1 from public.tool_scene_drafts where id=draft_id) then raise exception 'PLANE_MATERIAL_OTHER_OWNER_READ'; end if;
  begin perform public.save_tool_scene_draft(draft_id,sample,2); raise exception 'PLANE_MATERIAL_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  execute 'reset role';
end;
$test$;
rollback;
