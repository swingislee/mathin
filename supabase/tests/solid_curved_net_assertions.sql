begin;
do $$
declare base jsonb := '{"toolId":"solid-nets","contentVersion":"solid-nets-lesson-v3","payload":{"title":"Curved net","initial":{"mode":"curved","data":{"version":"curved-net-v1","kind":"cylinder","radius":1,"height":2.5,"progress":{"side":0,"lower":0,"upper":0},"surfaces":{"side":{"color":"#e7e0d0","opacity":0.9},"lower":{"color":"#df8a84","opacity":0.9},"upper":{"color":"#edce79","opacity":0.9}},"labelsVisible":true,"view":"angle","motion":null}}}}'::jsonb;
  pyramid jsonb := '{"version":"solid-nets-v3","kind":"square-pyramid","dimensions":{"width":3,"height":2,"depth":3},"angles":{"base-left":0,"base-right":0,"base-front":0,"base-back":0},"surfaces":{"base":{"color":"#8fbf88","label":"A","opacity":0.9},"left":{"color":"#df8a84","label":"B","opacity":0.9},"right":{"color":"#edce79","label":"C","opacity":0.9},"front":{"color":"#7da9ce","label":"D","opacity":0.9},"back":{"color":"#b39dcc","label":"E","opacity":0.9}},"anchor":null,"view":"angle","labelsVisible":true}'::jsonb;
  sample jsonb; p numeric;
begin
  foreach p in array array[0,0.25,0.5,1]::numeric[] loop
    sample := jsonb_set(base,'{payload,initial,data,progress}',jsonb_build_object('side',p,'lower',p,'upper',p));
    if public.tool_solid_nets_complete_scene_is_valid(sample) is not true then raise exception 'CYLINDER_STATE_REJECTED'; end if;
    sample := jsonb_set(jsonb_set(sample,'{payload,initial,data,kind}','"cone"'),'{payload,initial,data,progress,upper}','0');
    if public.tool_solid_nets_complete_scene_is_valid(sample) is not true then raise exception 'CONE_STATE_REJECTED'; end if;
  end loop;
  sample := jsonb_set(base,'{payload,initial}',jsonb_build_object('mode','polyhedron','data',pyramid));
  if public.tool_solid_nets_complete_scene_is_valid(sample) is not true then raise exception 'POLYHEDRON_PROXY_REJECTED'; end if;
  foreach sample in array array[
    base-'toolId', base||'{"draftId":"private"}', jsonb_set(base,'{toolId}','"spatial-lab"'),
    jsonb_set(base,'{payload,title}','null'), jsonb_set(base,'{payload,initial,mode}','"paper"'),
    jsonb_set(base,'{payload,initial,data,radius}','0.1'), jsonb_set(base,'{payload,initial,data,height}','9'),
    jsonb_set(base,'{payload,initial,data,progress,side}','1.1'), jsonb_set(base,'{payload,initial,data,surfaces,side,opacity}','-0.1'),
    jsonb_set(base,'{payload,initial,data,surfaces,side,color}','"#ffffff"'), jsonb_set(base,'{payload,initial,data,view}','"bottom"'),
    jsonb_set(base,'{payload,initial,data,motion}','{}'), jsonb_set(base,'{payload,initial,data,progress,extra}','0'),
    base#-'{payload,initial,data,motion}', jsonb_set(base,'{payload,initial,data,labelsVisible}','"true"'),
    jsonb_set(jsonb_set(base,'{payload,initial,data,kind}','"cone"'),'{payload,initial,data,progress,upper}','0.1')
  ] loop if public.tool_solid_nets_complete_scene_is_valid(sample) is not false then raise exception 'INVALID_CURVED_NET_ACCEPTED: %',sample; end if; end loop;
end $$;
rollback;
