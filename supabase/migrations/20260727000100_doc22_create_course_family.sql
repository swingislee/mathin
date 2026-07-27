-- docs/plan/22 §5.15：课程产品创建。
--
-- 权限键 course.product.create 从 P4B 起就存在，但一直没有消费方：现有课程工作区
-- 只能在已有 Course Family 下建 Variant（create_course_variant），从零建立一个课程
-- 产品没有任何入口。这是本轮唯一新增的创建路由 /dashboard/courses/new 的数据层。

-- ---------------------------------------------------------------------------
-- 1. create_course_family
-- ---------------------------------------------------------------------------
create or replace function public.create_course_family(
  p_title text,
  p_publisher text default '',
  p_stage text default '',
  p_subject text default '',
  p_edition text default '',
  p_description text default '',
  p_purpose text default 'production',
  p_owner_id uuid default null,
  p_first_variant jsonb default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_title text := left(trim(coalesce(p_title, '')), 120);
  v_purpose text := lower(trim(coalesce(p_purpose, 'production')));
  v_base text;
  v_slug text;
  v_suffix integer := 0;
  v_family_id uuid;
  v_grade smallint;
  v_season smallint;
  v_class_type text;
  v_variant_title text;
  v_product_code text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.product.create') then raise exception 'FORBIDDEN'; end if;
  if length(v_title) = 0 then raise exception 'VALIDATION'; end if;
  if v_purpose not in ('production', 'test') then raise exception 'VALIDATION'; end if;
  if p_owner_id is not null and not exists (select 1 from public.profiles where id = p_owner_id) then
    raise exception 'INVALID_STAFF';
  end if;

  -- slug 是产品库的搜索字段之一，但它不是用户可见的表单项：中文标题 slugify 之后
  -- 通常是空串，所以保留 ASCII 片段、空则退回 'course'，再按需追加数字避开 unique。
  v_base := trim(both '-' from regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'));
  if length(v_base) = 0 then v_base := 'course'; end if;
  v_base := left(v_base, 48);
  v_slug := v_base;
  while exists (select 1 from public.course_families where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    if v_suffix > 500 then raise exception 'SLUG_EXHAUSTED'; end if;
    v_slug := v_base || '-' || v_suffix::text;
  end loop;

  -- status 建为 enabled 而不是 draft：family.status 决定的是产品在课程库里**是否可见**
  -- （list_course_families 的 draft 分支只对 course.manage 开放），而能不能拿去开班由
  -- variant.status 和讲次 release 把关，新建版本本来就是 draft。若这里建成 draft，
  -- 只持有 course.product.create 而没有 course.manage 的人会立刻在库里找不到自己刚建的产品。
  insert into public.course_families (
    slug, title, publisher, stage, subject, edition, description, purpose, status, created_by
  ) values (
    v_slug,
    v_title,
    left(trim(coalesce(p_publisher, '')), 60),
    left(trim(coalesce(p_stage, '')), 40),
    left(trim(coalesce(p_subject, '')), 40),
    left(trim(coalesce(p_edition, '')), 60),
    left(trim(coalesce(p_description, '')), 2000),
    v_purpose,
    'enabled',
    uid
  )
  returning id into v_family_id;

  -- 初始负责人是创建流程的一部分，因此这里直接落 assignment，而不要求另一枚
  -- course.assignment.manage——建产品的人本来就在决定它归谁。后续改派仍走
  -- assign_course_owner，那条路径继续受 course.assignment.manage 保护。
  if p_owner_id is not null then
    insert into public.course_staff_assignments (user_id, scope_type, family_id, responsibility, created_by)
    values (p_owner_id, 'family', v_family_id, 'owner', uid);
  end if;

  -- 可选首个版本：内联 insert 而不是调用 create_course_variant——后者要求
  -- course.manage，而 course.product.create 是一枚独立的权限键。
  if p_first_variant is not null and jsonb_typeof(p_first_variant) = 'object' then
    v_variant_title := left(trim(coalesce(p_first_variant ->> 'title', '')), 100);
    if length(v_variant_title) = 0 then raise exception 'VALIDATION'; end if;
    if coalesce(p_first_variant ->> 'grade', '') !~ '^[1-9]$' then raise exception 'VALIDATION'; end if;
    if coalesce(p_first_variant ->> 'courseSeason', '') !~ '^[1-4]$' then raise exception 'VALIDATION'; end if;
    v_grade := (p_first_variant ->> 'grade')::smallint;
    v_season := (p_first_variant ->> 'courseSeason')::smallint;
    v_class_type := left(trim(coalesce(p_first_variant ->> 'classType', '')), 20);
    v_product_code := nullif(left(trim(coalesce(p_first_variant ->> 'productCode', '')), 40), '');

    begin
      insert into public.courses (
        family_id, title, product_code, grade, term, class_type, status, purpose, created_by
      ) values (
        v_family_id, v_variant_title, v_product_code, v_grade, v_season, v_class_type, 'draft', v_purpose, uid
      );
    exception when unique_violation then
      raise exception 'VARIANT_ALREADY_EXISTS';
    end;
  end if;

  return v_family_id;
end;
$$;

revoke all on function public.create_course_family(text, text, text, text, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_course_family(text, text, text, text, text, text, text, uuid, jsonb)
  to authenticated;

comment on function public.create_course_family(text, text, text, text, text, text, text, uuid, jsonb) is
  'doc22 §5.15 课程产品创建：产品身份 + 用途 + 可选初始负责人 + 可选首个版本，权限键 course.product.create。';

-- ---------------------------------------------------------------------------
-- 2. list_course_families：让还没有任何版本的课程产品在库里可见。
--
-- 原实现用 `join public.courses` 聚合版本，因此零版本的 family 一行都不返回。
-- 在 P4H 那批 seed 数据里不存在这种 family，但 §5.15 明确把"首个课程版本"定为
-- 可选步骤——不改这里的话，只填产品身份就创建的产品在跳转离开详情页之后就再也
-- 找不到了。
--
-- 修法是并上一条"零版本产品"分支，而不是把 join 改成 left join：后者会让
-- grade/courseSeason/classType/variantStatus/readiness 这些**版本级**筛选失效
-- （筛年级 3 会把所有产品都列出来、只是匹配版本为空）。零版本分支只在没有任何
-- 版本级筛选时参与，语义与既有筛选完全不冲突。
-- ---------------------------------------------------------------------------
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
  v_search := replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  -- 只要有一条版本级筛选生效，"零版本产品"就必然不匹配，直接整条分支关掉。
  -- teaching scope 同理：它的定义就是"我在教的版本"。
  v_variant_filtered :=
    v_grade is not null
    or v_course_season is not null
    or v_class_type <> ''
    or v_variant_status is not null
    or v_readiness is not null
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

revoke all on function public.list_course_families(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.list_course_families(text, jsonb, integer) to authenticated;
