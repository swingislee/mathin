-- 正四棱锥沿用 Tools 场景和课堂入口；旧展开图版本保持原语义。
begin;

create function public.tool_solid_nets_polyhedra_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare d jsonb := s#>'{payload,initial}'; legacy jsonb; kind text := d->>'kind'; w double precision; h double precision; depth_value double precision;
  a record; limit_angle double precision; face text; points jsonb; expected double precision[]; actual double precision;
  i integer; j integer; pair_index integer := 0; side_squared double precision;
begin
  if not coalesce(s->>'toolId'='solid-nets' and s->>'contentVersion'='solid-nets-lesson-v2'
    and d->>'version'='solid-nets-v3' and kind in ('cube','cuboid','triangular-prism','square-pyramid'),false) then return false; end if;
  legacy := jsonb_set(jsonb_set(s,'{contentVersion}','"solid-nets-lesson-v1"'),'{payload,initial,version}','"solid-nets-v2"');
  -- 复用已有严格字段、尺寸、面样式、视角和五面／六面拓扑校验；新锥体的数学约束在下方计算。
  if kind='square-pyramid' then legacy := jsonb_set(legacy,'{payload,initial,kind}','"triangular-prism"'); end if;
  if public.tool_solid_nets_scene_is_valid(legacy) is not true then return false; end if;
  w := (d#>>'{dimensions,width}')::double precision; h := (d#>>'{dimensions,height}')::double precision;
  depth_value := (d#>>'{dimensions,depth}')::double precision;
  if kind='square-pyramid' and w<>depth_value then return false; end if;
  for a in select key,value from jsonb_each(d->'angles') loop
    limit_angle := case when kind='square-pyramid' or (kind='triangular-prism' and a.key in ('base-left','base-right'))
      then 90+degrees(atan2(w/2,h)) else 90 end;
    if abs((a.value::text)::double precision)>limit_angle+1e-7 then return false; end if;
  end loop;
  if d->'anchor'<>'null'::jsonb then
    face := d#>>'{anchor,faceId}'; points := d#>'{anchor,vertices}';
    -- 对应各面前三个顶点的三条距离；锚点只允许刚体位置变化，不接受拉伸纸片。
    if kind='square-pyramid' and face<>'base' then
      side_squared := w*w/2+h*h; expected := array[side_squared,w*w,side_squared];
    elsif kind='triangular-prism' and face in ('front','back') then
      side_squared := w*w/4+h*h;
      expected := case when face='front' then array[side_squared,w*w,side_squared] else array[w*w,side_squared,side_squared] end;
    elsif face in ('base','top') then expected := array[depth_value*depth_value,w*w+depth_value*depth_value,w*w];
    elsif face in ('left','right') then
      side_squared := case when kind='triangular-prism' then w*w/4+h*h else h*h end;
      expected := array[depth_value*depth_value,side_squared+depth_value*depth_value,side_squared];
    else expected := array[h*h,w*w+h*h,w*w]; end if;
    for i in 0..1 loop
      for j in (i+1)..2 loop
        pair_index := pair_index+1;
        actual := power((points->i->>'x')::double precision-(points->j->>'x')::double precision,2)
          +power((points->i->>'y')::double precision-(points->j->>'y')::double precision,2)
          +power((points->i->>'z')::double precision-(points->j->>'z')::double precision,2);
        if abs(actual-expected[pair_index])>greatest(1,expected[pair_index])*1e-6 then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
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
    or public.tool_solid_nets_scene_is_valid(p_scene) or public.tool_solid_nets_polyhedra_scene_is_valid(p_scene),false)
    and octet_length(p_scene::text)<=750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog,public as $$
  select case p_scene->>'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures' when 'cube-structures-lesson-v3' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'cube-net-lesson-v2' then 'cube-net' when 'cube-net-lesson-v3' then 'cube-net'
    when 'solid-nets-lesson-v1' then 'solid-nets' when 'solid-nets-lesson-v2' then 'solid-nets' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' when 'solid-geometry-lesson-v1' then 'solid-geometry'
    when 'solid-capacity-lesson-v1' then 'solid-capacity' when 'soma-cube-lesson-v1' then 'soma-cube'
    when 'soma-cube-lesson-v2' then 'soma-cube' else null end;
$$;
revoke all on function public.tool_solid_nets_polyhedra_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
