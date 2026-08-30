-- Teacher microcourses have one authoring document and one editor:
-- courseware-composition-v1 + CoursewareCompositionWorkbench.
-- Preserve immutable revision/page/source identities while upgrading the two
-- obsolete microcourse-page-v1 envelopes into composition blocks.

begin;

create temporary table teacher_microcourse_editor_upgrade on commit drop as
select
  revision_row.id as revision_id,
  revision_row.page_doc_id,
  revision_row.doc as original_doc
from public.cw_page_revisions revision_row
join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
where revision_row.doc ->> 'docVersion' = 'microcourse-page-v1'
  and revision_row.doc ->> 'mode' in ('composition', 'h5')
  and exists (
    select 1
    from public.teacher_microcourses microcourse_row
    where microcourse_row.lecture_id = page_row.lecture_id
  );

alter table public.cw_page_revisions
  disable trigger cw_page_revisions_set_document_metadata;

do $$
declare
  target record;
  node_record record;
  upgraded_doc jsonb;
  upgraded_nodes jsonb;
  layout_blocks jsonb;
  transform_value jsonb;
  column_value integer;
  row_value integer;
  column_span integer;
  row_span integer;
begin
  for target in
    select * from teacher_microcourse_editor_upgrade order by revision_id
  loop
    if target.original_doc ->> 'mode' = 'h5' then
      upgraded_doc := jsonb_build_object(
        'docVersion', 'courseware-composition-v1',
        'canvas', target.original_doc -> 'canvas',
        'source', null,
        'overlay', jsonb_build_object(
          'docVersion', 'page-doc-v1',
          'sourceCoursewareId', 'teacher-composition-overlay',
          'sourcePageId', null,
          'sourcePageDatabaseId', 1,
          'sourceSnapshotId', 1,
          'sourceContentHash', repeat('0', 64),
          'canvas', jsonb_build_object(
            'width', 960,
            'height', 720,
            'backgroundColor', null,
            'backgroundBindingKey', null
          ),
          'nodes', '[]'::jsonb,
          'interactions', '[]'::jsonb
        ),
        'layout', jsonb_build_object(
          'version', 'courseware-composition-grid-v1',
          'columns', 12,
          'rows', 9,
          'blocks', jsonb_build_array(jsonb_build_object(
            'id', 'h5-1',
            'type', 'h5',
            'placement', jsonb_build_object(
              'column', 0,
              'row', 0,
              'columnSpan', 12,
              'rowSpan', 9
            ),
            'h5', jsonb_build_object(
              'artifactId', target.original_doc -> 'artifactId',
              'sha256', target.original_doc -> 'sha256',
              'byteCount', target.original_doc -> 'byteCount',
              'entryPath', target.original_doc -> 'entryPath'
            )
          ))
        )
      );
    else
      upgraded_nodes := '[]'::jsonb;
      layout_blocks := '[]'::jsonb;

      for node_record in
        select node.value, node.ordinality
        from jsonb_array_elements(target.original_doc #> '{overlay,nodes}')
          with ordinality node(value, ordinality)
        order by node.ordinality
      loop
        transform_value := node_record.value -> 'transform';
        column_value := least(11, greatest(0, floor(
          coalesce((transform_value ->> 'x')::numeric, 0) / 80
        )::integer));
        row_value := least(8, greatest(0, floor(
          coalesce((transform_value ->> 'y')::numeric, 0) / 80
        )::integer));
        column_span := least(12 - column_value, greatest(1, ceil(
          coalesce((transform_value ->> 'width')::numeric, 80) / 80
        )::integer));
        row_span := least(9 - row_value, greatest(1, ceil(
          coalesce((transform_value ->> 'height')::numeric, 80) / 80
        )::integer));

        upgraded_nodes := upgraded_nodes || jsonb_build_array(
          node_record.value || jsonb_build_object(
            'transform', transform_value || jsonb_build_object(
              'x', column_value * 80,
              'y', row_value * 80,
              'width', column_span * 80,
              'height', row_span * 80
            )
          )
        );
        layout_blocks := layout_blocks || jsonb_build_array(jsonb_build_object(
          'id', 'node-' || node_record.ordinality,
          'type', 'node',
          'placement', jsonb_build_object(
            'column', column_value,
            'row', row_value,
            'columnSpan', column_span,
            'rowSpan', row_span
          ),
          'nodeId', node_record.value -> 'id'
        ));
      end loop;

      upgraded_doc := jsonb_build_object(
        'docVersion', 'courseware-composition-v1',
        'canvas', target.original_doc -> 'canvas',
        'source', target.original_doc -> 'source',
        'overlay', jsonb_set(target.original_doc -> 'overlay', '{nodes}', upgraded_nodes),
        'layout', jsonb_build_object(
          'version', 'courseware-composition-grid-v1',
          'columns', 12,
          'rows', 9,
          'blocks', layout_blocks
        )
      );
    end if;

    if not public.cw_courseware_composition_doc_is_valid(upgraded_doc) then
      raise exception 'INVALID_TEACHER_EDITOR_UPGRADE:%', target.revision_id;
    end if;

    update public.cw_page_revisions
    set doc = upgraded_doc,
        doc_version = 'courseware-composition-v1',
        layout_profile = 'standard-4x3'
    where id = target.revision_id;
  end loop;
end;
$$;

alter table public.cw_page_revisions
  enable trigger cw_page_revisions_set_document_metadata;

update public.cw_page_docs page_row
set doc_version = 'courseware-composition-v1',
    aspect = '4:3'
where page_row.id in (
  select distinct target.page_doc_id
  from teacher_microcourse_editor_upgrade target
);

update public.cw_page_track_heads head_row
set current_layout_profile = case
      when head_row.current_revision_id is not null then 'standard-4x3'
      else head_row.current_layout_profile
    end,
    draft_layout_profile = case
      when head_row.draft_revision_id is not null then 'standard-4x3'
      else head_row.draft_layout_profile
    end,
    updated_at = now()
where head_row.page_doc_id in (
  select distinct target.page_doc_id
  from teacher_microcourse_editor_upgrade target
);

-- These old whole-page writers would recreate documents the application no
-- longer parses. H5 remains available as a composition block.
revoke all on function public.save_teacher_microcourse_page(
  uuid, jsonb, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_teacher_microcourse_h5_page(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    where exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.lecture_id = page_row.lecture_id
    )
      and revision_row.doc ->> 'docVersion' <> 'courseware-composition-v1'
  ) then raise exception 'NON_COMPOSITION_TEACHER_REVISION_REMAINS'; end if;

  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    where exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.lecture_id = page_row.lecture_id
    )
      and not public.cw_courseware_composition_doc_is_valid(revision_row.doc)
  ) then raise exception 'INVALID_TEACHER_COMPOSITION_REMAINS'; end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
