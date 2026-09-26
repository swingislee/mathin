-- 图形认识与图形运动 v2 共用可构造材料；旧 v1 校验链与教师已存场景保持原样。
-- 仅追加严格数学合同，不改写草稿、冻结课件、目录约束、RLS 或保存 RPC。
begin;

create function public.tool_plane_construction_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags';
  ids integer[]; object_id integer; next_id integer; active_id integer; kind integer; n integer; life integer; total_vertices integer:=0;
  parameter_keys text[]:=array['nextId','active','dx','dy','turn','axisAngle']; point_keys text[]:=array['pivot','axis'];
  flag_keys text[]:=array['grid','measures','edges','vertices','names','counts','ghost','edit','snap'];
  prefix text; vertices jsonb; a jsonb; b jsonb; c jsonb; d jsonb; mark jsonb; parts text[];
  i integer; j integer; area_sum double precision; ax double precision; ay double precision; bx double precision; by_ double precision;
  cx double precision; cy double precision; dx_ double precision; dy_ double precision; abx double precision; aby double precision;
  bcx double precision; bcy double precision; first double precision; second double precision; third double precision; fourth double precision;
  eps constant double precision:=1e-7;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or (s->>'sceneId' is distinct from '01-create' and s->>'sceneId' is distinct from '20-create') or not public.tool_space_number(s->'phase',0,0)
    or not public.tool_space_number(p->'nextId',1,99999,true) or not public.tool_space_number(p->'active',-1,99998,true)
    or not public.tool_space_number(p->'dx',-600,600) or not public.tool_space_number(p->'dy',-600,600)
    or not public.tool_space_number(p->'turn',-360,360) or not public.tool_space_number(p->'axisAngle',-180,180)
    or not public.tool_planar_point(q->'pivot',-1000,2000,-1000,1720) or not public.tool_planar_point(q->'axis',-1000,2000,-1000,1720)
    then return false; end if;
  next_id:=(p->>'nextId')::numeric::integer; active_id:=(p->>'active')::numeric::integer;
  select coalesce(array_agg(substring(key from 6)::integer order by substring(key from 6)::integer),array[]::integer[])
    into ids from jsonb_object_keys(p) as object_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  if cardinality(ids)>16 or exists(select 1 from unnest(ids) as object_ids(id) where id>=next_id or id>99998)
    or (active_id<>-1 and not active_id=any(ids)) then return false; end if;
  foreach object_id in array ids loop
    foreach prefix in array array['kind','count','angle','rx','ry','life','detail','flip'] loop parameter_keys:=array_append(parameter_keys,prefix||'.'||object_id); end loop;
    point_keys:=array_append(point_keys,'center.'||object_id);
    if not public.tool_space_number(p->('kind.'||object_id),0,3,true)
      or not public.tool_space_number(p->('count.'||object_id),0,32,true)
      or not public.tool_space_number(p->('angle.'||object_id),-36000,36000)
      or not public.tool_space_number(p->('life.'||object_id),0,5,true)
      or not public.tool_space_number(p->('detail.'||object_id),0,1)
      or not public.tool_space_number(p->('flip.'||object_id),-1,1,true)
      or (p->>('flip.'||object_id))::numeric not in (-1,1)
      or not public.tool_planar_point(q->('center.'||object_id),-1000,2000,-1000,1720)
      then return false; end if;
    kind:=(p->>('kind.'||object_id))::numeric::integer; n:=(p->>('count.'||object_id))::numeric::integer; life:=(p->>('life.'||object_id))::numeric::integer;
    if (life=0 and (p->>('detail.'||object_id))::numeric<>0)
      or (life=1 and (kind<>0 or n<>3)) or (life in (2,3) and kind<>1) or (life=4 and kind<>2) or (life=5 and kind<>3)
      then return false; end if;
    total_vertices:=total_vertices+n;
    if total_vertices>192 then return false; end if;
    if kind>=2 then
      if n<>0 or not public.tool_space_number(p->('rx.'||object_id),6,350) or not public.tool_space_number(p->('ry.'||object_id),6,350)
        or (kind=2 and (p->>('rx.'||object_id))::double precision<>(p->>('ry.'||object_id))::double precision) then return false; end if;
      continue;
    end if;
    if n<3 or (kind=1 and n<>4) or not public.tool_space_number(p->('rx.'||object_id),0,0)
      or not public.tool_space_number(p->('ry.'||object_id),0,0) then return false; end if;
    vertices:='[]';
    for i in 0..n-1 loop
      prefix:='vertex.'||object_id||'.'||i; point_keys:=array_append(point_keys,prefix);
      if not public.tool_planar_point(q->prefix,-800,800,-800,800) then return false; end if;
      vertices:=vertices||jsonb_build_array(q->prefix);
    end loop;
    area_sum:=0;
    for i in 0..n-1 loop
      a:=vertices->i; b:=vertices->((i+1)%n); c:=vertices->((i+2)%n);
      ax:=(a->>'x')::double precision; ay:=(a->>'y')::double precision; bx:=(b->>'x')::double precision; by_:=(b->>'y')::double precision;
      cx:=(c->>'x')::double precision; cy:=(c->>'y')::double precision;
      abx:=bx-ax; aby:=by_-ay; bcx:=cx-bx; bcy:=cy-by_;
      area_sum:=area_sum+(ax*by_-bx*ay);
      if sqrt(abx*abx+aby*aby)<1 or (abs(public.tool_planar_cross(a,b,c))<=eps and abx*bcx+aby*bcy<0) then return false; end if;
      if kind=1 and abs(abx*bcx+aby*bcy)>1e-6*sqrt(abx*abx+aby*aby)*sqrt(bcx*bcx+bcy*bcy) then return false; end if;
      for j in i+1..n-1 loop
        if j=i+1 or (i=0 and j=n-1) then continue; end if;
        c:=vertices->j; d:=vertices->((j+1)%n);
        cx:=(c->>'x')::double precision; cy:=(c->>'y')::double precision; dx_:=(d->>'x')::double precision; dy_:=(d->>'y')::double precision;
        first:=public.tool_planar_cross(a,b,c); second:=public.tool_planar_cross(a,b,d);
        third:=public.tool_planar_cross(c,d,a); fourth:=public.tool_planar_cross(c,d,b);
        -- 与客户端相同的 EPS；非相邻端点接触、共线重叠也属于不合法的穿越。
        if (((first>eps and second< -eps) or (first< -eps and second>eps)) and ((third>eps and fourth< -eps) or (third< -eps and fourth>eps)))
          or (abs(third)<=eps and ax between least(cx,dx_)-eps and greatest(cx,dx_)+eps and ay between least(cy,dy_)-eps and greatest(cy,dy_)+eps)
          or (abs(fourth)<=eps and bx between least(cx,dx_)-eps and greatest(cx,dx_)+eps and by_ between least(cy,dy_)-eps and greatest(cy,dy_)+eps)
          or (abs(first)<=eps and cx between least(ax,bx)-eps and greatest(ax,bx)+eps and cy between least(ay,by_)-eps and greatest(ay,by_)+eps)
          or (abs(second)<=eps and dx_ between least(ax,bx)-eps and greatest(ax,bx)+eps and dy_ between least(ay,by_)-eps and greatest(ay,by_)+eps)
          then return false; end if;
      end loop;
    end loop;
    if abs(area_sum)/2<=1 then return false; end if;
    if kind=1 then
      for i in 0..1 loop
        a:=vertices->i; b:=vertices->((i+1)%4); c:=vertices->((i+2)%4); d:=vertices->((i+3)%4);
        abx:=((b->>'x')::double precision-(a->>'x')::double precision)+((d->>'x')::double precision-(c->>'x')::double precision);
        aby:=((b->>'y')::double precision-(a->>'y')::double precision)+((d->>'y')::double precision-(c->>'y')::double precision);
        if sqrt(abx*abx+aby*aby)>1e-6 then return false; end if;
      end loop;
    end if;
  end loop;
  -- 精确键集合也排除 frameA/B/C/D.* 等动画表现参数及孤立的对象/顶点键。
  if not public.tool_space_keys(p,parameter_keys,parameter_keys) or not public.tool_space_keys(q,point_keys,point_keys)
    or not public.tool_space_keys(f,flag_keys,flag_keys) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean')
    or jsonb_typeof(s->'marks') is distinct from 'array' or jsonb_array_length(s->'marks')>128
    or (select count(distinct value) from jsonb_array_elements(s->'marks'))<>jsonb_array_length(s->'marks') then return false; end if;
  for mark in select value from jsonb_array_elements(s->'marks') loop
    if jsonb_typeof(mark)<>'string' or (mark#>>'{}')!~'^((edge|vertex)\.(0|[1-9][0-9]{0,4})\.(0|[1-9]|[12][0-9]|3[01])|boundary\.(0|[1-9][0-9]{0,4}))$' then return false; end if;
    parts:=string_to_array(mark#>>'{}','.'); object_id:=parts[2]::integer;
    if not object_id=any(ids) then return false; end if;
    kind:=(p->>('kind.'||object_id))::numeric::integer;
    if (parts[1]='boundary' and kind<2) or (parts[1]<>'boundary' and (kind>=2 or parts[3]::integer>=(p->>('count.'||object_id))::numeric::integer)) then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_construction_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    ((s->>'toolId'='plane-shapes' and s->>'contentVersion'='plane-shapes-lesson-v2' and s#>>'{payload,initial,sceneId}'='01-create')
      or (s->>'toolId'='plane-motion' and s->>'contentVersion'='plane-motion-lesson-v2' and s#>>'{payload,initial,sceneId}'='20-create'))
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_construction_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_construction_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_construction_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

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
    or public.tool_plane_material_scene_is_valid(p_scene) or public.tool_plane_construction_scene_is_valid(p_scene),false) and octet_length(p_scene::text)<=750000;
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
    else case when p_scene->>'contentVersion'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')||'-lesson-v1'
      and p_scene->>'toolId'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')
      then public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}') else null end end;
$$;
notify pgrst, 'reload schema';
commit;
