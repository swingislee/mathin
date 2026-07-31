-- R1-6: remove PL/pgSQL variable/column ambiguity in independent session result RPCs.
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
    if not exists(
      select 1 from public.enrollments enrollment_row
       where enrollment_row.classroom_id = result_classroom_id and enrollment_row.student_id = student_value
    ) then raise exception 'STUDENT_NOT_IN_CLASS'; end if;
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

create or replace function public.publish_session_family_brief(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); result_classroom_id uuid; result_term_id uuid;
  brief_row public.session_family_briefs%rowtype; recipient record;
  head_row public.learning_result_heads%rowtype; snapshot jsonb;
  revision_id uuid; existing_content jsonb; result_count integer := 0; changed_count integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id, session_row.term_id into result_classroom_id, result_term_id
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if result_classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(result_classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into brief_row from public.session_family_briefs where session_id = p_session_id for update;
  if not found then raise exception 'BRIEF_NOT_FOUND'; end if;
  if btrim(brief_row.lesson_title) = '' or btrim(brief_row.learning_summary) = '' then raise exception 'VALIDATION'; end if;
  snapshot := jsonb_build_object(
    'lessonTitle', brief_row.lesson_title, 'learningSummary', brief_row.learning_summary,
    'homeworkSummary', brief_row.homework_summary, 'materialsNote', brief_row.materials_note,
    'teacherPublicComment', brief_row.teacher_public_comment
  );

  for recipient in
    select distinct enrollment_row.student_id,
           coalesce(enrollment_row.term_id, result_term_id) as effective_term_id
      from public.enrollments enrollment_row
      join public.students student_row on student_row.id = enrollment_row.student_id and student_row.deleted_at is null
     where enrollment_row.classroom_id = result_classroom_id
     order by enrollment_row.student_id
  loop
    result_count := result_count + 1;
    if recipient.effective_term_id is null then raise exception 'TERM_NOT_FOUND'; end if;
    select * into head_row from public.learning_result_heads
     where kind = 'knowledge_summary'
       and source_key = p_session_id::text || ':' || recipient.student_id::text for update;
    if not found then
      insert into public.learning_result_heads(
        kind, source_key, student_id, term_id, session_id, status, requires_review, created_by
      ) values (
        'knowledge_summary', p_session_id::text || ':' || recipient.student_id::text,
        recipient.student_id, recipient.effective_term_id, p_session_id, 'draft', false, uid
      ) returning * into head_row;
    end if;
    select content into existing_content from public.learning_result_revisions where id = head_row.published_revision_id;
    if head_row.status = 'published' and existing_content = snapshot then continue; end if;
    revision_id := public.append_learning_result_revision(
      head_row.id, snapshot, null, null, null, null, null, '{}'::jsonb, uid
    );
    update public.learning_result_heads
       set status = 'published', published_revision_id = revision_id,
           published_by = uid, published_at = now(), withdrawn_by = null,
           withdrawn_at = null, withdrawal_reason = null
     where id = head_row.id;
    perform public.record_learning_result_transition(
      head_row.id, revision_id, head_row.status, 'published', 'knowledge summary published', uid, true
    );
    changed_count := changed_count + 1;
  end loop;
  if result_count = 0 then raise exception 'RECIPIENT_NOT_FOUND'; end if;
  update public.session_family_briefs
     set published_by = uid, published_at = case when changed_count > 0 then now() else coalesce(published_at, now()) end
   where session_id = p_session_id;
  update public.session_completion_tasks
     set status = 'done', completed_by = uid, completed_at = now(), skip_reason = null
   where session_id = p_session_id and kind = 'summary' and status = 'pending';
  if changed_count > 0 then
    perform public.emit_domain_event(
      'session_family_brief.published', 'class_session', p_session_id,
      jsonb_build_object('resultCount', result_count), null, null
    );
  end if;
end
$$;
revoke all on function public.publish_session_family_brief(uuid) from public, anon, authenticated;
grant execute on function public.publish_session_family_brief(uuid) to authenticated;

commit;
