-- R1: preserve a sparse 20-seat classroom plan instead of collapsing smaller
-- rosters into a contiguous card list.

begin;

create or replace function public.save_classroom_student_seat_layout(
  p_session_id uuid,
  p_student_ids uuid[],
  p_positions integer[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target_classroom_id uuid;
  submitted_count integer;
  distinct_student_count integer;
  distinct_position_count integer;
  active_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select session_row.classroom_id into target_classroom_id
    from public.class_sessions session_row
   where session_row.id = p_session_id
     and session_row.deleted_at is null;
  if target_classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;

  submitted_count := coalesce(cardinality(p_student_ids), -1);
  if submitted_count < 1
     or submitted_count > 60
     or submitted_count <> coalesce(cardinality(p_positions), -1)
     or array_position(p_student_ids, null) is not null
     or array_position(p_positions, null) is not null
     or exists (
       select 1
         from unnest(p_positions) submitted(position)
        where submitted.position < 0 or submitted.position > 59
     )
  then
    raise exception 'VALIDATION';
  end if;

  select count(distinct submitted.student_id)
    into distinct_student_count
    from unnest(p_student_ids) submitted(student_id);
  select count(distinct submitted.position)
    into distinct_position_count
    from unnest(p_positions) submitted(position);
  if submitted_count <> distinct_student_count
     or submitted_count <> distinct_position_count
  then
    raise exception 'VALIDATION';
  end if;

  perform 1 from public.classrooms where id = target_classroom_id for update;

  select count(*) into active_count
    from public.enrollments enrollment_row
   where enrollment_row.classroom_id = target_classroom_id
     and enrollment_row.status = 'active';

  if submitted_count <> active_count or exists (
    select 1
      from unnest(p_student_ids) submitted(student_id)
     where not exists (
       select 1
         from public.enrollments enrollment_row
        where enrollment_row.classroom_id = target_classroom_id
          and enrollment_row.student_id = submitted.student_id
          and enrollment_row.status = 'active'
     )
  ) then
    raise exception 'ROSTER_CHANGED';
  end if;

  delete from public.classroom_student_seat_order
   where classroom_id = target_classroom_id;

  insert into public.classroom_student_seat_order(
    classroom_id,
    student_id,
    position,
    updated_by
  )
  select target_classroom_id, submitted.student_id, submitted.position::smallint, uid
    from unnest(p_student_ids, p_positions) submitted(student_id, position);

  perform public.emit_domain_event(
    'classroom.student_seat_layout.updated',
    'classroom',
    target_classroom_id,
    jsonb_build_object(
      'sessionId', p_session_id,
      'studentCount', submitted_count,
      'seatCapacity', 20
    ),
    null,
    '/dashboard/sessions/' || p_session_id::text || '?stage=live'
  );
end;
$$;

revoke execute on function public.save_classroom_student_seat_order(uuid, uuid[])
  from authenticated;
revoke all on function public.save_classroom_student_seat_layout(uuid, uuid[], integer[])
  from public, anon, authenticated;
grant execute on function public.save_classroom_student_seat_layout(uuid, uuid[], integer[])
  to authenticated;

comment on function public.save_classroom_student_seat_layout(uuid, uuid[], integer[]) is
  'Atomically saves the complete active roster to explicit classroom seat positions, preserving empty seats.';

commit;
