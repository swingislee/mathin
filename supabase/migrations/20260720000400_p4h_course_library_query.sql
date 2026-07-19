-- P4H-4：课程产品库的单查询列表合同。
-- 在产品库内一次聚合版本、讲次准备度、使用班级和下一次使用时间，避免按 family N+1 请求。

drop function if exists public.list_course_families(text, jsonb, integer);

create function public.list_course_families(
  p_scope text default 'all',
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1
)
returns table(
  id uuid,
  slug text,
  title text,
  publisher text,
  stage text,
  subject text,
  edition text,
  purpose text,
  status text,
  variant_count integer,
  lecture_count integer,
  released_lecture_count integer,
  incomplete_lecture_count integer,
  classroom_count integer,
  next_session_at timestamptz,
  updated_at timestamptz,
  matched_variants jsonb,
  total_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_manage boolean;
  v_scope text := lower(trim(coalesce(p_scope, 'all')));
  v_query text := left(trim(coalesce(p_filters ->> 'q', '')), 80);
  v_search text;
  v_grade smallint;
  v_course_season smallint;
  v_class_type text := left(trim(coalesce(p_filters ->> 'classType', '')), 20);
  v_purpose text := nullif(lower(trim(coalesce(p_filters ->> 'purpose', ''))), '');
  v_family_status text := nullif(lower(trim(coalesce(p_filters ->> 'familyStatus', ''))), '');
  v_variant_status text := nullif(lower(trim(coalesce(p_filters ->> 'variantStatus', ''))), '');
  v_readiness text := nullif(lower(trim(coalesce(p_filters ->> 'readiness', ''))), '');
  v_page integer := greatest(1, least(coalesce(p_page, 1), 100000));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if v_scope not in ('research','teaching','all','test') then raise exception 'INVALID_SCOPE'; end if;

  can_manage := public.has_perm(uid, 'course.manage');
  if v_scope in ('research','test') and not can_manage then raise exception 'FORBIDDEN_SCOPE'; end if;
  if coalesce(p_filters ->> 'grade', '') ~ '^[1-9]$' then v_grade := (p_filters ->> 'grade')::smallint; end if;
  if coalesce(p_filters ->> 'courseSeason', '') ~ '^[1-4]$' then v_course_season := (p_filters ->> 'courseSeason')::smallint; end if;
  if v_purpose not in ('production','test') then v_purpose := null; end if;
  if v_family_status not in ('draft','enabled','disabled') then v_family_status := null; end if;
  if v_variant_status not in ('draft','enabled','disabled') then v_variant_status := null; end if;
  if v_readiness not in ('ready','incomplete') then v_readiness := null; end if;
  v_search := replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  return query
  with variants as (
    select
      family_row.id as family_id,
      family_row.slug,
      family_row.title as family_title,
      family_row.publisher,
      family_row.stage,
      family_row.subject,
      family_row.edition,
      family_row.purpose as family_purpose,
      family_row.status as family_status,
      family_row.updated_at as family_updated_at,
      course_row.id as variant_id,
      course_row.title as variant_title,
      course_row.product_code,
      course_row.grade,
      course_row.term,
      course_row.class_type,
      course_row.status as variant_status,
      course_row.updated_at as variant_updated_at,
      lecture_stats.lecture_count,
      lecture_stats.released_lecture_count
    from public.course_families family_row
    join public.courses course_row on course_row.family_id = family_row.id
    cross join lateral (
      select
        count(*)::integer as lecture_count,
        count(*) filter (where lecture_row.current_release_id is not null)::integer as released_lecture_count
      from public.course_lectures lecture_row
      where lecture_row.course_id = course_row.id
    ) lecture_stats
    where course_row.trashed_at is null
      and (can_manage or (family_row.status = 'enabled' and course_row.status = 'enabled'))
      and (v_scope <> 'test' or family_row.purpose = 'test')
      and (v_scope <> 'teaching' or exists (
        select 1
        from public.classrooms classroom_row
        join public.classroom_staff_assignments assignment_row on assignment_row.classroom_id = classroom_row.id
        where classroom_row.course_id = course_row.id
          and assignment_row.user_id = uid
          and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      ))
      and (v_grade is null or course_row.grade = v_grade)
      and (v_course_season is null or course_row.term = v_course_season)
      and (v_class_type = '' or course_row.class_type = v_class_type)
      and (v_purpose is null or family_row.purpose = v_purpose)
      and (v_family_status is null or family_row.status = v_family_status)
      and (v_variant_status is null or course_row.status = v_variant_status)
      and (v_readiness is null
        or (v_readiness = 'ready' and lecture_stats.lecture_count > 0 and lecture_stats.released_lecture_count = lecture_stats.lecture_count)
        or (v_readiness = 'incomplete' and lecture_stats.released_lecture_count < lecture_stats.lecture_count))
      and (
        v_query = ''
        or family_row.title ilike '%' || v_search || '%' escape E'\\'
        or family_row.publisher ilike '%' || v_search || '%' escape E'\\'
        or family_row.subject ilike '%' || v_search || '%' escape E'\\'
        or family_row.edition ilike '%' || v_search || '%' escape E'\\'
        or family_row.slug ilike '%' || v_search || '%' escape E'\\'
        or course_row.title ilike '%' || v_search || '%' escape E'\\'
        or coalesce(course_row.product_code, '') ilike '%' || v_search || '%' escape E'\\'
        or exists (
          select 1
          from public.course_lectures lecture_row
          where lecture_row.course_id = course_row.id
            and lecture_row.name ilike '%' || v_search || '%' escape E'\\'
        )
      )
  ), families as (
    select
      variant_row.family_id,
      variant_row.slug,
      variant_row.family_title,
      variant_row.publisher,
      variant_row.stage,
      variant_row.subject,
      variant_row.edition,
      variant_row.family_purpose,
      variant_row.family_status,
      max(variant_row.family_updated_at) as family_updated_at,
      max(variant_row.variant_updated_at) as variant_updated_at,
      count(*)::integer as variant_count,
      sum(variant_row.lecture_count)::integer as lecture_count,
      sum(variant_row.released_lecture_count)::integer as released_lecture_count,
      sum(variant_row.lecture_count - variant_row.released_lecture_count)::integer as incomplete_lecture_count,
      jsonb_agg(jsonb_build_object(
        'id', variant_row.variant_id,
        'title', variant_row.variant_title,
        'productCode', variant_row.product_code,
        'grade', variant_row.grade,
        'courseSeason', variant_row.term,
        'classType', variant_row.class_type,
        'lectureCount', variant_row.lecture_count,
        'releasedLectureCount', variant_row.released_lecture_count
      ) order by variant_row.grade, variant_row.term, variant_row.class_type, variant_row.product_code) as matched_variants
    from variants variant_row
    group by
      variant_row.family_id,
      variant_row.slug,
      variant_row.family_title,
      variant_row.publisher,
      variant_row.stage,
      variant_row.subject,
      variant_row.edition,
      variant_row.family_purpose,
      variant_row.family_status
  ), presentation as (
    select
      family_row.*,
      usage_row.classroom_count,
      usage_row.next_session_at,
      greatest(family_row.family_updated_at, family_row.variant_updated_at) as updated_at
    from families family_row
    cross join lateral (
      select
        count(distinct classroom_row.id)::integer as classroom_count,
        min(session_row.scheduled_at) filter (
          where session_row.scheduled_at >= now()
            and session_row.deleted_at is null
            and session_row.voided_at is null
        ) as next_session_at
      from public.classrooms classroom_row
      join public.courses usage_course_row on usage_course_row.id = classroom_row.course_id
      left join public.class_sessions session_row on session_row.classroom_id = classroom_row.id
      where usage_course_row.family_id = family_row.family_id
    ) usage_row
  )
  select
    presentation_row.family_id,
    presentation_row.slug,
    presentation_row.family_title,
    presentation_row.publisher,
    presentation_row.stage,
    presentation_row.subject,
    presentation_row.edition,
    presentation_row.family_purpose,
    presentation_row.family_status,
    presentation_row.variant_count,
    presentation_row.lecture_count,
    presentation_row.released_lecture_count,
    presentation_row.incomplete_lecture_count,
    presentation_row.classroom_count,
    presentation_row.next_session_at,
    presentation_row.updated_at,
    presentation_row.matched_variants,
    count(*) over()::integer
  from presentation presentation_row
  order by
    (presentation_row.incomplete_lecture_count > 0) desc,
    presentation_row.next_session_at asc nulls last,
    presentation_row.updated_at desc,
    presentation_row.family_title,
    presentation_row.slug
  limit 20 offset ((v_page - 1) * 20);
end;
$$;

revoke all on function public.list_course_families(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.list_course_families(text, jsonb, integer) to authenticated;
