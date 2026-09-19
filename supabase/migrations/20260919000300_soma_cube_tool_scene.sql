-- 索玛七宝使用 Tools 共用场景库；实体形状由版本化定义生成。
begin;

create function public.tool_soma_cells(piece_id text, orientation integer)
returns table(x integer,y integer,z integer) language sql immutable set search_path = pg_catalog as $$
  with definitions as (
    select '{"bao-1":[[0,1,0],[0,0,0],[0,0,1]],"bao-2":[[0,0,2],[0,1,0],[0,0,0],[0,0,1]],"bao-3":[[0,0,2],[0,1,1],[0,0,0],[0,0,1]],"bao-4":[[0,0,2],[0,1,1],[0,1,0],[0,0,1]],"bao-5":[[1,0,0],[0,1,1],[0,0,0],[0,0,1]],"bao-6":[[1,0,1],[0,1,0],[0,0,0],[0,0,1]],"bao-7":[[1,0,0],[0,1,0],[0,0,0],[0,0,1]]}'::jsonb->piece_id as cells,
      '[[[1,0,0],[0,1,0],[0,0,1]],[[1,0,0],[0,0,1],[0,-1,0]],[[0,0,-1],[0,1,0],[1,0,0]],[[0,1,0],[-1,0,0],[0,0,1]],[[1,0,0],[0,-1,0],[0,0,-1]],[[0,0,-1],[1,0,0],[0,-1,0]],[[0,1,0],[0,0,1],[1,0,0]],[[-1,0,0],[0,1,0],[0,0,-1]],[[0,0,-1],[-1,0,0],[0,1,0]],[[0,0,1],[-1,0,0],[0,-1,0]],[[-1,0,0],[0,-1,0],[0,0,1]],[[1,0,0],[0,0,-1],[0,1,0]],[[0,0,-1],[0,-1,0],[-1,0,0]],[[0,1,0],[1,0,0],[0,0,-1]],[[-1,0,0],[0,0,-1],[0,-1,0]],[[0,0,1],[0,-1,0],[1,0,0]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,0,1],[0,1,0],[-1,0,0]],[[0,-1,0],[-1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,1,0],[0,0,-1],[-1,0,0]],[[0,0,1],[1,0,0],[0,1,0]],[[0,-1,0],[0,0,-1],[1,0,0]],[[0,-1,0],[0,0,1],[-1,0,0]]]'::jsonb->orientation as m
  ), rotated as (
    select (c->>0)::integer*(m#>>'{0,0}')::integer+(c->>1)::integer*(m#>>'{1,0}')::integer+(c->>2)::integer*(m#>>'{2,0}')::integer as x,
      (c->>0)::integer*(m#>>'{0,1}')::integer+(c->>1)::integer*(m#>>'{1,1}')::integer+(c->>2)::integer*(m#>>'{2,1}')::integer as y,
      (c->>0)::integer*(m#>>'{0,2}')::integer+(c->>1)::integer*(m#>>'{1,2}')::integer+(c->>2)::integer*(m#>>'{2,2}')::integer as z
    from definitions cross join lateral jsonb_array_elements(cells) c
  ) select x-min(x) over(), y-min(y) over(), z-min(z) over() from rotated;
$$;

create function public.tool_soma_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; piece jsonb; key text; cell record;
  ids text[] := '{}'; occupied text[] := '{}'; cx integer; cy integer; cz integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not coalesce(s->>'toolId'='soma-cube' and s->>'contentVersion'='soma-cube-lesson-v1',false)
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['pieces','selectedId','mode','view','grid','axes','labels','frame','cameraRevision'],array['pieces','selectedId','mode','view','grid','axes','labels','frame','cameraRevision'])
    or not coalesce(i->>'mode' in ('observe','assemble') and i->>'view' in ('angle','front','left','right','top'),false)
    or jsonb_typeof(i->'pieces')<>'array' or jsonb_array_length(i->'pieces') not between 1 and 7
    or not public.tool_space_number(i->'cameraRevision',0,1000000,true)
    or not public.tool_space_keys(i->'frame',array['center','radius'],array['center','radius'])
    or not public.tool_space_vector(i#>'{frame,center}',12) or not public.tool_space_number(i#>'{frame,center,y}',0,12)
    or not public.tool_space_number(i#>'{frame,radius}',2.5,30) then return false; end if;
  foreach key in array array['grid','axes','labels'] loop
    if jsonb_typeof(i->key)<>'boolean' then return false; end if;
  end loop;
  for piece in select value from jsonb_array_elements(i->'pieces') loop
    if not public.tool_space_keys(piece,array['id','position','orientation'],array['id','position','orientation'])
      or not coalesce(piece->>'id' in ('bao-1','bao-2','bao-3','bao-4','bao-5','bao-6','bao-7'),false)
      or piece->>'id'=any(ids) or not public.tool_space_number(piece->'orientation',0,23,true)
      or not public.tool_space_keys(piece->'position',array['x','y','z'],array['x','y','z'])
      or not public.tool_space_number(piece#>'{position,x}',-12,12,true)
      or not public.tool_space_number(piece#>'{position,y}',0,12,true)
      or not public.tool_space_number(piece#>'{position,z}',-12,12,true) then return false; end if;
    ids := array_append(ids,piece->>'id');
    for cell in select * from public.tool_soma_cells(piece->>'id',(piece->>'orientation')::integer) loop
      cx := cell.x+(piece#>>'{position,x}')::integer;
      cy := cell.y+(piece#>>'{position,y}')::integer;
      cz := cell.z+(piece#>>'{position,z}')::integer;
      key := cx||','||cy||','||cz;
      if abs(cx)>12 or cy<0 or cy>12 or abs(cz)>12 or key=any(occupied) then return false; end if;
      occupied := array_append(occupied,key);
    end loop;
  end loop;
  return coalesce(i->>'selectedId'=any(ids),false);
exception when others then return false; end;
$$;

create or replace function public.tool_scene_is_valid(p_scene jsonb)
returns boolean language sql immutable set search_path = pg_catalog,public as $$
  select coalesce(
    (p_scene->>'contentVersion'='cube-structures-lesson-v2' and public.cw_cube_structures_tool_is_valid(p_scene))
    or public.cw_spatial_teaching_tool_is_valid(p_scene) or public.tool_numeric_scene_is_valid(p_scene)
    or public.tool_projection_scene_is_valid(p_scene) or public.tool_cube_rotation_scene_is_valid(p_scene)
    or public.tool_net_teaching_scene_is_valid(p_scene) or public.tool_solid_geometry_scene_is_valid(p_scene)
    or public.tool_solid_capacity_scene_is_valid(p_scene) or public.tool_soma_scene_is_valid(p_scene),false)
    and octet_length(p_scene::text)<=750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog,public as $$
  select case p_scene->>'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures' when 'cube-structures-lesson-v3' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'cube-net-lesson-v2' then 'cube-net' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' when 'solid-geometry-lesson-v1' then 'solid-geometry'
    when 'solid-capacity-lesson-v1' then 'solid-capacity' when 'soma-cube-lesson-v1' then 'soma-cube' else null end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check
  check (catalog_id in ('cube-structures','cube-net','dice','fraction-line','motion-lab','projection','solid-geometry','solid-capacity','soma-cube'));
revoke all on function public.tool_soma_cells(text,integer),public.tool_soma_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
