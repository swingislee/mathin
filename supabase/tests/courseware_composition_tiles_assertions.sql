begin;

do $$
declare
  empty_doc jsonb;
  overlap_doc jsonb;
  source_interaction_doc jsonb;
  multi_interaction_doc jsonb;
  tool_doc jsonb;
  unknown_tool_doc jsonb;
begin
  empty_doc := jsonb_build_object(
    'docVersion', 'courseware-composition-v1',
    'canvas', jsonb_build_object('width', 960, 'height', 720, 'backgroundColor', '#ffffff'),
    'source', null,
    'overlay', jsonb_build_object(
      'docVersion', 'page-doc-v1',
      'canvas', jsonb_build_object('width', 960, 'height', 720),
      'nodes', '[]'::jsonb
    ),
    'layout', jsonb_build_object(
      'version', 'courseware-composition-grid-v1',
      'columns', 12,
      'rows', 9,
      'blocks', '[]'::jsonb
    )
  );
  if not public.cw_courseware_composition_doc_is_valid(empty_doc) then
    raise exception 'empty composition must be valid';
  end if;

  overlap_doc := jsonb_set(
    jsonb_set(
      empty_doc,
      '{overlay,nodes}',
      '[{"id":"node-a"},{"id":"node-b"}]'::jsonb
    ),
    '{layout,blocks}',
    '[
      {"id":"tile-a","type":"node","nodeId":"node-a","placement":{"column":0,"row":0,"columnSpan":6,"rowSpan":3}},
      {"id":"tile-b","type":"node","nodeId":"node-b","placement":{"column":4,"row":0,"columnSpan":6,"rowSpan":3}}
    ]'::jsonb
  );
  if public.cw_courseware_composition_doc_is_valid(overlap_doc) then
    raise exception 'overlapping composition tiles must be rejected';
  end if;

  source_interaction_doc := jsonb_set(
    jsonb_set(
      empty_doc,
      '{source}',
      '{
        "sourceReleaseId":"00000000-0000-4000-8000-000000000001",
        "sourceRevisionId":"00000000-0000-4000-8000-000000000002",
        "doc":{"docVersion":"page-doc-v1"}
      }'::jsonb
    ),
    '{layout,blocks}',
    '[{
      "id":"interactive-h5",
      "type":"h5",
      "h5":{
        "artifactId":"00000000-0000-4000-8000-000000000003",
        "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "byteCount":10,
        "entryPath":"index.html"
      },
      "placement":{"column":0,"row":0,"columnSpan":12,"rowSpan":9}
    }]'::jsonb
  );
  if not public.cw_courseware_composition_doc_is_valid(source_interaction_doc) then
    raise exception 'a source page and authored interaction must be independently keyed';
  end if;

  multi_interaction_doc := jsonb_set(
    empty_doc,
    '{layout,blocks}',
    '[
      {
        "id":"h5-1",
        "type":"h5",
        "h5":{
          "artifactId":"00000000-0000-4000-8000-000000000003",
          "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "byteCount":10,
          "entryPath":"index.html"
        },
        "placement":{"column":0,"row":0,"columnSpan":2,"rowSpan":2}
      },
      {
        "id":"h5-2",
        "type":"h5",
        "h5":{
          "artifactId":"00000000-0000-4000-8000-000000000004",
          "sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "byteCount":20,
          "entryPath":"index.html"
        },
        "placement":{"column":2,"row":0,"columnSpan":2,"rowSpan":2}
      }
    ]'::jsonb
  );
  if not public.cw_courseware_composition_doc_is_valid(multi_interaction_doc) then
    raise exception 'multiple independently keyed interactive blocks must be valid';
  end if;

  tool_doc := jsonb_set(
    empty_doc,
    '{layout,blocks}',
    '[{
      "id":"tool-1",
      "type":"tool",
      "tool":{"toolId":"fraction-line","contentVersion":"tool-embed-v1"},
      "placement":{"column":0,"row":0,"columnSpan":4,"rowSpan":3}
    }]'::jsonb
  );
  if not public.cw_courseware_composition_doc_is_valid(tool_doc) then
    raise exception 'registered versioned Tool block must be valid';
  end if;

  unknown_tool_doc := jsonb_set(
    tool_doc,
    '{layout,blocks,0,tool,toolId}',
    '"unknown-tool"'::jsonb
  );
  if public.cw_courseware_composition_doc_is_valid(unknown_tool_doc) then
    raise exception 'unregistered Tool contract must be rejected';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.save_teacher_microcourse_page(uuid,jsonb,integer,text,text)',
    'execute'
  ) then raise exception 'legacy standalone page save must be closed'; end if;
  if has_function_privilege(
    'service_role',
    'public.create_teacher_microcourse_game_page(uuid,uuid,uuid,text,jsonb)',
    'execute'
  ) then raise exception 'legacy standalone game page create must be closed'; end if;
  if not has_function_privilege(
    'service_role',
    'public.save_teacher_courseware_composition_page(uuid,uuid,jsonb,integer,text,text)',
    'execute'
  ) then raise exception 'composition save must be service-only'; end if;
end;
$$;

select 'courseware composition assertions passed' as result;

rollback;
