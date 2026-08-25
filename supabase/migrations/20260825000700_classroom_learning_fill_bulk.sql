-- Atomic one-step learning-check writes for the classroom completion rail.
-- The legacy single-student RPC remains for compatibility with older bundles.

create or replace function public.mark_session_learning_checks(
  p_session_id uuid,
  p_check_id uuid,
  p_student_ids uuid[],
  p_status text
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_classroom_id uuid;
  submitted_count integer := coalesce(cardinality(p_student_ids), 0);
  distinct_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('explained','independent','prompted','imitated','incomplete','unchecked') then
    raise exception 'VALIDATION';
  end if;
  if submitted_count < 1 or submitted_count > 30 then raise exception 'VALIDATION'; end if;

  select count(distinct submitted.student_id)
    into distinct_count
    from unnest(p_student_ids) submitted(student_id)
   where submitted.student_id is not null;
  if distinct_count <> submitted_count then raise exception 'VALIDATION'; end if;

  select session_row.classroom_id into v_classroom_id
    from public.class_sessions session_row
    join public.session_learning_checks check_row
      on check_row.session_id = session_row.id and check_row.id = p_check_id
   where session_row.id = p_session_id;
  if v_classroom_id is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;

  if exists(
    select 1
      from unnest(p_student_ids) submitted(student_id)
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
     where result_row.check_id = p_check_id
       and result_row.student_id = any(p_student_ids);
  else
    insert into public.session_learning_check_results(
      check_id, student_id, status, marked_by, marked_at
    )
    select p_check_id, submitted.student_id, p_status, uid, now()
      from unnest(p_student_ids) submitted(student_id)
    on conflict(check_id, student_id) do update
      set status = excluded.status,
          marked_by = excluded.marked_by,
          marked_at = excluded.marked_at;
  end if;
end
$$;

revoke all on function public.mark_session_learning_checks(uuid, uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.mark_session_learning_checks(uuid, uuid, uuid[], text)
  to authenticated;
