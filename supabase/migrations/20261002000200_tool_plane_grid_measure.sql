-- 钉板与面积单位 v2 的领域校验；总入口由本批集成迁移接入。
-- 只追加 helper，旧 v1、冻结副本、业务数据、RLS 与保存 RPC 保持原样。
begin;

create function public.tool_plane_grid_measure_polygon_is_valid(vertices jsonb, lattice boolean)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer; i integer; j integer; a jsonb; b jsonb; c jsonb; other_ jsonb; dot_ double precision; dx double precision; dy double precision;
begin
  if jsonb_typeof(vertices) is distinct from 'array' then return false; end if;
  n:=jsonb_array_length(vertices);
  if n not between 3 and 32 or not public.tool_planar_simple_polygon(vertices) then return false; end if;
  for i in 0..n-1 loop
    a:=vertices->((i+n-1)%n); b:=vertices->i; c:=vertices->((i+1)%n);
    if not public.tool_planar_point(b,0,18,0,12,lattice) then return false; end if;
    for j in i+1..n-1 loop
      other_:=vertices->j;
      dx:=(other_->>'x')::double precision-(b->>'x')::double precision; dy:=(other_->>'y')::double precision-(b->>'y')::double precision;
      if sqrt(dx*dx+dy*dy)<1e-8 then return false; end if;
    end loop;
    dot_:=((a->>'x')::double precision-(b->>'x')::double precision)*((c->>'x')::double precision-(b->>'x')::double precision)
      +((a->>'y')::double precision-(b->>'y')::double precision)*((c->>'y')::double precision-(b->>'y')::double precision);
    -- 同向共线编辑点合法；相邻边折返重叠不能围成简单材料。
    if abs(public.tool_planar_cross(a,b,c))<=1e-8 and dot_>1e-8 then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_grid_measure_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; lattice boolean:=s->>'sceneId'='34-create';
  flags_ text[]:=array['grid','lattice','boundary','points','measures','relation','units','height','triangles','snap','coverage'];
  parameter_keys text[]:=array['nextId','active','unit']; point_keys text[]:=array[]::text[];
  ids integer[]; id integer; next_id integer; active_id integer; kind integer; n integer; split_ integer; i integer; key_ text; prefix text;
  polygon_count integer:=0; vertex_count integer:=0; square_count integer:=0; corner_count integer;
  vertices jsonb; a jsonb; b jsonb; c jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or (s->>'sceneId' is distinct from '34-create' and s->>'sceneId' is distinct from '11-create')
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(q) is distinct from 'object'
    or not public.tool_space_number(s->'phase',0,0)
    or jsonb_typeof(s->'marks') is distinct from 'array' or jsonb_array_length(s->'marks')<>0
    or not public.tool_space_keys(f,flags_,flags_) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean')
    or f->'grid' is distinct from 'false'::jsonb
    or not public.tool_space_number(p->'nextId',1,99999,true) or not public.tool_space_number(p->'active',-1,99998,true)
    or not public.tool_space_number(p->'unit',0,2,true) then return false; end if;
  next_id:=(p->>'nextId')::numeric::integer; active_id:=(p->>'active')::numeric::integer;
  select coalesce(array_agg(substring(key from 6)::integer order by substring(key from 6)::integer),array[]::integer[])
    into ids from jsonb_object_keys(p) as t(key) where key~'^kind\.(0|[1-9][0-9]{0,4})$';
  if exists(select 1 from unnest(ids) as t(id_) where id_>=next_id or id_>99998)
    or (active_id<>-1 and not active_id=any(ids)) then return false; end if;
  foreach id in array ids loop
    if not public.tool_space_number(p->('kind.'||id),0,1,true) then return false; end if;
    kind:=(p->>('kind.'||id))::numeric::integer;
    if kind=1 then
      square_count:=square_count+1; key_:='tile.'||id;
      if lattice or square_count>100 or not public.tool_planar_point(q->key_,-1,18,-1,12) then return false; end if;
      parameter_keys:=array_append(parameter_keys,'kind.'||id); point_keys:=array_append(point_keys,key_); continue;
    end if;
    polygon_count:=polygon_count+1;
    if polygon_count>4 or not public.tool_space_number(p->('count.'||id),3,32,true) then return false; end if;
    n:=(p->>('count.'||id))::numeric::integer; vertex_count:=vertex_count+n;
    if vertex_count>96 or not public.tool_space_number(p->('base.'||id),0,n-1,true)
      or not public.tool_space_number(p->('apex.'||id),0,n-1,true)
      or not public.tool_space_number(p->('split.'||id),0,case when lattice then 1 else 0 end,true) then return false; end if;
    split_:=(p->>('split.'||id))::numeric::integer;
    foreach prefix in array array['kind','count','base','apex','split'] loop parameter_keys:=array_append(parameter_keys,prefix||'.'||id); end loop;
    vertices:='[]';
    for i in 0..n-1 loop
      key_:='v.'||id||'.'||i; point_keys:=array_append(point_keys,key_);
      vertices:=vertices||jsonb_build_array(q->key_);
    end loop;
    if not public.tool_plane_grid_measure_polygon_is_valid(vertices,lattice) then return false; end if;
    if split_=1 then
      corner_count:=0;
      for i in 0..n-1 loop
        a:=vertices->((i+n-1)%n); b:=vertices->i; c:=vertices->((i+1)%n);
        if abs(public.tool_planar_cross(a,b,c))>1e-8 then corner_count:=corner_count+1; end if;
      end loop;
      if corner_count<3 then return false; end if;
      for i in 0..corner_count-3 loop
        key_:='part.'||id||'.'||i; point_keys:=array_append(point_keys,key_);
        if not public.tool_planar_point(q->key_,-24,24,-24,24) then return false; end if;
      end loop;
    end if;
  end loop;
  return public.tool_space_keys(p,parameter_keys,parameter_keys) and public.tool_space_keys(q,point_keys,point_keys);
exception when others then return false; end;
$$;

create function public.tool_plane_grid_measure_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    ((s->>'toolId'='plane-geoboard' and s->>'contentVersion'='plane-geoboard-lesson-v2' and s#>>'{payload,initial,sceneId}'='34-create')
      or (s->>'toolId'='plane-measurement' and s->>'contentVersion'='plane-measurement-lesson-v2' and s#>>'{payload,initial,sceneId}'='11-create'))
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_grid_measure_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_grid_measure_polygon_is_valid(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_grid_measure_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_grid_measure_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
