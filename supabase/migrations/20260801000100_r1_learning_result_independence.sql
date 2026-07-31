-- R1-6: split knowledge summaries from per-student reviews and make result
-- notifications actionable. Legacy session_result rows stay immutable and are
-- retained only as historical compatibility records.
begin;

alter table public.learning_result_heads
  drop constraint if exists learning_result_heads_kind_check,
  drop constraint if exists learning_result_heads_source_shape,
  drop constraint if exists learning_result_heads_review_kind;
alter table public.learning_result_heads
  add constraint learning_result_heads_kind_check
    check (kind in ('session_result', 'knowledge_summary', 'session_review', 'video_review', 'stage_report')),
  add constraint learning_result_heads_source_shape check (
    (kind in ('session_result', 'knowledge_summary', 'session_review') and session_id is not null and video_id is null and period_start is null and period_end is null)
    or (kind = 'video_review' and session_id is not null and video_id is not null and period_start is null and period_end is null)
    or (kind = 'stage_report' and session_id is null and video_id is null and period_start is not null and period_end is not null and period_end >= period_start)
  ),
  add constraint learning_result_heads_review_kind check (requires_review = (kind = 'stage_report'));

-- Preserve current development/RC history without mutating legacy revisions.
with recipients as (
  select legacy.session_id, legacy.student_id, legacy.term_id
    from public.learning_result_heads legacy
   where legacy.kind = 'session_result'
  union
  select brief_row.session_id, enrollment_row.student_id,
         coalesce(enrollment_row.term_id, session_row.term_id)
    from public.session_family_briefs brief_row
    join public.class_sessions session_row on session_row.id = brief_row.session_id
    join public.enrollments enrollment_row on enrollment_row.classroom_id = session_row.classroom_id
    join public.students student_row on student_row.id = enrollment_row.student_id and student_row.deleted_at is null
   where session_row.deleted_at is null
)
insert into public.learning_result_heads(
  kind, source_key, student_id, term_id, session_id, status, requires_review,
  reviewed_by, reviewed_at, published_by, published_at, withdrawn_by, withdrawn_at,
  withdrawal_reason, created_by, created_at, updated_at
)
select 'knowledge_summary', recipient.session_id::text || ':' || recipient.student_id::text,
       recipient.student_id, recipient.term_id, recipient.session_id,
       coalesce(legacy.status, case brief_row.family_visibility_state
         when 'published' then 'published' when 'withdrawn' then 'withdrawn' else 'draft' end),
       false, legacy.reviewed_by, legacy.reviewed_at,
       coalesce(legacy.published_by, brief_row.published_by),
       coalesce(legacy.published_at, brief_row.published_at),
       legacy.withdrawn_by, legacy.withdrawn_at, legacy.withdrawal_reason,
       coalesce(legacy.created_by, brief_row.published_by),
       coalesce(legacy.created_at, brief_row.updated_at),
       greatest(coalesce(legacy.updated_at, brief_row.updated_at), brief_row.updated_at)
  from recipients recipient
  join public.session_family_briefs brief_row on brief_row.session_id = recipient.session_id
  left join public.learning_result_heads legacy
    on legacy.kind = 'session_result'
   and legacy.source_key = recipient.session_id::text || ':' || recipient.student_id::text
 where recipient.term_id is not null
on conflict(kind, source_key) do nothing;

insert into public.learning_result_heads(
  kind, source_key, student_id, term_id, session_id, status, requires_review,
  reviewed_by, reviewed_at, published_by, published_at, withdrawn_by, withdrawn_at,
  withdrawal_reason, created_by, created_at, updated_at
)
select 'session_review', review_row.session_id::text || ':' || review_row.student_id::text,
       review_row.student_id, coalesce(review_row.term_id, session_row.term_id), review_row.session_id,
       coalesce(legacy.status, 'draft'), false,
       legacy.reviewed_by, legacy.reviewed_at, legacy.published_by, legacy.published_at,
       legacy.withdrawn_by, legacy.withdrawn_at, legacy.withdrawal_reason,
       coalesce(legacy.created_by, review_row.created_by),
       coalesce(legacy.created_at, review_row.updated_at),
       greatest(coalesce(legacy.updated_at, review_row.updated_at), review_row.updated_at)
  from public.session_reviews review_row
  join public.class_sessions session_row on session_row.id = review_row.session_id
  left join public.learning_result_heads legacy
    on legacy.kind = 'session_result'
   and legacy.source_key = review_row.session_id::text || ':' || review_row.student_id::text
 where coalesce(review_row.term_id, session_row.term_id) is not null
on conflict(kind, source_key) do nothing;

insert into public.learning_result_revisions(head_id, revision_no, content, dataset, created_by, created_at)
select head_row.id, 1,
       jsonb_build_object(
         'lessonTitle', coalesce(legacy_revision.content ->> 'lessonTitle', brief_row.lesson_title),
         'learningSummary', coalesce(legacy_revision.content ->> 'learningSummary', brief_row.learning_summary),
         'homeworkSummary', coalesce(legacy_revision.content ->> 'homeworkSummary', brief_row.homework_summary),
         'materialsNote', coalesce(legacy_revision.content ->> 'materialsNote', brief_row.materials_note),
         'teacherPublicComment', coalesce(legacy_revision.content ->> 'teacherPublicComment', brief_row.teacher_public_comment)
       ), '{}'::jsonb, coalesce(legacy_revision.created_by, head_row.created_by),
       coalesce(legacy_revision.created_at, brief_row.updated_at)
  from public.learning_result_heads head_row
  join public.session_family_briefs brief_row on brief_row.session_id = head_row.session_id
  left join public.learning_result_heads legacy
    on legacy.kind = 'session_result' and legacy.source_key = head_row.source_key
  left join public.learning_result_revisions legacy_revision
    on legacy_revision.id = coalesce(legacy.published_revision_id, legacy.current_revision_id)
 where head_row.kind = 'knowledge_summary' and head_row.current_revision_id is null;

insert into public.learning_result_revisions(head_id, revision_no, content, dataset, created_by, created_at)
select head_row.id, 1,
       jsonb_build_object(
         'lessonTitle', session_row.title,
         'entryScore', coalesce(legacy_revision.content -> 'entryScore', to_jsonb(review_row.entry_score)),
         'exitScore', coalesce(legacy_revision.content -> 'exitScore', to_jsonb(review_row.exit_score)),
         'focus', coalesce(legacy_revision.content -> 'focus', to_jsonb(review_row.focus)),
         'participation', coalesce(legacy_revision.content -> 'participation', to_jsonb(review_row.participation)),
         'mastery', coalesce(legacy_revision.content -> 'mastery', to_jsonb(review_row.mastery)),
         'comment', coalesce(legacy_revision.content ->> 'comment', review_row.comment)
       ), '{}'::jsonb, coalesce(legacy_revision.created_by, review_row.created_by),
       coalesce(legacy_revision.created_at, review_row.updated_at)
  from public.learning_result_heads head_row
  join public.session_reviews review_row
    on review_row.session_id = head_row.session_id and review_row.student_id = head_row.student_id
  join public.class_sessions session_row on session_row.id = head_row.session_id
  left join public.learning_result_heads legacy
    on legacy.kind = 'session_result' and legacy.source_key = head_row.source_key
  left join public.learning_result_revisions legacy_revision
    on legacy_revision.id = coalesce(legacy.published_revision_id, legacy.current_revision_id)
 where head_row.kind = 'session_review' and head_row.current_revision_id is null;

update public.learning_result_heads head_row
   set current_revision_id = revision_row.id,
       published_revision_id = case when head_row.status in ('published', 'withdrawn', 'revised') then revision_row.id else null end
  from public.learning_result_revisions revision_row
 where revision_row.head_id = head_row.id and revision_row.revision_no = 1
   and head_row.kind in ('knowledge_summary', 'session_review')
   and head_row.current_revision_id is null;
create or replace function public.record_learning_result_transition(
  p_head_id uuid, p_revision_id uuid, p_from_status text, p_to_status text,
  p_reason text, p_actor_id uuid, p_notify boolean default false
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  head_row public.learning_result_heads%rowtype; actor_role text; recipient record;
  target_link text; title_value text; revision_content jsonb := '{}'::jsonb;
begin
  select * into head_row from public.learning_result_heads where id = p_head_id;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  insert into public.learning_result_events(head_id, revision_id, from_status, to_status, reason, actor_id)
  values(p_head_id, p_revision_id, p_from_status, p_to_status,
         nullif(left(btrim(coalesce(p_reason, '')), 1000), ''), p_actor_id);
  if not p_notify then return; end if;

  if p_revision_id is not null then
    select content into revision_content from public.learning_result_revisions where id = p_revision_id;
  end if;
  title_value := coalesce(
    nullif(revision_content ->> 'title', ''),
    nullif(revision_content ->> 'lessonTitle', ''),
    (select nullif(session_row.title, '') from public.class_sessions session_row where session_row.id = head_row.session_id),
    case head_row.kind when 'stage_report' then 'Stage report'
      when 'knowledge_summary' then 'Knowledge summary'
      when 'session_review' then 'Session review'
      when 'video_review' then 'Video review' else 'Learning result' end
  );
  select role into actor_role from public.profiles where id = p_actor_id;

  if p_to_status = 'review' then
    for recipient in
      select profile_row.id as recipient_id
        from public.profiles profile_row
       where profile_row.id <> p_actor_id
         and (public.is_admin(profile_row.id)
           or (public.has_perm(profile_row.id, 'review.write')
             and public.can_manage_learning_result(head_row.student_id, head_row.term_id, profile_row.id)))
    loop
      target_link := '/dashboard/students/' || head_row.student_id::text ||
        '?tab=learning&report=' || head_row.id::text;
      insert into public.domain_events(
        actor_id, actor_role, target_user_id, event_type, entity_type, entity_id,
        payload, event_link, term_id
      ) values (
        p_actor_id, actor_role, recipient.recipient_id, 'learning_result.review_submitted',
        'learning_result', head_row.id,
        jsonb_build_object('headId', head_row.id, 'revisionId', p_revision_id,
          'resultKind', head_row.kind, 'studentId', head_row.student_id, 'title', title_value),
        target_link, head_row.term_id
      );
    end loop;
    return;
  end if;

  if p_from_status = 'review' and p_to_status = 'draft' then
    select coalesce(revision_row.created_by, head_row.created_by) as recipient_id
      into recipient
      from public.learning_result_revisions revision_row
     where revision_row.id = p_revision_id;
    if recipient.recipient_id is not null then
      target_link := '/dashboard/students/' || head_row.student_id::text ||
        '?tab=learning&report=' || head_row.id::text;
      insert into public.domain_events(
        actor_id, actor_role, target_user_id, event_type, entity_type, entity_id,
        payload, event_link, term_id
      ) values (
        p_actor_id, actor_role, recipient.recipient_id, 'learning_result.changes_requested',
        'learning_result', head_row.id,
        jsonb_build_object('headId', head_row.id, 'revisionId', p_revision_id,
          'resultKind', head_row.kind, 'studentId', head_row.student_id,
          'title', title_value, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
        target_link, head_row.term_id
      );
    end if;
    return;
  end if;

  if p_to_status not in ('published', 'withdrawn', 'revised') then return; end if;
  for recipient in
    select student_row.user_id as recipient_id, true as is_student
      from public.students student_row
     where student_row.id = head_row.student_id and student_row.user_id is not null
    union
    select guardian_row.guardian_id, false
      from public.student_guardians guardian_row
     where guardian_row.student_id = head_row.student_id and 'grades' = any(guardian_row.scope)
  loop
    target_link := case when recipient.is_student
      then '/dashboard/progress#learning-results'
      else '/dashboard/children?child=' || head_row.student_id::text || '#learning-results' end;
    insert into public.domain_events(
      actor_id, actor_role, target_user_id, event_type, entity_type, entity_id,
      payload, event_link, term_id
    ) values (
      p_actor_id, actor_role, recipient.recipient_id,
      'learning_result.' || p_to_status, 'learning_result', head_row.id,
      jsonb_build_object('headId', head_row.id, 'revisionId', p_revision_id,
        'resultKind', head_row.kind, 'studentId', head_row.student_id, 'title', title_value),
      target_link, head_row.term_id
    );
  end loop;
end
$$;
revoke all on function public.record_learning_result_transition(uuid,uuid,text,text,text,uuid,boolean)
  from public, anon, authenticated;

create or replace function public.submit_learning_result_review(p_head_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); head_row public.learning_result_heads%rowtype; revision_content jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into head_row from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  if not public.can_manage_learning_result(head_row.student_id, head_row.term_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not head_row.requires_review or head_row.current_revision_id is null
     or head_row.status not in ('draft', 'revised') then raise exception 'INVALID_STATE'; end if;
  select content into revision_content from public.learning_result_revisions where id = head_row.current_revision_id;
  if head_row.kind = 'stage_report' and (
    btrim(coalesce(revision_content ->> 'title', '')) = ''
    or btrim(coalesce(revision_content ->> 'summary', '')) = ''
  ) then raise exception 'VALIDATION'; end if;
  update public.learning_result_heads set status = 'review', reviewed_by = null, reviewed_at = null where id = p_head_id;
  perform public.record_learning_result_transition(
    p_head_id, head_row.current_revision_id, head_row.status, 'review', 'submitted for review', uid, true
  );
end
$$;
revoke all on function public.submit_learning_result_review(uuid) from public, anon, authenticated;
grant execute on function public.submit_learning_result_review(uuid) to authenticated;

create or replace function public.decide_learning_result_review(
  p_head_id uuid, p_decision text, p_note text default ''
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); head_row public.learning_result_heads%rowtype; decision_value text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  decision_value := lower(btrim(coalesce(p_decision, '')));
  if decision_value not in ('publish', 'changes_requested') then raise exception 'VALIDATION'; end if;
  select * into head_row from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  if not public.can_manage_learning_result(head_row.student_id, head_row.term_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not head_row.requires_review or head_row.status <> 'review' or head_row.current_revision_id is null then
    raise exception 'INVALID_STATE';
  end if;
  if decision_value = 'changes_requested' then
    update public.learning_result_heads set status = 'draft', reviewed_by = uid, reviewed_at = now() where id = p_head_id;
    perform public.record_learning_result_transition(
      p_head_id, head_row.current_revision_id, 'review', 'draft', p_note, uid, true
    );
  else
    update public.learning_result_heads
       set status = 'published', published_revision_id = current_revision_id,
           reviewed_by = uid, reviewed_at = now(), published_by = uid, published_at = now(),
           withdrawn_by = null, withdrawn_at = null, withdrawal_reason = null
     where id = p_head_id;
    perform public.record_learning_result_transition(
      p_head_id, head_row.current_revision_id, 'review', 'published', p_note, uid, true
    );
  end if;
end
$$;
revoke all on function public.decide_learning_result_review(uuid,text,text) from public, anon, authenticated;
grant execute on function public.decide_learning_result_review(uuid,text,text) to authenticated;

create or replace function public.mark_session_result_kind_changed(
  p_session_id uuid, p_kind text, p_actor_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare head_row public.learning_result_heads%rowtype;
begin
  if p_kind not in ('knowledge_summary', 'session_review') then raise exception 'VALIDATION'; end if;
  for head_row in
    select * from public.learning_result_heads
     where kind = p_kind and session_id = p_session_id and status in ('published', 'withdrawn')
     for update
  loop
    update public.learning_result_heads set status = 'revised' where id = head_row.id;
    perform public.record_learning_result_transition(
      head_row.id, head_row.published_revision_id, head_row.status, 'revised',
      p_kind || ' source changed', p_actor_id, true
    );
  end loop;
end
$$;
revoke all on function public.mark_session_result_kind_changed(uuid,text,uuid)
  from public, anon, authenticated;

create or replace function public.mark_session_learning_results_changed(p_session_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.mark_session_result_kind_changed(p_session_id, 'knowledge_summary', p_actor_id);
end
$$;
revoke all on function public.mark_session_learning_results_changed(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.invalidate_family_brief_on_review_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare changed_session_id uuid; actor_id uuid;
begin
  changed_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  actor_id := coalesce(auth.uid(), case when tg_op = 'DELETE' then old.created_by else new.created_by end);
  perform public.mark_session_result_kind_changed(changed_session_id, 'session_review', actor_id);
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function public.invalidate_family_brief_on_review_change() from public, anon, authenticated;

create or replace function public.save_session_reviews_v2(p_session_id uuid, p_records jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); classroom_id uuid; item jsonb; student_value uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id into classroom_id from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'VALIDATION';
  end if;
  for item in select value from jsonb_array_elements(p_records)
  loop
    begin student_value := (item ->> 'studentId')::uuid;
    exception when others then raise exception 'VALIDATION'; end;
    if not exists(
      select 1 from public.enrollments enrollment_row
       where enrollment_row.classroom_id = classroom_id and enrollment_row.student_id = student_value
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
  uid uuid := auth.uid(); classroom_id uuid; result_term_id uuid;
  brief_row public.session_family_briefs%rowtype; recipient record;
  head_row public.learning_result_heads%rowtype; snapshot jsonb;
  revision_id uuid; existing_content jsonb; result_count integer := 0; changed_count integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id, session_row.term_id into classroom_id, result_term_id
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
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
     where enrollment_row.classroom_id = classroom_id
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

create or replace function public.publish_session_reviews(p_session_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); classroom_id uuid; result_term_id uuid; session_title text;
  review_item record; head_row public.learning_result_heads%rowtype;
  snapshot jsonb; revision_id uuid; existing_content jsonb; changed_count integer := 0; result_count integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id, session_row.term_id, session_row.title
    into classroom_id, result_term_id, session_title
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  for review_item in
    select review_row.*, coalesce(review_row.term_id, result_term_id) as effective_term_id
      from public.session_reviews review_row
      join public.students student_row on student_row.id = review_row.student_id and student_row.deleted_at is null
     where review_row.session_id = p_session_id order by review_row.student_id
  loop
    result_count := result_count + 1;
    if review_item.effective_term_id is null then raise exception 'TERM_NOT_FOUND'; end if;
    snapshot := jsonb_build_object(
      'lessonTitle', session_title, 'entryScore', review_item.entry_score,
      'exitScore', review_item.exit_score, 'focus', review_item.focus,
      'participation', review_item.participation, 'mastery', review_item.mastery,
      'comment', review_item.comment
    );
    select * into head_row from public.learning_result_heads
     where kind = 'session_review'
       and source_key = p_session_id::text || ':' || review_item.student_id::text for update;
    if not found then
      insert into public.learning_result_heads(
        kind, source_key, student_id, term_id, session_id, status, requires_review, created_by
      ) values (
        'session_review', p_session_id::text || ':' || review_item.student_id::text,
        review_item.student_id, review_item.effective_term_id, p_session_id, 'draft', false, uid
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
      head_row.id, revision_id, head_row.status, 'published', 'session review published', uid, true
    );
    changed_count := changed_count + 1;
  end loop;
  if result_count = 0 then raise exception 'REVIEW_NOT_FOUND'; end if;
  return changed_count;
end
$$;
revoke all on function public.publish_session_reviews(uuid) from public, anon, authenticated;
grant execute on function public.publish_session_reviews(uuid) to authenticated;

create or replace function public.withdraw_session_result_kind(p_session_id uuid, p_kind text, p_reason text)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); classroom_id uuid; head_row public.learning_result_heads%rowtype; affected integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_kind not in ('knowledge_summary', 'session_review') or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'VALIDATION';
  end if;
  select session_row.classroom_id into classroom_id from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  for head_row in
    select * from public.learning_result_heads
     where kind = p_kind and session_id = p_session_id and status = 'published' for update
  loop
    update public.learning_result_heads
       set status = 'withdrawn', withdrawn_by = uid, withdrawn_at = now(),
           withdrawal_reason = left(btrim(p_reason), 1000)
     where id = head_row.id;
    perform public.record_learning_result_transition(
      head_row.id, head_row.published_revision_id, 'published', 'withdrawn', p_reason, uid, true
    );
    affected := affected + 1;
  end loop;
  if affected = 0 then raise exception 'INVALID_STATE'; end if;
  if p_kind = 'knowledge_summary' then
    update public.session_family_briefs set published_by = null, published_at = null where session_id = p_session_id;
  end if;
  return affected;
end
$$;
revoke all on function public.withdraw_session_result_kind(uuid,text,text) from public, anon, authenticated;

create or replace function public.withdraw_session_learning_results(p_session_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.withdraw_session_result_kind(p_session_id, 'knowledge_summary', p_reason);
end
$$;
revoke all on function public.withdraw_session_learning_results(uuid,text) from public, anon, authenticated;
grant execute on function public.withdraw_session_learning_results(uuid,text) to authenticated;

create or replace function public.withdraw_session_reviews(p_session_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.withdraw_session_result_kind(p_session_id, 'session_review', p_reason);
end
$$;
revoke all on function public.withdraw_session_reviews(uuid,text) from public, anon, authenticated;
grant execute on function public.withdraw_session_reviews(uuid,text) to authenticated;

create or replace function public.withdraw_learning_result(p_head_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); head_row public.learning_result_heads%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'VALIDATION'; end if;
  select * into head_row from public.learning_result_heads where id = p_head_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;
  if not public.can_manage_learning_result(head_row.student_id, head_row.term_id, uid) then raise exception 'FORBIDDEN'; end if;
  if head_row.status <> 'published' then raise exception 'INVALID_STATE'; end if;
  update public.learning_result_heads
     set status = 'withdrawn', withdrawn_by = uid, withdrawn_at = now(),
         withdrawal_reason = left(btrim(p_reason), 1000)
   where id = p_head_id;
  if head_row.kind = 'knowledge_summary' and not exists (
    select 1 from public.learning_result_heads other_head
     where other_head.kind = 'knowledge_summary' and other_head.session_id = head_row.session_id
       and other_head.status = 'published' and other_head.id <> p_head_id
  ) then
    update public.session_family_briefs set published_by = null, published_at = null where session_id = head_row.session_id;
  end if;
  perform public.record_learning_result_transition(
    p_head_id, head_row.published_revision_id, 'published', 'withdrawn', p_reason, uid, true
  );
end
$$;
revoke all on function public.withdraw_learning_result(uuid,text) from public, anon, authenticated;
grant execute on function public.withdraw_learning_result(uuid,text) to authenticated;
create or replace function public.get_my_knowledge_summaries(p_from timestamptz, p_to timestamptz)
returns table(
  head_id uuid, session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, lesson_title text, learning_summary text,
  homework_summary text, materials_note text, teacher_public_comment text, published_at timestamptz
) language sql security definer stable set search_path = public, pg_temp
as $$
  select head_row.id, session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at,
         coalesce(revision_row.content ->> 'lessonTitle', ''),
         coalesce(revision_row.content ->> 'learningSummary', ''),
         coalesce(revision_row.content ->> 'homeworkSummary', ''),
         coalesce(revision_row.content ->> 'materialsNote', ''),
         coalesce(revision_row.content ->> 'teacherPublicComment', ''), head_row.published_at
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.class_sessions session_row on session_row.id = head_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'knowledge_summary' and head_row.status = 'published'
     and student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'grades'))
   order by session_row.scheduled_at desc, student_row.id
$$;
revoke all on function public.get_my_knowledge_summaries(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_knowledge_summaries(timestamptz,timestamptz) to authenticated;

create or replace function public.get_my_session_reviews(p_from timestamptz, p_to timestamptz)
returns table(
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, entry_score numeric, exit_score numeric,
  focus smallint, participation smallint, mastery smallint, comment text, knowledge_summary text
) language sql security definer stable set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at,
         (revision_row.content ->> 'entryScore')::numeric,
         (revision_row.content ->> 'exitScore')::numeric,
         (revision_row.content ->> 'focus')::smallint,
         (revision_row.content ->> 'participation')::smallint,
         (revision_row.content ->> 'mastery')::smallint,
         coalesce(revision_row.content ->> 'comment', ''), ''::text
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.class_sessions session_row on session_row.id = head_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'session_review' and head_row.status = 'published'
     and student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'grades'))
   order by session_row.scheduled_at desc, student_row.id
$$;
revoke all on function public.get_my_session_reviews(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_session_reviews(timestamptz,timestamptz) to authenticated;

create or replace function public.get_family_session_brief(p_session_id uuid)
returns table(
  lesson_title text, learning_summary text, homework_summary text,
  materials_note text, teacher_public_comment text, published_at timestamptz
) language sql security definer stable set search_path = public, pg_temp
as $$
  select coalesce(revision_row.content ->> 'lessonTitle', ''),
         coalesce(revision_row.content ->> 'learningSummary', ''),
         coalesce(revision_row.content ->> 'homeworkSummary', ''),
         coalesce(revision_row.content ->> 'materialsNote', ''),
         coalesce(revision_row.content ->> 'teacherPublicComment', ''), head_row.published_at
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'knowledge_summary' and head_row.session_id = p_session_id
     and head_row.status = 'published' and student_row.deleted_at is null
     and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'grades'))
   order by head_row.student_id limit 1
$$;
revoke all on function public.get_family_session_brief(uuid) from public, anon, authenticated;
grant execute on function public.get_family_session_brief(uuid) to authenticated;

create or replace function public.get_my_session_review_states(p_from timestamptz, p_to timestamptz)
returns table(
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, availability_state text
) language sql security definer stable set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at,
         case when head_row.status = 'published' then 'published'
           when head_row.status in ('withdrawn', 'revised') then 'withdrawn' else 'pending' end
    from public.session_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = review_row.student_id
    left join public.learning_result_heads head_row
      on head_row.kind = 'session_review'
     and head_row.source_key = review_row.session_id::text || ':' || review_row.student_id::text
   where student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'grades'))
   order by session_row.scheduled_at desc, student_row.id
$$;
revoke all on function public.get_my_session_review_states(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_session_review_states(timestamptz,timestamptz) to authenticated;

comment on function public.publish_session_family_brief(uuid)
  is 'Publishes only the shared knowledge summary; per-student reviews are independent.';
comment on function public.publish_session_reviews(uuid)
  is 'Publishes per-student reviews without requiring or changing the knowledge summary.';

commit;