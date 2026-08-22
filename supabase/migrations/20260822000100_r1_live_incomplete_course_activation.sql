-- R1-Live: courseware readiness is an operational warning, not a class activation gate.
-- A production class still needs an enabled course with active lectures, and every
-- scheduled session must keep a structurally valid active lecture reference. Missing
-- lecture releases remain visible in readiness surfaces and must be completed before
-- the affected session is taught.

create or replace function public.create_class(
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

    select count(*) filter (where status = 'active')
    into active_lecture_count
    from public.course_lectures
    where course_id = p_course_id;
  elsif jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) <> 0 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  -- Production free classes and courses without active lectures still start in planning.
  -- A missing current_release_id no longer blocks activation.
  if p_activate and p_purpose = 'production' and (
    p_course_id is null or active_lecture_count = 0
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

create or replace function public.transition_classroom_status(
  p_classroom_id uuid,
  p_target text
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
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target not in ('planning', 'active', 'completed') then raise exception 'INVALID_TRANSITION'; end if;

  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is not null then raise exception 'INVALID_TRANSITION'; end if;
  if classroom_row.operational_status = p_target then return; end if;
  if not (
    (classroom_row.operational_status = 'planning' and p_target in ('active', 'completed'))
    or (classroom_row.operational_status = 'active' and p_target = 'completed')
  ) then
    raise exception 'INVALID_TRANSITION';
  end if;

  if p_target = 'active' and classroom_row.purpose = 'production' and (
    classroom_row.course_id is null
    or not exists (
      select 1 from public.courses course_row
       where course_row.id = classroom_row.course_id
         and course_row.status = 'enabled'
         and course_row.trashed_at is null
    )
    or exists (
      select 1
        from public.class_sessions session_row
        left join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id
       where session_row.classroom_id = p_classroom_id
         and session_row.deleted_at is null
         and (
           session_row.lecture_id is null
           or lecture_row.status <> 'active'
         )
    )
  ) then
    raise exception 'CLASSROOM_PREP_INCOMPLETE';
  end if;

  update public.classrooms set operational_status = p_target where id = p_classroom_id;
  perform public.emit_domain_event(
    'classroom.lifecycle.transition', 'classroom', p_classroom_id,
    jsonb_build_object('from', classroom_row.operational_status, 'to', p_target), null, null
  );
end;
$$;

revoke all on function public.create_class(text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.transition_classroom_status(uuid, text) from public, anon, authenticated;
grant execute on function public.create_class(text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.transition_classroom_status(uuid, text) to authenticated;
