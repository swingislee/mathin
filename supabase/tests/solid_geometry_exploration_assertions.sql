begin;
do $$
declare
  scene jsonb; legacy jsonb; cut jsonb; key text;
begin
  scene := '{"toolId":"solid-geometry","contentVersion":"solid-geometry-lesson-v2","payload":{"title":"Units and cuts","initial":{"entities":[{"id":"box","kind":"cuboid","dimensions":{"width":3,"height":2,"depth":2,"radius":1},"position":{"x":0,"y":1,"z":0},"rotation":{"x":0,"y":0,"z":0},"color":"#8fbf88","opacity":1}],"selectedId":"box","feature":null,"axes":true,"grid":false,"view":"angle","section":{"enabled":false,"axis":"y","offset":0,"tiltA":0,"tiltB":0,"removedSide":"none","showPlane":true},"measurement":{"enabled":true,"dimensions":true,"faceArea":true,"totals":true,"unitGrid":false,"unitFill":false,"fillLayers":0,"unit":"cm","version":"solid-measurement-v2","displayUnit":"dm","accumulation":"volume","accumulationCount":12},"cuts":[]}}}'::jsonb;
  if not public.tool_solid_geometry_exploration_scene_is_valid(scene) then raise exception 'valid unit scene rejected'; end if;
  if public.tool_solid_geometry_scene_is_valid(scene) then raise exception 'legacy geometry contract widened'; end if;
  foreach key in array array['toolId','contentVersion'] loop
    if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,array[key],'null'::jsonb)) then raise exception 'null identity % accepted',key; end if;
  end loop;
  foreach key in array array['unit','displayUnit','version','accumulation'] loop
    if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,array['payload','initial','measurement',key],'null'::jsonb)) then raise exception 'null measurement enum % accepted',key; end if;
  end loop;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,view}','null')) then raise exception 'null view accepted'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,entities,0,kind}','null')) then raise exception 'null entity kind accepted'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,measurement,displayUnit}','"unit"')) then raise exception 'unassigned metric conversion accepted'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,measurement,accumulationCount}','1729')) then raise exception 'unbounded unit fill accepted'; end if;
  cut := '{"id":"cut-box","entityId":"box","normal":{"x":0,"y":1,"z":0},"distance":0,"pieces":[{"position":{"x":0,"y":1.5,"z":0},"rotation":{"x":0,"y":0,"z":0},"color":"#8fbf88","opacity":1},{"position":{"x":0,"y":0.5,"z":0},"rotation":{"x":0,"y":0,"z":0},"color":"#8fbf88","opacity":1}],"cutColor":"#b39dcc"}'::jsonb;
  scene := jsonb_set(jsonb_set(scene,'{payload,initial,cuts}',jsonb_build_array(cut)),'{payload,initial,selectedId}','"cut-box:positive"');
  if not public.tool_solid_geometry_exploration_scene_is_valid(scene) then raise exception 'valid two-piece scene rejected'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,cuts,0,cutColor}','null')) then raise exception 'null cut color accepted'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,selectedId}','"box"')) then raise exception 'hidden cut source selected'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,cuts,0,distance}','1')) then raise exception 'tangent plane created two pieces'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,cuts,0,normal,y}','2')) then raise exception 'non-unit normal accepted'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,cuts,0,pieces,0,position,x}','31')) then raise exception 'unbounded piece pose accepted'; end if;
  if public.tool_solid_geometry_exploration_scene_is_valid(jsonb_set(scene,'{payload,initial,cuts}',jsonb_build_array(cut,cut))) then raise exception 'duplicate cut accepted'; end if;
  legacy := jsonb_set(scene,'{contentVersion}','"solid-geometry-lesson-v1"');
  if public.tool_solid_geometry_scene_is_valid(legacy) then raise exception 'v2 cuts accepted by legacy version'; end if;
end $$;
rollback;
