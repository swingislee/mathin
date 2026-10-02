-- 只追加面积关系内点 v3；原 v1/v2、RLS、草稿及冻结副本不改写。
begin;

create function public.tool_plane_interior_state_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare
  p jsonb:=s->'params'; f jsonb:=s->'flags'; base_p jsonb; base_f jsonb; base_state jsonb;
  ids integer[]; object_id integer; prefix text;
begin
  if s->>'sceneId' is distinct from '18-interior' or jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(f) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p))>256 or (select count(*) from jsonb_object_keys(f))>256 then return false; end if;
  select coalesce(array_agg(substring(key from 6)::integer),array[]::integer[]) into ids
    from jsonb_object_keys(p) as parameter_keys(key) where key ~ '^kind\.(0|[1-9][0-9]{0,4})$';
  base_p:=p; base_f:=f;
  foreach object_id in array ids loop
    foreach prefix in array array['innerBase','innerHeight'] loop
      if not public.tool_space_number(p->(prefix||'.'||object_id),0.05,0.95) then return false; end if;
      base_p:=base_p-(prefix||'.'||object_id);
    end loop;
    foreach prefix in array array['interior','collinear'] loop
      if jsonb_typeof(f->(prefix||'.'||object_id)) is distinct from 'boolean' then return false; end if;
      base_f:=base_f-(prefix||'.'||object_id);
    end loop;
    if (p->>('count.'||object_id))::numeric<>3
      and ((f->>('interior.'||object_id))::boolean or (f->>('collinear.'||object_id))::boolean) then return false; end if;
    if (f->>('collinear.'||object_id))::boolean and (p->('innerBase.'||object_id)) is distinct from (p->('fraction.'||object_id)) then return false; end if;
  end loop;
  base_state:=jsonb_set(jsonb_set(jsonb_set(s,'{sceneId}','"18-create"'),'{params}',base_p),'{flags}',base_f);
  return public.tool_plane_relations_state_is_valid(base_state);
exception when others then return false; end;
$$;

create function public.tool_plane_interior_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
begin
  return coalesce(s->>'toolId'='plane-area-relations' and s->>'contentVersion'='plane-area-relations-lesson-v3'
    and public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    and public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    and jsonb_typeof(s#>'{payload,title}')='string' and char_length(btrim(s#>>'{payload,title}')) between 1 and 80
    and octet_length(s::text)<=150000 and public.tool_plane_interior_state_is_valid(s#>'{payload,initial}'),false);
exception when others then return false; end;
$$;

revoke all on function public.tool_plane_interior_state_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_plane_interior_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_relations_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_interior_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_INTERIOR_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_interior_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-area-relations-lesson-v2'' then ''plane-area-relations''';
  if strpos(source,needle)=0 or strpos(source,'''plane-area-relations-lesson-v3''')>0 then raise exception 'PLANE_INTERIOR_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-area-relations-lesson-v3'' then ''plane-area-relations''');
end $$;
notify pgrst, 'reload schema';
commit;
