-- Standalone courses reuse the registered authored Sudoku component.
-- Existing page permissions, revisions, asset bindings and frozen releases remain intact.
begin;

insert into public.cw_game_content_contracts(game_id, content_version, validator_version, authorable, copyable, enabled)
values ('sudoku', 'sudoku-authored-v3', 'sudoku-authored-v3@1', true, true, true)
on conflict (game_id, content_version) do update set validator_version = excluded.validator_version,
  authorable = excluded.authorable, copyable = excluded.copyable, enabled = excluded.enabled;

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
    elsif block ->> 'type' = 'game' then
      if public.cw_game_page_doc_is_valid(block -> 'game') is not true
        or block #>> '{game,gameId}' is distinct from 'sudoku'
        or coalesce(block #>> '{game,contentVersion}','') not in ('sudoku-authored-v2','sudoku-authored-v3')
        then return false; end if;
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
