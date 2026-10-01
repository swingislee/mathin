-- 面积关系与凸纸片重叠的独立 v2 helper；本迁移不改总入口、RLS 或既有内容。
-- 两类材料复用 construction 精确点位合同，辅助几何与面积均由来源材料派生。
begin;

create function public.tool_plane_relations_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; f jsonb:=s->'flags';
  base_p jsonb; base_f jsonb; base_state jsonb; ids integer[]; object_id integer; n integer; i integer;
  prefix text; turn double precision; positive boolean; negative boolean;
  a jsonb; b jsonb; c jsonb;
begin
  if s->>'sceneId' is distinct from '18-create' or jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(f) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(f))>256 then return false; end if;
  select coalesce(array_agg(substring(key from 6)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as parameter_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  base_p:=p; base_f:=f;
  foreach object_id in array ids loop
    foreach prefix in array array['base','fraction'] loop base_p:=base_p-(prefix||'.'||object_id); end loop;
    foreach prefix in array array['height','division','parallel','diagonals','midpoints'] loop base_f:=base_f-(prefix||'.'||object_id); end loop;
  end loop;
  base_state:=jsonb_set(jsonb_set(jsonb_set(s,'{sceneId}','"01-create"'),'{params}',base_p),'{flags}',base_f);
  if public.tool_plane_construction_state_is_valid(base_state) is not true then return false; end if;
  foreach object_id in array ids loop
    n:=(p->>('count.'||object_id))::numeric::integer;
    if n not in (3,4) or (p->>('kind.'||object_id))::numeric not in (0,1)
      or (p->>('life.'||object_id))::numeric<>0 or (p->>('detail.'||object_id))::numeric<>0
      or not public.tool_space_number(p->('base.'||object_id),0,n-1,true)
      or not public.tool_space_number(p->('fraction.'||object_id),0.05,0.95) then return false; end if;
    foreach prefix in array array['height','division','parallel','diagonals','midpoints'] loop
      if jsonb_typeof(f->(prefix||'.'||object_id)) is distinct from 'boolean' then return false; end if;
    end loop;
    if (n=3 and (f->>('diagonals.'||object_id))::boolean)
      or (n=4 and ((f->>('division.'||object_id))::boolean or (f->>('parallel.'||object_id))::boolean or (f->>('midpoints.'||object_id))::boolean)) then return false; end if;
    positive:=false; negative:=false;
    for i in 0..n-1 loop
      a:=q->('vertex.'||object_id||'.'||i); b:=q->('vertex.'||object_id||'.'||((i+1)%n)); c:=q->('vertex.'||object_id||'.'||((i+2)%n));
      turn:=public.tool_planar_cross(a,b,c);
      if abs(turn)<=1e-7 then return false; end if;
      positive:=positive or turn>1e-7; negative:=negative or turn< -1e-7;
      if positive and negative then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_overlap_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; q jsonb:=s->'points'; base_state jsonb; ids integer[];
  object_id integer; pair_a integer; pair_b integer; n integer; i integer;
  turn double precision; positive boolean; negative boolean; a jsonb; b jsonb; c jsonb;
begin
  if s->>'sceneId' is distinct from '33-create' or jsonb_typeof(p) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p))>256
    or not public.tool_space_number(p->'pairA',-1,99998,true) or not public.tool_space_number(p->'pairB',-1,99998,true)
    or not public.tool_space_number(p->'region',0,3,true) then return false; end if;
  base_state:=jsonb_set(jsonb_set(s,'{sceneId}','"01-create"'),'{params}',p-array['pairA','pairB','region']);
  if public.tool_plane_construction_state_is_valid(base_state) is not true then return false; end if;
  select coalesce(array_agg(substring(key from 6)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as parameter_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  pair_a:=(p->>'pairA')::numeric::integer; pair_b:=(p->>'pairB')::numeric::integer;
  if (pair_a<>-1 and not pair_a=any(ids)) or (pair_b<>-1 and not pair_b=any(ids)) or (pair_a>=0 and pair_a=pair_b) then return false; end if;
  foreach object_id in array ids loop
    n:=(p->>('count.'||object_id))::numeric::integer;
    if (p->>('kind.'||object_id))::numeric not in (0,1) or (p->>('life.'||object_id))::numeric<>0 or (p->>('detail.'||object_id))::numeric<>0 then return false; end if;
    positive:=false; negative:=false;
    for i in 0..n-1 loop
      a:=q->('vertex.'||object_id||'.'||i); b:=q->('vertex.'||object_id||'.'||((i+1)%n)); c:=q->('vertex.'||object_id||'.'||((i+2)%n));
      turn:=public.tool_planar_cross(a,b,c);
      -- 同向共线编辑点允许保留；构造 helper 已排除折返、自交与退化。
      positive:=positive or turn>1e-7; negative:=negative or turn< -1e-7;
      if positive and negative then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_relations_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    s->>'toolId'='plane-area-relations' and s->>'contentVersion'='plane-area-relations-lesson-v2'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_relations_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

create function public.tool_plane_overlap_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    s->>'toolId'='plane-overlap' and s->>'contentVersion'='plane-overlap-lesson-v2'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_overlap_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_relations_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_relations_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_overlap_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_overlap_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
