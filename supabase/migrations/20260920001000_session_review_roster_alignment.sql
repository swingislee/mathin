-- 班级内连续课评与课次读取、沟通共用当课名单，包括冻结名单及临时调入学生。
begin;

create or replace function public.save_session_reviews_v2(p_session_id uuid, p_records jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result_classroom_id uuid; item jsonb; student_value uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id into result_classroom_id from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if result_classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(result_classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'VALIDATION';
  end if;
  for item in select value from jsonb_array_elements(p_records)
  loop
    begin student_value := (item ->> 'studentId')::uuid;
    exception when others then raise exception 'VALIDATION'; end;
    if not (student_value = any(public.session_communication_student_ids(p_session_id))) then
      raise exception 'STUDENT_NOT_IN_CLASS';
    end if;
    insert into public.session_reviews(
      session_id, student_id, entry_score, exit_score, focus, participation, mastery, comment, created_by
    ) values (
      p_session_id, student_value, nullif(item ->> 'entryScore', '')::numeric,
      nullif(item ->> 'exitScore', '')::numeric, nullif(item ->> 'focus', '')::smallint,
      nullif(item ->> 'participation', '')::smallint, nullif(item ->> 'mastery', '')::smallint,
      left(coalesce(item ->> 'comment', ''), 2000), uid
    ) on conflict(session_id, student_id) do update set
      entry_score = excluded.entry_score, exit_score = excluded.exit_score,
      focus = excluded.focus, participation = excluded.participation,
      mastery = excluded.mastery, comment = excluded.comment, updated_at = now();
  end loop;
end
$$;
revoke all on function public.save_session_reviews_v2(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_session_reviews_v2(uuid,jsonb) to authenticated;


commit;
