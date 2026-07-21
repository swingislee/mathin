-- P4I-10：课程产品工作区。
-- 1) get_course_family_detail 不再在未指定版本时自动选版本（doc19 §8.2）；
--    variants[] 追加矩阵单元格聚合（讲次数/发布数/使用班级数/风险角标）；
--    追加 family/variant 两级责任（course_staff_assignments）与 variant 使用情况（classrooms）。
-- 2) create_course_variant：在已有 family 下真实建版本（跳过 legacy 触发器）。
-- 3) 责任写入 RPC：assign_course_owner / add_course_collaborator / remove_course_assignment
--    ——course_staff_assignments 建于 P4I-2，此前只有 RLS，没有任何 RPC 或调用方。

drop function if exists public.get_course_family_detail(uuid, uuid, text);

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
    'selectedVariant', case when has_selected_variant then jsonb_build_object(
      'id', selected_variant.id,
      'title', selected_variant.title,
      'productCode', selected_variant.product_code,
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

revoke all on function public.get_course_family_detail(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_course_family_detail(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_course_variant：在已有 family 下真实建版本。
-- 显式传入 family_id，跳过 P4H 遗留的 assign_legacy_course_family 触发器
-- （该触发器只在 family_id 为 null 时才会新建一次性 legacy family）。
-- ---------------------------------------------------------------------------

create or replace function public.create_course_variant(
  p_family_id uuid,
  p_title text,
  p_product_code text,
  p_grade smallint,
  p_course_season smallint,
  p_class_type text,
  p_status text default 'draft'
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_row public.course_families%rowtype;
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

  begin
    insert into public.courses (family_id, title, product_code, grade, term, class_type, status, purpose, created_by)
    values (
      p_family_id,
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

revoke all on function public.create_course_variant(uuid, text, text, smallint, smallint, text, text) from public, anon, authenticated;
grant execute on function public.create_course_variant(uuid, text, text, smallint, smallint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 责任写入：course_staff_assignments 建于 P4I-2，此前只有 RLS insert/update
-- 策略、没有任何 RPC 或调用方（P4I-10 是第一个真实消费者）。
-- ---------------------------------------------------------------------------

create or replace function public.assign_course_owner(
  p_scope_type text,
  p_scope_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  assignment_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.assignment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_scope_type not in ('family', 'variant') then raise exception 'INVALID_SCOPE'; end if;
  if p_scope_type = 'family' and not exists (select 1 from public.course_families where id = p_scope_id) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;
  if p_scope_type = 'variant' and not exists (select 1 from public.courses where id = p_scope_id) then
    raise exception 'COURSE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'INVALID_STAFF'; end if;

  update public.course_staff_assignments
  set archived_at = now()
  where responsibility = 'owner'
    and archived_at is null
    and scope_type = p_scope_type
    and (
      (p_scope_type = 'family' and family_id = p_scope_id)
      or (p_scope_type = 'variant' and course_id = p_scope_id)
    );

  insert into public.course_staff_assignments (user_id, scope_type, family_id, course_id, responsibility, created_by)
  values (
    p_user_id,
    p_scope_type,
    case when p_scope_type = 'family' then p_scope_id else null end,
    case when p_scope_type = 'variant' then p_scope_id else null end,
    'owner',
    uid
  )
  returning id into assignment_id;

  return assignment_id;
end;
$$;

revoke all on function public.assign_course_owner(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_course_owner(text, uuid, uuid) to authenticated;

create or replace function public.add_course_collaborator(
  p_scope_type text,
  p_scope_id uuid,
  p_user_id uuid,
  p_responsibility text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  assignment_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.assignment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_scope_type not in ('family', 'variant') then raise exception 'INVALID_SCOPE'; end if;
  if p_responsibility not in ('editor', 'reviewer') then raise exception 'INVALID_RESPONSIBILITY'; end if;
  if p_scope_type = 'family' and not exists (select 1 from public.course_families where id = p_scope_id) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;
  if p_scope_type = 'variant' and not exists (select 1 from public.courses where id = p_scope_id) then
    raise exception 'COURSE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'INVALID_STAFF'; end if;

  begin
    insert into public.course_staff_assignments (user_id, scope_type, family_id, course_id, responsibility, created_by)
    values (
      p_user_id,
      p_scope_type,
      case when p_scope_type = 'family' then p_scope_id else null end,
      case when p_scope_type = 'variant' then p_scope_id else null end,
      p_responsibility,
      uid
    )
    returning id into assignment_id;
  exception when unique_violation then
    raise exception 'ASSIGNMENT_ALREADY_EXISTS';
  end;

  return assignment_id;
end;
$$;

revoke all on function public.add_course_collaborator(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_course_collaborator(text, uuid, uuid, text) to authenticated;

create or replace function public.remove_course_assignment(p_assignment_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  updated_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.assignment.manage') then raise exception 'FORBIDDEN'; end if;

  update public.course_staff_assignments
  set archived_at = now()
  where id = p_assignment_id and archived_at is null;
  get diagnostics updated_count = row_count;
  if updated_count = 0 then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.remove_course_assignment(uuid) from public, anon, authenticated;
grant execute on function public.remove_course_assignment(uuid) to authenticated;
