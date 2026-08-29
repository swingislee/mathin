-- Register versioned Tool blocks in courseware-composition-v1.
-- The database whitelist mirrors src/features/tools/courseware/registry.ts.

begin;

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
         or coalesce(block_value #>> '{tool,toolId}', '') not in (
           'fraction-line', 'motion-lab', 'spatial-lab'
         )
         or coalesce(block_value #>> '{tool,contentVersion}', '') <> 'tool-embed-v1' then
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

comment on function public.cw_courseware_composition_doc_is_valid(jsonb)
  is 'Structural hard gate for non-overlapping courseware-composition-v1 node, game, H5 and versioned Tool blocks.';

notify pgrst, 'reload schema';

commit;
