-- 基本图形认识与七巧板按教学用途拆分；旧 plane-pieces 固定副本继续按原版本读取。
begin;

create function public.tool_plane_shapes_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; n integer; i integer; kind integer;
  keys text[]:=array['count','active']; point_keys text[]:=array[]::text[]; mark jsonb; parts text[]; sides integer;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or s->>'sceneId' is distinct from '01-basic' or not public.tool_space_number(s->'phase',0,0)
    or not public.tool_space_number(p->'count',0,8,true) then return false; end if;
  n:=(p->>'count')::integer;
  if not public.tool_space_number(p->'active',case when n=0 then -1 else 0 end,n-1,true) then return false; end if;
  for i in 0..n-1 loop
    keys:=keys||array['kind'||i,'scale'||i,'angle'||i,'detail'||i];
    point_keys:=array_append(point_keys,'object'||i);
    if not public.tool_space_number(p->('kind'||i),0,11,true)
      or not public.tool_space_number(p->('scale'||i),0.5,2)
      or not public.tool_space_number(p->('angle'||i),-36000,36000)
      or not public.tool_planar_point(q->('object'||i),60,900,60,660) then return false; end if;
    kind:=(p->>('kind'||i))::integer;
    if not public.tool_space_number(p->('detail'||i),0,case when kind<7 then 0 else 1 end) then return false; end if;
  end loop;
  if not public.tool_space_keys(p,keys,keys) or not public.tool_space_keys(q,point_keys,point_keys)
    or not public.tool_space_keys(f,array['grid','measures','edges','vertices','names'],array['grid','measures','edges','vertices','names'])
    or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean')
    or jsonb_typeof(s->'marks') is distinct from 'array' or jsonb_array_length(s->'marks')>64
    or (select count(distinct value) from jsonb_array_elements(s->'marks'))<>jsonb_array_length(s->'marks') then return false; end if;
  for mark in select value from jsonb_array_elements(s->'marks') loop
    if jsonb_typeof(mark)<>'string' or (mark#>>'{}')!~'^(boundary\.[0-7]|(edge|vertex)\.[0-7]\.[0-3])$' then return false; end if;
    parts:=string_to_array(mark#>>'{}','.'); i:=parts[2]::integer;
    if i>=n then return false; end if;
    kind:=(p->>('kind'||i))::integer;
    sides:=case when kind in (0,7) then 3 when kind in (5,6,10,11) then 0 else 4 end;
    if (parts[1]='boundary' and sides<>0) or (parts[1]<>'boundary' and parts[3]::integer>=sides) then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_material_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  if s->>'toolId'='plane-tangram' and s->>'contentVersion'='plane-tangram-lesson-v1'
    and s#>>'{payload,initial,sceneId}'='02' then
    -- 仅复用七巧板的数学合同，保留旧场景与新版入口的独立身份。
    return public.tool_planar_scene_is_valid(jsonb_set(jsonb_set(s,'{toolId}','"plane-pieces"'),'{contentVersion}','"plane-pieces-lesson-v1"'));
  end if;
  return coalesce(s->>'toolId'='plane-shapes' and s->>'contentVersion'='plane-shapes-lesson-v1'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_shapes_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_shapes_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_material_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

create or replace function public.tool_scene_is_valid(p_scene jsonb)
returns boolean language sql immutable set search_path = pg_catalog,public as $$
  select coalesce(
    (p_scene->>'contentVersion'='cube-structures-lesson-v2' and public.cw_cube_structures_tool_is_valid(p_scene))
    or public.cw_spatial_teaching_tool_is_valid(p_scene) or public.tool_numeric_scene_is_valid(p_scene)
    or public.tool_projection_scene_is_valid(p_scene) or public.tool_cube_rotation_scene_is_valid(p_scene)
    or public.tool_net_teaching_scene_is_valid(p_scene) or public.tool_solid_geometry_scene_is_valid(p_scene)
    or public.tool_solid_capacity_scene_is_valid(p_scene) or public.tool_soma_scene_is_valid(p_scene)
    or public.tool_soma_free_scene_is_valid(p_scene) or public.tool_cube_net_exploration_scene_is_valid(p_scene)
    or public.tool_solid_nets_scene_is_valid(p_scene) or public.tool_solid_nets_polyhedra_scene_is_valid(p_scene)
    or public.tool_solid_nets_complete_scene_is_valid(p_scene) or public.tool_solid_capacity_teaching_scene_is_valid(p_scene)
    or public.tool_solid_geometry_exploration_scene_is_valid(p_scene) or public.tool_solid_revolution_scene_is_valid(p_scene)
    or public.tool_place_value_scene_is_valid(p_scene) or public.tool_planar_scene_is_valid(p_scene)
    or public.tool_plane_material_scene_is_valid(p_scene),false) and octet_length(p_scene::text)<=750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog,public as $$
  select case p_scene->>'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures' when 'cube-structures-lesson-v3' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'cube-net-lesson-v2' then 'cube-net' when 'cube-net-lesson-v3' then 'cube-net'
    when 'solid-nets-lesson-v1' then 'solid-nets' when 'solid-nets-lesson-v2' then 'solid-nets' when 'solid-nets-lesson-v3' then 'solid-nets'
    when 'dice-lesson-v1' then 'dice' when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' when 'solid-geometry-lesson-v1' then 'solid-geometry' when 'solid-geometry-lesson-v2' then 'solid-geometry'
    when 'solid-capacity-lesson-v1' then 'solid-capacity' when 'solid-capacity-lesson-v2' then 'solid-capacity'
    when 'solid-revolution-lesson-v1' then 'solid-revolution' when 'soma-cube-lesson-v1' then 'soma-cube' when 'soma-cube-lesson-v2' then 'soma-cube'
    when 'place-value-lesson-v1' then 'place-value'
    when 'plane-shapes-lesson-v1' then 'plane-shapes' when 'plane-tangram-lesson-v1' then 'plane-tangram'
    else case when p_scene->>'contentVersion'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')||'-lesson-v1'
      and p_scene->>'toolId'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')
      then public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}') else null end end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check check (catalog_id in (
  'cube-structures','cube-net','solid-nets','dice','fraction-line','motion-lab','projection','solid-geometry','solid-capacity','solid-revolution','soma-cube','place-value',
  'plane-pieces','plane-shapes','plane-tangram','plane-geometry','plane-polygons','plane-perimeter','plane-measurement','plane-geoboard',
  'plane-area','plane-area-relations','plane-circle-area','plane-overlap','plane-motion','plane-folding','plane-tiling',
  'plane-patterns','plane-matchsticks','plane-graph-path','plane-grid-path','plane-reflection-path','plane-covering','plane-rolling','plane-clock'
));
notify pgrst, 'reload schema';
commit;
