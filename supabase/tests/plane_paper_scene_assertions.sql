-- 由操作者完成本机隔离目标 preflight 后执行；独立合同断言无业务造数，整体回滚。
begin;
do $test$
declare
  empty_state jsonb := $state${"sceneId":"14-create","params":{"nextId":2,"active":-1,"dx":180,"dy":0,"turn":90,"axisAngle":90},"points":{"pivot":{"x":480,"y":360},"axis":{"x":480,"y":360}},"flags":{"grid":false,"measures":false,"edges":false,"vertices":false,"names":false,"counts":false,"ghost":false,"edit":false,"snap":false},"marks":[],"phase":0}$state$;
  paper jsonb; cut jsonb; sample jsonb; s jsonb; bad jsonb; curves jsonb; p jsonb; q jsonb; before_area numeric; after_area numeric;
  i integer; case_no integer:=0; proc regprocedure;
begin
  paper:=jsonb_set(jsonb_set(empty_state,'{params}',(empty_state->'params')||'{"active":1,"kind.1":0,"count.1":4,"angle.1":0,"rx.1":0,"ry.1":0,"life.1":0,"detail.1":0,"flip.1":1}'),'{points}',(empty_state->'points')||'{"center.1":{"x":420,"y":290},"vertex.1.0":{"x":-155,"y":90},"vertex.1.1":{"x":85,"y":90},"vertex.1.2":{"x":155,"y":-90},"vertex.1.3":{"x":-85,"y":-90}}');
  s:=jsonb_build_object('toolId','plane-area','contentVersion','plane-area-lesson-v2','payload',jsonb_build_object('title','Independent paper','initial',paper));
  if public.tool_plane_paper_state_is_valid(paper) is not true or public.tool_plane_paper_scene_is_valid(s) is not true
    or public.tool_plane_paper_state_is_valid(empty_state) is not true
    then raise exception 'PLANE_PAPER_DEFAULT_OR_EMPTY_REJECTED'; end if;

  -- 一刀竖切的两张纸片保留原世界位置，可分别平移、旋转、反射，稳定 ID 无需连续。
  p:=(empty_state->'params')||'{"nextId":4,"active":2,"kind.2":0,"count.2":4,"angle.2":0,"rx.2":0,"ry.2":0,"life.2":0,"detail.2":0,"flip.2":1,"kind.3":0,"count.3":4,"angle.3":0,"rx.3":0,"ry.3":0,"life.3":0,"detail.3":0,"flip.3":1}';
  q:=(empty_state->'points')||'{"center.2":{"x":342.5,"y":290},"vertex.2.0":{"x":-77.5,"y":90},"vertex.2.1":{"x":77.5,"y":90},"vertex.2.2":{"x":77.5,"y":-90},"vertex.2.3":{"x":-7.5,"y":-90},"center.3":{"x":497.5,"y":290},"vertex.3.0":{"x":-77.5,"y":90},"vertex.3.1":{"x":7.5,"y":90},"vertex.3.2":{"x":77.5,"y":-90},"vertex.3.3":{"x":-77.5,"y":-90}}';
  cut:=jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q);
  if public.tool_plane_paper_state_is_valid(cut) is not true then raise exception 'PLANE_PAPER_CUT_PIECES_REJECTED'; end if;
  before_area:=0; after_area:=0;
  for i in 0..3 loop
    before_area:=before_area+(paper#>>array['points','vertex.1.'||i,'x'])::numeric*(paper#>>array['points','vertex.1.'||((i+1)%4),'y'])::numeric-(paper#>>array['points','vertex.1.'||((i+1)%4),'x'])::numeric*(paper#>>array['points','vertex.1.'||i,'y'])::numeric;
    after_area:=after_area+(q#>>array['vertex.2.'||i,'x'])::numeric*(q#>>array['vertex.2.'||((i+1)%4),'y'])::numeric-(q#>>array['vertex.2.'||((i+1)%4),'x'])::numeric*(q#>>array['vertex.2.'||i,'y'])::numeric
      +(q#>>array['vertex.3.'||i,'x'])::numeric*(q#>>array['vertex.3.'||((i+1)%4),'y'])::numeric-(q#>>array['vertex.3.'||((i+1)%4),'x'])::numeric*(q#>>array['vertex.3.'||i,'y'])::numeric;
  end loop;
  if before_area<>after_area then raise exception 'PLANE_PAPER_CUT_FIXTURE_LOST_AREA'; end if;
  sample:=jsonb_set(jsonb_set(jsonb_set(cut,'{params,angle.2}','72'),'{params,flip.2}','-1'),'{points,center.2}','{"x":610,"y":480}');
  sample:=jsonb_set(sample,'{marks}','["edge.2.0","vertex.3.2"]');
  if public.tool_plane_paper_state_is_valid(sample) is not true or public.tool_plane_paper_scene_is_valid(jsonb_set(s,'{payload,initial}',sample)) is not true
    then raise exception 'PLANE_PAPER_INDEPENDENT_TRANSFORM_REJECTED'; end if;

  -- 长方形纸片可直接构造，凹图仍按真实轮廓校验。
  sample:=jsonb_set(jsonb_set(paper,'{params,kind.1}','1'),'{points}',(empty_state->'points')||'{"center.1":{"x":420,"y":290},"vertex.1.0":{"x":-100,"y":-80},"vertex.1.1":{"x":100,"y":-80},"vertex.1.2":{"x":100,"y":80},"vertex.1.3":{"x":-100,"y":80}}');
  if public.tool_plane_paper_state_is_valid(sample) is not true then raise exception 'PLANE_PAPER_RECTANGLE_REJECTED'; end if;
  sample:=jsonb_set(jsonb_set(paper,'{params,count.1}','6'),'{points}',(empty_state->'points')||'{"center.1":{"x":420,"y":290},"vertex.1.0":{"x":-140,"y":-100},"vertex.1.1":{"x":140,"y":-100},"vertex.1.2":{"x":140,"y":-10},"vertex.1.3":{"x":20,"y":-10},"vertex.1.4":{"x":20,"y":100},"vertex.1.5":{"x":-140,"y":100}}');
  if public.tool_plane_paper_state_is_valid(sample) is not true then raise exception 'PLANE_PAPER_CONCAVE_REJECTED'; end if;
  curves:=jsonb_set(jsonb_set(paper,'{params}',(paper->'params')||'{"kind.1":2,"count.1":0,"rx.1":90,"ry.1":90}'),'{points}',(paper->'points')-array['vertex.1.0','vertex.1.1','vertex.1.2','vertex.1.3']);
  if public.tool_plane_construction_state_is_valid(jsonb_set(curves,'{sceneId}','"01-create"')) is not true
    or public.tool_plane_paper_state_is_valid(curves) is not false then raise exception 'PLANE_PAPER_CURVE_ALLOWED'; end if;

  -- 继承有限数值、精确键、合法拓扑、稳定 ID、marks 和表现帧隔离。
  foreach bad in array array[
    paper||'{"extra":0}', jsonb_set(paper,'{sceneId}','"14"'), jsonb_set(paper,'{sceneId}','"01-create"'),
    jsonb_set(paper,'{params,kind.1}','1'), jsonb_set(paper,'{params,life.1}','1'), jsonb_set(paper,'{params,detail.1}','0.5'),
    jsonb_set(paper,'{params,frameA.1}','1'), jsonb_set(paper,'{params,frameB.1}','0'),
    jsonb_set(paper,'{params,kind.01}','0'), jsonb_set(paper,'{params,count.1}','3.5'), jsonb_set(paper,'{params,angle.1}','"NaN"'),
    jsonb_set(paper,'{params,nextId}','1'), jsonb_set(paper,'{params,active}','2'), jsonb_set(paper,'{phase}','0.5'),
    jsonb_set(paper,'{points,center.1,x}','2001'), jsonb_set(paper,'{points,vertex.1.0,y}','801'), jsonb_set(paper,'{points,vertex.1.0,z}','0'),
    jsonb_set(paper,'{points,vertex.1.2}',paper#>'{points,vertex.1.0}'),
    jsonb_set(paper,'{points}',(paper->'points')||'{"vertex.1.0":{"x":-100,"y":-100},"vertex.1.1":{"x":100,"y":100},"vertex.1.2":{"x":-100,"y":100},"vertex.1.3":{"x":100,"y":-100}}'),
    jsonb_set(paper,'{points}',(paper->'points')||'{"vertex.1.0":{"x":0,"y":0},"vertex.1.1":{"x":100,"y":0},"vertex.1.2":{"x":100,"y":0.002},"vertex.1.3":{"x":0,"y":0.002}}'),
    jsonb_set(paper,'{marks}','["boundary.1"]'), jsonb_set(paper,'{marks}','["edge.1.4"]'), jsonb_set(paper,'{marks}','["edge.1.0","edge.1.0"]'),
    jsonb_set(paper,'{marks}','["edge.0.0"]'), jsonb_set(paper,'{flags,cut}','true'), jsonb_set(paper,'{flags,snap}','1'),
    jsonb_set(paper,'{params}',(paper->'params')-'rx.1')
  ] loop
    case_no:=case_no+1;
    if public.tool_plane_paper_state_is_valid(bad) is not false then raise exception 'PLANE_PAPER_INVALID_ACCEPTED: %',case_no; end if;
  end loop;
  foreach bad in array array[
    s||'{"extra":true}', jsonb_set(s,'{payload,sourceDraftId}','"live-reference"'), jsonb_set(s,'{payload,title}','"  "'),
    jsonb_set(s,'{payload,title}',to_jsonb(repeat('x',81))), jsonb_set(s,'{toolId}','"plane-shapes"'),
    jsonb_set(s,'{contentVersion}','"plane-area-lesson-v1"'), jsonb_set(s,'{payload,initial}',curves)
  ] loop if public.tool_plane_paper_scene_is_valid(bad) is not false then raise exception 'PLANE_PAPER_ENVELOPE_INVALID_ACCEPTED'; end if; end loop;

  -- 16 张纸片本身有效，第 17 张拒绝；原材料合同继续负责 192 顶点预算。
  p:=(empty_state->'params')||'{"nextId":16,"active":15}'; q:=empty_state->'points';
  for i in 0..16 loop
    p:=p||jsonb_build_object('kind.'||i,0,'count.'||i,3,'angle.'||i,0,'rx.'||i,0,'ry.'||i,0,'life.'||i,0,'detail.'||i,0,'flip.'||i,1);
    q:=q||jsonb_build_object('center.'||i,jsonb_build_object('x',100+i*40,'y',300),'vertex.'||i||'.0','{"x":0,"y":0}'::jsonb,'vertex.'||i||'.1','{"x":100,"y":0}'::jsonb,'vertex.'||i||'.2','{"x":0,"y":100}'::jsonb);
    if i=15 and public.tool_plane_paper_state_is_valid(jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q)) is not true then raise exception 'PLANE_PAPER_LIMIT_REJECTED'; end if;
  end loop;
  p:=p||'{"nextId":17}';
  if public.tool_plane_paper_state_is_valid(jsonb_set(jsonb_set(empty_state,'{params}',p),'{points}',q)) is not false then raise exception 'PLANE_PAPER_OBJECT_LIMIT_EXCEEDED'; end if;
  foreach proc in array array['public.tool_plane_paper_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_paper_scene_is_valid(jsonb)'::regprocedure] loop
    if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute')
      then raise exception 'PLANE_PAPER_VALIDATOR_EXPOSED'; end if;
  end loop;
end;
$test$;
rollback;
