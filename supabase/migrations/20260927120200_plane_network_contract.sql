-- 可编辑图网络的严格合同。只添加领域 helper；总入口、版本目录由集成迁移接入。
-- 未写入业务数据，也不修改冻结课件、RLS 或旧教具合同。
begin;

create function public.tool_plane_network_on_segment(point_ jsonb,a jsonb,b jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare dx double precision; dy double precision; length_ double precision; projected double precision;
begin
  dx:=(b->>'x')::double precision-(a->>'x')::double precision;
  dy:=(b->>'y')::double precision-(a->>'y')::double precision;
  length_:=sqrt(dx*dx+dy*dy); if length_<=1e-6 then return false; end if;
  projected:=(((point_->>'x')::double precision-(a->>'x')::double precision)*dx+((point_->>'y')::double precision-(a->>'y')::double precision)*dy)/length_;
  return abs(public.tool_planar_cross(a,b,point_))<=1e-6*length_ and projected>= -1e-6 and projected<=length_+1e-6;
exception when others then return false; end;
$$;

create function public.tool_plane_network_intersects(a jsonb,b jsonb,c jsonb,d jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare rx double precision; ry double precision; sx double precision; sy double precision;
  cx double precision; cy double precision; denominator double precision; t double precision; u double precision;
begin
  rx:=(b->>'x')::double precision-(a->>'x')::double precision; ry:=(b->>'y')::double precision-(a->>'y')::double precision;
  sx:=(d->>'x')::double precision-(c->>'x')::double precision; sy:=(d->>'y')::double precision-(c->>'y')::double precision;
  denominator:=rx*sy-ry*sx; if abs(denominator)<1e-12 then return false; end if;
  cx:=(c->>'x')::double precision-(a->>'x')::double precision; cy:=(c->>'y')::double precision-(a->>'y')::double precision;
  t:=(cx*sy-cy*sx)/denominator; u:=(cx*ry-cy*rx)/denominator;
  return t>=0 and t<=1 and u>=0 and u<=1;
exception when others then return false; end;
$$;

create function public.tool_plane_network_covered(graph jsonb,from_id integer,to_id integer)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare points jsonb:=graph->'points'; a jsonb:=points->from_id::text; b jsonb:=points->to_id::text;
  ordered integer[]; previous_id integer; node integer; dx double precision; dy double precision; edges jsonb:=graph->'edges';
begin
  if a is null or b is null or from_id=to_id then return false; end if;
  dx:=(b->>'x')::double precision-(a->>'x')::double precision; dy:=(b->>'y')::double precision-(a->>'y')::double precision;
  select coalesce(array_agg(key::integer order by (value->>'x')::double precision*dx+(value->>'y')::double precision*dy),array[]::integer[])
    into ordered from jsonb_each(points) where public.tool_plane_network_on_segment(value,a,b);
  if cardinality(ordered)<2 or ordered[1]<>from_id or ordered[cardinality(ordered)]<>to_id then return false; end if;
  previous_id:=ordered[1];
  foreach node in array ordered[2:cardinality(ordered)] loop
    if not edges @> jsonb_build_array(jsonb_build_array(least(previous_id,node),greatest(previous_id,node))) then return false; end if;
    previous_id:=node;
  end loop; return true;
exception when others then return false; end;
$$;

create function public.tool_plane_network_simple_polygon(vertices jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer:=jsonb_array_length(vertices); i integer; j integer; a jsonb; b jsonb; c jsonb; d jsonb; previous_ jsonb;
  dx double precision; dy double precision; area_ double precision:=0;
begin
  if n<3 or n>12 then return false; end if;
  for i in 0..n-1 loop
    a:=vertices->i; b:=vertices->((i+1)%n); previous_:=vertices->((i+n-1)%n);
    dx:=(b->>'x')::double precision-(a->>'x')::double precision; dy:=(b->>'y')::double precision-(a->>'y')::double precision;
    area_:=area_+(a->>'x')::double precision*(b->>'y')::double precision-(a->>'y')::double precision*(b->>'x')::double precision;
    if sqrt(dx*dx+dy*dy)<=1e-6 or public.tool_plane_network_on_segment(b,previous_,a) or public.tool_plane_network_on_segment(previous_,a,b) then return false; end if;
    for j in i+1..n-1 loop
      if j=i+1 or (i=0 and j=n-1) then continue; end if;
      c:=vertices->j; d:=vertices->((j+1)%n);
      if public.tool_plane_network_intersects(a,b,c,d) or public.tool_plane_network_on_segment(c,a,b) or public.tool_plane_network_on_segment(d,a,b)
        or public.tool_plane_network_on_segment(a,c,d) or public.tool_plane_network_on_segment(b,c,d) then return false; end if;
    end loop;
  end loop;
  return abs(area_)/2>1;
exception when others then return false; end;
$$;

create function public.tool_plane_network_same_ray(vertex_ jsonb,a jsonb,b jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare ax double precision; ay double precision; bx double precision; by_ double precision;
begin
  ax:=(a->>'x')::double precision-(vertex_->>'x')::double precision; ay:=(a->>'y')::double precision-(vertex_->>'y')::double precision;
  bx:=(b->>'x')::double precision-(vertex_->>'x')::double precision; by_:=(b->>'y')::double precision-(vertex_->>'y')::double precision;
  return ax*bx+ay*by_>0 and abs(ax*by_-ay*bx)<=1e-6*sqrt(ax*ax+ay*ay)*sqrt(bx*bx+by_*by_);
exception when others then return false; end;
$$;

create function public.tool_plane_network_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags';
  globals_ text[]:=array['nextNode','nextEdge','nextRecord','nextStroke','activeNode','activeEdge','currentStroke','figureMode','rays','columns','rows','levels'];
  flags_ text[]:=array['grid','measures','names','degrees','intersections','edit','snap','repeat','highlights'];
  parameter_keys text[]:=globals_; point_keys text[]:=array[]::text[]; node_ids integer[]:=array[]::integer[]; edge_ids integer[]:=array[]::integer[];
  points_ jsonb:='{}'; edges_ jsonb:='[]'; graph jsonb; edge_pairs text[]:=array[]::text[];
  k text; id integer; a_id integer; b_id integer; i integer; j integer; key_ text; a jsonb; b jsonb; c jsonb; d jsonb; edge_ jsonb; other_ jsonb;
  dx double precision; dy double precision;
  mark jsonb; parts text[]; kind_ text; record_id integer; step_ integer; node_ integer; picks jsonb:='{}'; records jsonb:='{}'; record_ jsonb; steps_ jsonb;
  ordered integer[]; vertices jsonb; limit_ integer; visits integer:=0; seen_edges text[]:=array[]::text[]; record_count integer;
  angles_ jsonb:='[]'; angle_ jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or (s->>'sceneId' is distinct from '47-create' and s->>'sceneId' is distinct from '52-create')
    or not public.tool_space_number(s->'phase',0,1) or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(q) is distinct from 'object'
    or not public.tool_space_keys(f,flags_,flags_) or exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean')
    or (select count(*) from jsonb_each(q))>96 or (select count(*) from jsonb_each(p))>204 then return false; end if;
  foreach k in array array['nextNode','nextEdge','nextRecord','nextStroke'] loop if not public.tool_space_number(p->k,1,99999,true) then return false; end if; end loop;
  foreach k in array array['activeNode','activeEdge','currentStroke'] loop if not public.tool_space_number(p->k,-1,99998,true) then return false; end if; end loop;
  if not public.tool_space_number(p->'figureMode',0,2,true) or not public.tool_space_number(p->'rays',2,8,true)
    or not public.tool_space_number(p->'columns',1,5,true) or not public.tool_space_number(p->'rows',1,4,true)
    or not public.tool_space_number(p->'levels',1,4,true) then return false; end if;
  for k in select jsonb_object_keys(q) loop
    if k!~'^node\.(0|[1-9][0-9]{0,4})$' or not public.tool_planar_point(q->k,-1000,2000,-1000,1720) then return false; end if;
    id:=substring(k from 6)::integer;
    if id>99998 or id>=(p->>'nextNode')::numeric::integer then return false; end if;
    node_ids:=array_append(node_ids,id); point_keys:=array_append(point_keys,k); points_:=points_||jsonb_build_object(id::text,q->k);
  end loop;
  for k in select jsonb_object_keys(p) loop
    if k=any(globals_) then continue; end if;
    if k!~'^[ab]\.(0|[1-9][0-9]{0,4})$' then return false; end if;
    id:=substring(k from 3)::integer;
    if id>99998 or id>=(p->>'nextEdge')::numeric::integer or not public.tool_space_number(p->k,0,99998,true) or not (p->>k)::numeric::integer=any(node_ids) then return false; end if;
    if not id=any(edge_ids) then edge_ids:=array_append(edge_ids,id); parameter_keys:=array_append(array_append(parameter_keys,'a.'||id),'b.'||id); end if;
  end loop;
  if cardinality(edge_ids)>96 or not public.tool_space_keys(p,parameter_keys,parameter_keys) or not public.tool_space_keys(q,point_keys,point_keys)
    or ((p->>'activeNode')::numeric::integer<>-1 and not (p->>'activeNode')::numeric::integer=any(node_ids))
    or ((p->>'activeEdge')::numeric::integer<>-1 and not (p->>'activeEdge')::numeric::integer=any(edge_ids)) then return false; end if;
  -- 所有节点彼此不同；线内的点必须已经把线分裂成真实连接。
  for i in 1..cardinality(node_ids) loop
    a:=points_->node_ids[i]::text;
    for j in i+1..cardinality(node_ids) loop
      b:=points_->node_ids[j]::text; dx:=(a->>'x')::double precision-(b->>'x')::double precision; dy:=(a->>'y')::double precision-(b->>'y')::double precision;
      if sqrt(dx*dx+dy*dy)<=1e-6 then return false; end if;
    end loop;
  end loop;
  foreach id in array edge_ids loop
    if not public.tool_space_number(p->('a.'||id),0,99998,true) or not public.tool_space_number(p->('b.'||id),0,99998,true) then return false; end if;
    a_id:=(p->>('a.'||id))::numeric::integer; b_id:=(p->>('b.'||id))::numeric::integer;
    key_:=a_id||'.'||b_id;
    if a_id>=b_id or key_=any(edge_pairs) then return false; end if;
    edge_pairs:=array_append(edge_pairs,key_); a:=points_->a_id::text; b:=points_->b_id::text;
    dx:=(b->>'x')::double precision-(a->>'x')::double precision; dy:=(b->>'y')::double precision-(a->>'y')::double precision;
    if sqrt(dx*dx+dy*dy)<=1e-6 then return false; end if;
    foreach node_ in array node_ids loop
      if node_<>a_id and node_<>b_id and public.tool_plane_network_on_segment(points_->node_::text,a,b) then return false; end if;
    end loop;
    edges_:=edges_||jsonb_build_array(jsonb_build_array(a_id,b_id));
  end loop;
  for i in 0..jsonb_array_length(edges_)-1 loop
    edge_:=edges_->i;
    for j in i+1..jsonb_array_length(edges_)-1 loop
      other_:=edges_->j;
      if edge_->0=other_->0 or edge_->0=other_->1 or edge_->1=other_->0 or edge_->1=other_->1 then continue; end if;
      if public.tool_plane_network_intersects(points_->(edge_->>0),points_->(edge_->>1),points_->(other_->>0),points_->(other_->>1)) then return false; end if;
    end loop;
  end loop;
  graph:=jsonb_build_object('points',points_,'edges',edges_);
  if jsonb_typeof(s->'marks') is distinct from 'array' or jsonb_array_length(s->'marks')>320
    or (select count(distinct value) from jsonb_array_elements(s->'marks'))<>jsonb_array_length(s->'marks') then return false; end if;
  for mark in select value from jsonb_array_elements(s->'marks') loop
    if jsonb_typeof(mark)<>'string' or char_length(mark#>>'{}')>64 then return false; end if;
    parts:=string_to_array(mark#>>'{}','.');
    if (mark#>>'{}')~'^pick\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$' then
      step_:=parts[2]::integer; node_:=parts[3]::integer; limit_:=case (p->>'figureMode')::numeric::integer when 0 then 2 when 1 then 3 else 12 end;
      if s->>'sceneId'<>'47-create' or step_>=limit_ or not node_=any(node_ids) or picks ? step_::text or exists(select 1 from jsonb_each(picks) where value=to_jsonb(node_)) then return false; end if;
      picks:=picks||jsonb_build_object(step_::text,node_); continue;
    end if;
    if (mark#>>'{}')!~'^(segment|angle|figure|stroke)\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$' then return false; end if;
    kind_:=parts[1]; record_id:=parts[2]::integer; step_:=parts[3]::integer; node_:=parts[4]::integer;
    if record_id>99998 or not node_=any(node_ids) or record_id>=(p->>(case when kind_='stroke' then 'nextStroke' else 'nextRecord' end))::numeric::integer
      or (s->>'sceneId'='52-create' and kind_<>'stroke') or (s->>'sceneId'='47-create' and kind_='stroke') then return false; end if;
    record_:=coalesce(records->record_id::text,jsonb_build_object('kind',kind_,'steps','{}'::jsonb)); steps_:=record_->'steps';
    if record_->>'kind'<>kind_ or steps_ ? step_::text then return false; end if;
    records:=records||jsonb_build_object(record_id::text,jsonb_build_object('kind',kind_,'steps',steps_||jsonb_build_object(step_::text,node_)));
  end loop;
  limit_:=(select count(*) from jsonb_each(picks));
  if exists(select 1 from jsonb_object_keys(picks) as t(key) where key::integer>=limit_) then return false; end if;
  record_count:=(select count(*) from jsonb_each(records));
  if record_count>(case when s->>'sceneId'='52-create' then 32 else 24 end) then return false; end if;
  for record_ in select value from jsonb_each(records) order by key::integer loop
    kind_:=record_->>'kind'; steps_:=record_->'steps'; limit_:=(select count(*) from jsonb_each(steps_));
    if exists(select 1 from jsonb_object_keys(steps_) as t(key) where key::integer>=limit_) then return false; end if;
    select array_agg((value#>>'{}')::integer order by key::integer) into ordered from jsonb_each(steps_);
    if kind_='stroke' then
      visits:=visits+cardinality(ordered); if visits>192 then return false; end if;
      for i in 2..cardinality(ordered) loop
        key_:=least(ordered[i-1],ordered[i])||'.'||greatest(ordered[i-1],ordered[i]);
        if not key_=any(edge_pairs) or (not (f->>'repeat')::boolean and key_=any(seen_edges)) then return false; end if;
        seen_edges:=array_append(seen_edges,key_);
      end loop; continue;
    end if;
    if (kind_='segment' and cardinality(ordered)<>2) or (kind_='angle' and cardinality(ordered)<>3)
      or (kind_='figure' and cardinality(ordered) not between 3 and 12)
      or (select count(distinct value) from unnest(ordered) value)<>cardinality(ordered) then return false; end if;
    vertices:='[]'; foreach node_ in array ordered loop vertices:=vertices||jsonb_build_array(points_->node_::text); end loop;
    if kind_='figure' and not public.tool_plane_network_simple_polygon(vertices) then return false; end if;
    if kind_='angle' then
      b:=points_->ordered[2]::text;
      if public.tool_plane_network_same_ray(b,points_->ordered[1]::text,points_->ordered[3]::text) then return false; end if;
      for angle_ in select value from jsonb_array_elements(angles_) loop
        if (angle_->>1)::integer<>ordered[2] then continue; end if;
        if (public.tool_plane_network_same_ray(b,points_->ordered[1]::text,points_->(angle_->>0)) and public.tool_plane_network_same_ray(b,points_->ordered[3]::text,points_->(angle_->>2)))
          or (public.tool_plane_network_same_ray(b,points_->ordered[1]::text,points_->(angle_->>2)) and public.tool_plane_network_same_ray(b,points_->ordered[3]::text,points_->(angle_->>0))) then return false; end if;
      end loop;
      angles_:=angles_||jsonb_build_array(to_jsonb(ordered));
    end if;
    for i in 1..(cardinality(ordered)-(case when kind_='figure' then 0 else 1 end)) loop
      if not public.tool_plane_network_covered(graph,ordered[i],ordered[i%cardinality(ordered)+1]) then return false; end if;
    end loop;
  end loop;
  return (p->>'currentStroke')::numeric::integer=-1 or (s->>'sceneId'='52-create' and records ? ((p->>'currentStroke')::numeric::integer)::text);
exception when others then return false; end;
$$;

create function public.tool_plane_network_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    ((s->>'toolId'='plane-patterns' and s->>'contentVersion'='plane-patterns-lesson-v2' and s#>>'{payload,initial,sceneId}'='47-create')
      or (s->>'toolId'='plane-graph-path' and s->>'contentVersion'='plane-graph-path-lesson-v2' and s#>>'{payload,initial,sceneId}'='52-create'))
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_network_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_network_on_segment(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_network_intersects(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_network_covered(jsonb,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_network_simple_polygon(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_network_same_ray(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_network_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_network_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
