-- 两类路线工作台独立 v2 材料合同；旧版读取与统一分发由后续迁移保留和接入。
begin;

create function public.tool_plane_routes_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; f jsonb:=s->'flags'; q jsonb:=s->'points'; m jsonb:=s->'marks';
  is_grid boolean; allowed text[]; flag_keys text[]; point_keys text[];
  ids integer[]:=array[]::integer[]; id integer; candidate_key text; value jsonb; point jsonb;
  next_id integer; active_id integer; cols integer; rows integer; direction integer;
  visits integer:=0; visit_count integer; step integer; x integer; y integer; px integer; py integer;
  sx integer; sy integer; ex integer; ey integer; edge_key text; edge_bit integer;
  mark jsonb; parts text[]; step_key text; positions jsonb:='{}'::jsonb;
begin
  if not public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase'])
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object'
    or jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(m) is distinct from 'array'
    or not public.tool_space_number(s->'phase',0,1)
    or s->>'sceneId' not in ('53-create','54-create') or s->>'sceneId' is null then return false; end if;
  is_grid:=s->>'sceneId'='53-create';
  if not public.tool_space_number(p->'nextId',0,99999,true) or not public.tool_space_number(p->'active',-1,99998,true)
    or f->'grid' is distinct from 'false'::jsonb then return false; end if;
  next_id:=(p->>'nextId')::numeric::integer; active_id:=(p->>'active')::numeric::integer;
  allowed:=case when is_grid then array['columns','rows','nextId','active','direction','numberStep'] else array['axisAngle','nextId','active','viewX','viewY','viewSpan'] end;
  flag_keys:=case when is_grid then array['grid','measures','names','required','shortest','highlights'] else array['grid','measures','mirror','shortest','names','highlights'] end;
  point_keys:=case when is_grid then array['start','end','required'] else array['a','b','axis'] end;
  if not public.tool_space_keys(f,flag_keys,flag_keys) or not public.tool_space_keys(q,point_keys,point_keys)
    or exists(select 1 from jsonb_each(f) as flags where jsonb_typeof(flags.value) is distinct from 'boolean') then return false; end if;
  for candidate_key,value in select * from jsonb_each(p) loop
    if candidate_key ~ (case when is_grid then '^visits\.(0|[1-9][0-9]{0,4})$' else '^contact\.(0|[1-9][0-9]{0,4})$' end) then
      id:=split_part(candidate_key,'.',2)::integer;
      if id>=next_id or id>99998 or not public.tool_space_number(value,case when is_grid then 1 else -5000 end,case when is_grid then 480 else 5000 end,is_grid) then return false; end if;
      ids:=array_append(ids,id); allowed:=array_append(allowed,candidate_key);
      if is_grid then visits:=visits+(value::text)::numeric::integer; end if;
    end if;
  end loop;
  if cardinality(ids)>8 or (cardinality(ids)=0 and active_id<>-1) or (cardinality(ids)>0 and not active_id=any(ids)) then return false; end if;
  if not is_grid then
    if jsonb_array_length(m)<>0 or not public.tool_space_keys(p,allowed,allowed)
      or not public.tool_space_number(p->'axisAngle',-180,180) or not public.tool_space_number(p->'viewX',-1000,1000)
      or not public.tool_space_number(p->'viewY',-1000,1000) or not public.tool_space_number(p->'viewSpan',1,20000) then return false; end if;
    for point in select point_values.value from jsonb_each(q) as point_values loop
      if not public.tool_space_keys(point,array['x','y'],array['x','y'])
        or not public.tool_space_number(point->'x',-1000,1000) or not public.tool_space_number(point->'y',-1000,1000) then return false; end if;
    end loop;
    return true;
  end if;
  if not public.tool_space_number(p->'columns',1,12,true) or not public.tool_space_number(p->'rows',1,12,true)
    or not public.tool_space_number(p->'direction',0,1,true) or visits>480 or jsonb_array_length(m)<>visits then return false; end if;
  cols:=(p->>'columns')::numeric::integer; rows:=(p->>'rows')::numeric::integer; direction:=(p->>'direction')::numeric::integer;
  if not public.tool_space_number(p->'numberStep',-1,(cols+1)*(rows+1)-1,true) then return false; end if;
  for point in select point_values.value from jsonb_each(q) as point_values loop
    if not public.tool_space_keys(point,array['x','y'],array['x','y'])
      or not public.tool_space_number(point->'x',0,cols,true) or not public.tool_space_number(point->'y',0,rows,true) then return false; end if;
  end loop;
  for y in 0..rows loop
    candidate_key:='h.'||y; allowed:=array_append(allowed,candidate_key);
    if not public.tool_space_number(p->candidate_key,0,(1<<cols)-1,true) then return false; end if;
  end loop;
  for x in 0..cols loop
    candidate_key:='v.'||x; allowed:=array_append(allowed,candidate_key);
    if not public.tool_space_number(p->candidate_key,0,(1<<rows)-1,true) then return false; end if;
  end loop;
  if not public.tool_space_keys(p,allowed,allowed) then return false; end if;
  for mark in select * from jsonb_array_elements(m) loop
    if jsonb_typeof(mark) is distinct from 'string' then return false; end if;
    parts:=regexp_match(mark#>>'{}','^visit\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]?)_(0|[1-9][0-9]?)$');
    if parts is null then return false; end if;
    id:=parts[1]::integer; step:=parts[2]::integer; x:=parts[3]::integer; y:=parts[4]::integer; step_key:=id||'.'||step;
    if not id=any(ids) or positions ? step_key or step>=(p->>('visits.'||id))::numeric::integer or x>cols or y>rows then return false; end if;
    positions:=positions||jsonb_build_object(step_key,jsonb_build_array(x,y));
  end loop;
  sx:=(q#>>'{start,x}')::numeric::integer; sy:=(q#>>'{start,y}')::numeric::integer; ex:=(q#>>'{end,x}')::numeric::integer; ey:=(q#>>'{end,y}')::numeric::integer;
  foreach id in array ids loop
    visit_count:=(p->>('visits.'||id))::numeric::integer;
    for step in 0..visit_count-1 loop
      point:=positions->(id||'.'||step);
      if point is null then return false; end if;
      x:=(point->>0)::integer; y:=(point->>1)::integer;
      if step=0 then
        if x<>sx or y<>sy then return false; end if;
      else
        if abs(x-px)+abs(y-py)<>1 then return false; end if;
        edge_key:=case when y=py then 'h.'||y else 'v.'||x end;
        edge_bit:=case when y=py then least(x,px) else least(y,py) end;
        if ((p->>edge_key)::numeric::integer & (1<<edge_bit))<>0
          or (direction=0 and ((x<>px and x-px<>sign(ex-sx)) or (y<>py and y-py<>sign(ey-sy)))) then return false; end if;
      end if;
      px:=x; py:=y;
    end loop;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_routes_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  title text; title_units integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  -- 与 Zod 的 JavaScript trim / UTF-16 长度保持一致，包含全角空白和辅助平面字符。
  title:=btrim(s#>>'{payload,title}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'') as chars(codepoint);
  return coalesce(title_units between 1 and 80 and (
    (s->>'toolId'='plane-grid-path' and s->>'contentVersion'='plane-grid-path-lesson-v2' and s#>>'{payload,initial,sceneId}'='53-create')
    or (s->>'toolId'='plane-reflection-path' and s->>'contentVersion'='plane-reflection-path-lesson-v2' and s#>>'{payload,initial,sceneId}'='54-create'))
    and public.tool_plane_routes_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_routes_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_routes_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
