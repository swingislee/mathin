-- 2026-08-28: class offering classification and one-off activity boundary.
--
-- `purpose` remains the data-governance axis (`production` / `test`).
-- `offering_type` records how a real class is organized:
--   * long_term_formal: a regular class that runs over a longer period;
--   * short_term_topic: a fixed-roster topic class delivered over a short series.
-- One-off trials and public classes remain activities with one scheduled time.

alter table public.classrooms
  add column if not exists offering_type text not null default 'long_term_formal';

alter table public.classrooms
  drop constraint if exists classrooms_offering_type_check;
alter table public.classrooms
  add constraint classrooms_offering_type_check
  check (offering_type in ('long_term_formal', 'short_term_topic'));

comment on column public.classrooms.offering_type is
  'Business offering classification, independent from production/test data purpose.';

grant select (offering_type) on public.classrooms to authenticated;

-- Recreate the two class builders with an optional offering type. Keeping the
-- default preserves every older named/positional caller while new clients can
-- persist the explicit business classification atomically with class creation.
drop function if exists public.create_free_class_with_sessions(
  text, smallint, text, uuid, uuid, uuid, text, jsonb, boolean
);
drop function if exists public.create_class(
  text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean
);

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
  p_activate boolean default false,
  p_offering_type text default 'long_term_formal'
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
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if left(btrim(coalesce(p_name, '')), 100) = '' then raise exception 'INVALID_NAME'; end if;
  if char_length(btrim(p_name)) > 100 then raise exception 'INVALID_NAME'; end if;
  if p_capacity is not null and (p_capacity < 1 or p_capacity > 500) then raise exception 'INVALID_CAPACITY'; end if;
  if char_length(coalesce(p_room, '')) > 100 then raise exception 'INVALID_ROOM'; end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;
  if p_offering_type not in ('long_term_formal', 'short_term_topic') then
    raise exception 'INVALID_OFFERING_TYPE';
  end if;
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
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 200 then
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
  elsif jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) <> 0 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  loop
    code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8);
    begin
      insert into public.classrooms (
        owner_id, name, invite_code, course_id, grade, capacity, room,
        purpose, offering_type, operational_status, term_id
      ) values (
        p_primary_teacher_id, btrim(p_name), code, p_course_id,
        case when p_course_id is null then null else course_row.grade end,
        p_capacity, coalesce(p_room, ''), p_purpose, p_offering_type,
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
    if session_input.lecture_id is null or session_input.scheduled_at is null
       or session_input.duration_min not between 1 and 600 then
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
      'offeringType', p_offering_type,
      'operationalStatus', case when p_activate then 'active' else 'planning' end,
      'sessionCount', jsonb_array_length(coalesce(p_sessions, '[]'::jsonb))
    ), p_primary_teacher_id, null
  );
  return cid;
end;
$$;

create function public.create_free_class_with_sessions(
  p_name text,
  p_capacity smallint default null,
  p_room text default '',
  p_primary_teacher_id uuid default null,
  p_learning_support_id uuid default null,
  p_term_id uuid default null,
  p_purpose text default 'production',
  p_sessions jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_offering_type text default 'long_term_formal'
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid;
  sid uuid;
  session_input record;
begin
  if p_offering_type not in ('long_term_formal', 'short_term_topic') then
    raise exception 'INVALID_OFFERING_TYPE';
  end if;
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 200 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  for session_input in
    select * from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as item(lecture_id uuid, title text, scheduled_at timestamptz, duration_min smallint)
  loop
    if session_input.lecture_id is not null
       or nullif(btrim(coalesce(session_input.title, '')), '') is null
       or char_length(btrim(session_input.title)) > 100
       or session_input.scheduled_at is null
       or session_input.duration_min is null
       or session_input.duration_min not between 1 and 600 then
      raise exception 'INVALID_SCHEDULE';
    end if;
  end loop;

  cid := public.create_class(
    p_name => p_name,
    p_course_id => null,
    p_capacity => p_capacity,
    p_room => p_room,
    p_primary_teacher_id => p_primary_teacher_id,
    p_learning_support_id => p_learning_support_id,
    p_term_id => p_term_id,
    p_purpose => p_purpose,
    p_sessions => '[]'::jsonb,
    p_activate => p_activate,
    p_offering_type => p_offering_type
  );

  for session_input in
    select * from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as item(lecture_id uuid, title text, scheduled_at timestamptz, duration_min smallint)
  loop
    insert into public.class_sessions (
      classroom_id, title, scheduled_at, duration_min, term_id, courseware, courseware_overlay
    ) values (
      cid, btrim(session_input.title), session_input.scheduled_at,
      session_input.duration_min, p_term_id, '[]'::jsonb, '[]'::jsonb
    ) returning id into sid;

    perform public.emit_domain_event(
      'session.schedule.created', 'class_session', sid,
      jsonb_build_object('classroomId', cid, 'source', 'class_creation'), null, null
    );
  end loop;

  return cid;
end;
$$;

revoke all on function public.create_class(
  text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean, text
) from public, anon, authenticated;
revoke all on function public.create_free_class_with_sessions(
  text, smallint, text, uuid, uuid, uuid, text, jsonb, boolean, text
) from public, anon, authenticated;
grant execute on function public.create_class(
  text, uuid, smallint, text, uuid, uuid, uuid, text, jsonb, boolean, text
) to authenticated;
grant execute on function public.create_free_class_with_sessions(
  text, smallint, text, uuid, uuid, uuid, text, jsonb, boolean, text
) to authenticated;

-- Make public classes an explicit one-off activity type. A multi-session public
-- series with a fixed roster should use a short-term topic class instead.
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in (
    'trial_class', 'public_class', 'assessment_1v1', 'sanbanfu', 'lecture', 'competition'
  ));

create or replace function public.create_activity(
  p_kind text,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint default null,
  p_location text default '',
  p_capacity smallint default null,
  p_remark text default ''
)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); aid uuid;
begin
  if uid is null or not public.has_perm(uid,'activity.manage') then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('trial_class','public_class','assessment_1v1','sanbanfu','lecture','competition') then
    raise exception 'INVALID_KIND';
  end if;
  if trim(coalesce(p_title,''))='' then raise exception 'EMPTY_TITLE'; end if;
  insert into public.activities(kind,title,scheduled_at,duration_min,location,capacity,remark,created_by)
  values(
    p_kind,left(trim(p_title),100),p_scheduled_at,p_duration_min,
    left(trim(coalesce(p_location,'')),100),p_capacity,left(trim(coalesce(p_remark,'')),1000),uid
  ) returning id into aid;
  return aid;
end $$;

create or replace function public.update_activity(
  p_activity_id uuid,
  p_kind text,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint default null,
  p_location text default '',
  p_capacity smallint default null,
  p_remark text default ''
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'activity.manage') then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('trial_class','public_class','assessment_1v1','sanbanfu','lecture','competition')
     or trim(coalesce(p_title,''))='' then
    raise exception 'INVALID_INPUT';
  end if;
  update public.activities
  set kind=p_kind,
      title=left(trim(p_title),100),
      scheduled_at=p_scheduled_at,
      duration_min=p_duration_min,
      location=left(trim(coalesce(p_location,'')),100),
      capacity=p_capacity,
      remark=left(trim(coalesce(p_remark,'')),1000)
  where id=p_activity_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

revoke all on function public.create_activity(text,text,timestamptz,smallint,text,smallint,text)
  from public,anon,authenticated;
revoke all on function public.update_activity(uuid,text,text,timestamptz,smallint,text,smallint,text)
  from public,anon,authenticated;
grant execute on function public.create_activity(text,text,timestamptz,smallint,text,smallint,text)
  to authenticated;
grant execute on function public.update_activity(uuid,text,text,timestamptz,smallint,text,smallint,text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
