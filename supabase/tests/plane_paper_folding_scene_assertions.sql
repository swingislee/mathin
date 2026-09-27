-- 单独 helper 断言；事务回滚，不创建课件、用户或业务记录。
begin;
do $$
declare
  base jsonb:='{"sceneId":"32-create","phase":0,"marks":[],"params":{"paperCount":4,"creaseSet":0,"side":1,"cutCount":0},"points":{"paper.0":{"x":260,"y":180},"paper.1":{"x":700,"y":180},"paper.2":{"x":700,"y":560},"paper.3":{"x":260,"y":560},"creaseA":{"x":300,"y":370},"creaseB":{"x":660,"y":370}},"flags":{"grid":false,"measures":false,"crease":true,"edit":false}}';
  creased jsonb; folded jsonb; cut jsonb; polygon_cut jsonb; broken jsonb; scene jsonb; poly jsonb; fragment jsonb; area_ double precision:=0;
  i integer; sample jsonb;
begin
  if not public.tool_plane_paper_folding_state_is_valid(base) then raise exception 'default paper rejected'; end if;
  creased:=jsonb_set(base,'{params,creaseSet}','1');
  creased:=jsonb_set(creased,'{params,side}','-1');
  creased:=jsonb_set(creased,'{points,creaseA}','{"x":480,"y":190}');
  creased:=jsonb_set(creased,'{points,creaseB}','{"x":480,"y":550}');
  folded:=jsonb_set(creased,'{phase}','1');
  cut:=folded||jsonb_build_object('params',(folded->'params')||'{"cutCount":1,"cutKind.0":0,"cutVertices.0":1,"cutRadius.0":25}'::jsonb,
    'points',(folded->'points')||'{"cut.0.0":{"x":590,"y":300}}'::jsonb);
  if not public.tool_plane_paper_folding_state_is_valid(cut) then raise exception 'real two-layer circle cut rejected'; end if;
  for i in 0..20 loop
    sample:=jsonb_set(cut,'{phase}',to_jsonb(i/20.0));
    if not public.tool_plane_paper_folding_state_is_valid(sample) then raise exception 'valid folded frame % rejected',i; end if;
  end loop;
  if not public.tool_plane_paper_folding_state_is_valid(jsonb_set(cut,'{points,cut.0.0}','{"x":700,"y":300}')) then raise exception 'cross-edge circle cut rejected'; end if;
  polygon_cut:=folded||jsonb_build_object('params',(folded->'params')||'{"cutCount":1,"cutKind.0":1,"cutVertices.0":3,"cutRadius.0":0}'::jsonb,
    'points',(folded->'points')||'{"cut.0.0":{"x":680,"y":280},"cut.0.1":{"x":720,"y":280},"cut.0.2":{"x":700,"y":330}}'::jsonb);
  if not public.tool_plane_paper_folding_state_is_valid(polygon_cut) then raise exception 'cross-edge polygon notch rejected'; end if;
  -- Concave material can yield two disjoint regions on one side of a crease.
  poly:='[{"x":100,"y":100},{"x":500,"y":100},{"x":500,"y":500},{"x":400,"y":500},{"x":400,"y":200},{"x":200,"y":200},{"x":200,"y":500},{"x":100,"y":500}]';
  if not public.tool_paper_polygon_is_valid(poly) then raise exception 'concave simple paper rejected'; end if;
  for fragment in select value from jsonb_array_elements(public.tool_paper_triangles(poly)) loop area_:=area_+abs(public.tool_paper_signed_area(fragment)); end loop;
  if abs(area_-100000)>1e-6 then raise exception 'concave triangulation lost material: %',area_; end if;

  for broken in select value from jsonb_array_elements(jsonb_build_array(
    base-'flags', jsonb_set(base,'{flags}',(base->'flags')-'measures'), jsonb_set(base,'{flags,other}','true'),
    jsonb_set(base,'{phase}','0.5'), jsonb_set(base,'{phase}','1.1'), jsonb_set(base,'{marks}','["answer"]'),
    jsonb_set(base,'{points,creaseB}',base#>'{points,creaseA}'),
    jsonb_set(base,'{params,paperCount}','33'), jsonb_set(base,'{params,side}','0'),
    jsonb_set(base,'{points,paper.1}','{"x":1000,"y":180}'),
    jsonb_set(base,'{points,paper.1}',base#>'{points,paper.3}'),
    jsonb_set(creased,'{points,creaseA}','{"x":700,"y":190}')||jsonb_build_object('points',(creased->'points')||'{"creaseA":{"x":700,"y":190},"creaseB":{"x":700,"y":550}}'::jsonb),
    jsonb_set(cut,'{points,cut.0.0}','{"x":900,"y":650}'),
    jsonb_set(cut,'{params,cutRadius.0}','2.9'), jsonb_set(cut,'{params,cutCount}','13'),
    jsonb_set(cut,'{points,cut.0.1}','{"x":500,"y":300}'),
    jsonb_set(polygon_cut,'{params,cutRadius.0}','4'),
    jsonb_set(polygon_cut,'{points,cut.0.2}',polygon_cut#>'{points,cut.0.1}')
  )) loop
    if public.tool_plane_paper_folding_state_is_valid(broken) then raise exception 'invalid state admitted: %',broken; end if;
  end loop;
  broken:=cut||jsonb_build_object('params',(cut->'params')||'{"cutCount":2,"cutKind.1":0,"cutVertices.1":1,"cutRadius.1":25}'::jsonb,
    'points',(cut->'points')||'{"cut.1.0":{"x":590,"y":300}}'::jsonb);
  if public.tool_plane_paper_folding_state_is_valid(broken) then raise exception 'duplicate cut admitted'; end if;
  scene:=jsonb_build_object('toolId','plane-folding','contentVersion','plane-folding-lesson-v2','payload',jsonb_build_object('title','一折剪纸','initial',cut));
  if not public.tool_plane_paper_folding_scene_is_valid(scene) then raise exception 'v2 scene rejected'; end if;
  if public.tool_plane_paper_folding_scene_is_valid(jsonb_set(scene,'{contentVersion}','"plane-folding-lesson-v1"'))
    or public.tool_plane_paper_folding_scene_is_valid(jsonb_set(scene,'{payload,title}','"  "'))
    or public.tool_plane_paper_folding_scene_is_valid(jsonb_set(scene,'{toolId}','"plane-motion"')) then raise exception 'invalid envelope admitted'; end if;
end; $$;
rollback;
