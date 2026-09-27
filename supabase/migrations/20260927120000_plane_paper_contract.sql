-- 剪拼 v2 复用真实构造材料的严格数学合同，只接受直边纸片。
-- 本迁移仅定义独立 helper；版本总入口由本批统一接入迁移追加，旧课件不改写。
begin;

create function public.tool_plane_paper_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare object_key text; object_id text;
begin
  if s->>'sceneId' is distinct from '14-create'
    or public.tool_plane_construction_state_is_valid(jsonb_set(s,'{sceneId}','"01-create"')) is not true
    then return false; end if;
  for object_key in select key from jsonb_object_keys(s->'params') as object_keys(key) where key like 'kind.%' loop
    object_id:=substring(object_key from 6);
    if (s#>>array['params',object_key])::numeric not in (0,1)
      or (s#>>array['params','life.'||object_id])::numeric<>0
      or (s#>>array['params','detail.'||object_id])::numeric<>0 then return false; end if;
  end loop;
  return true;
exception when others then return false; end;
$$;

create function public.tool_plane_paper_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(
    s->>'toolId'='plane-area' and s->>'contentVersion'='plane-area-lesson-v2'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_paper_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;
revoke all on function public.tool_plane_paper_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_paper_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
