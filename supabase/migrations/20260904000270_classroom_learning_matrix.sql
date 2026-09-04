-- One atomic students × questions write contract for both matrix orientations.
-- Existing one-question/many-students clients keep using mark_session_learning_checks.

create or replace function public.mark_session_learning_matrix_cells(
  p_session_id uuid,
  p_cells jsonb,
  p_status text
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_classroom_id uuid;
  submitted_count integer;
  distinct_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('explained','independent','prompted','imitated','incomplete','unchecked') then
    raise exception 'VALIDATION';
  end if;
  if jsonb_typeof(p_cells) is distinct from 'array' then raise exception 'VALIDATION'; end if;

  submitted_count := jsonb_array_length(p_cells);
  if submitted_count < 1 or submitted_count > 200 then raise exception 'VALIDATION'; end if;

  with submitted as (
    select row.check_id, row.student_id
      from jsonb_to_recordset(p_cells) as row(check_id uuid, student_id uuid)
  )
  select count(distinct (submitted.check_id, submitted.student_id))
    into distinct_count
    from submitted
   where submitted.check_id is not null and submitted.student_id is not null;
  if distinct_count <> submitted_count then raise exception 'VALIDATION'; end if;

  select session_row.classroom_id into v_classroom_id
    from public.class_sessions session_row
   where session_row.id = p_session_id;
  if v_classroom_id is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;

  if exists(
    select 1
      from jsonb_to_recordset(p_cells) as submitted(check_id uuid, student_id uuid)
     where not exists(
       select 1
         from public.session_learning_checks check_row
        where check_row.id = submitted.check_id
          and check_row.session_id = p_session_id
     )
  ) then
    raise exception 'NOT_FOUND';
  end if;

  if exists(
    select 1
      from jsonb_to_recordset(p_cells) as submitted(check_id uuid, student_id uuid)
     where not exists(
       select 1
         from public.enrollments enrollment_row
        where enrollment_row.classroom_id = v_classroom_id
          and enrollment_row.student_id = submitted.student_id
          and enrollment_row.status = 'active'
     )
  ) then
    raise exception 'STUDENT_NOT_ENROLLED';
  end if;

  if p_status = 'unchecked' then
    delete from public.session_learning_check_results result_row
     using jsonb_to_recordset(p_cells) as submitted(check_id uuid, student_id uuid)
     where result_row.check_id = submitted.check_id
       and result_row.student_id = submitted.student_id;
  else
    insert into public.session_learning_check_results(
      check_id, student_id, status, marked_by, marked_at
    )
    select submitted.check_id, submitted.student_id, p_status, uid, now()
      from jsonb_to_recordset(p_cells) as submitted(check_id uuid, student_id uuid)
    on conflict(check_id, student_id) do update
      set status = excluded.status,
          marked_by = excluded.marked_by,
          marked_at = excluded.marked_at;
  end if;
end
$$;

revoke all on function public.mark_session_learning_matrix_cells(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.mark_session_learning_matrix_cells(uuid, jsonb, text)
  to authenticated;
