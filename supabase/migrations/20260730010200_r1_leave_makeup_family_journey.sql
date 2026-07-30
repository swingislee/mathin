-- R1-5 family portal: close the leave -> approval -> makeup journey.
-- Family projections share requests across guardians, surface the latest
-- makeup arrangement, and include cross-class makeup sessions in schedules.

begin;

create or replace function public.get_my_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, classroom_name text, lecture_name text, scheduled_at timestamptz,
  duration_min smallint, teacher_name text, student_name text, classroom_id uuid,
  student_id uuid
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  with latest_makeup as (
    select distinct on (change_row.session_id, change_row.student_id)
           change_row.session_id, change_row.student_id, change_row.to_session
      from public.session_changes change_row
     where change_row.kind = 'makeup'
       and change_row.to_session is not null
     order by change_row.session_id, change_row.student_id,
              change_row.created_at desc, change_row.id desc
  ), schedule_rows as (
    select session_row.id as session_id, classroom_row.name as classroom_name,
           session_row.title as lecture_name, session_row.scheduled_at,
           session_row.duration_min,
           coalesce((
             select profile_row.display_name
               from public.classroom_members member_row
               join public.profiles profile_row on profile_row.id = member_row.user_id
              where member_row.classroom_id = classroom_row.id and member_row.role = 'teacher'
              limit 1
           ), '') as teacher_name,
           student_row.name as student_name, classroom_row.id as classroom_id,
           student_row.id as student_id
      from public.class_sessions session_row
      join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
      join public.enrollments enrollment_row
        on enrollment_row.classroom_id = classroom_row.id and enrollment_row.status = 'active'
      join public.students student_row on student_row.id = enrollment_row.student_id
     where (
       student_row.user_id = auth.uid()
       or exists (
         select 1 from public.student_guardians guardian_row
          where guardian_row.student_id = student_row.id
            and guardian_row.guardian_id = auth.uid()
       )
     )
       and student_row.deleted_at is null
       and session_row.deleted_at is null
       and session_row.scheduled_at >= p_from
       and session_row.scheduled_at < p_to
    union
    select target_row.id, classroom_row.name, target_row.title,
           target_row.scheduled_at, target_row.duration_min,
           coalesce((
             select profile_row.display_name
               from public.classroom_members member_row
               join public.profiles profile_row on profile_row.id = member_row.user_id
              where member_row.classroom_id = classroom_row.id and member_row.role = 'teacher'
              limit 1
           ), ''),
           student_row.name, classroom_row.id, student_row.id
      from latest_makeup makeup_row
      join public.class_sessions target_row on target_row.id = makeup_row.to_session
      join public.classrooms classroom_row on classroom_row.id = target_row.classroom_id
      join public.students student_row on student_row.id = makeup_row.student_id
     where (
       student_row.user_id = auth.uid()
       or exists (
         select 1 from public.student_guardians guardian_row
          where guardian_row.student_id = student_row.id
            and guardian_row.guardian_id = auth.uid()
       )
     )
       and student_row.deleted_at is null
       and target_row.deleted_at is null
       and target_row.scheduled_at >= p_from
       and target_row.scheduled_at < p_to
  )
  select schedule_row.* from schedule_rows schedule_row
   order by schedule_row.scheduled_at;
$$;

revoke all on function public.get_my_schedule(timestamptz, timestamptz) from public;
grant execute on function public.get_my_schedule(timestamptz, timestamptz) to authenticated;

drop function if exists public.list_my_session_leave_requests();
create function public.list_my_session_leave_requests()
returns table(
  id uuid, session_id uuid, session_title text, student_id uuid, student_name text,
  reason text, status text, created_at timestamptz, decided_at timestamptz,
  makeup_session_id uuid, makeup_session_title text, makeup_classroom_name text,
  makeup_scheduled_at timestamptz, makeup_status text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return query
  select request_row.id, request_row.session_id, source_row.title,
         request_row.student_id, student_row.name, request_row.reason,
         request_row.status, request_row.created_at, request_row.decided_at,
         makeup_row.session_id, makeup_row.session_title,
         makeup_row.classroom_name, makeup_row.scheduled_at,
         case
           when request_row.status <> 'approved' then null
           when makeup_row.session_id is null then 'to_schedule'
           when makeup_row.deleted_at is not null then 'cancelled'
           when makeup_row.ended_at is not null then 'completed'
           else 'scheduled'
         end
    from public.session_leave_requests request_row
    join public.class_sessions source_row on source_row.id = request_row.session_id
    join public.students student_row on student_row.id = request_row.student_id
    left join lateral (
      select target_row.id as session_id, target_row.title as session_title,
             classroom_row.name as classroom_name, target_row.scheduled_at,
             target_row.ended_at, target_row.deleted_at
        from public.session_changes change_row
        join public.class_sessions target_row on target_row.id = change_row.to_session
        join public.classrooms classroom_row on classroom_row.id = target_row.classroom_id
       where change_row.session_id = request_row.session_id
         and change_row.student_id = request_row.student_id
         and change_row.kind = 'makeup'
       order by change_row.created_at desc, change_row.id desc
       limit 1
    ) makeup_row on true
   where public.family_of_student(request_row.student_id, uid)
   order by request_row.created_at desc
   limit 100;
end;
$$;

revoke all on function public.list_my_session_leave_requests() from public, anon, authenticated;
grant execute on function public.list_my_session_leave_requests() to authenticated;

create or replace function public.record_session_change(
  p_session_id uuid, p_student_id uuid, p_kind text,
  p_to_session uuid default null, p_reason text default ''
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  target_cid uuid;
  change_id uuid;
  completed_task_id uuid;
begin
  select classroom_id into cid from public.class_sessions
   where id = p_session_id and deleted_at is null;
  if uid is null or cid is null or not public.can_mark_attendance(cid, uid) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('leave','makeup') then raise exception 'INVALID_KIND'; end if;
  if not exists(
    select 1 from public.enrollments
     where classroom_id = cid and student_id = p_student_id and status = 'active'
  ) then raise exception 'STUDENT_NOT_ENROLLED'; end if;

  if p_kind = 'makeup' then
    select classroom_id into target_cid from public.class_sessions
     where id = p_to_session and id <> p_session_id
       and deleted_at is null and scheduled_at >= now();
    if target_cid is null or not (
      public.can_mark_attendance(target_cid, uid)
      or public.can_manage_classroom(target_cid, uid)
    ) then raise exception 'INVALID_TARGET_SESSION'; end if;
  else
    if p_to_session is not null then raise exception 'INVALID_TARGET_SESSION'; end if;
    insert into public.session_attendance(session_id, student_id, status, note)
    values(p_session_id, p_student_id, 'leave', left(trim(coalesce(p_reason, '')), 500))
    on conflict(session_id, student_id) do update set status = 'leave', note = excluded.note;
    select id into change_id from public.session_changes
     where session_id = p_session_id and student_id = p_student_id and kind = 'leave'
     order by created_at desc limit 1;
    if change_id is not null then return change_id; end if;
  end if;

  insert into public.session_changes(
    session_id, student_id, kind, from_session, to_session, reason, operated_by
  ) values (
    p_session_id, p_student_id, p_kind, p_session_id, p_to_session,
    left(trim(coalesce(p_reason, '')), 1000), uid
  ) returning id into change_id;

  if p_kind = 'makeup' then
    update public.class_support_tasks
       set status = 'done', completed_at = now(), completed_by = uid,
           note = case when btrim(note) = '' then 'Makeup session scheduled' else note end
     where session_id = p_session_id
       and student_id = p_student_id
       and kind = 'makeup_followup'
       and status = 'pending'
    returning id into completed_task_id;
    if completed_task_id is not null then
      perform public.emit_domain_event(
        'support_task.completed', 'class_support_task', completed_task_id,
        jsonb_build_object('kind', 'makeup_followup', 'status', 'done'), uid, null
      );
    end if;
  end if;

  perform public.emit_domain_event(
    'session_change.' || p_kind, 'session_change', change_id,
    jsonb_build_object('sessionId', p_session_id, 'studentId', p_student_id, 'toSession', p_to_session),
    null, null
  );
  return change_id;
end;
$$;

revoke all on function public.record_session_change(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_session_change(uuid, uuid, text, uuid, text) to authenticated;

-- Keep the earlier notification trigger owned by supabase_admin intact: it
-- notifies the requester. This additive trigger covers the student and other
-- currently linked guardians without duplicating the requester.
create or replace function public.notify_family_leave_decision()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare recipient uuid; student_name text;
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    select student_row.name into student_name from public.students student_row
     where student_row.id = new.student_id;
    for recipient in
      select student_row.user_id from public.students student_row
       where student_row.id = new.student_id
         and student_row.user_id is not null
         and student_row.user_id <> new.requested_by
      union
      select guardian_row.guardian_id from public.student_guardians guardian_row
       where guardian_row.student_id = new.student_id
         and guardian_row.guardian_id <> new.requested_by
    loop
      perform public.emit_domain_event(
        'leave_request.' || new.status, 'session_leave_request', new.id,
        jsonb_build_object('studentId', new.student_id, 'studentName', student_name, 'reason', new.reason),
        recipient, '/dashboard/children?child=' || new.student_id::text || '#leave'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists session_leave_requests_notify_family_decision on public.session_leave_requests;
create trigger session_leave_requests_notify_family_decision
after update of status on public.session_leave_requests
for each row execute function public.notify_family_leave_decision();

revoke all on function public.notify_family_leave_decision() from public, anon, authenticated;

create or replace function public.notify_family_makeup_schedule()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  recipient uuid;
  target_row record;
begin
  if new.kind <> 'makeup' or new.student_id is null or new.to_session is null then return new; end if;
  select session_row.title, session_row.scheduled_at, classroom_row.name as classroom_name
    into target_row
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
   where session_row.id = new.to_session;
  for recipient in
    select student_row.user_id from public.students student_row
     where student_row.id = new.student_id and student_row.user_id is not null
    union
    select guardian_row.guardian_id from public.student_guardians guardian_row
     where guardian_row.student_id = new.student_id
  loop
    perform public.emit_domain_event(
      'session_change.makeup', 'session_change', new.id,
      jsonb_build_object(
        'studentId', new.student_id, 'sessionId', new.to_session,
        'title', target_row.title, 'classroomName', target_row.classroom_name,
        'scheduledAt', target_row.scheduled_at
      ), recipient, '/dashboard/children?child=' || new.student_id::text || '#leave'
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists session_changes_notify_family_makeup on public.session_changes;
create trigger session_changes_notify_family_makeup
after insert on public.session_changes
for each row when (new.kind = 'makeup')
execute function public.notify_family_makeup_schedule();

revoke all on function public.notify_family_makeup_schedule() from public, anon, authenticated;

commit;
