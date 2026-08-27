-- DEV-TMC-2: source pickers depend on one revision capability predicate.
-- Adding a future registered game content version no longer requires editing
-- page search, lecture search, or copy transactions.

begin;

create function public.cw_teacher_microcourse_source_revision_is_supported(
  p_revision_id uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when revision_row.doc_version in (
        'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
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
    and public.cw_teacher_microcourse_source_revision_is_supported(revision_row.id)
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
      and public.cw_teacher_microcourse_source_revision_is_supported(revision_row.id);
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

create or replace function public.search_teacher_microcourse_source_lectures(
  p_query text default '',
  p_family_id uuid default null,
  p_course_id uuid default null,
  p_limit integer default 60
)
returns table(
  family_id uuid,
  family_title text,
  course_id uuid,
  course_title text,
  lecture_id uuid,
  lecture_no integer,
  lecture_title text,
  release_id uuid,
  page_count integer,
  preview_page_doc_id uuid,
  preview_revision_id uuid,
  preview_page_no integer,
  preview_page_title text,
  preview_doc jsonb,
  preview_bindings jsonb
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
  if p_limit not between 1 and 100 then raise exception 'VALIDATION'; end if;

  return query
  select
    family_row.id,
    family_row.title,
    course_row.id,
    course_row.title,
    lecture_row.id,
    lecture_row.no::integer,
    lecture_row.name,
    release_row.id,
    jsonb_array_length(release_row.snapshot),
    preview_page.id,
    preview_revision.id,
    preview_page.page_no,
    preview_page.title,
    preview_revision.doc,
    coalesce(preview_item.value -> 'bindings', '[]'::jsonb)
  from public.course_families family_row
  join public.courses course_row on course_row.family_id = family_row.id
  join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
  left join public.cw_lecture_track_heads track_head
    on track_head.lecture_id = lecture_row.id
   and track_head.track = 'native-16x9'
  join public.cw_lecture_releases release_row
    on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
  cross join lateral (
    select item.value
    from jsonb_array_elements(release_row.snapshot) with ordinality item(value, position)
    order by item.position
    limit 1
  ) preview_item
  join public.cw_page_docs preview_page
    on preview_page.id = (preview_item.value ->> 'pageDocId')::uuid
   and preview_page.lecture_id = lecture_row.id
   and preview_page.deleted_at is null
  join public.cw_page_revisions preview_revision
    on preview_revision.id = (preview_item.value ->> 'revisionId')::uuid
   and preview_revision.page_doc_id = preview_page.id
  where course_row.course_kind = 'curriculum'
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and lecture_row.status = 'active'
    and jsonb_array_length(release_row.snapshot) between 1 and 200
    and not exists (
      select 1
      from jsonb_array_elements(release_row.snapshot) all_item
      left join public.cw_page_docs source_page
        on source_page.id = (all_item.value ->> 'pageDocId')::uuid
       and source_page.lecture_id = lecture_row.id
       and source_page.deleted_at is null
      left join public.cw_page_revisions source_revision
        on source_revision.id = (all_item.value ->> 'revisionId')::uuid
       and source_revision.page_doc_id = source_page.id
      where source_page.id is null
         or source_revision.id is null
         or not public.cw_teacher_microcourse_source_revision_is_supported(source_revision.id)
    )
    and (p_family_id is null or family_row.id = p_family_id)
    and (p_course_id is null or course_row.id = p_course_id)
    and (
      btrim(coalesce(p_query, '')) = ''
      or family_row.title ilike '%' || left(btrim(p_query), 100) || '%'
      or course_row.title ilike '%' || left(btrim(p_query), 100) || '%'
      or lecture_row.name ilike '%' || left(btrim(p_query), 100) || '%'
    )
  order by family_row.title, course_row.title, lecture_row.no
  limit p_limit;
end;
$$;

create or replace function public.create_teacher_microcourse_composition_pages_from_lecture(
  p_microcourse_id uuid,
  p_after_page_doc_id uuid,
  p_source_release_id uuid,
  p_source_lecture_id uuid
)
returns table(
  first_page_id uuid,
  last_page_id uuid,
  page_count integer
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  target_lecture_id uuid;
  source_snapshot jsonb;
  expected_count integer;
  eligible_count integer;
  current_count integer;
  inserted_count integer := 0;
  first_inserted_id uuid;
  after_id uuid := p_after_page_doc_id;
  inserted_id uuid;
  source_row record;
begin
  target_lecture_id := public.assert_teacher_microcourse_author(p_microcourse_id);
  perform 1
  from public.course_lectures target_lecture
  where target_lecture.id = target_lecture_id
  for update;

  select release_row.snapshot
  into source_snapshot
  from public.course_families family_row
  join public.courses course_row on course_row.family_id = family_row.id
  join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
  left join public.cw_lecture_track_heads track_head
    on track_head.lecture_id = lecture_row.id
   and track_head.track = 'native-16x9'
  join public.cw_lecture_releases release_row
    on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
  where lecture_row.id = p_source_lecture_id
    and release_row.id = p_source_release_id
    and course_row.course_kind = 'curriculum'
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and lecture_row.status = 'active';
  if not found then raise exception 'SOURCE_LECTURE_NOT_CURRENT_PUBLISHED'; end if;

  expected_count := jsonb_array_length(source_snapshot);
  if expected_count not between 1 and 200 then
    raise exception 'SOURCE_LECTURE_SNAPSHOT_INVALID';
  end if;

  select count(*)
  into eligible_count
  from jsonb_array_elements(source_snapshot) source_item
  join public.cw_page_docs source_page
    on source_page.id = (source_item.value ->> 'pageDocId')::uuid
   and source_page.lecture_id = p_source_lecture_id
   and source_page.deleted_at is null
  join public.cw_page_revisions source_revision
    on source_revision.id = (source_item.value ->> 'revisionId')::uuid
   and source_revision.page_doc_id = source_page.id
  where public.cw_teacher_microcourse_source_revision_is_supported(source_revision.id);
  if eligible_count <> expected_count then
    raise exception 'SOURCE_LECTURE_SNAPSHOT_INVALID';
  end if;

  select count(*)
  into current_count
  from public.cw_page_docs target_page
  where target_page.lecture_id = target_lecture_id
    and target_page.deleted_at is null;
  if current_count + expected_count > 200 then
    raise exception 'MICROCOURSE_PAGE_LIMIT';
  end if;

  for source_row in
    select
      source_page.id as page_doc_id,
      source_page.title,
      source_revision.id as revision_id
    from jsonb_array_elements(source_snapshot) with ordinality source_item(value, position)
    join public.cw_page_docs source_page
      on source_page.id = (source_item.value ->> 'pageDocId')::uuid
     and source_page.lecture_id = p_source_lecture_id
     and source_page.deleted_at is null
    join public.cw_page_revisions source_revision
      on source_revision.id = (source_item.value ->> 'revisionId')::uuid
     and source_revision.page_doc_id = source_page.id
    order by source_item.position
  loop
    inserted_id := public.create_teacher_microcourse_composition_page(
      p_microcourse_id,
      after_id,
      coalesce(nullif(btrim(source_row.title), ''), 'Untitled'),
      p_source_release_id,
      source_row.page_doc_id,
      source_row.revision_id
    );
    first_inserted_id := coalesce(first_inserted_id, inserted_id);
    after_id := inserted_id;
    inserted_count := inserted_count + 1;
  end loop;

  if inserted_count <> expected_count then
    raise exception 'SOURCE_LECTURE_SNAPSHOT_INVALID';
  end if;

  return query select first_inserted_id, after_id, inserted_count;
end;
$$;

notify pgrst, 'reload schema';

commit;
