-- P6：课程目录版本层的读写面。
--
-- 迁移 20260803000300 只建了结构。本迁移把版本暴露到三处会因为版本并存而产生歧义的
-- 界面上：课程库列表、课程产品版本矩阵、建班课程选择器；并让建版本可以显式指定落到
-- 哪一个年度版本，而不是永远落在课程族的当前版本。
--
-- 建班选择器默认排除已被替代的课程版本。已有班级仍固定在原 course_id 上，按 ID 直接
-- 打开的详情接口也继续返回被替代的课程，只是带上 isSuperseded 让界面说清楚。

-- ---------------------------------------------------------------------------
-- 1. create_course_variant：可选指定年度版本
-- ---------------------------------------------------------------------------
drop function if exists public.create_course_variant(uuid, text, text, smallint, smallint, text, text);

create function public.create_course_variant(
  p_family_id uuid,
  p_title text,
  p_product_code text,
  p_grade smallint,
  p_course_season smallint,
  p_class_type text,
  p_status text default 'draft',
  p_catalog_version_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_row public.course_families%rowtype;
  version_id uuid;
  course_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_title, ''))) = 0
     or p_grade not between 1 and 9
     or p_course_season not between 1 and 4
     or p_status not in ('draft', 'enabled', 'disabled') then
    raise exception 'VALIDATION';
  end if;

  select * into family_row from public.course_families where id = p_family_id;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;

  -- 不传版本时沿用课程族当前版本，与 courses_resolve_catalog_version 触发器同义；
  -- 显式传入时必须属于本课程族，避免版本矩阵在某个版本页签下创建出别的版本的课程。
  if p_catalog_version_id is null then
    select version_row.id into version_id
      from public.course_catalog_versions version_row
     where version_row.family_id = p_family_id and version_row.is_current;
    if version_id is null then raise exception 'COURSE_CATALOG_VERSION_MISSING'; end if;
  else
    select version_row.id into version_id
      from public.course_catalog_versions version_row
     where version_row.id = p_catalog_version_id and version_row.family_id = p_family_id;
    if version_id is null then raise exception 'COURSE_CATALOG_VERSION_NOT_IN_FAMILY'; end if;
  end if;

  begin
    insert into public.courses (family_id, catalog_version_id, title, product_code, grade, term, class_type, status, purpose, created_by)
    values (
      p_family_id,
      version_id,
      left(trim(p_title), 100),
      nullif(left(trim(coalesce(p_product_code, '')), 40), ''),
      p_grade,
      p_course_season,
      left(trim(coalesce(p_class_type, '')), 20),
      p_status,
      family_row.purpose,
      uid
    )
    returning id into course_id;
  exception when unique_violation then
    raise exception 'VARIANT_ALREADY_EXISTS';
  end;

  return course_id;
end;
$$;

revoke all on function public.create_course_variant(uuid, text, text, smallint, smallint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_course_variant(uuid, text, text, smallint, smallint, text, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_course_family_detail：产品总览按年度版本分组
-- ---------------------------------------------------------------------------
create or replace function public.get_course_family_detail(
  p_family_id uuid,
  p_variant_id uuid default null,
  p_scope text default 'all'
)
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_manage boolean;
  v_scope text := lower(trim(coalesce(p_scope, 'all')));
  family_row public.course_families%rowtype;
  selected_variant public.courses%rowtype;
  has_selected_variant boolean := false;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if v_scope not in ('research', 'teaching', 'all', 'test') then raise exception 'INVALID_SCOPE'; end if;

  can_manage := public.has_perm(uid, 'course.manage');
  if v_scope in ('research', 'test') and not can_manage then raise exception 'FORBIDDEN_SCOPE'; end if;

  select * into family_row from public.course_families where id = p_family_id;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  if not can_manage and family_row.status <> 'enabled' then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_scope = 'test' and family_row.purpose <> 'test' then raise exception 'FORBIDDEN_SCOPE'; end if;

  -- doc19 §8.2：未指定版本时进入产品总览，不自动选择数据库第一版本。
  if p_variant_id is not null then
    select * into selected_variant
    from public.courses course_row
    where course_row.id = p_variant_id
      and course_row.family_id = p_family_id;
    if not found then raise exception 'COURSE_VARIANT_NOT_IN_FAMILY'; end if;
    if not can_manage and (
      selected_variant.trashed_at is not null
      or selected_variant.status <> 'enabled'
      or (v_scope = 'teaching' and not exists (
        select 1
        from public.classrooms classroom_row
        join public.classroom_staff_assignments assignment_row on assignment_row.classroom_id = classroom_row.id
        where classroom_row.course_id = selected_variant.id
          and assignment_row.user_id = uid
          and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      ))
    ) then
      raise exception 'FORBIDDEN_SCOPE';
    end if;
    has_selected_variant := true;
  end if;

  return jsonb_build_object(
    'family', jsonb_build_object(
      'id', family_row.id,
      'slug', family_row.slug,
      'title', family_row.title,
      'publisher', family_row.publisher,
      'stage', family_row.stage,
      'subject', family_row.subject,
      'edition', family_row.edition,
      'description', family_row.description,
      'coverPath', family_row.cover_path,
      'purpose', family_row.purpose,
      'status', family_row.status
    ),
    -- 版本矩阵的年级 × 季节 × 班型三维在年度版本并存后会重叠，因此总览必须先按
    -- 版本分面。这里始终返回全部版本，界面按 length >= 2 决定是否显示版本页签。
    'catalogVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version_row.id,
        'slug', version_row.slug,
        'title', version_row.title,
        'editionYear', version_row.edition_year,
        'isCurrent', version_row.is_current,
        'status', version_row.status,
        'variantCount', (
          select count(*) from public.courses course_row
           where course_row.catalog_version_id = version_row.id
             and course_row.trashed_at is null
        )
      ) order by version_row.sort_order, version_row.slug)
      from public.course_catalog_versions version_row
      where version_row.family_id = p_family_id
        and (version_row.status = 'enabled' or can_manage)
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course_row.id,
        'title', course_row.title,
        'productCode', course_row.product_code,
        'catalogVersionId', course_row.catalog_version_id,
        'catalogVersionSlug', version_row.slug,
        'catalogVersionTitle', version_row.title,
        'supersededByCourseId', course_row.superseded_by_course_id,
        'grade', course_row.grade,
        'courseSeason', course_row.term,
        'classType', course_row.class_type,
        'status', course_row.status,
        'purpose', course_row.purpose,
        'trashedAt', course_row.trashed_at,
        'lectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = course_row.id),
        'releasedLectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = course_row.id and lecture_row.current_release_id is not null),
        'classroomCount', (select count(*) from public.classrooms classroom_row where classroom_row.course_id = course_row.id and classroom_row.archived_at is null),
        'hasRisk', exists (
          select 1
          from public.cw_lecture_workflows workflow_row
          join public.course_lectures lecture_row on lecture_row.id = workflow_row.lecture_id
          where lecture_row.course_id = course_row.id
            and (
              workflow_row.stage = 'changes_requested'
              or (workflow_row.internal_due_at is not null and workflow_row.internal_due_at < now() and workflow_row.stage <> 'ready_to_publish')
            )
        )
      ) order by version_row.sort_order, course_row.grade, course_row.term, course_row.class_type, course_row.product_code)
      from public.courses course_row
      join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
      where course_row.family_id = p_family_id
        and (
          can_manage
          or (
            course_row.trashed_at is null
            and course_row.status = 'enabled'
            and (
              v_scope <> 'teaching'
              or exists (
                select 1
                from public.classrooms classroom_row
                join public.classroom_staff_assignments assignment_row on assignment_row.classroom_id = classroom_row.id
                where classroom_row.course_id = course_row.id
                  and assignment_row.user_id = uid
                  and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
              )
            )
          )
        )
    ), '[]'::jsonb),
    'selectedVariant', case when has_selected_variant then jsonb_build_object(
      'id', selected_variant.id,
      'title', selected_variant.title,
      'productCode', selected_variant.product_code,
      'catalogVersionId', selected_variant.catalog_version_id,
      'catalogVersionSlug', (select version_row.slug from public.course_catalog_versions version_row where version_row.id = selected_variant.catalog_version_id),
      'catalogVersionTitle', (select version_row.title from public.course_catalog_versions version_row where version_row.id = selected_variant.catalog_version_id),
      'supersededByCourseId', selected_variant.superseded_by_course_id,
      'grade', selected_variant.grade,
      'courseSeason', selected_variant.term,
      'classType', selected_variant.class_type,
      'status', selected_variant.status,
      'purpose', selected_variant.purpose,
      'updatedAt', selected_variant.updated_at
    ) else null end,
    'teachingPlan', case when not has_selected_variant then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lecture_row.id,
        'no', lecture_row.no,
        'name', lecture_row.name,
        'objectives', lecture_row.objectives,
        'status', lecture_row.status,
        'archivedAt', lecture_row.archived_at,
        'hasRelease', lecture_row.current_release_id is not null,
        'pageCount', (select count(*) from public.cw_page_docs page_row where page_row.lecture_id = lecture_row.id and page_row.deleted_at is null)
      ) order by lecture_row.no)
      from public.course_lectures lecture_row
      where lecture_row.course_id = selected_variant.id
    ), '[]'::jsonb) end,
    'readiness', case when not has_selected_variant then jsonb_build_object('lectureCount', 0, 'releasedLectureCount', 0, 'pageCount', 0) else jsonb_build_object(
      'lectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = selected_variant.id),
      'releasedLectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = selected_variant.id and lecture_row.current_release_id is not null),
      'pageCount', (select count(*) from public.cw_page_docs page_row join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id where lecture_row.course_id = selected_variant.id and page_row.deleted_at is null)
    ) end,
    'familyAssignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment_row.id,
        'userId', assignment_row.user_id,
        'userName', profile_row.display_name,
        'responsibility', assignment_row.responsibility,
        'createdAt', assignment_row.created_at,
        'archivedAt', assignment_row.archived_at
      ) order by (assignment_row.archived_at is not null), assignment_row.created_at desc)
      from public.course_staff_assignments assignment_row
      join public.profiles profile_row on profile_row.id = assignment_row.user_id
      where assignment_row.scope_type = 'family' and assignment_row.family_id = p_family_id
    ), '[]'::jsonb),
    'variantAssignments', case when not has_selected_variant then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment_row.id,
        'userId', assignment_row.user_id,
        'userName', profile_row.display_name,
        'responsibility', assignment_row.responsibility,
        'createdAt', assignment_row.created_at,
        'archivedAt', assignment_row.archived_at
      ) order by (assignment_row.archived_at is not null), assignment_row.created_at desc)
      from public.course_staff_assignments assignment_row
      join public.profiles profile_row on profile_row.id = assignment_row.user_id
      where assignment_row.scope_type = 'variant' and assignment_row.course_id = selected_variant.id
    ), '[]'::jsonb) end,
    'usage', case when not has_selected_variant then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', classroom_row.id,
        'name', classroom_row.name,
        'operationalStatus', classroom_row.operational_status,
        'archivedAt', classroom_row.archived_at
      ) order by (classroom_row.archived_at is not null), classroom_row.created_at desc)
      from (
        select * from public.classrooms classroom_row
        where classroom_row.course_id = selected_variant.id
        order by (classroom_row.archived_at is not null), classroom_row.created_at desc
        limit 50
      ) classroom_row
    ), '[]'::jsonb) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. list_course_families：版本徽标与版本筛选
-- ---------------------------------------------------------------------------
create or replace function public.list_course_families(
  p_scope text default 'all',
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1
)
returns table(
  id uuid, slug text, title text, publisher text, stage text, subject text, edition text,
  purpose text, status text, variant_count integer, lecture_count integer,
  released_lecture_count integer, incomplete_lecture_count integer, classroom_count integer,
  next_session_at timestamptz, updated_at timestamptz, matched_variants jsonb, total_count integer
)
language plpgsql
stable security definer
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
  v_catalog_version text := nullif(left(lower(trim(coalesce(p_filters ->> 'catalogVersion', ''))), 40), '');
  v_variant_filtered boolean;
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
  if v_catalog_version is not null and v_catalog_version !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then v_catalog_version := null; end if;
  v_search := replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  -- 只要有一条版本级筛选生效，"零版本产品"就必然不匹配，直接整条分支关掉。
  -- teaching scope 同理：它的定义就是"我在教的版本"。
  v_variant_filtered :=
    v_grade is not null
    or v_course_season is not null
    or v_class_type <> ''
    or v_variant_status is not null
    or v_readiness is not null
    or v_catalog_version is not null
    or v_scope = 'teaching';

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
      course_row.superseded_by_course_id,
      version_row.slug as catalog_version_slug,
      version_row.title as catalog_version_title,
      version_row.sort_order as catalog_version_sort,
      lecture_stats.lecture_count,
      lecture_stats.released_lecture_count
    from public.course_families family_row
    join public.courses course_row on course_row.family_id = family_row.id
    join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
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
      and (v_catalog_version is null or version_row.slug = v_catalog_version)
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
        'catalogVersionSlug', variant_row.catalog_version_slug,
        'catalogVersionTitle', variant_row.catalog_version_title,
        'supersededByCourseId', variant_row.superseded_by_course_id,
        'grade', variant_row.grade,
        'courseSeason', variant_row.term,
        'classType', variant_row.class_type,
        'lectureCount', variant_row.lecture_count,
        'releasedLectureCount', variant_row.released_lecture_count
      ) order by variant_row.catalog_version_sort, variant_row.grade, variant_row.term, variant_row.class_type, variant_row.product_code) as matched_variants
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

    union all

    select
      family_row.id,
      family_row.slug,
      family_row.title,
      family_row.publisher,
      family_row.stage,
      family_row.subject,
      family_row.edition,
      family_row.purpose,
      family_row.status,
      family_row.updated_at,
      family_row.updated_at,
      0, 0, 0, 0,
      '[]'::jsonb
    from public.course_families family_row
    where not v_variant_filtered
      and not exists (
        select 1 from public.courses course_row
        where course_row.family_id = family_row.id and course_row.trashed_at is null
      )
      and (can_manage or family_row.status = 'enabled')
      and (v_scope <> 'test' or family_row.purpose = 'test')
      and (v_purpose is null or family_row.purpose = v_purpose)
      and (v_family_status is null or family_row.status = v_family_status)
      and (
        v_query = ''
        or family_row.title ilike '%' || v_search || '%' escape E'\\'
        or family_row.publisher ilike '%' || v_search || '%' escape E'\\'
        or family_row.subject ilike '%' || v_search || '%' escape E'\\'
        or family_row.edition ilike '%' || v_search || '%' escape E'\\'
        or family_row.slug ilike '%' || v_search || '%' escape E'\\'
      )
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

-- ---------------------------------------------------------------------------
-- 4. 建班课程选择器：默认只给未被替代的版本
-- ---------------------------------------------------------------------------
drop function if exists public.list_class_build_course_variants(text, smallint, smallint, text, text, integer);

create function public.list_class_build_course_variants(
  p_query text default '',
  p_grade smallint default null,
  p_course_season smallint default null,
  p_class_type text default null,
  p_purpose text default 'production',
  p_limit integer default 30,
  p_include_superseded boolean default false
)
returns table(
  course_id uuid, family_id uuid, family_title text, variant_title text, product_code text,
  catalog_version_slug text, catalog_version_title text, is_superseded boolean,
  grade smallint, course_season smallint, class_type text,
  lecture_count integer, released_lecture_count integer
)
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  normalized_query text := left(lower(btrim(coalesce(p_query, ''))), 80);
  normalized_class_type text := nullif(left(btrim(coalesce(p_class_type, '')), 20), '');
  bounded_limit integer := least(greatest(coalesce(p_limit, 30), 1), 30);
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;
  if p_grade is not null and (p_grade < 1 or p_grade > 12) then raise exception 'INVALID_GRADE'; end if;
  if p_course_season is not null and p_course_season not between 1 and 4 then raise exception 'INVALID_COURSE_SEASON'; end if;

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
    counts.released_lecture_count
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
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
    -- 已被新版替代的课程版本默认不出现在建班候选里；显式勾选"含历史版本"才返回。
    and (coalesce(p_include_superseded, false) or course_row.superseded_by_course_id is null)
    and (p_grade is null or course_row.grade = p_grade)
    and (p_course_season is null or course_row.term = p_course_season)
    and (normalized_class_type is null or course_row.class_type = normalized_class_type)
    and (
      normalized_query = ''
      or lower(family_row.title) like '%' || normalized_query || '%'
      or lower(course_row.title) like '%' || normalized_query || '%'
      or lower(coalesce(course_row.product_code, '')) like '%' || normalized_query || '%'
      or exists (
        select 1 from public.course_lectures lecture_match
        where lecture_match.course_id = course_row.id
          and lecture_match.status = 'active'
          and lower(lecture_match.name) like '%' || normalized_query || '%'
      )
    )
  order by family_row.title, version_row.sort_order desc, course_row.grade, course_row.term, course_row.class_type, course_row.title
  limit bounded_limit;
end;
$$;

revoke all on function public.list_class_build_course_variants(text, smallint, smallint, text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.list_class_build_course_variants(text, smallint, smallint, text, text, integer, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 建班课程详情：按 ID 打开时仍返回被替代的版本，但要说清楚
-- ---------------------------------------------------------------------------
create or replace function public.get_class_build_course_detail(p_course_id uuid, p_purpose text default 'production')
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
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
    'lectures', coalesce(lectures.rows, '[]'::jsonb)
  ) into result
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
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
    where lecture_row.course_id = course_row.id
      and lecture_row.status = 'active'
  ) lectures
  where course_row.id = p_course_id
    and family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose;

  if result is null then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  return result;
end;
$$;
