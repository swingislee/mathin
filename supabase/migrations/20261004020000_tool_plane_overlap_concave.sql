-- 凹凸直边纸片 v3：保存真实材料及 A/B 引用，布尔区域由几何派生。
begin;

create function public.tool_plane_overlap_concave_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; base_state jsonb; ids integer[];
  object_id integer; pair_a integer; pair_b integer;
begin
  if s->>'sceneId' is distinct from '33-concave' or jsonb_typeof(p) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p))>256
    or not public.tool_space_number(p->'pairA',-1,99998,true) or not public.tool_space_number(p->'pairB',-1,99998,true)
    or not public.tool_space_number(p->'region',0,3,true) then return false; end if;
  base_state:=jsonb_set(jsonb_set(s,'{sceneId}','"01-create"'),'{params}',p-array['pairA','pairB','region']);
  -- construction helper 已严格守卫数量、点位、类型、矩形、简单轮廓、标记和全部 key。
  if public.tool_plane_construction_state_is_valid(base_state) is not true then return false; end if;
  select coalesce(array_agg(substring(key from 6)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as parameter_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  pair_a:=(p->>'pairA')::numeric::integer; pair_b:=(p->>'pairB')::numeric::integer;
  if (pair_a<>-1 and not pair_a=any(ids)) or (pair_b<>-1 and not pair_b=any(ids)) or (pair_a>=0 and pair_a=pair_b) then return false; end if;
  foreach object_id in array ids loop
    if (p->>('kind.'||object_id))::numeric not in (0,1) or (p->>('life.'||object_id))::numeric<>0 or (p->>('detail.'||object_id))::numeric<>0 then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_overlap_concave_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    s->>'toolId'='plane-overlap' and s->>'contentVersion'='plane-overlap-lesson-v3'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_overlap_concave_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_overlap_concave_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_overlap_concave_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
