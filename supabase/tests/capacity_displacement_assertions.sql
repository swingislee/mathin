begin;
do $$
declare base jsonb := '{"toolId":"solid-capacity","contentVersion":"solid-capacity-lesson-v2","payload":{"title":"排水法","initial":{"mode":"displacement","pour":{"cone":{"radius":1,"height":3,"fill":1},"cylinder":{"radius":1,"height":3,"fill":0},"coneOrientation":"tip-down","linkedDimensions":true,"showAmounts":false,"showDimensions":true,"axes":false,"grid":false,"view":"angle"},"displacement":{"tank":{"width":6,"depth":4,"height":5,"waterHeight":2},"body":{"kind":"cuboid","width":2,"height":2,"depth":2,"bottom":5.4},"showAmounts":false,"showDimensions":true,"showInitialLevel":true,"axes":false,"grid":false,"view":"angle"}}}}'::jsonb;
  sample jsonb;
begin
  if public.tool_solid_capacity_teaching_scene_is_valid(base) is not true then raise exception 'default displacement scene must validate'; end if;
  if public.tool_solid_capacity_scene_is_valid(base) is not false then raise exception 'v1 must not accept v2'; end if;
  sample := jsonb_set(jsonb_set(base,'{payload,initial,displacement,body,kind}','"stepped"'),'{payload,initial,displacement,body,bottom}','1.1');
  if public.tool_solid_capacity_teaching_scene_is_valid(sample) is not true then raise exception 'partly immersed stepped body must validate'; end if;
  sample := jsonb_set(base,'{payload,initial,displacement,body,bottom}','0');
  if public.tool_solid_capacity_teaching_scene_is_valid(sample) is not true then raise exception 'fully immersed body must validate'; end if;
  sample := jsonb_set(jsonb_set(base,'{payload,initial,displacement,tank,waterHeight}','4.9'),'{payload,initial,displacement,body,bottom}','4.4');
  if public.tool_solid_capacity_teaching_scene_is_valid(sample) is not true then raise exception 'rim limited body must validate'; end if;
  sample := jsonb_set(sample,'{payload,initial,displacement,body,bottom}','4.3');
  if public.tool_solid_capacity_teaching_scene_is_valid(sample) is not false then raise exception 'overflow must reject'; end if;
  foreach sample in array array[
    base-'toolId', jsonb_set(base,'{toolId}','"solid-geometry"'), jsonb_set(base,'{contentVersion}','"solid-capacity-lesson-v1"'),
    jsonb_set(base,'{payload,initial,mode}','"quiz"'), jsonb_set(base,'{payload,initial,displacement,body,kind}','"sphere"'),
    jsonb_set(base,'{payload,initial,displacement,body,depth}','4'), jsonb_set(base,'{payload,initial,displacement,body,bottom}','-1'),
    jsonb_set(base,'{payload,initial,displacement,body,bottom}','7'), jsonb_set(base,'{payload,initial,displacement,tank,waterHeight}','6'),
    jsonb_set(base,'{payload,initial,displacement,body,width}','"2"'), jsonb_set(base,'{payload,initial,displacement,showAmounts}','null'),
    jsonb_set(base,'{payload,initial,displacement,cameraRevision}','1'), jsonb_set(base,'{payload,initial,pour,cone,radius}','2'),
    jsonb_set(base,'{payload,title}','""'), base#-'{payload,initial,displacement,showInitialLevel}'
  ] loop
    if public.tool_solid_capacity_teaching_scene_is_valid(sample) is not false then raise exception 'invalid displacement scene passed: %',sample; end if;
  end loop;
end $$;
rollback;
