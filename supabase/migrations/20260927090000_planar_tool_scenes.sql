-- 平面教具共用场景合同：21 个教学入口、49 个现场；原有版本、RLS 和冻结副本保持不变。
-- 此迁移只登记校验函数与目录，不迁移/改写任何教师场景或已发布课件。
begin;

create function public.tool_planar_catalog_for_scene(scene_id text)
returns text language sql immutable set search_path = pg_catalog,public as $$
  select case
    when scene_id in ('01','02') then 'plane-pieces'
    when scene_id in ('03','04','05') then 'plane-geometry'
    when scene_id in ('06','07','08') then 'plane-polygons'
    when scene_id in ('10','12','13','43') then 'plane-perimeter'
    when scene_id='11' then 'plane-measurement'
    when scene_id in ('34','56') then 'plane-geoboard'
    when scene_id in ('14','15','16','17','46','58') then 'plane-area'
    when scene_id in ('18','37','38','39','40','41','42','59') then 'plane-area-relations'
    when scene_id='27' then 'plane-circle-area'
    when scene_id in ('33','44','45') then 'plane-overlap'
    when scene_id in ('20','21','22','24') then 'plane-motion'
    when scene_id='32' then 'plane-folding' when scene_id='36' then 'plane-tiling'
    when scene_id in ('47','48','49') then 'plane-patterns'
    when scene_id='51' then 'plane-matchsticks' when scene_id='52' then 'plane-graph-path'
    when scene_id='53' then 'plane-grid-path' when scene_id='54' then 'plane-reflection-path'
    when scene_id='55' then 'plane-rolling' when scene_id='57' then 'plane-covering'
    when scene_id='60' then 'plane-clock' else null end;
$$;

create function public.tool_planar_point(p jsonb, xmin numeric default -100000, xmax numeric default 100000,
  ymin numeric default -100000, ymax numeric default 100000, integral boolean default false)
returns boolean language sql immutable set search_path = pg_catalog,public as $$
  select public.tool_space_keys(p,array['x','y'],array['x','y'])
    and public.tool_space_number(p->'x',xmin,xmax,integral) and public.tool_space_number(p->'y',ymin,ymax,integral);
$$;
create function public.tool_planar_cross(a jsonb,b jsonb,c jsonb)
returns double precision language sql immutable set search_path = pg_catalog,public as $$
  select ((b->>'x')::double precision-(a->>'x')::double precision)*((c->>'y')::double precision-(a->>'y')::double precision)
       - ((b->>'y')::double precision-(a->>'y')::double precision)*((c->>'x')::double precision-(a->>'x')::double precision);
$$;
create function public.tool_planar_on_segment(p jsonb,a jsonb,b jsonb)
returns boolean language sql immutable set search_path = pg_catalog,public as $$
  select abs(public.tool_planar_cross(a,b,p))<1e-8
    and (p->>'x')::double precision between least((a->>'x')::double precision,(b->>'x')::double precision)-1e-8 and greatest((a->>'x')::double precision,(b->>'x')::double precision)+1e-8
    and (p->>'y')::double precision between least((a->>'y')::double precision,(b->>'y')::double precision)-1e-8 and greatest((a->>'y')::double precision,(b->>'y')::double precision)+1e-8;
$$;
create function public.tool_planar_simple_polygon(vertices jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare n integer; i integer; j integer; a jsonb; b jsonb; c jsonb; d jsonb; signed double precision := 0;
begin
  if jsonb_typeof(vertices)<>'array' then return false; end if;
  n := jsonb_array_length(vertices);
  if n not between 3 and 256 or (select count(distinct value) from jsonb_array_elements(vertices))<>n then return false; end if;
  for i in 0..n-1 loop
    a:=vertices->i; b:=vertices->((i+1)%n);
    if not public.tool_planar_point(a) then return false; end if;
    signed:=signed+(a->>'x')::double precision*(b->>'y')::double precision-(a->>'y')::double precision*(b->>'x')::double precision;
  end loop;
  if abs(signed)<2e-8 then return false; end if;
  for i in 0..n-1 loop
    for j in i+1..n-1 loop
      if j=i+1 or (i=0 and j=n-1) then continue; end if;
      a:=vertices->i; b:=vertices->((i+1)%n); c:=vertices->j; d:=vertices->((j+1)%n);
      if (public.tool_planar_cross(a,b,c)*public.tool_planar_cross(a,b,d)<0 and public.tool_planar_cross(c,d,a)*public.tool_planar_cross(c,d,b)<0)
        or public.tool_planar_on_segment(c,a,b) or public.tool_planar_on_segment(d,a,b)
        or public.tool_planar_on_segment(a,c,d) or public.tool_planar_on_segment(b,c,d) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_planar_geometry_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; id text:=s->>'sceneId'; k text; v jsonb;
  total integer; i integer; capacity integer; vertices jsonb:='[]'::jsonb;
begin
  for v in select value from jsonb_each(q) loop if not public.tool_planar_point(v,-10000,10000,-10000,10000) then return false; end if; end loop;
  if id in ('01','02') then
    if not public.tool_space_number(p->'count',case when id='02' then 7 else 1 end,case when id='02' then 7 else 20 end,true) then return false; end if;
    total:=(p->>'count')::integer;
    if not public.tool_space_number(p->'active',0,total-1,true) or not public.tool_space_number(p->'rotation',-100000,100000) then return false; end if;
    for i in 0..total-1 loop
      if not public.tool_planar_point(q->('piece'||i),-10000,10000,-10000,10000)
        or not public.tool_space_number(p->('angle'||i),-100000,100000)
        or not public.tool_space_number(p->('reflection'||i),-1,1)
        or (p ? ('kind'||i) and not public.tool_space_number(p->('kind'||i),0,3,true)) then return false; end if;
    end loop;
    return true;
  elsif id='03' then
    return coalesce(public.tool_planar_point(q->'a') and public.tool_planar_point(q->'b') and public.tool_planar_point(q->'via')
      and power((q#>>'{a,x}')::numeric-(q#>>'{b,x}')::numeric,2)+power((q#>>'{a,y}')::numeric-(q#>>'{b,y}')::numeric,2)>=900
      and not(coalesce((f->>'ray')::boolean,false) and coalesce((f->>'fullLine')::boolean,false)),false);
  elsif id='04' then
    return public.tool_planar_point(q->'vertex') and public.tool_planar_point(q->'protractor')
      and public.tool_space_number(p->'angle',0,180) and public.tool_space_number(p->'lengthA',1,6)
      and public.tool_space_number(p->'lengthB',1,6) and public.tool_space_number(p->'protractorRotation',-180,180);
  elsif id='05' then
    return coalesce(public.tool_planar_point(q->'a') and public.tool_planar_point(q->'b') and public.tool_planar_point(q->'p')
      and public.tool_space_number(p->'along',-.2,1.2)
      and power((q#>>'{a,x}')::numeric-(q#>>'{b,x}')::numeric,2)+power((q#>>'{a,y}')::numeric-(q#>>'{b,y}')::numeric,2)>=6400,false);
  elsif id='06' then
    return public.tool_space_number(p->'base',1,7) and public.tool_space_number(p->'left',1,6)
      and public.tool_space_number(p->'right',1,6) and public.tool_space_number(p->'opening',15,165);
  elsif id='07' then
    return public.tool_planar_simple_polygon(jsonb_build_array(q->'a',q->'b',q->'c'));
  elsif id='08' then
    return public.tool_space_number(p->'family',0,4,true) and public.tool_space_number(p->'width',2,7)
      and public.tool_space_number(p->'height',1,5) and public.tool_space_number(p->'slant',-3,3) and public.tool_space_number(p->'base',0,3,true);
  elsif id='10' then return public.tool_space_number(p->'width',2,5) and public.tool_space_number(p->'height',1,3.5);
  elsif id='11' then
    if not public.tool_space_number(p->'columns',1,7,true) or not public.tool_space_number(p->'rows',1,5,true) then return false; end if;
    capacity:=case when coalesce((f->>'subdivision')::boolean,false) then 100 else (p->>'columns')::integer*(p->>'rows')::integer end;
    if not public.tool_space_number(p->'filled',0,capacity) or (select count(distinct value) from jsonb_array_elements(s->'marks'))<>jsonb_array_length(s->'marks') then return false; end if;
    for k in select jsonb_array_elements_text(s->'marks') loop
      if k!~'^cell[0-9]+$' or substring(k from 5)::numeric>=capacity then return false; end if;
    end loop; return true;
  elsif id='12' then return public.tool_space_number(p->'width',2,7);
  elsif id='13' then return public.tool_planar_point(q->'a') and public.tool_planar_point(q->'b');
  elsif id in ('34','56') then
    for i in 0..4 loop
      if not public.tool_planar_point(q->('v'||i),0,10,0,8,true) then return false; end if;
      vertices:=vertices||jsonb_build_array(q->('v'||i));
    end loop; return public.tool_planar_simple_polygon(vertices);
  elsif id='43' then return public.tool_space_number(p->'steps',2,8,true) and public.tool_space_number(p->'notch',0,1.5);
  elsif id='60' then return public.tool_space_number(p->'minutes',0,1440) and public.tool_space_number(p->'start',0,1440) and public.tool_space_number(p->'span',1,120);
  end if;
  return false;
exception when others then return false; end;
$$;

create function public.tool_planar_area_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; id text:=s->>'sceneId'; k text; v jsonb;
  triangle boolean:=id in ('18','37','38','39','41','42'); ranges jsonb; side double precision; base double precision; shear double precision;
  vertices jsonb; i integer; turn double precision; positive boolean:=true; negative boolean:=true;
begin
  if id not in ('14','15','16','17','18','27','33','37','38','39','40','41','42','44','45','46','58','59')
    or (select count(*) from jsonb_each(p))>80 or (select count(*) from jsonb_each(q))>80 then return false; end if;
  ranges:='{"slant":[-20,20],"top":[0.5,5],"fraction":[0.05,0.95],"secondary":[0.05,0.95],"count":[4,64],"layers":[1,5],"radius":[0.5,3],"cuts":[0,10],"angle":[-180,180]}'::jsonb
    ||case when triangle then '{"base":[0.02,20],"height":[0.01,20]}'::jsonb else '{"base":[1,8],"height":[0.25,6]}'::jsonb end;
  for k,v in select key,value from jsonb_each(ranges) loop
    if not public.tool_space_number(p->k,(v->>0)::numeric,(v->>1)::numeric,k in ('count','layers','cuts')) then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(p) loop
    if not ranges ? k and (k not like 'turn.%' or not public.tool_space_number(v,-36000,36000)) then return false; end if;
  end loop;
  foreach k in array array['grid','measures','constraint','original','areas','strips','complement','alternate','snap'] loop
    if jsonb_typeof(f->k) is distinct from 'boolean' then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(q) loop
    if (k not in ('A','B','C','D','P') and k not like 'piece.%') or not public.tool_planar_point(v,-20,20,-12,12) then return false; end if;
  end loop;
  if triangle then
    if not q ?& array['A','B','C'] or abs(public.tool_planar_cross(q->'A',q->'B',q->'C'))<.3 then return false; end if;
    if id in ('39','41') and not q ? 'P' then return false; end if;
  end if;
  if id='14' then
    if not public.tool_space_number(p->'base',2,8) or not public.tool_space_number(p->'height',1,6) or not public.tool_space_number(p->'slant',.2,12) then return false; end if;
    side:=sqrt(power((p->>'slant')::double precision,2)+power((p->>'height')::double precision,2));
    base:=case when (f->>'alternate')::boolean then side else (p->>'base')::double precision end;
    shear:=case when (f->>'alternate')::boolean then (p->>'base')::double precision*(p->>'slant')::double precision/side else (p->>'slant')::double precision end;
    if (p->>'cuts')::integer>ceil(shear/base-1e-9) then return false; end if;
  end if;
  if id='27' and (p->>'count')::integer not in (8,16,32,64) then return false; end if;
  if id='33' and not q ? 'P' then return false; end if;
  if id='40' then
    if not q ?& array['A','B','C','D'] then return false; end if;
    vertices:=jsonb_build_array(q->'A',q->'B',q->'C',q->'D');
    for i in 0..3 loop turn:=public.tool_planar_cross(vertices->i,vertices->((i+1)%4),vertices->((i+2)%4)); positive:=positive and turn>.1; negative:=negative and turn<-.1; end loop;
    if not positive and not negative then return false; end if;
    if (f->>'constraint')::boolean and (abs((q#>>'{A,y}')::numeric-(q#>>'{B,y}')::numeric)>1e-8 or abs((q#>>'{C,y}')::numeric-(q#>>'{D,y}')::numeric)>1e-8) then return false; end if;
  end if;
  return true;
exception when others then return false; end;
$$;

create function public.tool_planar_motion_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; id text:=s->>'sceneId'; i integer; k text; radius numeric;
begin
  if jsonb_array_length(s->'marks')>64 or (select count(*) from jsonb_each(p))>64 or (select count(*) from jsonb_each(q))>64 then return false; end if;
  if id='20' then return public.tool_space_number(p->'dx',-5000,5000) and public.tool_space_number(p->'dy',-5000,5000);
  elsif id='21' then return public.tool_space_number(p->'angle',-36000,36000) and public.tool_planar_point(q->'center',-5000,5000,-5000,5000);
  elsif id='22' then return public.tool_space_number(p->'axisAngle',-180,180) and (not q ? 'center' or public.tool_planar_point(q->'center',-5000,5000,-5000,5000));
  elsif id='24' then return public.tool_space_number(p->'copies',2,12,true) and public.tool_planar_point(q->'center',-5000,5000,-5000,5000);
  elsif id='32' then
    if not public.tool_space_number(p->'radius',8,35) or not public.tool_planar_point(q->'center',-5000,5000,-5000,5000)
      or not public.tool_planar_point(q->'hole',-5000,5000,-5000,5000) or jsonb_typeof(s#>'{flags,twice}') is distinct from 'boolean' then return false; end if;
    radius:=(p->>'radius')::numeric;
    return (q#>>'{hole,x}')::numeric between (q#>>'{center,x}')::numeric-155+radius and (q#>>'{center,x}')::numeric-radius
      and (q#>>'{hole,y}')::numeric between (q#>>'{center,y}')::numeric-155+radius and (q#>>'{center,y}')::numeric-radius;
  elsif id='36' then
    if not public.tool_space_number(p->'count',1,24,true) or not public.tool_space_number(p->'sides',3,6,true)
      or not public.tool_space_number(p->'selected',0,(p->>'count')::numeric-1,true) then return false; end if;
    for i in 0..(p->>'count')::integer-1 loop
      if not public.tool_planar_point(q->('tile'||i),-5000,5000,-5000,5000)
        or (p ? ('angle'||i) and not public.tool_space_number(p->('angle'||i),-36000,36000)) then return false; end if;
    end loop; return true;
  elsif id='54' then
    if not public.tool_space_number(p->'axisAngle',-180,180) or not public.tool_space_number(p->'contact',-3000,3000) then return false; end if;
    foreach k in array array['center','a','b'] loop if not public.tool_planar_point(q->k,-5000,5000,-5000,5000) then return false; end if; end loop; return true;
  elsif id='55' then
    return public.tool_space_number(p->'largeRadius',90,180) and public.tool_space_number(p->'smallRadius',20,80)
      and (p->>'smallRadius')::numeric<(p->>'largeRadius')::numeric and public.tool_space_number(p->'orbit',90,720)
      and public.tool_planar_point(q->'center',-5000,5000,-5000,5000);
  end if; return false;
exception when others then return false; end;
$$;

-- 图记录按真实点和完整现有边校验；不只接受一个看起来像ID的字符串。
create function public.tool_planar_graph(s jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog,public as $$
declare id text:=s->>'sceneId'; p jsonb:=s->'params'; points jsonb:='{}'::jsonb; edges jsonb:='[]'::jsonb;
  x integer; y integer; columns integer; rows integer; a text; b text; angle double precision;
begin
  if id in ('49','53') then
    if not public.tool_space_number(p->'columns',2,6,true) or not public.tool_space_number(p->'rows',2,4,true) then return null; end if;
    columns:=(p->>'columns')::integer; rows:=(p->>'rows')::integer;
    for y in 0..rows loop for x in 0..columns loop
      a:=x||','||y; points:=points||jsonb_build_object(a,jsonb_build_object('x',x,'y',y));
      if x>0 then edges:=edges||jsonb_build_array(jsonb_build_array((x-1)||','||y,a)); end if;
      if y>0 then edges:=edges||jsonb_build_array(jsonb_build_array(x||','||(y-1),a)); end if;
    end loop; end loop;
  elsif id='48' then
    if not public.tool_space_number(p->'levels',2,4,true) then return null; end if;
    rows:=(p->>'levels')::integer;
    for y in 0..rows loop for x in 0..y loop
      a:=x||','||y; points:=points||jsonb_build_object(a,jsonb_build_object('x',2*x-y,'y',y));
      if x>0 then edges:=edges||jsonb_build_array(jsonb_build_array((x-1)||','||y,a)); end if;
      if y>0 and x<y then edges:=edges||jsonb_build_array(jsonb_build_array(x||','||(y-1),a)); end if;
      if y>0 and x>0 then edges:=edges||jsonb_build_array(jsonb_build_array((x-1)||','||(y-1),a)); end if;
    end loop; end loop;
  elsif id='47' and coalesce((s#>>'{flags,angles}')::boolean,false) then
    points:='{"O":{"x":0,"y":0}}'::jsonb;
    for x in 0..4 loop a:=chr(65+x); angle:=radians(-100+x*32); points:=points||jsonb_build_object(a,jsonb_build_object('x',cos(angle)*240,'y',sin(angle)*240)); edges:=edges||jsonb_build_array(jsonb_build_array('O',a)); end loop;
  elsif id='47' then
    for x in 0..5 loop a:=chr(65+x); points:=points||jsonb_build_object(a,jsonb_build_object('x',x,'y',0)); if x>0 then edges:=edges||jsonb_build_array(jsonb_build_array(chr(64+x),a)); end if; end loop;
  elsif id='52' then
    points:='{"A":{"x":310,"y":470},"B":{"x":610,"y":470},"C":{"x":610,"y":280},"D":{"x":310,"y":280},"E":{"x":460,"y":155}}'::jsonb;
    edges:='[["A","B"],["B","C"],["C","D"],["D","A"],["C","E"],["E","D"],["A","C"]]'::jsonb;
  else return null; end if;
  return jsonb_build_object('points',points,'edges',edges);
exception when others then return null; end;
$$;
create function public.tool_planar_edge_key(a text,b text)
returns text language sql immutable set search_path = pg_catalog,public as $$ select least(a,b)||'|'||greatest(a,b); $$;
create function public.tool_planar_covered_segment(graph jsonb,from_id text,to_id text,closed text[])
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare points jsonb:=graph->'points'; a jsonb:=points->from_id; b jsonb:=points->to_id; c jsonb; d jsonb; edge jsonb;
  dx double precision; dy double precision; length2 double precision; lo double precision; hi double precision; u double precision; v double precision;
  ranges jsonb:='[]'::jsonb; span jsonb; covered double precision:=0;
begin
  if a is null or b is null then return false; end if;
  dx:=(b->>'x')::double precision-(a->>'x')::double precision; dy:=(b->>'y')::double precision-(a->>'y')::double precision; length2:=dx*dx+dy*dy;
  if length2<1e-8 then return false; end if;
  for edge in select value from jsonb_array_elements(graph->'edges') loop
    if public.tool_planar_edge_key(edge->>0,edge->>1)=any(closed) then continue; end if;
    c:=points->(edge->>0); d:=points->(edge->>1);
    if abs(public.tool_planar_cross(a,b,c))>1e-6 or abs(public.tool_planar_cross(a,b,d))>1e-6 then continue; end if;
    u:=(((c->>'x')::double precision-(a->>'x')::double precision)*dx+((c->>'y')::double precision-(a->>'y')::double precision)*dy)/length2;
    v:=(((d->>'x')::double precision-(a->>'x')::double precision)*dx+((d->>'y')::double precision-(a->>'y')::double precision)*dy)/length2;
    lo:=greatest(0,least(u,v)); hi:=least(1,greatest(u,v));
    if hi>lo then ranges:=ranges||jsonb_build_array(jsonb_build_array(lo,hi)); end if;
  end loop;
  for span in select value from jsonb_array_elements(ranges) order by (value->>0)::double precision loop
    if (span->>0)::double precision>covered+1e-6 then return false; end if;
    covered:=greatest(covered,(span->>1)::double precision);
    if covered>=1-1e-6 then return true; end if;
  end loop; return false;
exception when others then return false; end;
$$;
create function public.tool_planar_graph_records_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare id text:=s->>'sceneId'; graph jsonb:=public.tool_planar_graph(s); points jsonb:=graph->'points'; edge jsonb;
  mark text; parts text[]; nodes text[]; prefix text; node text; i integer; count_nodes integer;
  closed text[]:=array[]::text[]; edge_keys text[]:=array[]::text[]; picks integer:=0; throughs integer:=0; path boolean:=id in ('52','53');
begin
  if graph is null then return false; end if;
  for edge in select value from jsonb_array_elements(graph->'edges') loop edge_keys:=array_append(edge_keys,public.tool_planar_edge_key(edge->>0,edge->>1)); end loop;
  for mark in select jsonb_array_elements_text(s->'marks') loop
    parts:=string_to_array(replace(mark,'_',','),'.'); prefix:=parts[1]; nodes:=parts[2:array_length(parts,1)]; count_nodes:=coalesce(array_length(nodes,1),0);
    if position('.' in mark)=0 then return false; end if;
    if (path and prefix not in ('closed','stroke','through')) or (not path and prefix not in ('closed','figure','pick')) then return false; end if;
    if prefix='closed' then
      if count_nodes<>2 or not public.tool_planar_edge_key(nodes[1],nodes[2])=any(edge_keys) then return false; end if;
      closed:=array_append(closed,public.tool_planar_edge_key(nodes[1],nodes[2]));
    end if;
  end loop;
  for mark in select jsonb_array_elements_text(s->'marks') loop
    parts:=string_to_array(replace(mark,'_',','),'.'); prefix:=parts[1]; nodes:=parts[2:array_length(parts,1)]; count_nodes:=coalesce(array_length(nodes,1),0);
    if prefix='closed' then continue; end if;
    if count_nodes>0 then foreach node in array nodes loop if not points ? node then return false; end if; end loop; end if;
    if prefix='pick' then
      picks:=picks+1;
      if picks>1 or count_nodes>(case when id='48' then 3 else 2 end) then return false; end if;
    elsif prefix='through' then
      throughs:=throughs+1; if throughs>1 or count_nodes<>1 then return false; end if;
    elsif prefix='stroke' then
      if count_nodes=0 then return false; end if;
      for i in 2..count_nodes loop
        if not public.tool_planar_edge_key(nodes[i-1],nodes[i])=any(edge_keys) or public.tool_planar_edge_key(nodes[i-1],nodes[i])=any(closed) then return false; end if;
      end loop;
    elsif prefix='figure' then
      if count_nodes<2 or (select count(distinct value) from unnest(nodes) value)<>count_nodes then return false; end if;
      if id<>'47' and count_nodes>=3 and abs(public.tool_planar_cross(points->nodes[1],points->nodes[2],points->nodes[3]))<1e-6 then return false; end if;
      for i in 1..(case when id='47' then count_nodes-1 else count_nodes end) loop
        if not public.tool_planar_covered_segment(graph,nodes[i],nodes[i%count_nodes+1],closed) then return false; end if;
      end loop;
    end if;
  end loop;
  return id<>'53' or public.tool_space_number(s#>'{params,numberStep}',-1,(select count(*) from jsonb_each(points))-1,true);
exception when others then return false; end;
$$;
create function public.tool_planar_patterns_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare id text:=s->>'sceneId'; p jsonb:=s->'params'; q jsonb:=s->'points'; i integer; k text; x integer; y integer; dx integer; dy integer;
  occupied text[]:=array[]::text[]; removed text[]:=array[]::text[]; cell text;
begin
  if jsonb_array_length(s->'marks')>128 or (select count(*) from jsonb_each(p))>100 or (select count(*) from jsonb_each(q))>100 then return false; end if;
  if id='47' or id='52' then return public.tool_planar_graph_records_is_valid(s);
  elsif id='48' then return public.tool_space_number(p->'levels',2,4,true) and public.tool_planar_graph_records_is_valid(s);
  elsif id in ('49','53') then return public.tool_space_number(p->'columns',2,6,true) and public.tool_space_number(p->'rows',2,4,true) and public.tool_planar_graph_records_is_valid(s);
  elsif id='51' then
    if not public.tool_space_number(p->'count',1,48,true) or not public.tool_space_number(p->'selected',0,(p->>'count')::numeric-1,true) then return false; end if;
    for i in 0..(p->>'count')::integer-1 loop
      if not public.tool_planar_point(q->('match'||i),-5000,5000,-5000,5000) or not public.tool_space_number(p->('angle'||i),-36000,36000) then return false; end if;
    end loop; return true;
  elsif id='57' then
    if not public.tool_space_number(p->'count',0,18,true) or not public.tool_space_number(p->'selected',0,greatest(0,(p->>'count')::numeric-1),true) then return false; end if;
    for k in select jsonb_array_elements_text(s->'marks') loop
      if k!~'^missing\.[0-5]_[0-5]$' then return false; end if;
      removed:=array_append(removed,replace(substring(k from 9),'_',','));
    end loop;
    for i in 0..(p->>'count')::integer-1 loop
      if not public.tool_planar_point(q->('domino'||i),0,5,0,5,true) then return false; end if;
      x:=(q->('domino'||i)->>'x')::integer; y:=(q->('domino'||i)->>'y')::integer;
      dx:=case when coalesce((s->'flags'->>('vertical'||i))::boolean,false) then 0 else 1 end; dy:=1-dx;
      if x+dx>5 or y+dy>5 then return false; end if;
      foreach cell in array array[x||','||y,(x+dx)||','||(y+dy)] loop
        if cell=any(occupied) or cell=any(removed) then return false; end if; occupied:=array_append(occupied,cell);
      end loop;
    end loop; return true;
  end if; return false;
exception when others then return false; end;
$$;

create function public.tool_planar_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare initial jsonb:=s#>'{payload,initial}'; catalog text:=public.tool_planar_catalog_for_scene(initial->>'sceneId');
  k text; v jsonb; item jsonb;
begin
  if catalog is null or not coalesce(s->>'toolId'=catalog and s->>'contentVersion'=catalog||'-lesson-v1',false)
    or not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or octet_length(s::text)>150000
    or not public.tool_space_keys(initial,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or jsonb_typeof(initial->'sceneId') is distinct from 'string'
    or not public.tool_space_number(initial->'phase',0,1)
    or jsonb_typeof(initial->'params') is distinct from 'object' or jsonb_typeof(initial->'points') is distinct from 'object'
    or jsonb_typeof(initial->'flags') is distinct from 'object' or jsonb_typeof(initial->'marks') is distinct from 'array'
    or jsonb_array_length(initial->'marks')>512 then return false; end if;
  foreach k in array array['params','points','flags'] loop
    if (select count(*) from jsonb_each(initial->k))>256 then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(initial->'params') loop
    if k!~'^[a-zA-Z0-9_.-]{1,64}$' or k in ('__proto__','constructor','prototype') or not public.tool_space_number(v,-100000,100000) then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(initial->'points') loop
    if k!~'^[a-zA-Z0-9_.-]{1,64}$' or k in ('__proto__','constructor','prototype') or not public.tool_planar_point(v) then return false; end if;
  end loop;
  for k,v in select key,value from jsonb_each(initial->'flags') loop
    if k!~'^[a-zA-Z0-9_.-]{1,64}$' or k in ('__proto__','constructor','prototype') or jsonb_typeof(v) is distinct from 'boolean' then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(initial->'marks') loop
    if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}')!~'^[a-zA-Z0-9_.-]{1,64}$' or (item#>>'{}') in ('__proto__','constructor','prototype') then return false; end if;
  end loop;
  return coalesce(public.tool_planar_geometry_state_is_valid(initial) or public.tool_planar_area_state_is_valid(initial)
    or public.tool_planar_motion_state_is_valid(initial) or public.tool_planar_patterns_state_is_valid(initial),false);
exception when others then return false; end;
$$;

-- 辅助校验只由拥有者 RPC/文档约束使用，不增加新的公开调用面。
revoke all on function public.tool_planar_catalog_for_scene(text) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_point(jsonb,numeric,numeric,numeric,numeric,boolean) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_cross(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_on_segment(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_simple_polygon(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_geometry_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_area_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_motion_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_graph(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_edge_key(text,text) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_covered_segment(jsonb,text,text,text[]) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_graph_records_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_patterns_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_planar_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

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
    or public.tool_place_value_scene_is_valid(p_scene) or public.tool_planar_scene_is_valid(p_scene),false)
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
    when 'place-value-lesson-v1' then 'place-value'
    else case when p_scene->>'contentVersion'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')||'-lesson-v1'
      and p_scene->>'toolId'=public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}')
      then public.tool_planar_catalog_for_scene(p_scene#>>'{payload,initial,sceneId}') else null end end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check check (catalog_id in (
  'cube-structures','cube-net','solid-nets','dice','fraction-line','motion-lab','projection','solid-geometry','solid-capacity','solid-revolution','soma-cube','place-value',
  'plane-pieces','plane-geometry','plane-polygons','plane-perimeter','plane-measurement','plane-geoboard',
  'plane-area','plane-area-relations','plane-circle-area','plane-overlap','plane-motion','plane-folding','plane-tiling',
  'plane-patterns','plane-matchsticks','plane-graph-path','plane-grid-path','plane-reflection-path','plane-covering','plane-rolling','plane-clock'
));
notify pgrst, 'reload schema';
commit;
