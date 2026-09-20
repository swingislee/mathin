-- 自由轨迹球保存刚体姿态；v1 校验器和已有冻结内容原样保留。
begin;

create function public.tool_soma_pose_axes(q jsonb)
returns double precision[] language sql immutable set search_path = pg_catalog as $$
  select array[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),
    2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),
    2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)]
  from (select (q->>0)::double precision x,(q->>1)::double precision y,(q->>2)::double precision z,(q->>3)::double precision w) v;
$$;

-- 与 spatialUnitCubesOverlap 一致：15 条分离轴，贴面允许，1e-7 容差。
create function public.tool_soma_boxes_overlap(a jsonb,b jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare u double precision[]; v double precision[]; d double precision[]; n double precision[];
  k integer; j integer; ai integer; bi integer; length_squared double precision; radius double precision;
begin
  select array_agg(value::double precision order by ordinality) into u from jsonb_array_elements_text(a->'axes') with ordinality;
  select array_agg(value::double precision order by ordinality) into v from jsonb_array_elements_text(b->'axes') with ordinality;
  d := array[(b#>>'{center,0}')::double precision-(a#>>'{center,0}')::double precision,
    (b#>>'{center,1}')::double precision-(a#>>'{center,1}')::double precision,
    (b#>>'{center,2}')::double precision-(a#>>'{center,2}')::double precision];
  if d[1]^2+d[2]^2+d[3]^2>=3 then return false; end if;
  for k in 1..15 loop
    if k<=3 then n := array[u[k*3-2],u[k*3-1],u[k*3]];
    elsif k<=6 then j := k-3; n := array[v[j*3-2],v[j*3-1],v[j*3]];
    else
      ai := ((k-7)/3)*3+1; bi := ((k-7)%3)*3+1;
      n := array[u[ai+1]*v[bi+2]-u[ai+2]*v[bi+1],u[ai+2]*v[bi]-u[ai]*v[bi+2],u[ai]*v[bi+1]-u[ai+1]*v[bi]];
    end if;
    length_squared := n[1]^2+n[2]^2+n[3]^2;
    if length_squared<1e-14 then continue; end if;
    n := array[n[1]/sqrt(length_squared),n[2]/sqrt(length_squared),n[3]/sqrt(length_squared)];
    radius := 0;
    for j in 0..2 loop
      radius := radius+(abs(n[1]*u[j*3+1]+n[2]*u[j*3+2]+n[3]*u[j*3+3])+abs(n[1]*v[j*3+1]+n[2]*v[j*3+2]+n[3]*v[j*3+3]))/2;
    end loop;
    if abs(d[1]*n[1]+d[2]*n[2]+d[3]*n[3])>=radius-1e-7 then return false; end if;
  end loop;
  return true;
end;
$$;

create function public.tool_soma_free_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb := s#>'{payload,initial}'; piece jsonb; key text; cell record; box jsonb; other_box jsonb;
  ids text[] := '{}'; boxes jsonb := '[]'; axes double precision[]; px double precision; py double precision; pz double precision;
  cx double precision; cy double precision; cz double precision; squared double precision; free boolean; n integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not coalesce(s->>'toolId'='soma-cube' and s->>'contentVersion'='soma-cube-lesson-v2',false)
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}')<>'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['pieces','selectedId','mode','view','grid','axes','labels','frame','cameraRevision'],array['pieces','selectedId','mode','view','grid','axes','labels','frame','cameraRevision'])
    or not coalesce(i->>'mode' in ('observe','assemble') and i->>'view' in ('angle','front','left','right','top'),false)
    or jsonb_typeof(i->'pieces')<>'array' or jsonb_array_length(i->'pieces') not between 1 and 7
    or not public.tool_space_number(i->'cameraRevision',0,1000000,true)
    or not public.tool_space_keys(i->'frame',array['center','radius'],array['center','radius'])
    or not public.tool_space_vector(i#>'{frame,center}',12)
    or not public.tool_space_number(i#>'{frame,radius}',2.5,30) then return false; end if;
  foreach key in array array['grid','axes','labels'] loop
    if jsonb_typeof(i->key)<>'boolean' then return false; end if;
  end loop;
  for piece in select value from jsonb_array_elements(i->'pieces') loop
    if not coalesce(piece->>'id' in ('bao-1','bao-2','bao-3','bao-4','bao-5','bao-6','bao-7'),false)
      or piece->>'id'=any(ids) then return false; end if;
    ids := array_append(ids,piece->>'id'); free := piece ? 'quaternion';
    if free then
      if not public.tool_space_keys(piece,array['id','position','quaternion'],array['id','position','quaternion'])
        or not public.tool_space_vector(piece->'position',16)
        or jsonb_typeof(piece->'quaternion')<>'array' or jsonb_array_length(piece->'quaternion')<>4 then return false; end if;
      squared := 0;
      for n in 0..3 loop
        if not public.tool_space_number(piece->'quaternion'->n,-1.000001,1.000001) then return false; end if;
        squared := squared+(piece->'quaternion'->>n)::double precision^2;
      end loop;
      if abs(squared-1)>1e-6 then return false; end if;
      axes := public.tool_soma_pose_axes(piece->'quaternion');
    else
      if not public.tool_space_keys(piece,array['id','position','orientation'],array['id','position','orientation'])
        or not public.tool_space_number(piece->'orientation',0,23,true)
        or not public.tool_space_keys(piece->'position',array['x','y','z'],array['x','y','z'])
        or not public.tool_space_number(piece#>'{position,x}',-12,12,true)
        or not public.tool_space_number(piece#>'{position,y}',0,12,true)
        or not public.tool_space_number(piece#>'{position,z}',-12,12,true) then return false; end if;
      axes := array[1,0,0,0,1,0,0,0,1];
    end if;
    px := (piece#>>'{position,x}')::double precision; py := (piece#>>'{position,y}')::double precision; pz := (piece#>>'{position,z}')::double precision;
    for cell in select * from public.tool_soma_cells(piece->>'id',case when free then 0 else (piece->>'orientation')::integer end) loop
      cx := px+axes[1]*cell.x+axes[4]*cell.y+axes[7]*cell.z;
      cy := py+axes[2]*cell.x+axes[5]*cell.y+axes[8]*cell.z;
      cz := pz+axes[3]*cell.x+axes[6]*cell.y+axes[9]*cell.z;
      if free then
        if greatest(abs(cx),abs(cy),abs(cz))>12.0000001 then return false; end if;
      elsif greatest(abs(cx),cy,abs(cz))>12 or cy<0 then return false; end if;
      box := jsonb_build_object('id',piece->>'id','center',array[cx,cy,cz],'axes',axes);
      for other_box in select value from jsonb_array_elements(boxes) loop
        if other_box->>'id'<>piece->>'id' and public.tool_soma_boxes_overlap(box,other_box) then return false; end if;
      end loop;
      boxes := boxes||jsonb_build_array(box);
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
    or public.tool_solid_capacity_scene_is_valid(p_scene) or public.tool_soma_scene_is_valid(p_scene)
    or public.tool_soma_free_scene_is_valid(p_scene),false) and octet_length(p_scene::text)<=750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog,public as $$
  select case p_scene->>'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures' when 'cube-structures-lesson-v3' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'cube-net-lesson-v2' then 'cube-net' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' when 'solid-geometry-lesson-v1' then 'solid-geometry'
    when 'solid-capacity-lesson-v1' then 'solid-capacity' when 'soma-cube-lesson-v1' then 'soma-cube'
    when 'soma-cube-lesson-v2' then 'soma-cube' else null end;
$$;
revoke all on function public.tool_soma_pose_axes(jsonb),public.tool_soma_boxes_overlap(jsonb,jsonb),public.tool_soma_free_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
