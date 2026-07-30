-- R1-5 follow-up: qualify the student profile id inside the table-returning RPC.

begin;

create or replace function public.get_customer_submission(p_assignment_id uuid, p_student_id uuid)
returns table(
  id uuid, user_id uuid, content jsonb, submitted_at timestamptz,
  score numeric, feedback text, graded_at timestamptz
)
language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); student_user_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_submit_student_assignment(p_student_id, uid) then raise exception 'FORBIDDEN'; end if;
  select student_row.user_id into student_user_id
    from public.students student_row
   where student_row.id = p_student_id and student_row.deleted_at is null;
  if student_user_id is null then return; end if;
  return query
  select submission_row.id, submission_row.user_id, submission_row.content, submission_row.submitted_at,
         submission_row.score, submission_row.feedback, submission_row.graded_at
    from public.submissions submission_row
   where submission_row.assignment_id = p_assignment_id
     and submission_row.user_id = student_user_id;
end
$$;

commit;
