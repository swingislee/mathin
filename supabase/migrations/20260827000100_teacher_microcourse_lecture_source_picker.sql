-- DEV-TMC-1 follow-up: teachers choose a published lecture and copy the
-- complete release snapshot in one transaction. The editor remains the place
-- where individual copied pages are removed or reordered.

begin;

create function public.search_teacher_microcourse_source_lectures(
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
         or source_revision.doc_version not in (
           'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
         )
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

create function public.create_teacher_microcourse_composition_pages_from_lecture(
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
  where source_revision.doc_version in (
    'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
  );
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

revoke all on function public.search_teacher_microcourse_source_lectures(text, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_composition_pages_from_lecture(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.search_teacher_microcourse_source_lectures(text, uuid, uuid, integer)
  to authenticated;
grant execute on function public.create_teacher_microcourse_composition_pages_from_lecture(uuid, uuid, uuid, uuid)
  to authenticated;

commit;
