-- P4H-3 forward repair：RETURNS TABLE 输出列在 PL/pgSQL 中也是变量，查询 CTE 必须全限定。
-- 20260720000300 已在开发库执行过；此迁移让已部署实例与修正后的源迁移保持一致。

create or replace function public.list_course_families(
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
  v_status text := nullif(lower(trim(coalesce(p_filters ->> 'status', ''))), '');
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
  if v_status not in ('draft','enabled','disabled') then v_status := null; end if;
  v_search := replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  return query
  with variants as (
    select family_row.id as family_id, family_row.slug, family_row.title as family_title,
      family_row.publisher, family_row.stage, family_row.subject, family_row.edition,
      family_row.purpose as family_purpose, family_row.status as family_status,
      course_row.id as variant_id, course_row.title as variant_title, course_row.product_code,
      course_row.grade, course_row.term, course_row.class_type
      from public.course_families family_row
      join public.courses course_row on course_row.family_id = family_row.id
     where course_row.trashed_at is null
       and (can_manage or (family_row.status = 'enabled' and course_row.status = 'enabled'))
       and (v_scope <> 'test' or family_row.purpose = 'test')
       and (v_scope <> 'teaching' or exists (
         select 1 from public.classrooms classroom_row
         join public.classroom_staff_assignments assignment_row on assignment_row.classroom_id = classroom_row.id
         where classroom_row.course_id = course_row.id
           and assignment_row.user_id = uid
           and assignment_row.responsibility in ('primary_teacher','assistant_teacher')
       ))
       and (v_grade is null or course_row.grade = v_grade)
       and (v_course_season is null or course_row.term = v_course_season)
       and (v_class_type = '' or course_row.class_type = v_class_type)
       and (v_purpose is null or family_row.purpose = v_purpose)
       and (v_status is null or family_row.status = v_status)
       and (
         v_query = ''
         or family_row.title ilike '%' || v_search || '%' escape E'\\'
         or family_row.slug ilike '%' || v_search || '%' escape E'\\'
         or course_row.title ilike '%' || v_search || '%' escape E'\\'
         or coalesce(course_row.product_code, '') ilike '%' || v_search || '%' escape E'\\'
         or exists (select 1 from public.course_lectures lecture_row where lecture_row.course_id = course_row.id and lecture_row.name ilike '%' || v_search || '%' escape E'\\')
       )
  ), families as (
    select
      variant_row.family_id, variant_row.slug, variant_row.family_title,
      variant_row.publisher, variant_row.stage, variant_row.subject, variant_row.edition,
      variant_row.family_purpose, variant_row.family_status,
      count(*)::integer as variant_count,
      sum((select count(*) from public.course_lectures lecture_row where lecture_row.course_id = variant_row.variant_id))::integer as lecture_count,
      jsonb_agg(jsonb_build_object(
        'id', variant_row.variant_id,
        'title', variant_row.variant_title,
        'productCode', variant_row.product_code,
        'grade', variant_row.grade,
        'courseSeason', variant_row.term,
        'classType', variant_row.class_type,
        'lectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = variant_row.variant_id),
        'releasedLectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = variant_row.variant_id and lecture_row.current_release_id is not null)
      ) order by variant_row.grade, variant_row.term, variant_row.class_type, variant_row.product_code) as matched_variants
      from variants variant_row
     group by variant_row.family_id, variant_row.slug, variant_row.family_title,
       variant_row.publisher, variant_row.stage, variant_row.subject, variant_row.edition,
       variant_row.family_purpose, variant_row.family_status
  )
  select
    family_row.family_id, family_row.slug, family_row.family_title,
    family_row.publisher, family_row.stage, family_row.subject, family_row.edition,
    family_row.family_purpose, family_row.family_status,
    family_row.variant_count, family_row.lecture_count, family_row.matched_variants, count(*) over()::integer
    from families family_row
   order by family_row.family_title, family_row.slug
   limit 30 offset ((v_page - 1) * 30);
end;
$$;

revoke all on function public.list_course_families(text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.list_course_families(text,jsonb,integer) to authenticated;

drop policy if exists "course_families_select_course_view" on public.course_families;
create policy "course_families_select_course_view" on public.course_families
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.view')
    and (status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    and exists (
      select 1 from public.courses course_row
       where course_row.family_id = public.course_families.id
         and course_row.trashed_at is null
         and (course_row.status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    )
  );
