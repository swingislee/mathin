-- 只验证版本化领域合同；共用保存、RLS、冻结副本由 spatial_teaching_batch_assertions 覆盖。
begin;
do $revolution$
declare base jsonb := '{"toolId":"solid-revolution","contentVersion":"solid-revolution-lesson-v1","payload":{"title":"旋转成体","initial":{"shape":"rectangle","axis":"height","width":2,"height":3,"angle":0,"speed":30,"showSweep":true,"showStart":true,"showMeasures":true,"axes":false,"grid":true,"view":"angle"}}}'::jsonb;
  sample jsonb; shape text; axis text; view_name text; numeric_value integer; key text;
begin
  if public.tool_solid_revolution_scene_is_valid(base) is not true then raise exception 'REVOLUTION_DEFAULT_REJECTED'; end if;
  foreach shape in array array['rectangle','right-triangle'] loop
    foreach axis in array array['height','width'] loop
      foreach numeric_value in array array[0,90,180,270,360] loop
        sample := jsonb_set(jsonb_set(jsonb_set(base,'{payload,initial,shape}',to_jsonb(shape)),'{payload,initial,axis}',to_jsonb(axis)),'{payload,initial,angle}',to_jsonb(numeric_value));
        if public.tool_solid_revolution_scene_is_valid(sample) is not true then raise exception 'REVOLUTION_SHAPE_AXIS_ANGLE_REJECTED'; end if;
      end loop;
    end loop;
  end loop;
  foreach numeric_value in array array[15,30,60] loop
    if public.tool_solid_revolution_scene_is_valid(jsonb_set(base,'{payload,initial,speed}',to_jsonb(numeric_value))) is not true then raise exception 'REVOLUTION_SPEED_REJECTED'; end if;
  end loop;
  foreach view_name in array array['angle','front','left','right','top','bottom'] loop
    if public.tool_solid_revolution_scene_is_valid(jsonb_set(base,'{payload,initial,view}',to_jsonb(view_name))) is not true then raise exception 'REVOLUTION_VIEW_REJECTED'; end if;
  end loop;
  foreach sample in array array[
    jsonb_set(jsonb_set(base,'{payload,initial,width}','0.5'),'{payload,initial,height}','6'),
    jsonb_set(base,'{payload,initial,angle}','112.5'), jsonb_set(base,'{payload,initial,showSweep}','false')
  ] loop if public.tool_solid_revolution_scene_is_valid(sample) is not true then raise exception 'REVOLUTION_VALID_BOUNDARY_REJECTED'; end if; end loop;
  foreach sample in array array[
    'null'::jsonb, '{}'::jsonb, '[]'::jsonb,
    base-'toolId', jsonb_set(base,'{toolId}','null'), jsonb_set(base,'{toolId}','"solid-nets"'),
    jsonb_set(base,'{contentVersion}','null'), jsonb_set(base,'{contentVersion}','"solid-revolution-lesson-v2"'),
    jsonb_set(base,'{payload,title}','null'), jsonb_set(base,'{payload,title}','""'),
    jsonb_set(base,'{payload,title}',to_jsonb(repeat('x',81))), base||'{"draftId":"private"}',
    jsonb_set(base,'{payload,initial,shape}','null'), jsonb_set(base,'{payload,initial,shape}','"polygon"'),
    jsonb_set(base,'{payload,initial,axis}','null'), jsonb_set(base,'{payload,initial,axis}','"diagonal"'),
    jsonb_set(base,'{payload,initial,view}','null'), jsonb_set(base,'{payload,initial,view}','"perspective"'),
    jsonb_set(base,'{payload,initial,width}','0.49'), jsonb_set(base,'{payload,initial,height}','6.01'),
    jsonb_set(base,'{payload,initial,width}','"2"'), jsonb_set(base,'{payload,initial,height}','null'),
    jsonb_set(base,'{payload,initial,angle}','-0.01'), jsonb_set(base,'{payload,initial,angle}','360.01'),
    jsonb_set(base,'{payload,initial,angle}','"180"'), jsonb_set(base,'{payload,initial,speed}','"30"'),
    jsonb_set(base,'{payload,initial,speed}','45'), jsonb_set(base,'{payload,initial,motion}','null'),
    jsonb_set(base,'{payload,initial,cameraRevision}','0'), jsonb_set(base,'{payload,initial,score}','1')
  ] loop if public.tool_solid_revolution_scene_is_valid(sample) is not false then raise exception 'REVOLUTION_INVALID_SCENE_ACCEPTED: %',sample; end if; end loop;
  foreach key in array array['shape','axis','width','height','angle','speed','showSweep','showStart','showMeasures','axes','grid','view'] loop
    sample := base #- array['payload','initial',key];
    if public.tool_solid_revolution_scene_is_valid(sample) is not false then raise exception 'REVOLUTION_REQUIRED_FIELD_MISSING: %',key; end if;
    sample := jsonb_set(base,array['payload','initial',key],'null');
    if public.tool_solid_revolution_scene_is_valid(sample) is not false then raise exception 'REVOLUTION_NULL_FIELD_ACCEPTED: %',key; end if;
  end loop;
  if has_function_privilege('authenticated','public.tool_solid_revolution_scene_is_valid(jsonb)','execute')
    or has_function_privilege('anon','public.tool_solid_revolution_scene_is_valid(jsonb)','execute')
    or has_function_privilege('service_role','public.tool_solid_revolution_scene_is_valid(jsonb)','execute') then raise exception 'REVOLUTION_VALIDATOR_EXPOSED'; end if;
end;
$revolution$;
rollback;
