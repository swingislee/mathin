-- Classroom development fixture isolation.
--
-- The original list function leaked test-purpose and archived classrooms into
-- the ordinary all/teaching/support scopes. It also drifted between fresh
-- rebuilds (no archived_at return column) and long-lived development databases
-- (archived_at present). Recreate the function so both schemas converge:
--   * ordinary scopes default to active production-purpose classrooms;
--   * an explicit purpose=test filter may inspect active test classrooms;
--   * test scope remains the dedicated active + archived test-data workspace;
--   * trashed classrooms stay outside every ordinary list.

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
      and (
        (v_scope = 'test' and classroom_row.purpose = 'test')
        or (
          v_scope <> 'test'
          and classroom_row.archived_at is null
          and classroom_row.purpose = coalesce(v_purpose, 'production')
        )
      )
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

select pg_notify('pgrst', 'reload schema');
