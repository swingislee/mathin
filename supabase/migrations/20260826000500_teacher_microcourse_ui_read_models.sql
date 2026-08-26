-- DEV-TMC-1: UI-safe controlled-topic read model. The table remains RLS
-- protected; this RPC gives the authoring route a stable typed contract.

begin;

create or replace function public.list_teacher_microcourse_topics()
returns table(
  id uuid,
  slug text,
  title_zh text,
  title_en text,
  enabled boolean
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  return query
  select topic.id, topic.slug, topic.title_zh, topic.title_en, topic.enabled
  from public.teacher_microcourse_topics topic
  where topic.enabled
  order by topic.sort_order, topic.slug;
end;
$$;

revoke all on function public.list_teacher_microcourse_topics() from public, anon, authenticated;
grant execute on function public.list_teacher_microcourse_topics() to authenticated;

-- Curriculum publishing can keep its canonical current release either on the
-- legacy lecture pointer or on the native track head. Author search and the
-- copy transaction must agree on the same effective release.
create or replace function public.search_teacher_microcourse_source_pages(
  p_query text default '',
  p_family_id uuid default null,
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_limit integer default 100
)
returns table(
  family_id uuid,
  family_title text,
  course_id uuid,
  course_title text,
  lecture_id uuid,
  lecture_title text,
  release_id uuid,
  page_doc_id uuid,
  revision_id uuid,
  page_no integer,
  page_title text,
  doc jsonb,
  bindings jsonb
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not public.has_perm(auth.uid(), 'courseware.microcourse.author') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  if p_limit not between 1 and 200 then raise exception 'VALIDATION'; end if;
  return query
  select
    family_row.id,
    family_row.title,
    course_row.id,
    course_row.title,
    lecture_row.id,
    lecture_row.name,
    release_row.id,
    page_row.id,
    revision_row.id,
    page_row.page_no,
    page_row.title,
    revision_row.doc,
    coalesce(item.value -> 'bindings', '[]'::jsonb)
  from public.course_families family_row
  join public.courses course_row on course_row.family_id = family_row.id
  join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
  left join public.cw_lecture_track_heads track_head
    on track_head.lecture_id = lecture_row.id
   and track_head.track = 'native-16x9'
  join public.cw_lecture_releases release_row
    on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
  cross join lateral jsonb_array_elements(release_row.snapshot) item
  join public.cw_page_docs page_row
    on page_row.id = (item.value ->> 'pageDocId')::uuid
   and page_row.lecture_id = lecture_row.id
   and page_row.deleted_at is null
  join public.cw_page_revisions revision_row
    on revision_row.id = (item.value ->> 'revisionId')::uuid
   and revision_row.page_doc_id = page_row.id
  where course_row.course_kind = 'curriculum'
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and lecture_row.status = 'active'
    and revision_row.doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
    )
    and (p_family_id is null or family_row.id = p_family_id)
    and (p_course_id is null or course_row.id = p_course_id)
    and (p_lecture_id is null or lecture_row.id = p_lecture_id)
    and (
      btrim(coalesce(p_query, '')) = ''
      or family_row.title ilike '%' || left(btrim(p_query), 100) || '%'
      or course_row.title ilike '%' || left(btrim(p_query), 100) || '%'
      or lecture_row.name ilike '%' || left(btrim(p_query), 100) || '%'
      or page_row.title ilike '%' || left(btrim(p_query), 100) || '%'
    )
  order by family_row.title, course_row.title, lecture_row.no, page_row.page_no
  limit p_limit;
end;
$$;

create or replace function public.create_teacher_microcourse_composition_page(
  p_microcourse_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default 'Untitled',
  p_source_release_id uuid default null,
  p_source_page_doc_id uuid default null,
  p_source_revision_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_row record;
  source_value jsonb := 'null'::jsonb;
  overlay_value jsonb;
  document_value jsonb;
  target_page_id uuid;
  copied_binding_count integer := 0;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  if (p_source_release_id is null) <> (p_source_page_doc_id is null)
     or (p_source_release_id is null) <> (p_source_revision_id is null) then
    raise exception 'INVALID_SOURCE_SELECTION';
  end if;
  if p_source_release_id is not null then
    select
      family_row.id as family_id,
      course_row.id as course_id,
      lecture_row.id as lecture_id,
      release_row.id as release_id,
      release_row.track as release_track,
      page_row.id as page_id,
      page_row.page_no,
      page_row.title,
      revision_row.id as revision_id,
      revision_row.doc,
      item.value as snapshot_item
    into source_row
    from public.course_families family_row
    join public.courses course_row on course_row.family_id = family_row.id
    join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
    left join public.cw_lecture_track_heads track_head
      on track_head.lecture_id = lecture_row.id
     and track_head.track = 'native-16x9'
    join public.cw_lecture_releases release_row
      on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
    cross join lateral jsonb_array_elements(release_row.snapshot) item
    join public.cw_page_docs page_row
      on page_row.id = (item.value ->> 'pageDocId')::uuid
     and page_row.lecture_id = lecture_row.id
     and page_row.deleted_at is null
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
     and revision_row.page_doc_id = page_row.id
    where release_row.id = p_source_release_id
      and page_row.id = p_source_page_doc_id
      and revision_row.id = p_source_revision_id
      and course_row.course_kind = 'curriculum'
      and course_row.status = 'enabled'
      and course_row.trashed_at is null
      and lecture_row.status = 'active'
      and revision_row.doc_version in (
        'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
      );
    if not found then raise exception 'SOURCE_PAGE_NOT_CURRENT_PUBLISHED'; end if;
    source_value := jsonb_build_object(
      'sourceFamilyId', source_row.family_id,
      'sourceCourseId', source_row.course_id,
      'sourceLectureId', source_row.lecture_id,
      'sourceReleaseId', source_row.release_id,
      'sourcePageDocId', source_row.page_id,
      'sourceRevisionId', source_row.revision_id,
      'sourcePageNo', source_row.page_no,
      'sourceTitle', coalesce(nullif(btrim(source_row.title), ''), 'Untitled'),
      'doc', source_row.doc
    );
  end if;
  overlay_value := jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'teacher-microcourse-overlay',
    'sourcePageId', null,
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('0', 64),
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720,
      'backgroundColor', null, 'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  );
  document_value := jsonb_build_object(
    'docVersion', 'microcourse-page-v1',
    'mode', 'composition',
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720, 'backgroundColor', '#ffffff'
    ),
    'source', source_value,
    'overlay', overlay_value
  );
  target_page_id := public.insert_teacher_microcourse_page(
    p_microcourse_id, p_after_page_doc_id, p_title, document_value
  );
  if p_source_release_id is not null then
    insert into public.teacher_microcourse_page_sources(
      target_page_doc_id, microcourse_id, source_family_id, source_course_id,
      source_lecture_id, source_release_id, source_page_doc_id,
      source_revision_id, source_page_no, source_title
    ) values (
      target_page_id, p_microcourse_id, source_row.family_id, source_row.course_id,
      source_row.lecture_id, source_row.release_id, source_row.page_id,
      source_row.revision_id, source_row.page_no,
      coalesce(nullif(btrim(source_row.title), ''), 'Untitled')
    );
    insert into public.cw_page_asset_bindings(
      page_doc_id, binding_key, role, kind, shared_asset_id,
      pinned_revision_id, launch_query, track
    )
    select
      target_page_id,
      binding_item.value ->> 'bindingKey',
      source_binding.role,
      source_binding.kind,
      source_binding.shared_asset_id,
      asset_revision.id,
      source_binding.launch_query,
      'native-16x9'
    from jsonb_array_elements(coalesce(source_row.snapshot_item -> 'bindings', '[]'::jsonb)) binding_item
    join public.cw_page_asset_bindings source_binding
      on source_binding.page_doc_id = source_row.page_id
     and source_binding.binding_key = binding_item.value ->> 'bindingKey'
     and source_binding.track = source_row.release_track
    join public.cw_asset_revisions asset_revision
      on asset_revision.id = (binding_item.value ->> 'assetRevisionId')::uuid
     and asset_revision.shared_asset_id = source_binding.shared_asset_id;
    get diagnostics copied_binding_count = row_count;
    if copied_binding_count <> jsonb_array_length(
      coalesce(source_row.snapshot_item -> 'bindings', '[]'::jsonb)
    ) then raise exception 'SOURCE_BINDING_SNAPSHOT_MISMATCH'; end if;
  end if;
  return target_page_id;
end;
$$;

-- Frozen free sessions carry revision pins rather than the object hashes used
-- by ordinary published-session snapshots. Resolve those pins here so
-- preparation and live-class preload can sign the exact teacher-draft assets.
create or replace function public.list_session_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.courseware_resolved into resolved
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null and resolved ->> 'version' = 'cw-session-resolved-v1' then
    if jsonb_typeof(resolved #> '{microcourseDraft,pages}') = 'array' then
      return query
      select distinct object_row.sha256, object_row.storage_path, object_row.kind
      from jsonb_array_elements(resolved #> '{microcourseDraft,pages}') page_item
      cross join lateral jsonb_array_elements(
        coalesce(page_item.value -> 'bindings', '[]'::jsonb)
      ) binding
      join public.cw_asset_revisions revision_row
        on revision_row.id = (binding.value ->> 'assetRevisionId')::uuid
      join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
      where object_row.kind <> 'h5'
      order by object_row.sha256;
      return;
    end if;
    return query
    with hashes as (
      select distinct binding ->> 'objectHash' sha256
      from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) binding
      where jsonb_typeof(binding) = 'object'
        and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
    )
    select object_row.sha256, object_row.storage_path, object_row.kind
    from hashes
    join public.cw_asset_objects object_row on object_row.sha256 = hashes.sha256
    where object_row.kind <> 'h5'
    order by object_row.sha256;
    return;
  end if;

  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  return query
  select distinct object_row.sha256, object_row.storage_path, object_row.kind
  from jsonb_array_elements(release_snapshot) entry,
       jsonb_array_elements(entry.value -> 'bindings') binding
  join public.cw_asset_revisions revision_row
    on revision_row.id = (binding ->> 'assetRevisionId')::uuid
  join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
  where object_row.kind <> 'h5'
  order by object_row.sha256;
end;
$$;

-- H5 bytes must not enter the public immutable bucket during an intermediate
-- review round. Tell the server action whether this decision can publish.
create or replace function public.prepare_teacher_microcourse_review_publish(
  p_review_cycle_id uuid
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  snapshot_row public.teacher_microcourse_review_snapshots%rowtype;
  cycle_row public.cw_review_cycles%rowtype;
  required_rounds smallint;
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  select * into snapshot_row
  from public.teacher_microcourse_review_snapshots
  where review_cycle_id = p_review_cycle_id;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  select * into cycle_row
  from public.cw_review_cycles
  where id = p_review_cycle_id and status = 'submitted';
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  select workflow.required_review_rounds_snapshot into required_rounds
  from public.cw_lecture_workflows workflow
  where workflow.lecture_id = cycle_row.lecture_id
    and workflow.track = cycle_row.track
    and workflow.active_review_cycle_id = cycle_row.id;
  return jsonb_build_object(
    'microcourseId', snapshot_row.microcourse_id,
    'finalApproval', cycle_row.review_round_no >= coalesce(required_rounds, 1),
    'artifacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'artifactId', artifact.id,
        'sha256', artifact.sha256,
        'privatePath', artifact.private_path,
        'publicPath', 'packages/' || artifact.sha256 || '/index.html'
      ) order by artifact.sha256), '[]'::jsonb)
      from jsonb_array_elements_text(snapshot_row.h5_hashes) hash_item
      join public.teacher_microcourse_h5_artifacts artifact
        on artifact.microcourse_id = snapshot_row.microcourse_id
       and artifact.sha256 = hash_item.value
    )
  );
end;
$$;

commit;
