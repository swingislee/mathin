-- R1-Live P0: free classes can receive sessions during and after creation;
-- assigned teachers can edit the title/time/duration of their own unstarted sessions.

create or replace function public.create_free_class_with_sessions(
  p_name text,
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
  cid uuid;
  sid uuid;
  session_input record;
begin
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 200 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  -- Validate the whole schedule before creating the class so the operation stays atomic.
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
    p_activate => p_activate
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

create or replace function public.create_managed_class_session(
  p_classroom_id uuid,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
  sid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null
     or char_length(btrim(p_title)) > 100
     or p_scheduled_at is null
     or p_duration_min is null
     or p_duration_min not between 1 and 600 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  select * into classroom_row
  from public.classrooms
  where id = p_classroom_id
  for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not (
    public.is_admin(uid)
    or public.can_manage_classroom(p_classroom_id, uid)
    or public.is_classroom_teacher(p_classroom_id, uid)
  ) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is not null or classroom_row.operational_status = 'completed' then
    raise exception 'CLASSROOM_NOT_ACTIVE';
  end if;
  if classroom_row.course_id is not null then raise exception 'CLASSROOM_REQUIRES_LECTURE'; end if;

  insert into public.class_sessions (
    classroom_id, title, scheduled_at, duration_min, term_id, courseware, courseware_overlay
  ) values (
    p_classroom_id, btrim(p_title), p_scheduled_at, p_duration_min,
    classroom_row.term_id, '[]'::jsonb, '[]'::jsonb
  ) returning id into sid;

  perform public.emit_domain_event(
    'session.schedule.created', 'class_session', sid,
    jsonb_build_object('classroomId', p_classroom_id, 'source', 'class_workspace'), null, null
  );
  return sid;
end;
$$;

create or replace function public.update_managed_class_session(
  p_session_id uuid,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null
     or char_length(btrim(p_title)) > 100
     or p_scheduled_at is null
     or p_duration_min is null
     or p_duration_min not between 1 and 600 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  select * into session_row
  from public.class_sessions
  where id = p_session_id
  for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select * into classroom_row
  from public.classrooms
  where id = session_row.classroom_id;
  if not (
    public.is_admin(uid)
    or public.can_manage_classroom(session_row.classroom_id, uid)
    or public.is_classroom_teacher(session_row.classroom_id, uid)
  ) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is not null or classroom_row.operational_status = 'completed' then
    raise exception 'CLASSROOM_NOT_ACTIVE';
  end if;
  if session_row.started_at is not null
     or session_row.ended_at is not null
     or session_row.courseware_frozen_at is not null then
    raise exception 'SESSION_ALREADY_STARTED';
  end if;
  if session_row.deleted_at is not null
     or session_row.cancelled_by is not null
     or session_row.voided_at is not null then
    raise exception 'SESSION_NOT_EDITABLE';
  end if;

  update public.class_sessions
  set title = btrim(p_title),
      scheduled_at = p_scheduled_at,
      duration_min = p_duration_min
  where id = p_session_id;

  perform public.emit_domain_event(
    'session.schedule.updated', 'class_session', p_session_id,
    jsonb_build_object(
      'classroomId', session_row.classroom_id,
      'before', jsonb_build_object(
        'title', session_row.title,
        'scheduledAt', session_row.scheduled_at,
        'durationMin', session_row.duration_min
      ),
      'after', jsonb_build_object(
        'title', btrim(p_title),
        'scheduledAt', p_scheduled_at,
        'durationMin', p_duration_min
      )
    ), null, null
  );
end;
$$;

revoke all on function public.create_free_class_with_sessions(text,smallint,text,uuid,uuid,uuid,text,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.create_managed_class_session(uuid,text,timestamptz,smallint) from public,anon,authenticated;
revoke all on function public.update_managed_class_session(uuid,text,timestamptz,smallint) from public,anon,authenticated;

grant execute on function public.create_free_class_with_sessions(text,smallint,text,uuid,uuid,uuid,text,jsonb,boolean) to authenticated;
grant execute on function public.create_managed_class_session(uuid,text,timestamptz,smallint) to authenticated;
grant execute on function public.update_managed_class_session(uuid,text,timestamptz,smallint) to authenticated;
