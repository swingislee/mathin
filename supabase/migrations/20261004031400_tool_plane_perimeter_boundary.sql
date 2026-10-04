-- 组合成员与原边段纯平移合同；边界和测量只由原材料实时计算，不持久化派生结果。
begin;

create function public.tool_plane_perimeter_boundary_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags'; base_state jsonb; bp jsonb; bq jsonb; bf jsonb;
  pkeys text[]; qkeys text[]; fkeys text[]; ids integer[]; id integer; i integer; source_id integer; active_edge integer; edge_count integer:=0;
  boundary_flags text[]:=array['unionBoundary','unionSeams','unionCovered','unionHoles'];
begin
  if s->>'sceneId' is distinct from '10-boundary' or jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object'
    or not public.tool_space_number(p->'edgeSource',-1,99998,true) or not public.tool_space_number(p->'edgeActive',-1,31,true) then return false; end if;
  if (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(q))>256 then return false; end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into bp from jsonb_each(p) where key not like 'unionMember.%' and key not in ('edgeSource','edgeActive');
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into bq from jsonb_each(q) where key not like 'edgeMove.%';
  bf:=f-boundary_flags;
  base_state:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(s,'{sceneId}','"10-create"'),'{params}',bp),'{points}',bq),'{flags}',bf);
  if public.tool_plane_perimeter_state_is_valid(base_state) is not true then return false; end if;
  select coalesce(array_agg(key),array[]::text[]) into pkeys from jsonb_object_keys(bp) as fields(key);
  select coalesce(array_agg(key),array[]::text[]) into qkeys from jsonb_object_keys(bq) as fields(key);
  select coalesce(array_agg(key),array[]::text[]) into fkeys from jsonb_object_keys(bf) as fields(key);
  select coalesce(array_agg(substring(key from 6)::integer),array[]::integer[]) into ids from jsonb_object_keys(bp) as fields(key) where key~'^kind\.(0|[1-9][0-9]{0,4})$';
  pkeys:=pkeys||array['edgeSource','edgeActive']; fkeys:=fkeys||boundary_flags;
  source_id:=(p->>'edgeSource')::numeric::integer; active_edge:=(p->>'edgeActive')::numeric::integer;
  if source_id=-1 then
    if active_edge<>-1 then return false; end if;
  else
    if not source_id=any(ids) then return false; end if;
    edge_count:=(bp->>('count.'||source_id))::numeric::integer;
    if active_edge<0 or active_edge>=edge_count then return false; end if;
  end if;
  foreach id in array ids loop
    pkeys:=array_append(pkeys,'unionMember.'||id);
    if not public.tool_space_number(p->('unionMember.'||id),0,1,true) then return false; end if;
  end loop;
  if edge_count>0 then for i in 0..edge_count-1 loop
    qkeys:=array_append(qkeys,'edgeMove.'||i);
    if not public.tool_planar_point(q->('edgeMove.'||i),-50000,50000,-50000,50000) then return false; end if;
  end loop; end if;
  return public.tool_space_keys(p,pkeys,pkeys) and public.tool_space_keys(q,qkeys,qkeys) and public.tool_space_keys(f,fkeys,fkeys)
    and not exists(select 1 from jsonb_each(f) where jsonb_typeof(value)<>'boolean');
exception when others then return false; end;
$$;

create function public.tool_plane_perimeter_boundary_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare title text; title_units integer;
begin
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or octet_length(s::text)>150000 then return false; end if;
  -- 与 Zod 的 JavaScript trim / UTF-16 长度保持一致。
  title:=btrim(s#>>'{payload,title}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'') as chars(codepoint);
  return coalesce(title_units between 1 and 80 and s->>'toolId'='plane-perimeter' and s->>'contentVersion'='plane-perimeter-lesson-v3'
    and public.tool_plane_perimeter_boundary_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_perimeter_boundary_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_perimeter_boundary_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
