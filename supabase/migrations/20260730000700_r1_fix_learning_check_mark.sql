-- Fix the live learning-check write path. The original RPC used classroom_id
-- for both a PL/pgSQL variable and an enrollments column, so Postgres rejected
-- every mark with "column reference classroom_id is ambiguous".

create or replace function public.mark_session_learning_check(
  p_session_id uuid,
  p_check_id uuid,
  p_student_id uuid,
  p_status text
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_classroom_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('explained','independent','prompted','imitated','incomplete','unchecked') then
    raise exception 'VALIDATION';
  end if;

  select session_row.classroom_id into v_classroom_id
    from public.class_sessions session_row
    join public.session_learning_checks check_row
      on check_row.session_id = session_row.id and check_row.id = p_check_id
   where session_row.id = p_session_id;
  if v_classroom_id is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not exists(
    select 1 from public.enrollments enrollment_row
     where enrollment_row.classroom_id = v_classroom_id
       and enrollment_row.student_id = p_student_id
       and enrollment_row.status = 'active'
  ) then raise exception 'STUDENT_NOT_ENROLLED'; end if;

  if p_status = 'unchecked' then
    delete from public.session_learning_check_results
     where check_id = p_check_id and student_id = p_student_id;
  else
    insert into public.session_learning_check_results(check_id, student_id, status, marked_by, marked_at)
    values(p_check_id, p_student_id, p_status, uid, now())
    on conflict(check_id, student_id) do update
      set status = excluded.status, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  end if;
end
$$;

revoke all on function public.mark_session_learning_check(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_session_learning_check(uuid, uuid, uuid, text) to authenticated;
