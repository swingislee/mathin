-- 数位积木复用个人场景与课件快照；只扩展版本校验，不改变既有权限和旧版本语义。
begin;
create function public.tool_place_value_board_is_valid(b jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare units jsonb; rod jsonb; chain jsonb; unit jsonb; sequence_id bigint; seen bigint[] := array[]::bigint[];
begin
  if not public.tool_space_keys(b,array['ones','tens','hundreds','nextId'],array['ones','tens','hundreds','nextId'])
    or not public.tool_space_number(b->'nextId',0,1000000,true)
    or jsonb_typeof(b->'ones')<>'array' or jsonb_array_length(b->'ones')>999
    or jsonb_typeof(b->'tens')<>'array' or jsonb_array_length(b->'tens')>99
    or jsonb_typeof(b->'hundreds')<>'array' or jsonb_array_length(b->'hundreds')>9 then return false; end if;
  units := b->'ones';
  for rod in select value from jsonb_array_elements(b->'tens') loop
    if jsonb_typeof(rod)<>'array' or jsonb_array_length(rod)<>10 then return false; end if;
    units := units || rod;
  end loop;
  for chain in select value from jsonb_array_elements(b->'hundreds') loop
    if jsonb_typeof(chain)<>'array' or jsonb_array_length(chain)<>10 then return false; end if;
    for rod in select value from jsonb_array_elements(chain) loop
      if jsonb_typeof(rod)<>'array' or jsonb_array_length(rod)<>10 then return false; end if;
      units := units || rod;
    end loop;
  end loop;
  if jsonb_array_length(units)>999 then return false; end if;
  for unit in select value from jsonb_array_elements(units) loop
    if not public.tool_space_number(unit,0,1999999,true) then return false; end if;
    sequence_id := (unit::text)::bigint / 2;
    if sequence_id >= (b->>'nextId')::bigint or sequence_id=any(seen) then return false; end if;
    seen := array_append(seen,sequence_id);
  end loop;
  return true;
exception when others then return false; end;
$$;
create function public.tool_place_value_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; key text; selected jsonb; b jsonb; rod jsonb; chain jsonb; found boolean := false;
begin
  if not coalesce(s->>'toolId'='place-value' and s->>'contentVersion'='place-value-lesson-v1'
    and i->>'mode' in ('single','compare') and i->>'active' in ('left','right')
    and i->>'highlight' in ('all','hundreds','tens','ones') and i->>'comparison' in ('hidden','<','=','>')
    and i->>'speed' in ('slow','normal','fast') and i->>'view' in ('angle','front','left','right','top'),false) then return false; end if;
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['mode','left','right','active','selection','highlight','comparison','autoCarry','speed','showDigits','showLabels','grid','axes','view','frame'],
      array['mode','left','right','active','selection','highlight','comparison','autoCarry','speed','showDigits','showLabels','grid','axes','view','frame'])
    or not public.tool_place_value_board_is_valid(i->'left') or not public.tool_place_value_board_is_valid(i->'right')
    or not public.tool_space_keys(i->'frame',array['center','radius'],array['center','radius'])
    or not public.tool_space_vector(i#>'{frame,center}',2000)
    or not public.tool_space_number(i#>'{frame,radius}',1,1500) then return false; end if;
  foreach key in array array['autoCarry','showDigits','showLabels','grid','axes'] loop
    if jsonb_typeof(i->key)<>'boolean' then return false; end if;
  end loop;
  selected := i->'selection';
  if selected<>'null'::jsonb then
    if not public.tool_space_keys(selected,array['side','unit'],array['side','unit'])
      or not coalesce(selected->>'side' in ('left','right'),false)
      or not public.tool_space_number(selected->'unit',0,1999999,true) then return false; end if;
    b := i->(selected->>'side');
    found := b->'ones' @> jsonb_build_array(selected->'unit');
    for rod in select value from jsonb_array_elements(b->'tens') loop
      found := found or rod @> jsonb_build_array(selected->'unit');
    end loop;
    for chain in select value from jsonb_array_elements(b->'hundreds') loop
      for rod in select value from jsonb_array_elements(chain) loop
        found := found or rod @> jsonb_build_array(selected->'unit');
      end loop;
    end loop;
    if not found then return false; end if;
  end if;
  return true;
exception when others then return false; end;
$$;
revoke all on function public.tool_place_value_board_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_place_value_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

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
    or public.tool_place_value_scene_is_valid(p_scene),false)
    and octet_length(p_scene::text)<=750000;
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
    when 'place-value-lesson-v1' then 'place-value' else null end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check
  check (catalog_id in ('cube-structures','cube-net','solid-nets','dice','fraction-line','motion-lab','projection','solid-geometry','solid-capacity','solid-revolution','soma-cube','place-value'));
notify pgrst, 'reload schema';
commit;
