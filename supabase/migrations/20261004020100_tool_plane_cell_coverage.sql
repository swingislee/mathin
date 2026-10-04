-- 只追加完整格／边界格 v5 校验；v4 条带及更早版本保持独立，统一分发由后续迁移接入。
begin;

create function public.tool_plane_cell_coverage_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; f jsonb:=s->'flags'; base_p jsonb; base_f jsonb; base_state jsonb;
  ids integer[]; object_id integer;
begin
  if s->>'sceneId' is distinct from '18-coverage' or jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(f) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(f))>256 then return false; end if;
  select coalesce(array_agg(substring(key from 6)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as parameter_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  base_p:=p; base_f:=f;
  foreach object_id in array ids loop
    if not public.tool_space_number(p->('coverCount.'||object_id),4,48)
      or (p->>('coverCount.'||object_id))::numeric<>trunc((p->>('coverCount.'||object_id))::numeric)
      or jsonb_typeof(f->('coverCells.'||object_id)) is distinct from 'boolean' then return false; end if;
    if (p->>('count.'||object_id))::numeric<>3 and (f->>('coverCells.'||object_id))::boolean then return false; end if;
    base_p:=base_p-('coverCount.'||object_id); base_f:=base_f-('coverCells.'||object_id);
  end loop;
  base_state:=jsonb_set(jsonb_set(jsonb_set(s,'{sceneId}','"18-strips"'),'{params}',base_p),'{flags}',base_f);
  return public.tool_plane_strips_state_is_valid(base_state);
exception when others then return false; end;
$$;

create function public.tool_plane_cell_coverage_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(s->>'toolId'='plane-area-relations' and s->>'contentVersion'='plane-area-relations-lesson-v5'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_cell_coverage_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_cell_coverage_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_cell_coverage_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

commit;
