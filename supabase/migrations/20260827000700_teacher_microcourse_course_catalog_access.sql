-- DEV-TMC-1 follow-up: the course-product picker is shared by class building
-- and teacher microcourse source selection, while their authorization remains
-- distinct. Microcourse authors may only use the existing catalog RPCs for
-- enabled production curriculum courses; class-building behavior is unchanged.

begin;

create or replace function public.list_class_build_course_variants(
  p_query text default '',
  p_grade smallint default null,
  p_course_season smallint default null,
  p_class_type text default null,
  p_purpose text default 'production',
  p_limit integer default 30,
  p_include_superseded boolean default false,
  p_course_kind text default null,
  p_author_id uuid default null,
  p_primary_topic_slug text default null,
  p_keyword text default null
)
returns table(
  course_id uuid,
  family_id uuid,
  family_title text,
  variant_title text,
  product_code text,
  catalog_version_slug text,
  catalog_version_title text,
  is_superseded boolean,
  grade smallint,
  course_season smallint,
  class_type text,
  lecture_count integer,
  released_lecture_count integer,
  course_kind text,
  author_id uuid,
  author_name text,
  primary_topic_slug text,
  primary_topic_title_zh text,
  primary_topic_title_en text,
  keywords text[]
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  normalized_query text := left(lower(btrim(coalesce(p_query, ''))), 100);
  normalized_class_type text := nullif(left(btrim(coalesce(p_class_type, '')), 40), '');
  normalized_keyword text := nullif(left(lower(btrim(coalesce(p_keyword, ''))), 32), '');
  bounded_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  can_build_class boolean := uid is not null and public.has_perm(uid, 'class.create');
  can_select_microcourse_source boolean := uid is not null
    and public.has_perm(uid, 'courseware.microcourse.author')
    and public.is_feature_enabled('teaching.teacher_microcourses_v1')
    and p_purpose = 'production'
    and p_course_kind = 'curriculum'
    and p_author_id is null
    and p_primary_topic_slug is null
    and p_keyword is null;
begin
  if uid is null or not (can_build_class or can_select_microcourse_source) then
    raise exception 'FORBIDDEN';
  end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;
  if p_grade is not null and p_grade not between 1 and 12 then raise exception 'INVALID_GRADE'; end if;
  if p_course_season is not null and p_course_season not between 1 and 4 then
    raise exception 'INVALID_COURSE_SEASON';
  end if;
  if p_course_kind is not null and p_course_kind not in ('curriculum', 'microcourse') then
    raise exception 'INVALID_COURSE_KIND';
  end if;

  return query
  select
    course_row.id,
    family_row.id,
    family_row.title,
    course_row.title,
    course_row.product_code,
    version_row.slug,
    version_row.title,
    course_row.superseded_by_course_id is not null,
    course_row.grade,
    course_row.term,
    course_row.class_type,
    counts.lecture_count,
    counts.released_lecture_count,
    course_row.course_kind,
    microcourse_row.author_id,
    author_profile.display_name,
    topic_row.slug,
    topic_row.title_zh,
    topic_row.title_en,
    metadata_row.keywords
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
  left join public.teacher_microcourses microcourse_row
    on microcourse_row.course_id = course_row.id
  left join public.teacher_microcourse_metadata_revisions metadata_row
    on metadata_row.id = microcourse_row.published_metadata_revision_id
  left join public.teacher_microcourse_topics topic_row
    on topic_row.id = metadata_row.primary_topic_id
  left join public.profiles author_profile on author_profile.id = microcourse_row.author_id
  cross join lateral (
    select
      count(*) filter (where lecture_row.status = 'active')::integer as lecture_count,
      count(*) filter (
        where lecture_row.status = 'active'
          and coalesce(native_head.current_release_id, lecture_row.current_release_id) is not null
      )::integer as released_lecture_count
    from public.course_lectures lecture_row
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture_row.id and native_head.track = 'native-16x9'
    where lecture_row.course_id = course_row.id
  ) counts
  where family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose
    and (coalesce(p_include_superseded, false) or course_row.superseded_by_course_id is null)
    and (p_course_kind is null or course_row.course_kind = p_course_kind)
    and (p_grade is null or course_row.grade = p_grade)
    and (p_course_season is null or course_row.term = p_course_season)
    and (normalized_class_type is null or course_row.class_type = normalized_class_type)
    and (p_author_id is null or microcourse_row.author_id = p_author_id)
    and (p_primary_topic_slug is null or topic_row.slug = p_primary_topic_slug)
    and (
      normalized_keyword is null
      or exists (
        select 1 from unnest(coalesce(metadata_row.keywords, '{}'::text[])) keyword_value
        where lower(keyword_value) like '%' || normalized_keyword || '%'
      )
    )
    and (
      course_row.course_kind = 'curriculum'
      or (
        microcourse_row.published_metadata_revision_id is not null
        and microcourse_row.withdrawn_at is null
        and counts.lecture_count = 1
        and counts.released_lecture_count = 1
      )
    )
    and (
      normalized_query = ''
      or lower(family_row.title) like '%' || normalized_query || '%'
      or lower(course_row.title) like '%' || normalized_query || '%'
      or lower(coalesce(course_row.product_code, '')) like '%' || normalized_query || '%'
      or lower(coalesce(author_profile.display_name, '')) like '%' || normalized_query || '%'
      or lower(coalesce(topic_row.title_zh, '')) like '%' || normalized_query || '%'
      or lower(coalesce(topic_row.title_en, '')) like '%' || normalized_query || '%'
      or exists (
        select 1 from public.course_lectures lecture_match
        where lecture_match.course_id = course_row.id
          and lecture_match.status = 'active'
          and lower(lecture_match.name) like '%' || normalized_query || '%'
      )
      or exists (
        select 1 from unnest(coalesce(metadata_row.keywords, '{}'::text[])) keyword_value
        where lower(keyword_value) like '%' || normalized_query || '%'
      )
    )
  order by
    case when course_row.course_kind = 'microcourse' then 0 else 1 end,
    coalesce(microcourse_row.last_published_at, course_row.updated_at) desc,
    family_row.title,
    version_row.sort_order desc,
    course_row.grade,
    course_row.term nulls last,
    course_row.class_type,
    course_row.title
  limit bounded_limit;
end;
$$;

create or replace function public.get_class_build_course_detail(
  p_course_id uuid,
  p_purpose text default 'production'
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
  can_build_class boolean := uid is not null and public.has_perm(uid, 'class.create');
  can_select_microcourse_source boolean := uid is not null
    and public.has_perm(uid, 'courseware.microcourse.author')
    and public.is_feature_enabled('teaching.teacher_microcourses_v1')
    and p_purpose = 'production';
begin
  if uid is null or not (can_build_class or can_select_microcourse_source) then
    raise exception 'FORBIDDEN';
  end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;

  select jsonb_build_object(
    'id', course_row.id,
    'familyId', family_row.id,
    'familyTitle', family_row.title,
    'title', course_row.title,
    'productCode', course_row.product_code,
    'catalogVersionSlug', version_row.slug,
    'catalogVersionTitle', version_row.title,
    'isSuperseded', course_row.superseded_by_course_id is not null,
    'grade', course_row.grade,
    'courseSeason', course_row.term,
    'classType', course_row.class_type,
    'lectureCount', counts.lecture_count,
    'releasedLectureCount', counts.released_lecture_count,
    'courseKind', course_row.course_kind,
    'authorId', microcourse_row.author_id,
    'authorName', author_profile.display_name,
    'primaryTopicSlug', topic_row.slug,
    'primaryTopicTitleZh', topic_row.title_zh,
    'primaryTopicTitleEn', topic_row.title_en,
    'keywords', metadata_row.keywords,
    'lectures', coalesce(lectures.rows, '[]'::jsonb)
  ) into result
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
  left join public.teacher_microcourses microcourse_row
    on microcourse_row.course_id = course_row.id
  left join public.teacher_microcourse_metadata_revisions metadata_row
    on metadata_row.id = microcourse_row.published_metadata_revision_id
  left join public.teacher_microcourse_topics topic_row
    on topic_row.id = metadata_row.primary_topic_id
  left join public.profiles author_profile on author_profile.id = microcourse_row.author_id
  cross join lateral (
    select
      count(*) filter (where lecture_row.status = 'active')::integer as lecture_count,
      count(*) filter (
        where lecture_row.status = 'active'
          and coalesce(native_head.current_release_id, lecture_row.current_release_id) is not null
      )::integer as released_lecture_count
    from public.course_lectures lecture_row
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture_row.id and native_head.track = 'native-16x9'
    where lecture_row.course_id = course_row.id
  ) counts
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', lecture_row.id,
      'no', lecture_row.no,
      'name', lecture_row.name,
      'objectives', lecture_row.objectives,
      'ready', coalesce(native_head.current_release_id, lecture_row.current_release_id) is not null
    ) order by lecture_row.no) as rows
    from public.course_lectures lecture_row
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture_row.id and native_head.track = 'native-16x9'
    where lecture_row.course_id = course_row.id and lecture_row.status = 'active'
  ) lectures
  where course_row.id = p_course_id
    and family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose
    and (can_build_class or course_row.course_kind = 'curriculum')
    and (
      course_row.course_kind = 'curriculum'
      or (
        microcourse_row.published_metadata_revision_id is not null
        and microcourse_row.withdrawn_at is null
        and counts.lecture_count = 1
        and counts.released_lecture_count = 1
      )
    );

  if result is null then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

revoke all on function public.list_class_build_course_variants(
  text, smallint, smallint, text, text, integer, boolean, text, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.get_class_build_course_detail(uuid, text)
  from public, anon, authenticated;

grant execute on function public.list_class_build_course_variants(
  text, smallint, smallint, text, text, integer, boolean, text, uuid, text, text
) to authenticated;
grant execute on function public.get_class_build_course_detail(uuid, text)
  to authenticated;

comment on function public.list_class_build_course_variants(
  text, smallint, smallint, text, text, integer, boolean, text, uuid, text, text
) is 'Shared course-product filter: class builders keep full catalog scope; microcourse authors are constrained to production curriculum sources.';

commit;
