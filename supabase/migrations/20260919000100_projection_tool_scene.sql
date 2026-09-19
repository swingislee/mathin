-- 独立投射教具登记到 Tools 共用场景；沿用现有表、RPC、RLS 和课件冻结流程。
begin;

create function public.tool_projection_scene_is_valid(p_scene jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare initial jsonb := p_scene #> '{payload,initial}'; views jsonb := initial -> 'views';
begin
  if not coalesce(jsonb_typeof(p_scene) = 'object'
    and p_scene - array['toolId','contentVersion','payload'] = '{}'::jsonb
    and p_scene ->> 'toolId' = 'projection' and p_scene ->> 'contentVersion' = 'projection-lesson-v1'
    and jsonb_typeof(p_scene -> 'payload') = 'object'
    and (p_scene -> 'payload') - array['title','initial'] = '{}'::jsonb
    and jsonb_typeof(p_scene #> '{payload,title}') = 'string'
    and char_length(btrim(p_scene #>> '{payload,title}')) between 1 and 80
    and jsonb_typeof(initial) = 'object'
    and initial - array['structure','views','guides'] = '{}'::jsonb
    and initial ?& array['structure','views','guides']
    and jsonb_typeof(initial -> 'guides') = 'boolean'
    and jsonb_typeof(views) = 'array' and jsonb_array_length(views) <= 3, false) then return false; end if;
  if exists(select 1 from jsonb_array_elements(views) v where jsonb_typeof(v) <> 'string' or v #>> '{}' not in ('front','right','top'))
    or (select count(*) <> count(distinct v) from jsonb_array_elements(views) v) then return false; end if;
  return public.cw_cube_structures_tool_is_valid(jsonb_build_object(
    'toolId','spatial-lab','contentVersion','cube-structures-lesson-v2',
    'payload',jsonb_build_object('title',p_scene #> '{payload,title}','toolbar','[]'::jsonb,
      'history',jsonb_build_object('version','cube-structures-draft-v3','initial',initial -> 'structure','operations','[]'::jsonb,'cursor',0))));
exception when others then return false;
end;
$$;
comment on function public.tool_projection_scene_is_valid(jsonb)
  is 'Projection v1 structural gate; cube geometry uses the existing structural gate and full server-side scene schema.';
revoke all on function public.tool_projection_scene_is_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function public.tool_scene_is_valid(p_scene jsonb)
returns boolean language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(
    (p_scene ->> 'contentVersion' = 'cube-structures-lesson-v2' and public.cw_cube_structures_tool_is_valid(p_scene))
    or public.cw_spatial_teaching_tool_is_valid(p_scene)
    or public.tool_numeric_scene_is_valid(p_scene)
    or public.tool_projection_scene_is_valid(p_scene), false)
    and octet_length(p_scene::text) <= 750000;
$$;
create or replace function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select case p_scene ->> 'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    when 'projection-lesson-v1' then 'projection' else null end;
$$;
alter table public.tool_scene_drafts drop constraint tool_scene_drafts_catalog_id_check;
alter table public.tool_scene_drafts add constraint tool_scene_drafts_catalog_id_check
  check (catalog_id in ('cube-structures','cube-net','dice','fraction-line','motion-lab','projection'));
notify pgrst, 'reload schema';
commit;
