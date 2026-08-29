begin;

create or replace function public.list_teacher_microcourse_library(
  p_family_id uuid
)
returns table (
  course_id uuid,
  source_classroom_id uuid,
  source_classroom_name text,
  author_id uuid,
  author_name text,
  offering_type text,
  created_at timestamptz,
  updated_at timestamptz,
  topics jsonb,
  keywords text[],
  lecture_titles text[],
  search_text text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  can_manage boolean := false;
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'course.view') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1
    from public.course_families family
    where family.id = p_family_id
      and family.slug = 'teacher-microcourses'
  ) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;

  can_manage := public.has_perm(auth.uid(), 'course.manage');

  return query
  select
    course.id,
    root.source_classroom_id,
    classroom.name,
    root.created_by,
    author.display_name,
    classroom.offering_type,
    root.created_at,
    greatest(root.updated_at, course.updated_at),
    coalesce(metadata_facets.topics, '[]'::jsonb),
    coalesce(metadata_facets.keywords, '{}'::text[]),
    coalesce(lecture_facets.lecture_titles, '{}'::text[]),
    concat_ws(
      ' ',
      course.title,
      classroom.name,
      author.display_name,
      lecture_facets.lecture_text,
      metadata_facets.metadata_text,
      metadata_facets.topic_text,
      array_to_string(metadata_facets.keywords, ' ')
    )
  from public.teacher_microcourse_class_courses root
  join public.courses course on course.id = root.course_id
  join public.classrooms classroom on classroom.id = root.source_classroom_id
  join public.profiles author on author.id = root.created_by
  left join lateral (
    select
      array_agg(lecture.name order by session.scheduled_at, class_lecture.source_session_id)
        as lecture_titles,
      string_agg(
        concat_ws(' ', lecture.name, lecture.objectives),
        ' ' order by session.scheduled_at, class_lecture.source_session_id
      ) as lecture_text
    from public.teacher_microcourse_class_lectures class_lecture
    join public.course_lectures lecture on lecture.id = class_lecture.lecture_id
    join public.class_sessions session on session.id = class_lecture.source_session_id
    where class_lecture.course_id = course.id
  ) lecture_facets on true
  left join lateral (
    select
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'slug', topic_row.slug,
          'titleZh', topic_row.title_zh,
          'titleEn', topic_row.title_en
        ) order by topic_row.slug)
        from (
          select distinct topic.slug, topic.title_zh, topic.title_en
          from public.teacher_microcourses microcourse
          join public.teacher_microcourse_metadata_revisions metadata
            on metadata.id = case
              when can_manage then coalesce(
                microcourse.draft_metadata_revision_id,
                microcourse.published_metadata_revision_id
              )
              else microcourse.published_metadata_revision_id
            end
          join public.teacher_microcourse_topics topic
            on topic.id = metadata.primary_topic_id
          where microcourse.course_id = course.id
            and (can_manage or microcourse.withdrawn_at is null)
        ) topic_row
      ), '[]'::jsonb) as topics,
      coalesce((
        select array_agg(distinct keyword.value order by keyword.value)
        from public.teacher_microcourses microcourse
        join public.teacher_microcourse_metadata_revisions metadata
          on metadata.id = case
            when can_manage then coalesce(
              microcourse.draft_metadata_revision_id,
              microcourse.published_metadata_revision_id
            )
            else microcourse.published_metadata_revision_id
          end
        cross join lateral unnest(metadata.keywords) keyword(value)
        where microcourse.course_id = course.id
          and (can_manage or microcourse.withdrawn_at is null)
      ), '{}'::text[]) as keywords,
      (
        select string_agg(
          concat_ws(' ', metadata.title, metadata.description, microcourse.variant_name),
          ' '
        )
        from public.teacher_microcourses microcourse
        join public.teacher_microcourse_metadata_revisions metadata
          on metadata.id = case
            when can_manage then coalesce(
              microcourse.draft_metadata_revision_id,
              microcourse.published_metadata_revision_id
            )
            else microcourse.published_metadata_revision_id
          end
        where microcourse.course_id = course.id
          and (can_manage or microcourse.withdrawn_at is null)
      ) as metadata_text,
      (
        select string_agg(
          concat_ws(' ', topic_row.slug, topic_row.title_zh, topic_row.title_en),
          ' '
        )
        from (
          select distinct topic.slug, topic.title_zh, topic.title_en
          from public.teacher_microcourses microcourse
          join public.teacher_microcourse_metadata_revisions metadata
            on metadata.id = case
              when can_manage then coalesce(
                microcourse.draft_metadata_revision_id,
                microcourse.published_metadata_revision_id
              )
              else microcourse.published_metadata_revision_id
            end
          join public.teacher_microcourse_topics topic
            on topic.id = metadata.primary_topic_id
          where microcourse.course_id = course.id
            and (can_manage or microcourse.withdrawn_at is null)
        ) topic_row
      ) as topic_text
  ) metadata_facets on true
  where course.family_id = p_family_id
    and (
      can_manage
      or (
        course.trashed_at is null
        and course.status = 'enabled'
      )
    )
  order by greatest(root.updated_at, course.updated_at) desc, course.title, course.id;
end;
$$;

revoke all on function public.list_teacher_microcourse_library(uuid)
  from public, anon, authenticated;
grant execute on function public.list_teacher_microcourse_library(uuid)
  to authenticated;

comment on function public.list_teacher_microcourse_library(uuid) is
  'Teacher-microcourse discovery facets. Source grade/class/season remain optional filters, never a unique course address.';

notify pgrst, 'reload schema';

commit;
