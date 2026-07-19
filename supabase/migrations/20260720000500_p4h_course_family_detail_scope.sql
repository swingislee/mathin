-- P4H-5：课程产品详情必须与产品库使用同一 scope 合同。
-- 普通 course.view 不能借 familyId/variantId 猜测读取非本人任教的版本。

drop function if exists public.get_course_family_detail(uuid, uuid);

create function public.get_course_family_detail(
  p_family_id uuid,
  p_variant_id uuid default null,
  p_scope text default 'all'
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_manage boolean;
  v_scope text := lower(trim(coalesce(p_scope, 'all')));
  family_row public.course_families%rowtype;
  selected_variant public.courses%rowtype;
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
  else
    select * into selected_variant
    from public.courses course_row
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
    order by course_row.grade, course_row.term, course_row.class_type, course_row.product_code nulls last
    limit 1;
    if not found then raise exception 'FORBIDDEN_SCOPE'; end if;
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
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course_row.id,
        'title', course_row.title,
        'productCode', course_row.product_code,
        'grade', course_row.grade,
        'courseSeason', course_row.term,
        'classType', course_row.class_type,
        'status', course_row.status,
        'purpose', course_row.purpose,
        'trashedAt', course_row.trashed_at
      ) order by course_row.grade, course_row.term, course_row.class_type, course_row.product_code)
      from public.courses course_row
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
    'selectedVariant', jsonb_build_object(
      'id', selected_variant.id,
      'title', selected_variant.title,
      'productCode', selected_variant.product_code,
      'grade', selected_variant.grade,
      'courseSeason', selected_variant.term,
      'classType', selected_variant.class_type,
      'status', selected_variant.status,
      'purpose', selected_variant.purpose,
      'updatedAt', selected_variant.updated_at
    ),
    'teachingPlan', coalesce((
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
    ), '[]'::jsonb),
    'readiness', jsonb_build_object(
      'lectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = selected_variant.id),
      'releasedLectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = selected_variant.id and lecture_row.current_release_id is not null),
      'pageCount', (select count(*) from public.cw_page_docs page_row join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id where lecture_row.course_id = selected_variant.id and page_row.deleted_at is null)
    )
  );
end;
$$;

revoke all on function public.get_course_family_detail(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_course_family_detail(uuid, uuid, text) to authenticated;
