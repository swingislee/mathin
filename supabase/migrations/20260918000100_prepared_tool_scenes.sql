-- Tools 共用场景草稿与固定副本。旧立方体草稿、课件 revision 和 release 保持原样。
begin;

create function public.tool_numeric_scene_is_valid(p_tool jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare initial jsonb := p_tool #> '{payload,initial}'; item jsonb; key text; total integer := 0;
begin
  if not coalesce(jsonb_typeof(p_tool) = 'object'
    and p_tool - array['toolId','contentVersion','payload'] = '{}'::jsonb
    and ((p_tool ->> 'toolId' = 'fraction-line' and p_tool ->> 'contentVersion' = 'fraction-line-lesson-v1')
      or (p_tool ->> 'toolId' = 'motion-lab' and p_tool ->> 'contentVersion' = 'motion-lab-lesson-v1'))
    and jsonb_typeof(p_tool -> 'payload') = 'object'
    and (p_tool -> 'payload') - array['title','initial'] = '{}'::jsonb
    and jsonb_typeof(p_tool #> '{payload,title}') = 'string'
    and char_length(btrim(p_tool #>> '{payload,title}')) between 1 and 80
    and jsonb_typeof(initial) = 'object' and octet_length(p_tool::text) <= 300000, false) then return false; end if;
  if p_tool ->> 'toolId' = 'fraction-line' then
    if not coalesce(initial - array['rows','denomText','zoomPow','showTicks','showGuides','zeroX'] = '{}'::jsonb
      and initial ?& array['rows','denomText','zoomPow','showTicks','showGuides','zeroX']
      and jsonb_typeof(initial -> 'rows') = 'array' and jsonb_array_length(initial -> 'rows') <= 32
      and jsonb_typeof(initial -> 'denomText') = 'string' and initial ->> 'denomText' ~ '^[0-9]{0,5}$'
      and jsonb_typeof(initial -> 'zoomPow') = 'number' and (initial ->> 'zoomPow')::numeric between 1 and 6.079181246047625
      and jsonb_typeof(initial -> 'zeroX') = 'number' and (initial ->> 'zeroX')::numeric between -200000000 and 20000
      and jsonb_typeof(initial -> 'showTicks') = 'boolean' and jsonb_typeof(initial -> 'showGuides') = 'boolean', false) then return false; end if;
    for item in select value from jsonb_array_elements(initial -> 'rows') loop
      if not coalesce(jsonb_typeof(item) = 'object' and item - array['denominator','count','color'] = '{}'::jsonb
        and jsonb_typeof(item -> 'denominator') = 'number' and (item ->> 'denominator') ~ '^[0-9]+$' and (item ->> 'denominator')::numeric between 1 and 10000
        and jsonb_typeof(item -> 'count') = 'number' and (item ->> 'count') ~ '^[0-9]+$' and (item ->> 'count')::numeric between 1 and 2000
        and item ->> 'color' in ('var(--rose)','var(--leaf-deep)','var(--ink)','var(--crater)','var(--rose-deep)','var(--leaf)'), false) then return false; end if;
      total := total + (item ->> 'count')::integer;
    end loop;
    if total > 2000 then return false; end if;
  else
    if not coalesce(initial - array['length','runways','showRuler','allTime','allSpeed','playback'] = '{}'::jsonb
      and initial ?& array['length','runways','showRuler','allTime','allSpeed','playback']
      and jsonb_typeof(initial -> 'length') = 'number' and (initial ->> 'length')::numeric > 0 and (initial ->> 'length')::numeric <= 1000000000
      and jsonb_typeof(initial -> 'showRuler') = 'boolean'
      and initial -> 'playback' = '{"phase":"idle","elapsedMs":0,"startedAt":0}'::jsonb
      and jsonb_typeof(initial -> 'runways') = 'array' and jsonb_array_length(initial -> 'runways') between 1 and 12, false) then return false; end if;
    foreach key in array array['allTime','allSpeed'] loop
      if not coalesce(jsonb_typeof(initial -> key) = 'number' and (initial ->> key)::numeric between 0 and 1000000000, false) then return false; end if;
    end loop;
    if (select count(distinct r ->> 'id') from jsonb_array_elements(initial -> 'runways') r) <> jsonb_array_length(initial -> 'runways') then return false; end if;
    for item in select value from jsonb_array_elements(initial -> 'runways') loop
      if not coalesce(jsonb_typeof(item) = 'object' and item - array['id','head','vehicle','facingRight','x','solve','distance','time','speed'] = '{}'::jsonb
        and item ?& array['id','head','vehicle','facingRight','x','solve','distance','time','speed']
        and jsonb_typeof(item -> 'id') = 'number' and item ->> 'id' ~ '^[1-9][0-9]*$' and (item ->> 'id')::numeric <= 1000000000
        and jsonb_typeof(item -> 'facingRight') = 'boolean' and item ->> 'solve' in ('distance','time','speed'), false) then return false; end if;
      foreach key in array array['x','distance','time','speed'] loop
        if not coalesce(jsonb_typeof(item -> key) = 'number' and (item ->> key)::numeric between 0 and 1000000000, false) then return false; end if;
      end loop;
      if (item ->> 'x')::numeric > (initial ->> 'length')::numeric then return false; end if;
      foreach key in array array['head','vehicle'] loop
        if not coalesce(jsonb_typeof(item -> key) = 'string' and char_length(item ->> key) <= 128000
          and ((item ->> key) ~ '^/assets/tools/motion/(head|01-walk|02-bicycle|03-car|04-plane|05-rocket|06-cloud|07-wormhole)\.png$'
            or (item ->> key) ~ '^data:image/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$'), false) then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.tool_numeric_scene_is_valid(jsonb) from public, anon, authenticated, service_role;

create function public.tool_scene_is_valid(p_scene jsonb)
returns boolean language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(
    (p_scene ->> 'contentVersion' = 'cube-structures-lesson-v2' and public.cw_cube_structures_tool_is_valid(p_scene))
    or public.cw_spatial_teaching_tool_is_valid(p_scene)
    or public.tool_numeric_scene_is_valid(p_scene), false)
    and octet_length(p_scene::text) <= 750000;
$$;
revoke all on function public.tool_scene_is_valid(jsonb) from public, anon, authenticated, service_role;

create function public.tool_scene_catalog_id(p_scene jsonb)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select case p_scene ->> 'contentVersion'
    when 'cube-structures-lesson-v2' then 'cube-structures'
    when 'cube-net-lesson-v1' then 'cube-net' when 'dice-lesson-v1' then 'dice'
    when 'fraction-line-lesson-v1' then 'fraction-line' when 'motion-lab-lesson-v1' then 'motion-lab'
    else null end;
$$;
revoke all on function public.tool_scene_catalog_id(jsonb) from public, anon, authenticated, service_role;

create function public.tool_drafts_account_ready()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid()
    and p.is_active and p.account_status = 'active' and not p.password_change_required)
    and coalesce(public.has_current_required_consents(auth.uid()), false);
$$;
revoke all on function public.tool_drafts_account_ready() from public, anon;
grant execute on function public.tool_drafts_account_ready() to authenticated;

-- 原接口兼容同一套账号边界；不改旧记录结构或保存语义。
create or replace function public.cube_drafts_account_ready()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.tool_drafts_account_ready();
$$;

create table public.tool_scene_drafts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  catalog_id text not null check (catalog_id in ('cube-structures','cube-net','dice','fraction-line','motion-lab')),
  revision integer not null default 1 check (revision > 0),
  scene jsonb not null check (public.tool_scene_is_valid(scene) is true
    and catalog_id = public.tool_scene_catalog_id(scene) and name = scene #>> '{payload,title}'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tool_scene_drafts_owner_updated_idx on public.tool_scene_drafts(owner_id, updated_at desc, id);
alter table public.tool_scene_drafts enable row level security;
create policy tool_scene_drafts_owner_read on public.tool_scene_drafts for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.tool_drafts_account_ready()));
revoke all on public.tool_scene_drafts from public, anon, authenticated;
grant select on public.tool_scene_drafts to authenticated;

create function public.save_tool_scene_draft(p_id uuid, p_scene jsonb, p_expected_revision integer)
returns public.tool_scene_drafts language plpgsql security definer set search_path = pg_catalog, public as $$
declare saved public.tool_scene_drafts;
begin
  if auth.uid() is null or not public.tool_drafts_account_ready() then raise exception 'TOOL_DRAFT_FORBIDDEN' using errcode = '42501'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 2147483647
    or public.tool_scene_is_valid(p_scene) is not true then raise exception 'TOOL_DRAFT_INVALID' using errcode = '22023'; end if;
  if p_expected_revision = 0 then
    perform pg_advisory_xact_lock(hashtextextended('tool-drafts:' || auth.uid()::text, 0));
    if (select count(*) from public.tool_scene_drafts where owner_id = auth.uid()) >= 200 then raise exception 'TOOL_DRAFT_LIMIT' using errcode = '54000'; end if;
    insert into public.tool_scene_drafts(id, owner_id, name, catalog_id, scene)
      values (p_id, auth.uid(), p_scene #>> '{payload,title}', public.tool_scene_catalog_id(p_scene), p_scene)
      on conflict (id) do nothing returning * into saved;
    if saved.id is null then raise exception 'TOOL_DRAFT_CONFLICT' using errcode = 'P0001'; end if;
  else
    update public.tool_scene_drafts set name = p_scene #>> '{payload,title}', scene = p_scene, revision = revision + 1, updated_at = clock_timestamp()
      where id = p_id and owner_id = auth.uid() and revision = p_expected_revision and catalog_id = public.tool_scene_catalog_id(p_scene)
      returning * into saved;
    if saved.id is null then
      if exists(select 1 from public.tool_scene_drafts where id = p_id and owner_id = auth.uid()) then raise exception 'TOOL_DRAFT_CONFLICT' using errcode = 'P0001'; end if;
      raise exception 'TOOL_DRAFT_MISSING' using errcode = 'P0002';
    end if;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_tool_scene_draft(uuid, jsonb, integer) from public, anon;
grant execute on function public.save_tool_scene_draft(uuid, jsonb, integer) to authenticated;

create or replace function public.cw_courseware_composition_doc_is_valid(p_doc jsonb)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  blocks jsonb;
  block_value jsonb;
  placement jsonb;
  block_count integer;
  column_value integer;
  row_value integer;
  column_span integer;
  row_span integer;
begin
  if jsonb_typeof(p_doc) <> 'object'
     or p_doc ->> 'docVersion' <> 'courseware-composition-v1'
     or p_doc #>> '{canvas,width}' <> '960'
     or p_doc #>> '{canvas,height}' <> '720'
     or jsonb_typeof(p_doc -> 'overlay') <> 'object'
     or p_doc #>> '{overlay,docVersion}' <> 'page-doc-v1'
     or p_doc #>> '{overlay,canvas,width}' <> '960'
     or p_doc #>> '{overlay,canvas,height}' <> '720'
     or jsonb_typeof(p_doc #> '{overlay,nodes}') <> 'array'
     or jsonb_typeof(p_doc -> 'layout') <> 'object'
     or p_doc #>> '{layout,version}' <> 'courseware-composition-grid-v1'
     or p_doc #>> '{layout,columns}' <> '12'
     or p_doc #>> '{layout,rows}' <> '9'
     or jsonb_typeof(p_doc #> '{layout,blocks}') <> 'array'
     or octet_length(p_doc::text) > 3145728 then
    return false;
  end if;

  if not (
    p_doc -> 'source' = 'null'::jsonb
    or (
      jsonb_typeof(p_doc -> 'source') = 'object'
      and (
        p_doc #>> '{source,doc,docVersion}' in (
          'page-doc-v1', 'aixuexi-page-doc-v1',
          'source-runtime-page-v1', 'spatial-page-v1'
        )
        or public.cw_game_page_doc_is_valid(p_doc #> '{source,doc}')
      )
      and coalesce(p_doc #>> '{source,sourceReleaseId}', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce(p_doc #>> '{source,sourceRevisionId}', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) then return false; end if;

  blocks := p_doc #> '{layout,blocks}';
  block_count := jsonb_array_length(blocks);
  if block_count > 108 then return false; end if;
  if block_count <> (
    select count(distinct item.value ->> 'id')
    from jsonb_array_elements(blocks) item
  ) then return false; end if;

  for block_value in select item.value from jsonb_array_elements(blocks) item loop
    placement := block_value -> 'placement';
    if coalesce(block_value ->> 'id', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       or char_length(block_value ->> 'id') > 80
       or block_value ->> 'type' not in ('node', 'game', 'h5', 'tool')
       or jsonb_typeof(placement) <> 'object'
       or coalesce(placement ->> 'column', '') !~ '^[0-9]+$'
       or coalesce(placement ->> 'row', '') !~ '^[0-9]+$'
       or coalesce(placement ->> 'columnSpan', '') !~ '^[0-9]+$'
       or coalesce(placement ->> 'rowSpan', '') !~ '^[0-9]+$' then
      return false;
    end if;
    column_value := (placement ->> 'column')::integer;
    row_value := (placement ->> 'row')::integer;
    column_span := (placement ->> 'columnSpan')::integer;
    row_span := (placement ->> 'rowSpan')::integer;
    if column_value < 0 or row_value < 0
       or column_span < 1 or row_span < 1
       or column_value + column_span > 12
       or row_value + row_span > 9 then
      return false;
    end if;
    if block_value ->> 'type' = 'node' then
      if coalesce(block_value ->> 'nodeId', '') = '' then return false; end if;
    elsif block_value ->> 'type' = 'game' then
      if column_span < 4 or row_span < 4
         or not public.cw_game_page_doc_is_valid(block_value -> 'game')
         or (block_value -> 'game') ? 'layout' then return false; end if;
    elsif block_value ->> 'type' = 'h5' then
      if column_span < 2 or row_span < 2
         or jsonb_typeof(block_value -> 'h5') <> 'object'
         or coalesce(block_value #>> '{h5,artifactId}', '')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or coalesce(block_value #>> '{h5,sha256}', '') !~ '^[0-9a-f]{64}$'
         or coalesce(block_value #>> '{h5,entryPath}', '') <> 'index.html'
         or coalesce(block_value #>> '{h5,byteCount}', '') !~ '^[0-9]+$'
         or (block_value #>> '{h5,byteCount}')::bigint not between 0 and 5242880 then
        return false;
      end if;
    else
      if column_span < 2 or row_span < 2
         or jsonb_typeof(block_value -> 'tool') <> 'object'
         or not (
           (coalesce(block_value #>> '{tool,toolId}', '') in ('fraction-line', 'motion-lab', 'spatial-lab')
             and coalesce(block_value #>> '{tool,contentVersion}', '') = 'tool-embed-v1'
             and not ((block_value -> 'tool') ? 'payload'))
           or public.cw_cube_structures_tool_is_valid(block_value -> 'tool')
           or public.tool_scene_is_valid(block_value -> 'tool')
         ) then
        return false;
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(blocks) with ordinality left_item(value, position)
    join jsonb_array_elements(blocks) with ordinality right_item(value, position)
      on left_item.position < right_item.position
    where (left_item.value #>> '{placement,column}')::integer
            < (right_item.value #>> '{placement,column}')::integer
              + (right_item.value #>> '{placement,columnSpan}')::integer
      and (right_item.value #>> '{placement,column}')::integer
            < (left_item.value #>> '{placement,column}')::integer
              + (left_item.value #>> '{placement,columnSpan}')::integer
      and (left_item.value #>> '{placement,row}')::integer
            < (right_item.value #>> '{placement,row}')::integer
              + (right_item.value #>> '{placement,rowSpan}')::integer
      and (right_item.value #>> '{placement,row}')::integer
            < (left_item.value #>> '{placement,row}')::integer
              + (left_item.value #>> '{placement,rowSpan}')::integer
  ) then return false; end if;

  if (select count(*) from jsonb_array_elements(blocks) item where item.value ->> 'type' = 'node')
     <> jsonb_array_length(p_doc #> '{overlay,nodes}') then return false; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_doc #> '{overlay,nodes}') node
    where (
      select count(*)
      from jsonb_array_elements(blocks) item
      where item.value ->> 'type' = 'node'
        and item.value ->> 'nodeId' = node.value ->> 'id'
    ) <> 1
  ) then return false; end if;
  if exists (
    select 1
    from jsonb_array_elements(blocks) item
    where item.value ->> 'type' = 'node'
      and not exists (
        select 1
        from jsonb_array_elements(p_doc #> '{overlay,nodes}') node
        where node.value ->> 'id' = item.value ->> 'nodeId'
      )
  ) then return false; end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.cw_formal_cube_page_is_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare block jsonb; node jsonb;
begin
  if public.cw_courseware_composition_doc_is_valid(p_doc) is not true
    or p_doc -> 'source' is distinct from 'null'::jsonb
    or p_doc #> '{overlay,canvas,backgroundBindingKey}' is distinct from 'null'::jsonb
    or p_doc #> '{overlay,interactions}' is distinct from '[]'::jsonb
    or octet_length(p_doc::text) > 750000 then return false; end if;
  for block in select value from jsonb_array_elements(p_doc #> '{layout,blocks}') loop
    if block ->> 'type' = 'tool' then
      if not ((block #>> '{tool,contentVersion}' = 'cube-structures-lesson-v2'
          and public.cw_cube_structures_tool_is_valid(block -> 'tool') is true)
          or public.tool_scene_is_valid(block -> 'tool') is true) then return false; end if;
    elsif block ->> 'type' is distinct from 'node' then return false;
    end if;
  end loop;
  for node in select value from jsonb_array_elements(p_doc #> '{overlay,nodes}') loop
    if coalesce(node ->> 'adapter', '') not in ('text','rich_text','shape')
      or node -> 'resources' is distinct from '[]'::jsonb
      or node -> 'children' is distinct from '[]'::jsonb then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.cw_manual_composition_doc_is_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare node jsonb; block jsonb; resource jsonb;
begin
  if public.cw_courseware_composition_doc_is_valid(p_doc) is not true
    or p_doc -> 'source' is distinct from 'null'::jsonb
    or p_doc #> '{overlay,canvas,backgroundBindingKey}' is distinct from 'null'::jsonb
    or p_doc #> '{overlay,interactions}' is distinct from '[]'::jsonb
    or octet_length(p_doc::text) > 750000 then return false; end if;
  for block in select value from jsonb_array_elements(p_doc #> '{layout,blocks}') loop
    if block ->> 'type' = 'tool' then
      if not ((block #>> '{tool,contentVersion}' = 'cube-structures-lesson-v2'
          and public.cw_cube_structures_tool_is_valid(block -> 'tool') is true)
          or public.tool_scene_is_valid(block -> 'tool') is true) then return false; end if;
    elsif block ->> 'type' is distinct from 'node' then return false;
    end if;
  end loop;
  for node in select value from jsonb_array_elements(p_doc #> '{overlay,nodes}') loop
    if node -> 'children' is distinct from '[]'::jsonb then return false; end if;
    if node ->> 'adapter' in ('text','rich_text','shape') then
      if node -> 'resources' is distinct from '[]'::jsonb then return false; end if;
    elsif node ->> 'adapter' in ('image','h5') then
      if jsonb_array_length(node -> 'resources') is distinct from 1 then return false; end if;
      resource := node #> '{resources,0}';
      if resource ->> 'kind' is distinct from node ->> 'adapter'
        or coalesce(resource ->> 'bindingKey','') !~ '^[0-9a-f]{64}$'
        or resource ->> 'role' is distinct from (case node ->> 'adapter' when 'image' then 'image' else 'entry' end)
        or resource ->> 'bindingPath' is distinct from (case node ->> 'adapter' when 'image' then '$.src' else '$.entry' end)
        then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

notify pgrst, 'reload schema';
commit;
