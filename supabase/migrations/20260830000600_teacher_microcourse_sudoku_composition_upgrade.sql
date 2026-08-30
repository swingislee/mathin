-- Convert every teacher-microcourse standalone Sudoku page to the current
-- courseware-composition-v1 envelope. The revision and page IDs stay stable;
-- only the obsolete document envelope is upgraded in place.

begin;

create temporary table teacher_microcourse_sudoku_upgrade on commit drop as
select
  revision_row.id as revision_id,
  revision_row.page_doc_id,
  revision_row.doc as original_doc
from public.cw_page_revisions revision_row
join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
join public.teacher_microcourses microcourse_row
  on microcourse_row.lecture_id = page_row.lecture_id
where (
    revision_row.doc ->> 'docVersion' = 'microcourse-page-v1'
    and revision_row.doc ->> 'mode' = 'sudoku'
  ) or (
    revision_row.doc ->> 'docVersion' = 'game-page-v1'
    and revision_row.doc ->> 'gameId' = 'sudoku'
  );

alter table public.cw_page_revisions
  disable trigger cw_page_revisions_set_document_metadata;

do $$
declare
  target record;
  game_doc jsonb;
  puzzle jsonb;
  display jsonb;
  analysis jsonb;
  goal jsonb;
  payload jsonb;
  details jsonb;
  zero_values jsonb;
  answer_values jsonb;
  variant_id text;
  goal_kind text;
  status_value text;
  code_value text;
  payload_serialized text;
  payload_hash text;
  ready_value boolean;
begin
  for target in
    select * from teacher_microcourse_sudoku_upgrade order by revision_id
  loop
    if target.original_doc ->> 'docVersion' = 'microcourse-page-v1' then
      puzzle := target.original_doc -> 'puzzle';
      display := target.original_doc -> 'display';
      analysis := target.original_doc -> 'analysis';
      variant_id := 'classic-9x9';
      game_doc := null;
    elsif target.original_doc ->> 'contentVersion' = 'sudoku-authored-v1' then
      puzzle := target.original_doc #> '{payload,puzzle}';
      display := target.original_doc #> '{payload,display}';
      analysis := target.original_doc #> '{validation,details}';
      variant_id := target.original_doc #>> '{payload,variantId}';
      game_doc := null;
    elsif target.original_doc ->> 'contentVersion' = 'sudoku-authored-v2' then
      game_doc := target.original_doc - 'layout';
    else
      raise exception 'UNSUPPORTED_STANDALONE_SUDOKU_CONTRACT:%', target.revision_id;
    end if;

    if game_doc is null then
      if jsonb_typeof(puzzle) <> 'array'
         or jsonb_array_length(puzzle) not in (16, 36, 81)
         or jsonb_typeof(display) <> 'object'
         or jsonb_typeof(analysis) <> 'object' then
        raise exception 'INVALID_STANDALONE_SUDOKU:%', target.revision_id;
      end if;
      if variant_id is null then
        variant_id := case jsonb_array_length(puzzle)
          when 16 then 'classic-4x4'
          when 36 then 'classic-6x6'
          else 'classic-9x9'
        end;
      end if;
      status_value := analysis ->> 'status';
      if status_value not in ('conflict', 'unsolvable', 'multiple', 'unique') then
        raise exception 'INVALID_STANDALONE_SUDOKU_ANALYSIS:%', target.revision_id;
      end if;
      goal_kind := case
        when status_value = 'unique'
         and coalesce((display ->> 'allowAnswerReveal')::boolean, false)
          then 'full-solution'
        else 'teacher-led'
      end;
      goal := case goal_kind
        when 'full-solution' then jsonb_build_object('kind', 'full-solution', 'requireUnique', true)
        else jsonb_build_object('kind', 'teacher-led')
      end;
      payload := jsonb_build_object(
        'kind', 'authored-activity',
        'variantId', variant_id,
        'puzzle', puzzle,
        'goal', goal,
        'display', display
      );
      select coalesce(jsonb_agg(to_jsonb(0) order by position), '[]'::jsonb)
      into zero_values
      from generate_series(1, jsonb_array_length(puzzle)) position;
      ready_value := case goal_kind
        when 'full-solution' then status_value = 'unique'
        else status_value in ('unique', 'multiple')
      end;
      code_value := case
        when goal_kind = 'full-solution' and ready_value then 'full-solution-ready'
        when goal_kind = 'full-solution' then 'full-solution-' || status_value
        when ready_value then 'teacher-led-ready'
        else 'teacher-led-' || status_value
      end;
      answer_values := case
        when goal_kind = 'full-solution' and status_value = 'unique'
          then analysis -> 'solution'
        else zero_values
      end;
      details := jsonb_build_object(
        'puzzle', analysis,
        'goalKind', goal_kind,
        'targets', '[]'::jsonb,
        'ready', ready_value,
        'code', code_value,
        'answerValues', answer_values,
        'completionTargets', zero_values
      );

      -- This serialization order exactly matches JSON.stringify() after the
      -- v2 zod schema has normalized the payload on the application server.
      payload_serialized :=
        '{"kind":"authored-activity","variantId":' || to_json(variant_id)::text
        || ',"puzzle":' || regexp_replace(puzzle::text, '[[:space:]]', '', 'g')
        || ',"goal":' || case goal_kind
          when 'full-solution' then '{"kind":"full-solution","requireUnique":true}'
          else '{"kind":"teacher-led"}'
        end
        || ',"display":{"showCoordinates":' || (display ->> 'showCoordinates')::boolean::text
        || ',"allowCandidates":' || (display ->> 'allowCandidates')::boolean::text
        || ',"allowAnswerReveal":' || (display ->> 'allowAnswerReveal')::boolean::text
        || ',"showTeachingTools":' || (display ->> 'showTeachingTools')::boolean::text
        || '}}';
      payload_hash := encode(
        extensions.digest(convert_to(payload_serialized, 'UTF8'), 'sha256'),
        'hex'
      );
      game_doc := jsonb_build_object(
        'docVersion', 'game-page-v1',
        'canvas', target.original_doc -> 'canvas',
        'gameId', 'sudoku',
        'contentVersion', 'sudoku-authored-v2',
        'payload', payload,
        'validation', jsonb_build_object(
          'payloadHash', payload_hash,
          'validatorVersion', 'sudoku-authored-v2@1',
          'publishable', ready_value,
          'code', code_value,
          'details', details
        )
      );
    end if;

    update public.cw_page_revisions
    set doc = jsonb_build_object(
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
              'id', 'game-1',
              'type', 'game',
              'placement', jsonb_build_object(
                'column', 0,
                'row', 0,
                'columnSpan', 12,
                'rowSpan', 9
              ),
              'game', game_doc - 'layout'
            ))
          )
        ),
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
  from teacher_microcourse_sudoku_upgrade target
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
  from teacher_microcourse_sudoku_upgrade target
);

delete from public.cw_game_revision_validations validation_row
where validation_row.revision_id in (
  select target.revision_id from teacher_microcourse_sudoku_upgrade target
);

update public.cw_game_content_contracts
set authorable = false
where game_id = 'sudoku'
  and content_version = 'sudoku-authored-v1';

-- The old envelope is no longer a valid database document. Historical SQL
-- files retain provenance, but the live schema and every live revision fail
-- closed on microcourse-page-v1/mode=sudoku.
create or replace function public.cw_microcourse_page_doc_is_valid(p_doc jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_doc) = 'object'
    and p_doc ->> 'docVersion' = 'microcourse-page-v1'
    and p_doc ->> 'mode' in ('composition', 'h5')
    and jsonb_typeof(p_doc -> 'canvas') = 'object'
    and p_doc #>> '{canvas,width}' = '960'
    and p_doc #>> '{canvas,height}' = '720'
    and (
      (
        p_doc ->> 'mode' = 'composition'
        and jsonb_typeof(p_doc -> 'overlay') = 'object'
        and p_doc #>> '{overlay,docVersion}' = 'page-doc-v1'
        and p_doc #>> '{overlay,canvas,width}' = '960'
        and p_doc #>> '{overlay,canvas,height}' = '720'
        and (
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
        )
      )
      or (
        p_doc ->> 'mode' = 'h5'
        and coalesce(p_doc ->> 'artifactId', '')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and coalesce(p_doc ->> 'sha256', '') ~ '^[0-9a-f]{64}$'
        and coalesce(p_doc ->> 'entryPath', '') = 'index.html'
        and coalesce(p_doc ->> 'byteCount', '') ~ '^[0-9]+$'
        and (p_doc ->> 'byteCount')::bigint between 0 and 5242880
      )
    )
    and octet_length(p_doc::text) <= 2097152,
    false
  )
$$;

revoke all on function public.create_teacher_microcourse_sudoku_page(
  uuid, uuid, text, integer[], jsonb
) from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    join public.teacher_microcourses microcourse_row
      on microcourse_row.lecture_id = page_row.lecture_id
    where revision_row.doc ->> 'docVersion' = 'microcourse-page-v1'
      and revision_row.doc ->> 'mode' = 'sudoku'
  ) then raise exception 'LEGACY_TEACHER_SUDOKU_REMAINS'; end if;
  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    join public.teacher_microcourses microcourse_row
      on microcourse_row.lecture_id = page_row.lecture_id
    where revision_row.doc ->> 'docVersion' = 'game-page-v1'
      and revision_row.doc ->> 'gameId' = 'sudoku'
  ) then raise exception 'STANDALONE_TEACHER_SUDOKU_REMAINS'; end if;
  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    join public.teacher_microcourses microcourse_row
      on microcourse_row.lecture_id = page_row.lecture_id
    where revision_row.doc ->> 'docVersion' = 'courseware-composition-v1'
      and not public.cw_courseware_composition_doc_is_valid(revision_row.doc)
  ) then raise exception 'INVALID_UPGRADED_TEACHER_COMPOSITION'; end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
