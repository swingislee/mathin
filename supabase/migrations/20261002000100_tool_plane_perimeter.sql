-- 周长 v2 只追加独立 helper；版本总入口由集成人统一接入，旧 v1 保持原合同。
begin;

create function public.tool_plane_perimeter_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; base_params jsonb:=s->'params'; object_key text; object_id text;
  progress_key text; progress_count integer:=0; object_count integer:=0;
begin
  if s->>'sceneId' is distinct from '10-create' or jsonb_typeof(p) is distinct from 'object' then return false; end if;
  for progress_key in select key from jsonb_object_keys(p) as parameter_keys(key) where key ~ '^(walk|straight)\.(0|[1-9][0-9]{0,4})$' loop
    if not public.tool_space_number(p->progress_key,0,1) then return false; end if;
    base_params:=base_params-progress_key; progress_count:=progress_count+1;
  end loop;
  if public.tool_plane_construction_state_is_valid(jsonb_set(jsonb_set(s,'{sceneId}','"01-create"'),'{params}',base_params)) is not true then return false; end if;
  for object_key in select key from jsonb_object_keys(base_params) as object_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$' loop
    object_id:=substring(object_key from 6); object_count:=object_count+1;
    if (p->>object_key)::numeric not in (0,1)
      or (p->>('life.'||object_id))::numeric<>0 or (p->>('detail.'||object_id))::numeric<>0
      or not (p ? ('walk.'||object_id)) or not (p ? ('straight.'||object_id)) then return false; end if;
  end loop;
  return progress_count=object_count*2;
exception when others then return false; end;
$$;

create function public.tool_plane_perimeter_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    s->>'toolId'='plane-perimeter' and s->>'contentVersion'='plane-perimeter-lesson-v2'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_perimeter_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_perimeter_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_perimeter_scene_is_valid(jsonb) from public,anon,authenticated,service_role;
commit;
