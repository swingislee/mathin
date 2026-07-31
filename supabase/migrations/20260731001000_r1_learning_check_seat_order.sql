-- R1: teachers arrange the active class roster once and reuse that seat order
-- in every session learning-check panel for the classroom.

begin;

create table public.classroom_student_seat_order (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  position smallint not null check (position between 0 and 59),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (classroom_id, student_id),
  unique (classroom_id, position)
);

create trigger classroom_student_seat_order_set_updated_at
before update on public.classroom_student_seat_order
for each row execute function public.set_updated_at();

alter table public.classroom_student_seat_order enable row level security;

create policy classroom_student_seat_order_select_teacher
on public.classroom_student_seat_order
for select to authenticated
using (
  exists (
    select 1
      from public.class_sessions session_row
     where session_row.classroom_id = classroom_student_seat_order.classroom_id
       and session_row.deleted_at is null
       and public.is_session_teacher(session_row.id, (select auth.uid()))
  )
);

revoke all on public.classroom_student_seat_order from anon, authenticated;
grant select on public.classroom_student_seat_order to authenticated;

create or replace function public.save_classroom_student_seat_order(
  p_session_id uuid,
  p_student_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target_classroom_id uuid;
  submitted_count integer;
  distinct_count integer;
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
  if submitted_count < 1 or submitted_count > 60 or array_position(p_student_ids, null) is not null then
    raise exception 'VALIDATION';
  end if;

  select count(*), count(distinct submitted.student_id)
    into submitted_count, distinct_count
    from unnest(p_student_ids) submitted(student_id);
  if submitted_count <> distinct_count then raise exception 'VALIDATION'; end if;

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
  select target_classroom_id, submitted.student_id, submitted.ordinality - 1, uid
    from unnest(p_student_ids) with ordinality submitted(student_id, ordinality);

  perform public.emit_domain_event(
    'classroom.student_seat_order.updated',
    'classroom',
    target_classroom_id,
    jsonb_build_object(
      'sessionId', p_session_id,
      'studentCount', submitted_count
    ),
    null,
    '/dashboard/sessions/' || p_session_id::text || '?stage=live'
  );
end;
$$;

revoke all on function public.save_classroom_student_seat_order(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.save_classroom_student_seat_order(uuid, uuid[])
  to authenticated;

comment on table public.classroom_student_seat_order is
  'Teacher-defined class roster order reused across sessions to match physical seating.';
comment on function public.save_classroom_student_seat_order(uuid, uuid[]) is
  'Atomically replaces the active classroom roster order after validating the complete current roster.';

commit;
