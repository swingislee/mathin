-- 仅由操作者完成本机隔离目标 preflight 后执行；固定开发身份，所有新增草稿事务回滚。
begin;

do $test$
declare
  empty_state jsonb := $state${"sceneId":"01-create","params":{"nextId":1,"active":-1,"dx":120,"dy":-60,"turn":90,"axisAngle":90},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false},"marks":[],"phase":0}$state$;
  rectangle_state jsonb;
  s jsonb; motion jsonb; sample jsonb; bad jsonb; frozen jsonb; draft_scene jsonb;
  legacy_shape jsonb := $legacy${"toolId":"plane-shapes","contentVersion":"plane-shapes-lesson-v1","payload":{"title":"Legacy shapes","initial":{"sceneId":"01-basic","params":{"count":1,"active":0,"kind0":2,"scale0":1,"angle0":0,"detail0":0},"points":{"object0":{"x":480,"y":360}},"flags":{"grid":false,"measures":true,"edges":false,"vertices":false,"names":false},"marks":[],"phase":0}}}$legacy$;
  legacy_motion jsonb := $legacy${"toolId":"plane-motion","contentVersion":"plane-motion-lesson-v1","payload":{"title":"Legacy translation","initial":{"sceneId":"20","params":{"dx":210,"dy":-40},"points":{},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}}$legacy$;
  p jsonb; q jsonb; marks jsonb; vertex jsonb; objects_state jsonb; many_vertices_state jsonb; triangle_state jsonb;
  i integer; j integer; life integer; kind integer; case_no integer:=0; proc regprocedure;
  owner_id uuid; other_id uuid; draft_id uuid; saved public.tool_scene_drafts;
begin
  rectangle_state:=jsonb_set(jsonb_set(empty_state,'{params}',(empty_state->'params')||'{"active":0,"kind.0":1,"count.0":4,"angle.0":30,"rx.0":0,"ry.0":0,"life.0":0,"detail.0":0,"flip.0":1}'),'{points}',(empty_state->'points')||'{"center.0":{"x":480,"y":360},"vertex.0.0":{"x":-90,"y":-60},"vertex.0.1":{"x":90,"y":-60},"vertex.0.2":{"x":90,"y":60},"vertex.0.3":{"x":-90,"y":60}}');
  s:=jsonb_build_object('toolId','plane-shapes','contentVersion','plane-shapes-lesson-v2','payload',jsonb_build_object('title','Constructed material','initial',rectangle_state));
  motion:=jsonb_set(jsonb_set(jsonb_set(s,'{toolId}','"plane-motion"'),'{contentVersion}','"plane-motion-lesson-v2"'),'{payload,initial,sceneId}','"20-create"');
  motion:=jsonb_set(jsonb_set(jsonb_set(motion,'{payload,initial,points,center.0}','{"x":600,"y":300}'),'{payload,initial,params,angle.0}','120'),'{payload,initial,params,flip.0}','-1');
  foreach sample in array array[s,motion,legacy_shape,legacy_motion] loop
    if public.tool_scene_is_valid(sample) is not true or public.tool_scene_catalog_id(sample) is distinct from sample->>'toolId'
      then raise exception 'PLANE_CONSTRUCTION_VERSION_OR_CATALOG_REJECTED'; end if;
  end loop;
  if public.tool_plane_construction_state_is_valid(empty_state) is not true
    or public.tool_scene_is_valid(jsonb_set(s,'{payload,initial}',empty_state)) is not true
    then raise exception 'PLANE_CONSTRUCTION_EMPTY_STAGE_REJECTED'; end if;

  -- 局部坐标也可为斜放的长方形；矩形身份以直角和对边关系为准。
  sample:=jsonb_set(s,'{payload,initial,points}',(rectangle_state->'points')||'{"vertex.0.0":{"x":0,"y":-100},"vertex.0.1":{"x":80,"y":-40},"vertex.0.2":{"x":20,"y":40},"vertex.0.3":{"x":-60,"y":-20}}');
  if public.tool_scene_is_valid(sample) is not true then raise exception 'ROTATED_LOCAL_RECTANGLE_REJECTED'; end if;
  sample:=jsonb_set(jsonb_set(s,'{payload,initial,params,kind.0}','0'),'{payload,initial,params,count.0}','5');
  sample:=jsonb_set(sample,'{payload,initial,points}',(rectangle_state->'points')||'{"vertex.0.0":{"x":-90,"y":-60},"vertex.0.1":{"x":0,"y":-60},"vertex.0.2":{"x":90,"y":-60},"vertex.0.3":{"x":90,"y":60},"vertex.0.4":{"x":-90,"y":60}}');
  if public.tool_scene_is_valid(sample) is not true then raise exception 'COLLINEAR_INSERTED_VERTEX_REJECTED'; end if;
  sample:=jsonb_set(sample,'{payload,initial,points,vertex.0.2}','{"x":0,"y":0}');
  if public.tool_scene_is_valid(sample) is not true then raise exception 'SIMPLE_CONCAVE_POLYGON_REJECTED'; end if;
  triangle_state:=jsonb_set(jsonb_set(rectangle_state,'{params}',(rectangle_state->'params')||'{"kind.0":0,"count.0":3}'),'{points}',(rectangle_state->'points')-'vertex.0.3');

  -- 生活细节只附着于对应的数学轮廓；圆/椭圆没有伪造的直边或顶点。
  for life in 0..5 loop
    kind:=case life when 1 then 0 when 4 then 2 when 5 then 3 else 1 end;
    sample:=case when life=1 then triangle_state else rectangle_state end;
    p:=(sample->'params')||jsonb_build_object('kind.0',kind,'life.0',life,'detail.0',case when life=0 then 0 else 0.45 end);
    q:=sample->'points';
    if kind>=2 then
      p:=p||jsonb_build_object('count.0',0,'rx.0',90,'ry.0',case when kind=2 then 90 else 60 end);
      q:=q-array['vertex.0.0','vertex.0.1','vertex.0.2','vertex.0.3'];
    end if;
    sample:=jsonb_set(jsonb_set(jsonb_set(sample,'{params}',p),'{points}',q),'{marks}',case when kind>=2 then '["boundary.0"]' else '["edge.0.0","vertex.0.0"]' end::jsonb);
    if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial}',sample)) is not true then raise exception 'CONSTRUCTION_LIFE_MATERIAL_REJECTED: %',life; end if;
    if kind>=2 and public.tool_plane_construction_state_is_valid(jsonb_set(sample,'{marks}','["vertex.0.0"]')) is not false
      then raise exception 'CURVE_HAS_FALSE_VERTEX'; end if;
    if kind=2 and public.tool_plane_construction_state_is_valid(jsonb_set(sample,'{params,ry.0}','91')) is not false
      then raise exception 'FALSE_CIRCLE_ACCEPTED'; end if;
  end loop;

  -- 稳定对象 ID 可有空缺；复制/删除不会重排其余对象的标记或几何键。
  p:=(empty_state->'params')||'{"nextId":99999,"active":99998,"kind.99998":2,"count.99998":0,"angle.99998":-36000,"rx.99998":6,"ry.99998":6,"life.99998":0,"detail.99998":0,"flip.99998":-1}';
  q:=(empty_state->'points')||'{"center.99998":{"x":-1000,"y":1720}}';
  sample:=jsonb_set(jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q),'{marks}','["boundary.99998"]');
  if public.tool_plane_construction_state_is_valid(sample) is not true then raise exception 'SPARSE_STABLE_ID_REJECTED'; end if;

  -- 上限本身有效，越过对象数或总顶点预算才拒绝。
  p:=(empty_state->'params')||'{"nextId":16,"active":15}'; q:=empty_state->'points';
  for i in 0..15 loop
    p:=p||jsonb_build_object('kind.'||i,2,'count.'||i,0,'angle.'||i,0,'rx.'||i,20,'ry.'||i,20,'life.'||i,0,'detail.'||i,0,'flip.'||i,1);
    q:=q||jsonb_build_object('center.'||i,jsonb_build_object('x',100+i*40,'y',300));
  end loop;
  objects_state:=jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q);
  if public.tool_plane_construction_state_is_valid(objects_state) is not true then raise exception 'SIXTEEN_OBJECTS_REJECTED'; end if;
  p:=p||'{"nextId":17,"kind.16":2,"count.16":0,"angle.16":0,"rx.16":20,"ry.16":20,"life.16":0,"detail.16":0,"flip.16":1}';
  q:=q||'{"center.16":{"x":780,"y":300}}';
  if public.tool_plane_construction_state_is_valid(jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q)) is not false then raise exception 'OBJECT_BUDGET_EXCEEDED'; end if;
  p:=(empty_state->'params')||'{"nextId":6,"active":5}'; q:=empty_state->'points'; marks:='[]';
  for i in 0..5 loop
    p:=p||jsonb_build_object('kind.'||i,0,'count.'||i,32,'angle.'||i,0,'rx.'||i,0,'ry.'||i,0,'life.'||i,0,'detail.'||i,0,'flip.'||i,1);
    q:=q||jsonb_build_object('center.'||i,jsonb_build_object('x',100+i*140,'y',300));
    for j in 0..31 loop
      vertex:=jsonb_build_object('x',60*cos(2*pi()*j/32),'y',60*sin(2*pi()*j/32));
      q:=q||jsonb_build_object('vertex.'||i||'.'||j,vertex);
      if i<2 then marks:=marks||jsonb_build_array('edge.'||i||'.'||j,'vertex.'||i||'.'||j); end if;
    end loop;
  end loop;
  many_vertices_state:=jsonb_set(jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q),'{marks}',marks);
  if public.tool_plane_construction_state_is_valid(many_vertices_state) is not true then raise exception 'VERTEX_OR_MARK_LIMIT_REJECTED'; end if;
  p:=p||'{"nextId":7,"kind.6":0,"count.6":3,"angle.6":0,"rx.6":0,"ry.6":0,"life.6":0,"detail.6":0,"flip.6":1}';
  q:=q||'{"center.6":{"x":400,"y":500},"vertex.6.0":{"x":0,"y":0},"vertex.6.1":{"x":100,"y":0},"vertex.6.2":{"x":0,"y":100}}';
  if public.tool_plane_construction_state_is_valid(jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q)) is not false then raise exception 'TOTAL_VERTEX_BUDGET_EXCEEDED'; end if;
  if public.tool_plane_construction_state_is_valid(jsonb_set(many_vertices_state,'{marks}',marks||'["edge.2.0"]')) is not false then raise exception 'MARK_BUDGET_EXCEEDED'; end if;

  foreach bad in array array[
    s||'{"extra":true}', jsonb_set(s,'{payload,draftId}','"live-reference"'),
    jsonb_set(s,'{payload,initial,extra}','0'), jsonb_set(s,'{payload,title}','""'), jsonb_set(s,'{payload,initial,sceneId}','null'),
    jsonb_set(s,'{toolId}','"plane-motion"'), jsonb_set(s,'{contentVersion}','"plane-motion-lesson-v2"'),
    jsonb_set(s,'{contentVersion}','"plane-shapes-lesson-v1"'), jsonb_set(motion,'{contentVersion}','"plane-motion-lesson-v1"'),
    jsonb_set(s,'{payload,initial}',legacy_shape#>'{payload,initial}'), jsonb_set(motion,'{payload,initial}',legacy_motion#>'{payload,initial}'),
    jsonb_set(s,'{payload,initial,phase}','0.1'), jsonb_set(s,'{payload,initial,params,nextId}','0'),
    jsonb_set(s,'{payload,initial,params,nextId}','100000'), jsonb_set(s,'{payload,initial,params,active}','1'),
    jsonb_set(s,'{payload,initial,params,active}','-2'), jsonb_set(s,'{payload,initial,params,active}','0.5'),
    jsonb_set(s,'{payload,initial,params,dx}','601'), jsonb_set(s,'{payload,initial,params,dy}','-601'),
    jsonb_set(s,'{payload,initial,params,turn}','361'), jsonb_set(s,'{payload,initial,params,axisAngle}','181'),
    jsonb_set(s,'{payload,initial,params,kind.0}','4'), jsonb_set(s,'{payload,initial,params,count.0}','4.5'),
    jsonb_set(s,'{payload,initial,params,angle.0}','36001'), jsonb_set(s,'{payload,initial,params,angle.0}','"NaN"'),
    jsonb_set(s,'{payload,initial,params,rx.0}','1'), jsonb_set(s,'{payload,initial,params,life.0}','6'),
    jsonb_set(s,'{payload,initial,params,life.0}','1'), jsonb_set(s,'{payload,initial,params,detail.0}','0.5'),
    jsonb_set(s,'{payload,initial,params,flip.0}','0'), jsonb_set(s,'{payload,initial,params,unknown}','1'),
    jsonb_set(s,'{payload,initial,params,frameA.0}','1'), jsonb_set(s,'{payload,initial,params,frameB.0}','0'),
    jsonb_set(s,'{payload,initial,params,frameC.0}','0'), jsonb_set(s,'{payload,initial,params,frameD.0}','1'),
    jsonb_set(s,'{payload,initial,params}',(rectangle_state->'params')-'flip.0'),
    jsonb_set(s,'{payload,initial,points,center.0,x}','-1001'), jsonb_set(s,'{payload,initial,points,center.0,y}','1721'),
    jsonb_set(s,'{payload,initial,points,vertex.0.0,x}','801'), jsonb_set(s,'{payload,initial,points,vertex.0.0,z}','0'),
    jsonb_set(s,'{payload,initial,points,vertex.0.4}','{"x":0,"y":0}'), jsonb_set(s,'{payload,initial,points,center.1}','{"x":400,"y":300}'),
    jsonb_set(s,'{payload,initial,points}',(rectangle_state->'points')-'pivot'),
    jsonb_set(s,'{payload,initial,flags,unknown}','false'), jsonb_set(s,'{payload,initial,flags,edit}','1'),
    jsonb_set(s,'{payload,initial,flags}',(rectangle_state->'flags')-'counts'),
    jsonb_set(s,'{payload,initial,marks}','["edge.0.0","edge.0.0"]'), jsonb_set(s,'{payload,initial,marks}','["boundary.0"]'),
    jsonb_set(s,'{payload,initial,marks}','["vertex.1.0"]'), jsonb_set(s,'{payload,initial,marks}','["edge.0.4"]'),
    jsonb_set(s,'{payload,initial,marks}','["edge.00.0"]'), jsonb_set(s,'{payload,initial,marks}','[3]'),
    jsonb_set(s,'{payload,initial,params,kind.00}','1'),
    jsonb_set(s,'{payload,initial,points,vertex.0.1}','{"x":-89.5,"y":-60}'),
    jsonb_set(s,'{payload,initial,points,vertex.0.1}','{"x":-90,"y":-60}'),
    jsonb_set(s,'{payload,initial,points}',(rectangle_state->'points')||'{"vertex.0.0":{"x":0,"y":0},"vertex.0.1":{"x":100,"y":0},"vertex.0.2":{"x":140,"y":100},"vertex.0.3":{"x":40,"y":100}}'),
    jsonb_set(jsonb_set(s,'{payload,initial,params,kind.0}','0'),'{payload,initial,points}',(rectangle_state->'points')||'{"vertex.0.0":{"x":-90,"y":-60},"vertex.0.1":{"x":90,"y":60},"vertex.0.2":{"x":90,"y":-60},"vertex.0.3":{"x":-90,"y":60}}'),
    jsonb_set(s,'{payload,initial}',jsonb_set(triangle_state,'{points}',(triangle_state->'points')||'{"vertex.0.0":{"x":0,"y":0},"vertex.0.1":{"x":1,"y":0},"vertex.0.2":{"x":0,"y":2}}')),
    jsonb_set(s,'{payload,initial}',jsonb_set(empty_state,'{params,active}','0'))
  ] loop
    case_no:=case_no+1;
    if public.tool_scene_is_valid(bad) is not false then raise exception 'INVALID_CONSTRUCTION_ACCEPTED_CASE_%',case_no; end if;
  end loop;
  -- 邻边折返与非相邻的端点接触也不属于简单多边形。
  sample:=jsonb_set(jsonb_set(s,'{payload,initial,params,kind.0}','0'),'{payload,initial,params,count.0}','5');
  sample:=jsonb_set(sample,'{payload,initial,points}',(rectangle_state->'points')||'{"vertex.0.0":{"x":0,"y":0},"vertex.0.1":{"x":100,"y":0},"vertex.0.2":{"x":50,"y":0},"vertex.0.3":{"x":100,"y":100},"vertex.0.4":{"x":0,"y":100}}');
  if public.tool_scene_is_valid(sample) is not false then raise exception 'ADJACENT_BACKTRACK_ACCEPTED'; end if;
  sample:=jsonb_set(sample,'{payload,initial,points,vertex.0.2}','{"x":0,"y":100}');
  if public.tool_scene_is_valid(sample) is not false then raise exception 'NONADJACENT_TOUCH_ACCEPTED'; end if;

  foreach proc in array array['public.tool_plane_construction_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_construction_scene_is_valid(jsonb)'::regprocedure] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute')
      or has_function_privilege('service_role',proc,'execute') then raise exception 'CONSTRUCTION_VALIDATOR_EXPOSED'; end if;
  end loop;
  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  foreach draft_scene in array array[s,motion] loop
    draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,draft_scene,0);
    if saved.scene is distinct from draft_scene or saved.catalog_id is distinct from draft_scene->>'toolId' or saved.revision<>1
      or (select scene from public.tool_scene_drafts where id=draft_id) is distinct from draft_scene
      then raise exception 'CONSTRUCTION_SAVE_ROUNDTRIP'; end if;
  end loop;
  frozen:=jsonb_build_object('tool',draft_scene);
  saved:=public.save_tool_scene_draft(draft_id,jsonb_set(draft_scene,'{payload,title}','"Later preparation"'),1);
  if saved.revision<>2 or frozen->'tool' is distinct from draft_scene then raise exception 'CONSTRUCTION_FROZEN_COPY_CHANGED'; end if;
  begin perform public.save_tool_scene_draft(draft_id,draft_scene,1); raise exception 'CONSTRUCTION_CONFLICT_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  begin perform public.save_tool_scene_draft(gen_random_uuid(),jsonb_set(draft_scene,'{payload,initial,params,frameA.0}','1'),0); raise exception 'CONSTRUCTION_FRAME_SAVED';
  exception when sqlstate '22023' then null; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if exists(select 1 from public.tool_scene_drafts where id=draft_id) then raise exception 'CONSTRUCTION_OTHER_OWNER_READ'; end if;
  begin perform public.save_tool_scene_draft(draft_id,draft_scene,2); raise exception 'CONSTRUCTION_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  execute 'reset role';
end;
$test$;
rollback;
