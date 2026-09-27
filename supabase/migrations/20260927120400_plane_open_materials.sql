-- 五个开放材料教具仅追加版本，已保存／冻结的旧场景仍走原校验链。
begin;
create function public.tool_plane_open_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare state jsonb:=s#>'{payload,initial}'; valid boolean:=false;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string'
    or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or octet_length(s::text)>150000
    or s->>'contentVersion' is distinct from (s->>'toolId')||'-lesson-v2' then return false; end if;
  case s->>'toolId'
    when 'plane-area' then valid:=public.tool_plane_paper_state_is_valid(state);
    when 'plane-folding' then valid:=public.tool_plane_paper_folding_state_is_valid(state);
    when 'plane-tiling' then valid:=public.tool_plane_tiling_state_is_valid(state);
    when 'plane-patterns' then valid:=state->>'sceneId'='47-create' and public.tool_plane_network_state_is_valid(state);
    when 'plane-graph-path' then valid:=state->>'sceneId'='52-create' and public.tool_plane_network_state_is_valid(state);
    else return false;
  end case;
  return coalesce(valid,false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_open_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

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
    or public.tool_plane_material_scene_is_valid(p_scene) or public.tool_plane_construction_scene_is_valid(p_scene)
    or public.tool_plane_open_scene_is_valid(p_scene),false) and octet_length(p_scene::text)<=750000;
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
    when 'plane-shapes-lesson-v2' then 'plane-shapes' when 'plane-motion-lesson-v2' then 'plane-motion'
    when 'plane-area-lesson-v2' then 'plane-area' when 'plane-folding-lesson-v2' then 'plane-folding'
    when 'plane-tiling-lesson-v2' then 'plane-tiling' when 'plane-patterns-lesson-v2' then 'plane-patterns'
    when 'plane-graph-path-lesson-v2' then 'plane-graph-path'
    else case when p_scene->>'contentVersion'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')||'-lesson-v1'
      and p_scene->>'toolId'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')
      then public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}') else null end end;
$$;
notify pgrst, 'reload schema';
commit;

