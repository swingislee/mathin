-- R1-9 / P6-9 courseware source capture.
--
-- This file is intentionally a fixed psql program: it emits one JSON object per
-- line and contains no parameters, write statements, RPC calls, or mutable page
-- head fallbacks. Every page and asset revision is resolved strictly from the
-- release selected by cw_lecture_track_heads.current_release_id.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

begin transaction isolation level repeatable read read only;
set local default_transaction_read_only = on;
set local statement_timeout = '30min';

with
course_scope as (
  select
    case
      when family.slug = 'xueersi-e-primary-math-cn' then 'e-series'
      when family.slug in (
        'aixuexi-gplus-primary-math-sujiao',
        'aixuexi-xplus-primary-math-sujiao',
        'aixuexi-aplus-primary-math-quanguo'
      ) then 'aixuexi-autumn'
    end as course_system,
    catalog.slug as catalog_version,
    course.product_code,
    course.grade,
    lecture.id as lecture_id,
    lecture.no as lecture_no
  from public.course_lectures lecture
  join public.courses course on course.id = lecture.course_id
  join public.course_catalog_versions catalog on catalog.id = course.catalog_version_id
  join public.course_families family on family.id = course.family_id
  where family.slug in (
    'xueersi-e-primary-math-cn',
    'aixuexi-gplus-primary-math-sujiao',
    'aixuexi-xplus-primary-math-sujiao',
    'aixuexi-aplus-primary-math-quanguo'
  )
),
lecture_rows as (
  select
    scope.*,
    case when scope.course_system <> 'aixuexi-autumn' or source_lecture.id is null then null else jsonb_build_object(
      'sourceSystem', source_package.source_system,
      'packageKey', source_package.package_key,
      'documentAdapter', source_package.document_adapter,
      'packageManifestSha256', source_package.manifest_sha256,
      'packageStatus', source_package.status,
      'sourceProductCode', source_lecture.source_product_code,
      'sourceCoursewareId', source_lecture.source_courseware_id,
      'sourceLessonIndex', source_lecture.source_lesson_index,
      'pageCount', source_lecture.page_count,
      'lectureVerificationSha256', source_lecture.verification_sha256,
      'offlineStatus', source_lecture.offline_status
    ) end as source_evidence
  from course_scope scope
  left join public.cw_source_lectures source_lecture
    on source_lecture.lecture_id = scope.lecture_id
  left join public.cw_source_packages source_package
    on source_package.id = source_lecture.source_package_id
),
selected_releases as (
  select
    lecture.course_system,
    lecture.catalog_version,
    lecture.product_code,
    lecture.grade,
    lecture.lecture_id,
    lecture.lecture_no,
    head.track,
    release.id as release_id,
    release.release_no,
    release.snapshot
  from lecture_rows lecture
  join public.cw_lecture_track_heads head
    on head.lecture_id = lecture.lecture_id
  join public.cw_lecture_releases release
    on release.id = head.current_release_id
   and release.lecture_id = head.lecture_id
   and release.track = head.track
  where head.track in ('native-16x9', 'adapted-4x3')
),
release_pages as (
  select
    selected.*,
    page_entry.ordinality::integer as snapshot_ordinal,
    page.page_no,
    page_entry.value as snapshot_page,
    page.id as page_doc_id,
    page.source_courseware_id as page_source_courseware_id,
    revision.id as revision_id,
    revision.track as revision_track,
    revision.doc as document
  from selected_releases selected
  cross join lateral jsonb_array_elements(selected.snapshot)
    with ordinality as page_entry(value, ordinality)
  join public.cw_page_docs page
    on page.id = (page_entry.value ->> 'pageDocId')::uuid
   and page.lecture_id = selected.lecture_id
  join public.cw_page_revisions revision
    on revision.id = (page_entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id
),
records as (
  select
    0 as sort_group,
    ''::text as sort_key,
    jsonb_build_object(
      'recordType', 'meta',
      'captureVersion', 'mathin-r1-courseware-source-capture-v1',
      'transactionReadOnly', current_setting('transaction_read_only') = 'on',
      'migrationVersion', (select max(version)::text from supabase_migrations.schema_migrations)
    ) as record

  union all

  select
    1,
    concat_ws(chr(1), lecture.course_system, lecture.catalog_version, lecture.product_code,
      lpad(lecture.lecture_no::text, 8, '0'), lecture.lecture_id::text),
    jsonb_build_object(
      'recordType', 'lecture',
      'courseSystem', lecture.course_system,
      'catalogVersion', lecture.catalog_version,
      'productCode', lecture.product_code,
      'grade', lecture.grade,
      'lectureId', lecture.lecture_id,
      'lectureNo', lecture.lecture_no,
      'sourceEvidence', lecture.source_evidence
    )
  from lecture_rows lecture

  union all

  select
    2,
    concat_ws(chr(1), selected.course_system, selected.catalog_version, selected.product_code,
      lpad(selected.lecture_no::text, 8, '0'), selected.lecture_id::text,
      case selected.track when 'native-16x9' then '0' else '1' end),
    jsonb_build_object(
      'recordType', 'release',
      'lectureId', selected.lecture_id,
      'track', selected.track,
      'releaseId', selected.release_id,
      'releaseNo', selected.release_no,
      'snapshot', selected.snapshot
    )
  from selected_releases selected

  union all

  select
    3,
    concat_ws(chr(1), page.course_system, page.catalog_version, page.product_code,
      lpad(page.lecture_no::text, 8, '0'), page.lecture_id::text,
      case page.track when 'native-16x9' then '0' else '1' end,
      lpad(page.snapshot_ordinal::text, 8, '0'), page.page_doc_id::text),
    jsonb_build_object(
      'recordType', 'page',
      'lectureId', page.lecture_id,
      'track', page.track,
      'releaseId', page.release_id,
      'snapshotOrdinal', page.snapshot_ordinal,
      'pageNo', page.page_no,
      'pageDocId', page.page_doc_id,
      'revisionId', page.revision_id,
      'revisionTrack', page.revision_track,
      'pageSourceCoursewareId', page.page_source_courseware_id,
      'document', page.document,
      'learningCheckEnabled', case
        when jsonb_typeof(page.snapshot_page -> 'learningCheckEnabled') = 'boolean'
          then (page.snapshot_page ->> 'learningCheckEnabled')::boolean
        else false
      end,
      'snapshotBindingCount', jsonb_array_length(page.snapshot_page -> 'bindings'),
      'bindings', (
        select jsonb_agg(jsonb_build_object(
          'bindingKey', snapshot_binding.value ->> 'bindingKey',
          'assetRevisionId', asset_revision.id,
          'objectSha256', object_row.sha256,
          'bindingKind', binding.kind,
          'sharedAssetKind', shared_asset.kind,
          'objectKind', object_row.kind,
          'bindingRole', binding.role,
          'sharedAssetRole', shared_asset.role,
          'variant', asset_revision.variant,
          'mime', object_row.mime,
          'byteCount', object_row.byte_count,
          'storagePath', object_row.storage_path,
          'bindingSharedAssetId', binding.shared_asset_id,
          'assetSharedAssetId', asset_revision.shared_asset_id,
          'launchQuery', snapshot_binding.value -> 'launchQuery',
          'adaptationStatus', adaptation.status
        ) order by snapshot_binding.ordinality)
        from jsonb_array_elements(page.snapshot_page -> 'bindings')
          with ordinality as snapshot_binding(value, ordinality)
        join public.cw_asset_revisions asset_revision
          on asset_revision.id = (snapshot_binding.value ->> 'assetRevisionId')::uuid
        join public.cw_asset_objects object_row
          on object_row.id = asset_revision.object_id
        join public.cw_shared_assets shared_asset
          on shared_asset.id = asset_revision.shared_asset_id
        join public.cw_page_asset_bindings binding
          on binding.page_doc_id = page.page_doc_id
         and binding.track = page.track
         and binding.binding_key = snapshot_binding.value ->> 'bindingKey'
        left join public.cw_adapt_backgrounds adaptation
          on adaptation.derived_asset_revision_id = asset_revision.id
      )
    )
  from release_pages page
)
select record::text
from records
order by sort_group, sort_key;

commit;
