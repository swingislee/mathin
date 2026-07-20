-- P4H-10：测试数据批量归档、CAS 零引用报告、受控永久清理。
-- testdata.purge 权限键（P4H-1 已注册）本迁移不授予任何角色——清理通道建完即默认
-- 对所有人关闭，需要管理员之后手动去 staff 角色页加这个权限键才能用。

-- ---------------------------------------------------------------------------
-- 批量归档测试班（可逆，仅 purpose='test'）
-- ---------------------------------------------------------------------------

create or replace function public.bulk_archive_test_classrooms(
  p_classroom_ids uuid[],
  p_archived boolean
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
  target_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_classroom_ids is null or array_length(p_classroom_ids, 1) is null then raise exception 'INVALID_SELECTION'; end if;
  if array_length(p_classroom_ids, 1) > 200 then raise exception 'INVALID_SELECTION'; end if;

  foreach target_id in array p_classroom_ids loop
    select * into classroom_row from public.classrooms where id = target_id for update;
    if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
    if classroom_row.purpose <> 'test' then raise exception 'PRODUCTION_DATA_PROTECTED'; end if;
    if not public.can_manage_classroom(target_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end loop;

  update public.classrooms
     set archived_at = case when p_archived then now() else null end
   where id = any(p_classroom_ids);

  foreach target_id in array p_classroom_ids loop
    perform public.emit_domain_event(
      case when p_archived then 'classroom.lifecycle.archived' else 'classroom.lifecycle.unarchived' end,
      'classroom', target_id, jsonb_build_object('archived', p_archived, 'batch', true), null, null
    );
  end loop;
end;
$$;

revoke all on function public.bulk_archive_test_classrooms(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.bulk_archive_test_classrooms(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- CAS 共享资源零引用报告（只读，不删除 Storage）
-- ---------------------------------------------------------------------------

create or replace function public.list_zero_reference_shared_assets()
returns table(
  id uuid,
  name text,
  kind text,
  byte_count bigint,
  mime text,
  storage_path text,
  created_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(uid, 'courseware.asset.manage') or public.has_perm(uid, 'testdata.purge')) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    asset_row.id,
    asset_row.name,
    asset_row.kind,
    object_row.byte_count,
    object_row.mime,
    object_row.storage_path,
    asset_row.created_at
  from public.cw_shared_assets asset_row
  join public.cw_asset_revisions revision_row
    on revision_row.id = coalesce(asset_row.published_revision_id, asset_row.draft_revision_id)
  join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
  where not exists (
    select 1 from public.cw_page_asset_bindings binding_row
    where binding_row.shared_asset_id = asset_row.id
  )
  order by asset_row.created_at asc
  limit 500;
end;
$$;

revoke all on function public.list_zero_reference_shared_assets() from public, anon, authenticated;
grant execute on function public.list_zero_reference_shared_assets() to authenticated;

-- ---------------------------------------------------------------------------
-- 可清理对象清单（admin-only，testdata.purge）
-- ---------------------------------------------------------------------------

create or replace function public.list_purgeable_course_families()
returns table(
  id uuid,
  title text,
  publisher text,
  variant_count integer,
  lecture_count integer,
  release_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  return query
  select
    family_row.id,
    family_row.title,
    family_row.publisher,
    (select count(*)::integer from public.courses c where c.family_id = family_row.id),
    (select count(*)::integer from public.course_lectures l join public.courses c on c.id = l.course_id where c.family_id = family_row.id),
    (select count(*)::integer from public.cw_lecture_releases r join public.course_lectures l on l.id = r.lecture_id join public.courses c on c.id = l.course_id where c.family_id = family_row.id)
  from public.course_families family_row
  where family_row.purpose = 'test'
    and not exists (
      select 1 from public.courses c where c.family_id = family_row.id and c.trashed_at is null
    )
  order by family_row.title;
end;
$$;

revoke all on function public.list_purgeable_course_families() from public, anon, authenticated;
grant execute on function public.list_purgeable_course_families() to authenticated;

create or replace function public.list_purgeable_classrooms()
returns table(
  id uuid,
  name text,
  enrollment_count integer,
  session_count integer,
  order_count integer,
  trashed_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  return query
  select
    classroom_row.id,
    classroom_row.name,
    (select count(*)::integer from public.enrollments e where e.classroom_id = classroom_row.id),
    (select count(*)::integer from public.class_sessions s where s.classroom_id = classroom_row.id),
    (select count(*)::integer from public.orders o where o.classroom_id = classroom_row.id),
    classroom_row.trashed_at
  from public.classrooms classroom_row
  where classroom_row.purpose = 'test' and classroom_row.trashed_at is not null
  order by classroom_row.name;
end;
$$;

revoke all on function public.list_purgeable_classrooms() from public, anon, authenticated;
grant execute on function public.list_purgeable_classrooms() to authenticated;

-- ---------------------------------------------------------------------------
-- 永久清理（唯一硬删除通道；testdata.purge 默认无人持有）
-- ---------------------------------------------------------------------------

create or replace function public.purge_test_course_family(
  p_family_id uuid,
  p_confirm_name text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_row public.course_families%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  select * into family_row from public.course_families where id = p_family_id for update;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  if family_row.purpose <> 'test' then raise exception 'PRODUCTION_DATA_PROTECTED'; end if;
  if exists (select 1 from public.courses c where c.family_id = p_family_id and c.trashed_at is null) then
    raise exception 'VARIANT_NOT_TRASHED';
  end if;
  if exists (select 1 from public.classrooms cl join public.courses c on c.id = cl.course_id where c.family_id = p_family_id) then
    raise exception 'COURSE_IN_USE';
  end if;
  if exists (
    select 1 from public.cw_replacement_items ri
      join public.courses c on c.id = ri.course_id
     where c.family_id = p_family_id
  ) then
    raise exception 'COURSE_HAS_REPLACEMENT_HISTORY';
  end if;
  if p_confirm_name is null or p_confirm_name <> family_row.title then raise exception 'NAME_MISMATCH'; end if;

  perform public.emit_domain_event(
    'course_family.lifecycle.purged', 'course_family', p_family_id,
    jsonb_build_object('title', family_row.title), null, null
  );

  delete from public.courses where family_id = p_family_id;
  delete from public.course_families where id = p_family_id;
end;
$$;

revoke all on function public.purge_test_course_family(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_test_course_family(uuid, text) to authenticated;

create or replace function public.purge_test_classroom(
  p_classroom_id uuid,
  p_confirm_name text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if classroom_row.purpose <> 'test' then raise exception 'PRODUCTION_DATA_PROTECTED'; end if;
  if classroom_row.trashed_at is null then raise exception 'CLASSROOM_NOT_TRASHED'; end if;
  if exists (select 1 from public.orders o where o.classroom_id = p_classroom_id) then
    raise exception 'CLASSROOM_HAS_HISTORY';
  end if;
  if p_confirm_name is null or p_confirm_name <> classroom_row.name then raise exception 'NAME_MISMATCH'; end if;

  perform public.emit_domain_event(
    'classroom.lifecycle.purged', 'classroom', p_classroom_id,
    jsonb_build_object('name', classroom_row.name), null, null
  );

  delete from public.classrooms where id = p_classroom_id;
end;
$$;

revoke all on function public.purge_test_classroom(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_test_classroom(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- list_classrooms_for_scope（P4H-8）追加 archived_at：批量归档面板需要知道
-- 每行当前是否已归档才能渲染「归档/取消归档」。RETURNS TABLE 列变更必须先 drop。
-- ---------------------------------------------------------------------------

drop function if exists public.list_classrooms_for_scope(text, jsonb, integer);

create function public.list_classrooms_for_scope(
  p_scope text default 'all',
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1
)
returns table(
  id uuid,
  name text,
  purpose text,
  operational_status text,
  archived_at timestamptz,
  course_family_title text,
  course_title text,
  course_product_code text,
  primary_teacher_name text,
  learning_support_names text[],
  enrolled_count integer,
  capacity smallint,
  session_done_count integer,
  session_total_count integer,
  next_session_at timestamptz,
  readiness text,
  anomaly_count integer,
  total_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_view_all boolean;
  can_manage boolean;
  is_teaching boolean;
  is_support boolean;
  v_scope text := lower(trim(coalesce(p_scope, 'all')));
  v_query text := left(trim(coalesce(p_filters ->> 'q', '')), 80);
  v_search text;
  v_teacher_id uuid;
  v_support_id uuid;
  v_grade smallint;
  v_term_id uuid;
  v_operational_status text := nullif(lower(trim(coalesce(p_filters ->> 'operationalStatus', ''))), '');
  v_purpose text := nullif(lower(trim(coalesce(p_filters ->> 'purpose', ''))), '');
  v_readiness text := nullif(lower(trim(coalesce(p_filters ->> 'readiness', ''))), '');
  v_page integer := greatest(1, least(coalesce(p_page, 1), 100000));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_scope not in ('teaching', 'support', 'all', 'test') then raise exception 'INVALID_SCOPE'; end if;

  can_view_all := public.has_perm(uid, 'class.view.all');
  can_manage := public.has_perm(uid, 'class.manage');
  is_teaching := public.has_perm(uid, 'class.view.mine') or exists (
    select 1 from public.classroom_staff_assignments
     where user_id = uid and responsibility in ('primary_teacher', 'assistant_teacher')
  );
  is_support := exists (
    select 1 from public.classroom_staff_assignments
     where user_id = uid and responsibility = 'learning_support'
  );
  if not (can_view_all or is_teaching or is_support) then raise exception 'FORBIDDEN'; end if;
  if v_scope = 'all' and not can_view_all then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_scope = 'test' and not can_manage then raise exception 'FORBIDDEN_SCOPE'; end if;

  if coalesce(p_filters ->> 'teacherId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_teacher_id := (p_filters ->> 'teacherId')::uuid;
  end if;
  if coalesce(p_filters ->> 'supportId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_support_id := (p_filters ->> 'supportId')::uuid;
  end if;
  if coalesce(p_filters ->> 'schoolTermId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_term_id := (p_filters ->> 'schoolTermId')::uuid;
  end if;
  if coalesce(p_filters ->> 'grade', '') ~ '^[1-9][0-9]?$' then v_grade := (p_filters ->> 'grade')::smallint; end if;
  if v_operational_status not in ('planning', 'active', 'completed') then v_operational_status := null; end if;
  if v_purpose not in ('production', 'test') then v_purpose := null; end if;
  if v_readiness not in ('ready', 'incomplete') then v_readiness := null; end if;
  v_search := replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  return query
  with candidates as (
    select
      classroom_row.id,
      classroom_row.name,
      classroom_row.purpose,
      classroom_row.operational_status,
      classroom_row.archived_at,
      family_row.title as course_family_title,
      course_row.title as course_title,
      course_row.product_code as course_product_code
    from public.classrooms classroom_row
    left join public.courses course_row on course_row.id = classroom_row.course_id
    left join public.course_families family_row on family_row.id = course_row.family_id
    where classroom_row.trashed_at is null
      and (v_scope <> 'test' or classroom_row.purpose = 'test')
      and (v_scope <> 'teaching' or exists (
        select 1 from public.classroom_staff_assignments assignment_row
         where assignment_row.classroom_id = classroom_row.id
           and assignment_row.user_id = uid
           and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      ))
      and (v_scope <> 'support' or exists (
        select 1 from public.classroom_staff_assignments assignment_row
         where assignment_row.classroom_id = classroom_row.id
           and assignment_row.user_id = uid
           and assignment_row.responsibility = 'learning_support'
      ))
      and (v_teacher_id is null or exists (
        select 1 from public.classroom_staff_assignments assignment_row
         where assignment_row.classroom_id = classroom_row.id
           and assignment_row.user_id = v_teacher_id
           and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      ))
      and (v_support_id is null or exists (
        select 1 from public.classroom_staff_assignments assignment_row
         where assignment_row.classroom_id = classroom_row.id
           and assignment_row.user_id = v_support_id
           and assignment_row.responsibility = 'learning_support'
      ))
      and (v_grade is null or classroom_row.grade = v_grade)
      and (v_term_id is null or classroom_row.term_id = v_term_id)
      and (v_operational_status is null or classroom_row.operational_status = v_operational_status)
      and (v_purpose is null or classroom_row.purpose = v_purpose)
      and (
        v_query = ''
        or classroom_row.name ilike '%' || v_search || '%' escape E'\\'
        or coalesce(family_row.title, '') ilike '%' || v_search || '%' escape E'\\'
        or coalesce(course_row.title, '') ilike '%' || v_search || '%' escape E'\\'
        or coalesce(course_row.product_code, '') ilike '%' || v_search || '%' escape E'\\'
        or exists (
          select 1 from public.course_lectures lecture_row
          where lecture_row.course_id = classroom_row.course_id
            and lecture_row.name ilike '%' || v_search || '%' escape E'\\'
        )
      )
  ), enriched as (
    select
      candidate_row.*,
      staff.primary_teacher_name,
      staff.learning_support_names,
      enrollment_stats.enrolled_count,
      classroom_row.capacity,
      session_stats.session_total_count,
      session_stats.session_done_count,
      session_stats.next_session_at,
      session_stats.anomaly_count,
      case
        when candidate_row.purpose = 'test' then 'ready'
        when session_stats.incomplete_session_count > 0 then 'incomplete'
        else 'ready'
      end as readiness
    from candidates candidate_row
    join public.classrooms classroom_row on classroom_row.id = candidate_row.id
    cross join lateral (
      select
        (array_agg(profile_row.display_name) filter (where assignment_row.responsibility = 'primary_teacher'))[1] as primary_teacher_name,
        coalesce(array_agg(profile_row.display_name) filter (where assignment_row.responsibility = 'learning_support'), array[]::text[]) as learning_support_names
      from public.classroom_staff_assignments assignment_row
      join public.profiles profile_row on profile_row.id = assignment_row.user_id
      where assignment_row.classroom_id = candidate_row.id
    ) staff
    cross join lateral (
      select count(*)::integer as enrolled_count
      from public.enrollments enrollment_row
      where enrollment_row.classroom_id = candidate_row.id and enrollment_row.status = 'active'
    ) enrollment_stats
    cross join lateral (
      select
        count(*) filter (where session_row.deleted_at is null)::integer as session_total_count,
        count(*) filter (where session_row.deleted_at is null and session_row.ended_at is not null)::integer as session_done_count,
        min(session_row.scheduled_at) filter (
          where session_row.deleted_at is null and session_row.ended_at is null and session_row.scheduled_at >= now()
        ) as next_session_at,
        count(*) filter (
          where session_row.deleted_at is null and session_row.started_at is null and session_row.scheduled_at < now()
        )::integer as anomaly_count,
        count(*) filter (
          where session_row.deleted_at is null
            and (session_row.lecture_id is null or lecture_row.status <> 'active' or lecture_row.current_release_id is null)
        )::integer as incomplete_session_count
      from public.class_sessions session_row
      left join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id
      where session_row.classroom_id = candidate_row.id
    ) session_stats
    where v_readiness is null or (
      case
        when candidate_row.purpose = 'test' then 'ready'
        when session_stats.incomplete_session_count > 0 then 'incomplete'
        else 'ready'
      end = v_readiness
    )
  )
  select
    enriched_row.id,
    enriched_row.name,
    enriched_row.purpose,
    enriched_row.operational_status,
    enriched_row.archived_at,
    enriched_row.course_family_title,
    enriched_row.course_title,
    enriched_row.course_product_code,
    enriched_row.primary_teacher_name,
    enriched_row.learning_support_names,
    enriched_row.enrolled_count,
    enriched_row.capacity,
    enriched_row.session_done_count,
    enriched_row.session_total_count,
    enriched_row.next_session_at,
    enriched_row.readiness,
    enriched_row.anomaly_count,
    count(*) over()::integer
  from enriched enriched_row
  order by
    (enriched_row.anomaly_count > 0) desc,
    enriched_row.next_session_at asc nulls last,
    enriched_row.name
  limit 20 offset ((v_page - 1) * 20);
end;
$$;

revoke all on function public.list_classrooms_for_scope(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.list_classrooms_for_scope(text, jsonb, integer) to authenticated;
