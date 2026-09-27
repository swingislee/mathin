-- 镶嵌保存独立的真实多边形，复用共用几何预算与严格校验。
begin;
create function public.tool_plane_tiling_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare k text; object_id text;
begin
  if s->>'sceneId' is distinct from '36-create'
    or not public.tool_plane_construction_state_is_valid(jsonb_set(s,'{sceneId}','"01-create"')) then return false; end if;
  for k in select key from jsonb_object_keys(s->'params') as keys(key) where key like 'kind.%' loop
    object_id:=substring(k from 6);
    if (s->'params'->>k)::numeric not in (0,1)
      or (s->'params'->>('life.'||object_id))::numeric<>0
      or (s->'params'->>('detail.'||object_id))::numeric<>0 then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_tiling_state_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
