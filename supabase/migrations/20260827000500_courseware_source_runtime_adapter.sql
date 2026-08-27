-- Source-owned courseware runtime: keep producer DOM/CSS/behavior in an
-- immutable H5 renderer and let Mathin resolve only resource/route bindings.

begin;

alter table public.cw_source_packages
  drop constraint cw_source_packages_document_adapter_check;
alter table public.cw_source_packages
  add constraint cw_source_packages_document_adapter_check check (
    document_adapter in ('aixuexi-page-v1', 'source-runtime-v1')
  );

alter table public.cw_page_docs
  drop constraint cw_page_docs_doc_version_check;
alter table public.cw_page_docs
  add constraint cw_page_docs_doc_version_check check (
    doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
      'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1'
    )
  );

alter table public.cw_page_revisions
  drop constraint cw_page_revisions_doc_version_check,
  drop constraint cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_version_check check (
    doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
      'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1'
    )
  ),
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
      'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1'
    )
    and (doc ->> 'docVersion' <> 'spatial-page-v1' or public.cw_spatial_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'microcourse-page-v1' or public.cw_microcourse_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'game-page-v1' or public.cw_game_page_doc_is_valid(doc))
    and octet_length(doc::text) <= case
      when doc ->> 'docVersion' in ('microcourse-page-v1', 'game-page-v1')
        then 2097152
      else 1048576
    end
  );

create or replace function public.cw_microcourse_page_doc_is_valid(p_doc jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_doc) = 'object'
    and p_doc ->> 'docVersion' = 'microcourse-page-v1'
    and p_doc ->> 'mode' in ('composition', 'sudoku', 'h5')
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
        p_doc ->> 'mode' = 'sudoku'
        and public.teacher_microcourse_sudoku_puzzle_is_valid(p_doc -> 'puzzle')
        and jsonb_typeof(p_doc -> 'display') = 'object'
        and jsonb_typeof(p_doc -> 'analysis') = 'object'
        and p_doc #>> '{analysis,status}' in ('conflict', 'unsolvable', 'multiple', 'unique')
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

create or replace function public.cw_teacher_microcourse_source_revision_is_supported(
  p_revision_id uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when revision_row.doc_version in (
        'page-doc-v1', 'aixuexi-page-doc-v1',
        'source-runtime-page-v1', 'spatial-page-v1'
      ) then true
      when revision_row.doc_version = 'game-page-v1' then
        public.cw_game_page_doc_is_valid(revision_row.doc)
        and public.cw_game_page_revision_validation_is_current(revision_row.id, true)
        and exists (
          select 1
          from public.cw_game_content_contracts contract_row
          where contract_row.game_id = revision_row.doc ->> 'gameId'
            and contract_row.content_version = revision_row.doc ->> 'contentVersion'
            and contract_row.enabled
            and contract_row.copyable
        )
      else false
    end
    from public.cw_page_revisions revision_row
    where revision_row.id = p_revision_id
  ), false)
$$;

revoke all on function public.cw_teacher_microcourse_source_revision_is_supported(uuid)
  from public, anon, authenticated, service_role;

commit;
