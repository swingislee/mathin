-- DEV-TMC-1 follow-up: reuse the existing course-product picker, then list
-- compact lecture choices for the selected production curriculum course.
-- Preview documents and signed bindings are deliberately absent from this
-- contract; the teacher only needs the lecture name and page count before the
-- immutable release is copied.

begin;

create function public.list_teacher_microcourse_source_lectures(
  p_course_id uuid,
  p_limit integer default 100
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
  page_count integer
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
  if p_course_id is null or p_limit not between 1 and 200 then
    raise exception 'VALIDATION';
  end if;

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
    jsonb_array_length(release_row.snapshot)
  from public.course_families family_row
  join public.courses course_row on course_row.family_id = family_row.id
  join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
  left join public.cw_lecture_track_heads track_head
    on track_head.lecture_id = lecture_row.id
   and track_head.track = 'native-16x9'
  join public.cw_lecture_releases release_row
    on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
  where course_row.id = p_course_id
    and family_row.purpose = 'production'
    and family_row.status = 'enabled'
    and course_row.course_kind = 'curriculum'
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and lecture_row.status = 'active'
    and jsonb_array_length(release_row.snapshot) between 1 and 200
    and not exists (
      select 1
      from jsonb_array_elements(release_row.snapshot) source_item
      left join public.cw_page_docs source_page
        on source_page.id = (source_item.value ->> 'pageDocId')::uuid
       and source_page.lecture_id = lecture_row.id
       and source_page.deleted_at is null
      left join public.cw_page_revisions source_revision
        on source_revision.id = (source_item.value ->> 'revisionId')::uuid
       and source_revision.page_doc_id = source_page.id
      where source_page.id is null
         or source_revision.id is null
         or not public.cw_teacher_microcourse_source_revision_is_supported(source_revision.id)
    )
  order by lecture_row.no, lecture_row.id
  limit p_limit;
end;
$$;

-- Keep the implementation from 20260827000400 as an owner-only primitive and
-- put the production course-product boundary in front of it. This preserves
-- the complete transactional copy implementation without exposing a second
-- client entry point.
alter function public.create_teacher_microcourse_composition_pages_from_lecture(uuid, uuid, uuid, uuid)
  rename to copy_teacher_microcourse_lecture_pages_internal;

revoke all on function public.copy_teacher_microcourse_lecture_pages_internal(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

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
begin
  if not exists (
    select 1
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
      and family_row.purpose = 'production'
      and family_row.status = 'enabled'
      and course_row.course_kind = 'curriculum'
      and course_row.status = 'enabled'
      and course_row.trashed_at is null
      and lecture_row.status = 'active'
  ) then
    raise exception 'SOURCE_LECTURE_NOT_CURRENT_PUBLISHED';
  end if;

  return query
  select *
  from public.copy_teacher_microcourse_lecture_pages_internal(
    p_microcourse_id,
    p_after_page_doc_id,
    p_source_release_id,
    p_source_lecture_id
  );
end;
$$;

revoke all on function public.list_teacher_microcourse_source_lectures(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_composition_pages_from_lecture(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.list_teacher_microcourse_source_lectures(uuid, integer)
  to authenticated;
grant execute on function public.create_teacher_microcourse_composition_pages_from_lecture(uuid, uuid, uuid, uuid)
  to authenticated;

comment on function public.list_teacher_microcourse_source_lectures(uuid, integer) is
  'Compact production curriculum lecture choices for the shared course-product picker; no page preview payload.';

commit;
