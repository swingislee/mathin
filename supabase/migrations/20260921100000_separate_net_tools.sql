-- 展开图入口独立；旧 v1/v2 场景继续按原合同读取，不重写既有记录。
begin;

create function public.tool_cube_net_exploration_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  if not coalesce(s->>'toolId'='spatial-lab' and s->>'contentVersion'='cube-net-lesson-v3'
    and s#>>'{payload,initial,mode}' in ('standard','free-paper'),false) then return false; end if;
  return public.tool_net_teaching_scene_is_valid(jsonb_set(s,'{contentVersion}','"cube-net-lesson-v2"'));
exception when others then return false; end;
$$;

create function public.tool_solid_nets_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare d jsonb := s#>'{payload,initial}'; legacy jsonb; face_ids text[]; hinge_ids text[];
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or not coalesce(s->>'toolId'='solid-nets' and s->>'contentVersion'='solid-nets-lesson-v1'
      and d->>'version'='solid-nets-v2' and d->>'kind' in ('cube','cuboid','triangular-prism'),false) then return false; end if;
  if d->>'kind'='cube' and not coalesce(d#>'{dimensions,width}'=d#>'{dimensions,height}'
    and d#>'{dimensions,width}'=d#>'{dimensions,depth}',false) then return false; end if;
  face_ids := array['base','left','right','front','back'];
  hinge_ids := array['base-left','base-right','base-front','base-back'];
  if d->>'kind'<>'triangular-prism' then face_ids := face_ids||array['top']; hinge_ids := hinge_ids||array['front-top']; end if;
  if not public.tool_space_keys(d->'surfaces',face_ids,face_ids)
    or not public.tool_space_keys(d->'angles',hinge_ids,hinge_ids)
    or (d->'anchor'<>'null'::jsonb and not coalesce(d#>>'{anchor,faceId}'=any(face_ids),false)) then return false; end if;
  if d->>'kind'<>'triangular-prism' and exists(select 1 from jsonb_each(d->'angles') a where not public.tool_space_number(a.value,-90,90)) then return false; end if;
  legacy := jsonb_set(d,'{version}','"solid-nets-v1"');
  if d->>'kind'='cube' then legacy := jsonb_set(legacy,'{kind}','"cuboid"'); end if;
  -- 矩形面、棱与尺寸沿用旧长方体数学合同，正方体额外约束三边相等。
  return public.tool_net_teaching_scene_is_valid(jsonb_build_object('toolId','spatial-lab','contentVersion','cube-net-lesson-v2',
    'payload',jsonb_build_object('title',s#>'{payload,title}','initial',jsonb_build_object('mode','solid-net','data',legacy))));
exception when others then return false; end;
$$;

create or replace function public.tool_scene_is_valid(p_scene jsonb)
returns boolean language sql immutable set search_path = pg_catalog,public as $$
  select coalesce(
    (p_scene->>'contentVersion'='cube-structures-lesson-v2' and public.cw_cube_structures_tool_is_valid(p_scene))
    or public.cw_spatial_teaching_tool_is_valid(p_scene) or public.tool_numeric_scene_is_valid(p_scene)
    or public.tool_projection_scene_is_valid(p_scene) or public.tool_cube_rotation_scene_is_valid(p_scene)
    or public.tool_net_teaching_scene_is_valid(p_scene) or public.tool_solid_geometry_scene_is_valid(p_scene)
    or public.tool_solid_capacity_scene_is_valid(p_scene) or public.tool_soma_scene_is_valid(p_scene)
    or public.tool_soma_free_scene_is_valid(p_scene) or public.tool_cube_net_exploration_scene_is_valid(p_scene)
    or public.tool_solid_nets_scene_is_valid(p_scene),false) and octet_length(p_scene::text)<=750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog,public as $$
  select case p_scene->>'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures' when 'cube-structures-lesson-v3' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'cube-net-lesson-v2' then 'cube-net' when 'cube-net-lesson-v3' then 'cube-net'
    when 'solid-nets-lesson-v1' then 'solid-nets' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' when 'solid-geometry-lesson-v1' then 'solid-geometry'
    when 'solid-capacity-lesson-v1' then 'solid-capacity' when 'soma-cube-lesson-v1' then 'soma-cube'
    when 'soma-cube-lesson-v2' then 'soma-cube' else null end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check
  check (catalog_id in ('cube-structures','cube-net','solid-nets','dice','fraction-line','motion-lab','projection','solid-geometry','solid-capacity','soma-cube'));
revoke all on function public.tool_cube_net_exploration_scene_is_valid(jsonb),public.tool_solid_nets_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
