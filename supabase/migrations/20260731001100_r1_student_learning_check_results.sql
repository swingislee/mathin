-- R1-5: expose each student's own per-question learning checks after the
-- session ends. Live markings stay private to teachers; guardians continue to
-- consume the separately published family result projection.

begin;

create or replace function public.is_student_account(
  p_student_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists(
    select 1
      from public.students student_row
     where student_row.id = p_student_id
       and student_row.user_id = p_user_id
       and student_row.deleted_at is null
  )
$$;

revoke all on function public.is_student_account(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_student_account(uuid, uuid)
  to authenticated;

-- The original self-read branch joined public.students inside a policy even
-- though the students table deliberately has no student-self SELECT policy.
-- That nested RLS reduced every student lookup to false. Avoid that dependency
-- and delay self visibility until the authoritative session end timestamp.
drop policy if exists session_learning_results_select_scope
  on public.session_learning_check_results;
create policy session_learning_results_select_scope
on public.session_learning_check_results
for select to authenticated
using (
  exists(
    select 1
      from public.session_learning_checks check_row
      join public.class_sessions session_row
        on session_row.id = check_row.session_id
     where check_row.id = session_learning_check_results.check_id
       and (
         public.is_session_teacher(session_row.id, (select auth.uid()))
         or (
           session_row.ended_at is not null
           and public.is_student_account(
             session_learning_check_results.student_id,
             (select auth.uid())
           )
         )
       )
  )
);

create or replace function public.get_my_learning_check_results(
  p_classroom_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table(
  check_id uuid,
  session_id uuid,
  student_id uuid,
  classroom_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  ended_at timestamptz,
  check_position smallint,
  check_title text,
  status text,
  marked_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select result_row.check_id,
         check_row.session_id,
         result_row.student_id,
         session_row.classroom_id,
         classroom_row.name,
         session_row.title,
         session_row.scheduled_at,
         session_row.ended_at,
         check_row.position,
         check_row.title,
         result_row.status,
         result_row.marked_at
    from public.session_learning_check_results result_row
    join public.session_learning_checks check_row
      on check_row.id = result_row.check_id
    join public.class_sessions session_row
      on session_row.id = check_row.session_id
    join public.classrooms classroom_row
      on classroom_row.id = session_row.classroom_id
    join public.students student_row
      on student_row.id = result_row.student_id
   where auth.uid() is not null
     and student_row.user_id = auth.uid()
     and student_row.deleted_at is null
     and session_row.deleted_at is null
     and session_row.ended_at is not null
     and (p_classroom_id is null or session_row.classroom_id = p_classroom_id)
     and (p_from is null or coalesce(session_row.scheduled_at, session_row.ended_at) >= p_from)
     and (p_to is null or coalesce(session_row.scheduled_at, session_row.ended_at) < p_to)
   order by coalesce(session_row.scheduled_at, session_row.ended_at) desc,
            check_row.position asc,
            result_row.marked_at desc
$$;

revoke all on function public.get_my_learning_check_results(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_learning_check_results(uuid, timestamptz, timestamptz)
  to authenticated;

comment on function public.get_my_learning_check_results(uuid, timestamptz, timestamptz) is
  'Student-only projection of the caller own learning checks after a session ends; guardians use published family results.';

commit;