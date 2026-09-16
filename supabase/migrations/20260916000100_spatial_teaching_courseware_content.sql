-- 展开图／骰子固定副本进入既有组合页；不修改历史 revision、release 或课堂事件权限。
begin;

create function public.cw_spatial_teaching_tool_is_valid(p_tool jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare payload jsonb := p_tool -> 'payload'; initial jsonb := payload -> 'initial'; scene jsonb; item jsonb; pair record;
begin
  if not coalesce(
    jsonb_typeof(p_tool) = 'object' and p_tool ->> 'toolId' = 'spatial-lab'
    and p_tool ->> 'contentVersion' in ('cube-net-lesson-v1', 'dice-lesson-v1')
    and p_tool - array['toolId','contentVersion','payload'] = '{}'::jsonb
    and jsonb_typeof(payload) = 'object' and payload - array['title','initial'] = '{}'::jsonb
    and jsonb_typeof(payload -> 'title') = 'string' and char_length(btrim(payload ->> 'title')) between 1 and 80
    and octet_length(p_tool::text) <= 192000 and jsonb_typeof(initial) = 'object'
    and jsonb_typeof(initial -> 'frame') = 'object' and jsonb_typeof(initial #> '{frame,center}') = 'object'
    and jsonb_typeof(initial #> '{frame,radius}') = 'number'
    and (initial #>> '{frame,radius}')::numeric > 0 and (initial #>> '{frame,radius}')::numeric <= 2000,
    false) then return false; end if;
  if p_tool ->> 'contentVersion' = 'dice-lesson-v1' then
    if initial - array['scene','view','frame','axes','grid','floor','arrows','selectedId'] <> '{}'::jsonb
      or initial ?& array['scene','view','frame','axes','grid','floor','arrows','selectedId'] is not true
      or coalesce(initial ->> 'view','') not in ('angle','front','left','right','top','bottom') then return false; end if;
    if exists (select 1 from unnest(array['axes','grid','floor','arrows']) k where jsonb_typeof(initial -> k) is distinct from 'boolean') then return false; end if;
    scene := initial -> 'scene';
    if not coalesce(jsonb_typeof(scene) = 'object' and scene ->> 'version' = 'dice-teaching-v1'
      and scene - array['version','dice','trail','nextId','puzzle'] = '{}'::jsonb
      and jsonb_typeof(scene -> 'dice') = 'array' and jsonb_array_length(scene -> 'dice') between 1 and 8
      and jsonb_typeof(scene -> 'trail') = 'array' and jsonb_array_length(scene -> 'trail') <= 128
      and (scene ->> 'nextId') ~ '^[1-9][0-9]{0,8}$'
      and jsonb_typeof(scene -> 'puzzle') in ('null','object'), false) then return false; end if;
    if (select count(distinct d ->> 'id') from jsonb_array_elements(scene -> 'dice') d) <> jsonb_array_length(scene -> 'dice') then return false; end if;
    if not exists (select 1 from jsonb_array_elements(scene -> 'dice') d where d ->> 'id' = initial ->> 'selectedId') then return false; end if;
    for item in select value from jsonb_array_elements(scene -> 'dice') loop
      if not coalesce(jsonb_typeof(item) = 'object' and item - array['id','hand','position','rotation','hidden','offsets','surfaces'] = '{}'::jsonb
        and item ->> 'id' ~ '^dice-[1-9][0-9]{0,8}$' and substring(item ->> 'id' from 6)::bigint < (scene ->> 'nextId')::bigint
        and item ->> 'hand' in ('left','right') and jsonb_typeof(item -> 'position') = 'object'
        and jsonb_typeof(item -> 'rotation') = 'object' and jsonb_typeof(item -> 'offsets') = 'object'
        and jsonb_typeof(item -> 'hidden') = 'array' and jsonb_array_length(item -> 'hidden') <= 6, false) then return false; end if;
      if exists (select 1 from jsonb_array_elements_text(item -> 'hidden') f where f not in ('x+','x-','y+','y-','z+','z-')) then return false; end if;
    end loop;
  else
    if initial - array['source','angles','anchor','surfaces','labels','cutting','faceOffsets','revealEnabled','view','axesVisible','frame'] <> '{}'::jsonb
      or initial ?& array['source','angles','anchor','surfaces','labels','cutting','faceOffsets','revealEnabled','view','axesVisible','frame'] is not true
      or coalesce(initial ->> 'view','') not in ('angle','front','left','right','top')
      or jsonb_typeof(initial -> 'axesVisible') is distinct from 'boolean'
      or jsonb_typeof(initial -> 'revealEnabled') is distinct from 'boolean'
      or jsonb_typeof(initial -> 'angles') is distinct from 'object'
      or jsonb_typeof(initial -> 'surfaces') is distinct from 'object'
      or jsonb_typeof(initial -> 'labels') is distinct from 'object'
      or jsonb_typeof(initial -> 'faceOffsets') is distinct from 'object'
      or jsonb_typeof(initial -> 'anchor') not in ('object','null')
      or jsonb_typeof(initial -> 'cutting') not in ('object','null')
      or jsonb_typeof(initial -> 'source') is distinct from 'object'
      or (initial -> 'source') - array['entryId','cuts'] <> '{}'::jsonb
      or (initial -> 'source') ?& array['entryId','cuts'] is not true
      or coalesce(initial #>> '{source,entryId}','') !~ '^cube-net-gallery\.[0-9]{2}$'
      or jsonb_typeof(initial #> '{source,cuts}') not in ('array','null') then return false; end if;
    if (select count(*) from jsonb_object_keys(initial -> 'angles')) <> 5 then return false; end if;
    for pair in select * from jsonb_each(initial -> 'angles') loop
      if pair.key !~ '^edge\.v[01]{3}-v[01]{3}$' or jsonb_typeof(pair.value) <> 'number'
        or (pair.value #>> '{}')::numeric not between -90 and 90 then return false; end if;
    end loop;
    if initial #> '{source,cuts}' <> 'null'::jsonb and jsonb_array_length(initial #> '{source,cuts}') <> 7 then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.cw_spatial_teaching_tool_is_valid(jsonb) from public, anon, authenticated, service_role;
comment on function public.cw_spatial_teaching_tool_is_valid(jsonb) is 'Versioned self-contained cube-net and dice starting scenes; full geometry and size validated by the server schema. No new classroom write authority.';

-- 既有组合页、正式立方体页和手工页校验器在下面仅扩展工具白名单。

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
           or public.cw_spatial_teaching_tool_is_valid(block_value -> 'tool')
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
          or public.cw_spatial_teaching_tool_is_valid(block -> 'tool') is true) then return false; end if;
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
          or public.cw_spatial_teaching_tool_is_valid(block -> 'tool') is true) then return false; end if;
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
