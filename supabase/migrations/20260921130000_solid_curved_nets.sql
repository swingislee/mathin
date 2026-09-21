-- 立体展开图 v3：多面体沿用原数学边界，圆柱/圆锥保存稳定的曲面展开参数。
begin;
create function public.tool_solid_nets_complete_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; d jsonb := i->'data'; p jsonb; surface_value jsonb; part text; legacy jsonb;
begin
  if not coalesce(public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and s->>'toolId'='solid-nets' and s->>'contentVersion'='solid-nets-lesson-v3'
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and public.tool_space_keys(i,array['mode','data'],array['mode','data']) and i->>'mode' in ('polyhedron','curved'),false) then return false; end if;
  if i->>'mode'='polyhedron' then
    legacy := jsonb_build_object('toolId','solid-nets','contentVersion','solid-nets-lesson-v2','payload',jsonb_build_object('title',s#>'{payload,title}','initial',d));
    return public.tool_solid_nets_polyhedra_scene_is_valid(legacy) is true;
  end if;
  if not coalesce(public.tool_space_keys(d,array['version','kind','radius','height','progress','surfaces','labelsVisible','view','motion'],array['version','kind','radius','height','progress','surfaces','labelsVisible','view','motion'])
    and d->>'version'='curved-net-v1' and d->>'kind' in ('cylinder','cone')
    and public.tool_space_number(d->'radius',0.25,4) and public.tool_space_number(d->'height',0.25,8)
    and jsonb_typeof(d->'labelsVisible')='boolean' and d->>'view' in ('angle','front','left','right','top')
    and d->'motion'='null'::jsonb
    and public.tool_space_keys(d->'surfaces',array['side','lower','upper'],array['side','lower','upper'])
    and public.tool_space_keys(d->'progress',array['side','lower','upper'],array['side','lower','upper']),false) then return false; end if;
  p := d->'progress';
  foreach part in array array['side','lower','upper'] loop
    surface_value := d->'surfaces'->part;
    if not coalesce(public.tool_space_number(p->part,0,1)
      and public.tool_space_keys(surface_value,array['color','opacity'],array['color','opacity'])
      and surface_value->>'color' in ('#8fbf88','#df8a84','#edce79','#7da9ce','#b39dcc','#e7e0d0')
      and public.tool_space_number(surface_value->'opacity',0,1),false) then return false; end if;
  end loop;
  return d->>'kind'<>'cone' or p->'upper'='0'::jsonb;
exception when others then return false; end;
$$;
revoke all on function public.tool_solid_nets_complete_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
