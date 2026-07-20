-- P4H-7：建班向导只按需检索课程版本；创建时在一个受控 RPC 内校验
-- 课程状态、运营学期、教师责任、排课以及立即启用条件。

create or replace function public.list_class_build_course_variants(
  p_query text default '',
  p_grade smallint default null,
  p_course_season smallint default null,
  p_class_type text default null,
  p_purpose text default 'production',
  p_limit integer default 30
)
returns table (
  course_id uuid,
  family_id uuid,
  family_title text,
  variant_title text,
  product_code text,
  grade smallint,
  course_season smallint,
  class_type text,
  lecture_count integer,
  released_lecture_count integer
)
language plpgsql security definer stable
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

  -- 空状态不预加载版本目录；用户输入关键词或使用任一快捷筛选后才查询。
  if normalized_query = '' and p_grade is null and p_course_season is null and normalized_class_type is null then
    return;
  end if;

  return query
  select
    course_row.id,
    family_row.id,
    family_row.title,
    course_row.title,
    course_row.product_code,
    course_row.grade,
    course_row.term,
    course_row.class_type,
    counts.lecture_count,
    counts.released_lecture_count
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  cross join lateral (
    select
      count(*) filter (where lecture_row.status = 'active')::integer as lecture_count,
      count(*) filter (where lecture_row.status = 'active' and lecture_row.current_release_id is not null)::integer as released_lecture_count
    from public.course_lectures lecture_row
    where lecture_row.course_id = course_row.id
  ) counts
  where family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose
    and (p_grade is null or course_row.grade = p_grade)
    and (p_course_season is null or course_row.term = p_course_season)
    and (normalized_class_type is null or course_row.class_type = normalized_class_type)
    and (
      normalized_query = ''
      or lower(family_row.title) like '%' || normalized_query || '%'
      or lower(course_row.title) like '%' || normalized_query || '%'
      or lower(coalesce(course_row.product_code, '')) like '%' || normalized_query || '%'
      or exists (
        select 1
        from public.course_lectures lecture_match
        where lecture_match.course_id = course_row.id
          and lecture_match.status = 'active'
          and lower(lecture_match.name) like '%' || normalized_query || '%'
      )
    )
  order by family_row.title, course_row.grade, course_row.term, course_row.class_type, course_row.title
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
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;

  select jsonb_build_object(
    'id', course_row.id,
    'familyId', family_row.id,
    'familyTitle', family_row.title,
    'title', course_row.title,
    'productCode', course_row.product_code,
    'grade', course_row.grade,
    'courseSeason', course_row.term,
    'classType', course_row.class_type,
    'lectureCount', counts.lecture_count,
    'releasedLectureCount', counts.released_lecture_count,
    'lectures', coalesce(lectures.rows, '[]'::jsonb)
  ) into result
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  cross join lateral (
    select
      count(*) filter (where lecture_row.status = 'active')::integer as lecture_count,
      count(*) filter (where lecture_row.status = 'active' and lecture_row.current_release_id is not null)::integer as released_lecture_count
    from public.course_lectures lecture_row
    where lecture_row.course_id = course_row.id
  ) counts
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', lecture_row.id,
      'no', lecture_row.no,
      'name', lecture_row.name,
      'objectives', lecture_row.objectives,
      'ready', lecture_row.current_release_id is not null
    ) order by lecture_row.no) as rows
    from public.course_lectures lecture_row
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

create or replace function public.get_class_build_conflicts(
  p_primary_teacher_id uuid,
  p_slots jsonb
)
returns table (
  session_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  duration_min smallint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_primary_teacher_id is null or jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_SCHEDULE';
  end if;

  return query
  with requested as (
    select requested_slot.scheduled_at, requested_slot.duration_min
    from jsonb_to_recordset(p_slots) as requested_slot(scheduled_at timestamptz, duration_min smallint)
    where requested_slot.scheduled_at is not null
      and requested_slot.duration_min between 1 and 600
  )
  select distinct
    session_row.id,
    classroom_row.name,
    session_row.title,
    session_row.scheduled_at,
    session_row.duration_min
  from requested
  join public.class_sessions session_row
    on session_row.deleted_at is null
   and session_row.scheduled_at is not null
   and session_row.duration_min is not null
   and session_row.scheduled_at < requested.scheduled_at + make_interval(mins => requested.duration_min)
   and requested.scheduled_at < session_row.scheduled_at + make_interval(mins => session_row.duration_min)
  join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
  where classroom_row.trashed_at is null
    and session_row.ended_at is null
    and (
      session_row.teacher_override = p_primary_teacher_id
      or classroom_row.owner_id = p_primary_teacher_id
      or exists (
        select 1
        from public.classroom_staff_assignments assignment_row
        where assignment_row.classroom_id = classroom_row.id
          and assignment_row.user_id = p_primary_teacher_id
          and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      )
    )
  order by session_row.scheduled_at
  limit 20;
end;
$$;

drop function if exists public.create_class(text, uuid, smallint, smallint, text, uuid);

create function public.create_class(
  p_name text,
  p_course_id uuid default null,
  p_capacity smallint default null,
  p_room text default '',
  p_primary_teacher_id uuid default null,
  p_learning_support_id uuid default null,
  p_term_id uuid default null,
  p_purpose text default 'production',
  p_sessions jsonb default '[]'::jsonb,
  p_activate boolean default false
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  code text;
  attempts integer := 0;
  course_row public.courses%rowtype;
  lecture_row public.course_lectures%rowtype;
  session_input record;
  active_lecture_count integer := 0;
  released_lecture_count integer := 0;
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if left(btrim(coalesce(p_name, '')), 100) = '' then raise exception 'INVALID_NAME'; end if;
  if char_length(btrim(p_name)) > 100 then raise exception 'INVALID_NAME'; end if;
  if p_capacity is not null and (p_capacity < 1 or p_capacity > 500) then raise exception 'INVALID_CAPACITY'; end if;
  if char_length(coalesce(p_room, '')) > 100 then raise exception 'INVALID_ROOM'; end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;
  if p_term_id is null or not exists (select 1 from public.school_terms where id = p_term_id) then
    raise exception 'INVALID_SCHOOL_TERM';
  end if;
  if p_primary_teacher_id is null or not exists (
    select 1 from public.profiles
    where id = p_primary_teacher_id and is_active and role in ('staff', 'admin')
  ) then raise exception 'INVALID_STAFF'; end if;
  if p_learning_support_id is not null and (
    p_learning_support_id = p_primary_teacher_id
    or not exists (
      select 1 from public.profiles
      where id = p_learning_support_id and is_active and role in ('staff', 'admin')
    )
  ) then raise exception 'INVALID_STAFF'; end if;
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 200 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  if p_course_id is not null then
    select course_candidate.* into course_row
    from public.courses course_candidate
    join public.course_families family_candidate on family_candidate.id = course_candidate.family_id
    where course_candidate.id = p_course_id
      and course_candidate.status = 'enabled'
      and course_candidate.trashed_at is null
      and course_candidate.purpose = p_purpose
      and family_candidate.status = 'enabled'
      and family_candidate.purpose = p_purpose;
    if not found then raise exception 'COURSE_NOT_AVAILABLE'; end if;

    select
      count(*) filter (where status = 'active'),
      count(*) filter (where status = 'active' and current_release_id is not null)
    into active_lecture_count, released_lecture_count
    from public.course_lectures
    where course_id = p_course_id;
  elsif jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) <> 0 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  if p_activate and p_purpose = 'production' and (
    p_course_id is null or active_lecture_count = 0 or active_lecture_count <> released_lecture_count
  ) then raise exception 'CLASSROOM_PREP_INCOMPLETE'; end if;

  loop
    code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8);
    begin
      insert into public.classrooms (
        owner_id, name, invite_code, course_id, grade, capacity, room,
        purpose, operational_status, term_id
      ) values (
        p_primary_teacher_id, btrim(p_name), code, p_course_id,
        case when p_course_id is null then null else course_row.grade end,
        p_capacity, coalesce(p_room, ''), p_purpose,
        case when p_activate then 'active' else 'planning' end, p_term_id
      ) returning id into cid;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts > 5 then raise; end if;
    end;
  end loop;

  insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
  values (cid, p_primary_teacher_id, 'primary_teacher', uid);
  insert into public.classroom_members (classroom_id, user_id, role)
  values (cid, p_primary_teacher_id, 'teacher')
  on conflict (classroom_id, user_id) do update set role = 'teacher';
  if p_learning_support_id is not null then
    insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
    values (cid, p_learning_support_id, 'learning_support', uid);
  end if;

  for session_input in
    select * from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as item(lecture_id uuid, scheduled_at timestamptz, duration_min smallint)
  loop
    if session_input.lecture_id is null or session_input.scheduled_at is null or session_input.duration_min not between 1 and 600 then
      raise exception 'INVALID_SCHEDULE';
    end if;
    select * into lecture_row
    from public.course_lectures
    where id = session_input.lecture_id
      and course_id = p_course_id
      and status = 'active';
    if not found then raise exception 'INVALID_SCHEDULE'; end if;

    insert into public.class_sessions (
      classroom_id, lecture_id, lecture_no, title, scheduled_at, duration_min, term_id,
      courseware, courseware_overlay
    ) values (
      cid, lecture_row.id, lecture_row.no, lecture_row.name,
      session_input.scheduled_at, session_input.duration_min, p_term_id,
      '[]'::jsonb, '[]'::jsonb
    );
  end loop;

  perform public.emit_domain_event(
    'classroom.created', 'classroom', cid,
    jsonb_build_object(
      'courseId', p_course_id,
      'purpose', p_purpose,
      'operationalStatus', case when p_activate then 'active' else 'planning' end,
      'sessionCount', jsonb_array_length(coalesce(p_sessions, '[]'::jsonb))
    ), p_primary_teacher_id, null
  );
  return cid;
end;
$$;

revoke all on function public.list_class_build_course_variants(text, smallint, smallint, text, text, integer) from public, anon, authenticated;
revoke all on function public.get_class_build_course_detail(uuid, text) from public, anon, authenticated;
revoke all on function public.get_class_build_conflicts(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_class(text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;

grant execute on function public.list_class_build_course_variants(text, smallint, smallint, text, text, integer) to authenticated;
grant execute on function public.get_class_build_course_detail(uuid, text) to authenticated;
grant execute on function public.get_class_build_conflicts(uuid, jsonb) to authenticated;
grant execute on function public.create_class(text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean) to authenticated;
