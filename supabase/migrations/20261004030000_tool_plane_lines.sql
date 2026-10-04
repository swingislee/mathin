-- 线与角 v2 保存独立材料，无限线、垂足、平行关系和角弧均由控制点派生。
begin;
create function public.tool_plane_lines_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; pts jsonb:=s->'points'; count_value integer; i integer; kind integer;
  keys_p text[]:=array['count','active','vertex']; keys_pt text[]:=array[]::text[];
  name text; at jsonb; a jsonb; b jsonb; c jsonb; length_value double precision;
begin
  if public.tool_space_keys(s,array['sceneId','params','points','flags','marks','phase'],array['sceneId','params','points','flags','marks','phase']) is not true
    or s->>'sceneId' is distinct from '03-create' or not public.tool_space_number(s->'phase',0,0) or s->'marks' is distinct from '[]'::jsonb
    or jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(pts) is distinct from 'object'
    or not public.tool_space_number(p->'count',0,16,true) or not public.tool_space_number(p->'vertex',0,2,true)
    or public.tool_space_keys(s->'flags',array['grid','measures','names','detour','foot'],array['grid','measures','names','detour','foot']) is not true
    or exists(select 1 from jsonb_each(s->'flags') where jsonb_typeof(value)<>'boolean') then return false; end if;
  count_value:=(p->>'count')::numeric::integer;
  if not public.tool_space_number(p->'active',case when count_value=0 then -1 else 0 end,count_value-1,true) then return false; end if;
  if count_value>0 then for i in 0..count_value-1 loop
    keys_p:=keys_p||array['kind.'||i,'q.'||i];
    if not public.tool_space_number(p->('kind.'||i),0,6,true) or not public.tool_space_number(p->('q.'||i),-4000,4000) then return false; end if;
    kind:=(p->>('kind.'||i))::numeric::integer;
    foreach name in array array['a','b','c'] loop
      keys_pt:=array_append(keys_pt,name||'.'||i); at:=pts->(name||'.'||i);
      if public.tool_space_keys(at,array['x','y'],array['x','y']) is not true
        or not public.tool_space_number(at->'x',-4000,4000) or not public.tool_space_number(at->'y',-4000,4000) then return false; end if;
    end loop;
    a:=pts->('a.'||i); b:=pts->('b.'||i); c:=pts->('c.'||i);
    length_value:=sqrt(power((b->>'x')::double precision-(a->>'x')::double precision,2)+power((b->>'y')::double precision-(a->>'y')::double precision,2));
    if length_value<1-1e-8 or (kind=4 and (length_value<40-1e-8 or length_value>400+1e-8)) then return false; end if;
    if kind=3 and sqrt(power((c->>'x')::double precision-(a->>'x')::double precision,2)+power((c->>'y')::double precision-(a->>'y')::double precision,2))<1-1e-8 then return false; end if;
  end loop; end if;
  return public.tool_space_keys(p,keys_p,keys_p) and public.tool_space_keys(pts,keys_pt,keys_pt);
exception when others then return false; end;
$$;
create function public.tool_plane_lines_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(s->>'toolId'='plane-geometry' and s->>'contentVersion'='plane-geometry-lesson-v2'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_lines_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_lines_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_lines_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
