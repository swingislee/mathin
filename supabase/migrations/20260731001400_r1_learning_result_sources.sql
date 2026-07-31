-- R1-6: project session reviews, family briefs, and video reviews through immutable results.
begin;

drop policy if exists session_reviews_select_scope on public.session_reviews;
create policy session_reviews_select_scope on public.session_reviews
  for select to authenticated
  using (
    exists (
      select 1 from public.class_sessions session_row
       where session_row.id = session_id
         and public.can_review_session(session_row.classroom_id, (select auth.uid()))
    )
  );

drop policy if exists session_videos_select_scope on public.session_videos;
create policy session_videos_select_scope on public.session_videos
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.class_sessions session_row
       where session_row.id = session_id
         and public.can_review_video_session(session_row.classroom_id, (select auth.uid()))
    )
  );

create or replace function public.can_read_session_video_object(p_storage_path text, p_uid uuid)
returns boolean language sql security definer stable set search_path = public, storage, pg_temp
as $$
  select exists (
    select 1
      from public.session_videos video_row
      join public.class_sessions session_row on session_row.id = video_row.session_id
     where video_row.storage_path = p_storage_path and video_row.deleted_at is null
       and (
         public.can_upload_student_media(video_row.student_id, p_uid)
         or public.can_review_video_session(session_row.classroom_id, p_uid)
       )
  )
$$;
revoke all on function public.can_read_session_video_object(text,uuid) from public;
grant execute on function public.can_read_session_video_object(text,uuid) to authenticated;

drop policy if exists session_videos_storage_select_staff_self on storage.objects;
create policy session_videos_storage_select_staff_self on storage.objects
  for select to authenticated
  using (bucket_id = 'session-videos' and public.can_read_session_video_object(name, (select auth.uid())));

create or replace function public.mark_video_learning_result_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare head_row public.learning_result_heads%rowtype; next_status text; actor_id uuid;
begin
  select * into head_row from public.learning_result_heads
   where kind = 'video_review' and source_key = new.id::text for update;
  if not found then return new; end if;
  actor_id := coalesce(auth.uid(), new.reviewed_by, old.reviewed_by);
  if new.deleted_at is not null and old.deleted_at is null and head_row.status = 'published' then
    next_status := 'withdrawn';
  elsif row(new.reviewed_by, new.reviewed_at, new.review_comment, new.review_score)
        is distinct from row(old.reviewed_by, old.reviewed_at, old.review_comment, old.review_score)
        and head_row.status in ('published', 'withdrawn') then
    next_status := 'revised';
  else
    return new;
  end if;
  update public.learning_result_heads
     set status = next_status,
         withdrawn_by = case when next_status = 'withdrawn' then actor_id else withdrawn_by end,
         withdrawn_at = case when next_status = 'withdrawn' then now() else withdrawn_at end,
         withdrawal_reason = case when next_status = 'withdrawn' then 'video removed' else withdrawal_reason end
   where id = head_row.id;
  perform public.record_learning_result_transition(
    head_row.id, head_row.published_revision_id, head_row.status, next_status,
    case when next_status = 'withdrawn' then 'video removed' else 'video review changed' end,
    actor_id, true
  );
  return new;
end
$$;
revoke all on function public.mark_video_learning_result_changed() from public, anon, authenticated;

drop trigger if exists session_videos_mark_learning_result_changed on public.session_videos;
create trigger session_videos_mark_learning_result_changed
  after update of reviewed_by, reviewed_at, review_comment, review_score, deleted_at on public.session_videos
  for each row execute function public.mark_video_learning_result_changed();

create or replace function public.publish_session_video_review(p_video_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); video_row public.session_videos%rowtype; classroom_id uuid;
  result_term_id uuid; head_row public.learning_result_heads%rowtype;
  snapshot jsonb; revision_id uuid; existing_content jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into video_row from public.session_videos where id = p_video_id for update;
  if video_row.id is null or video_row.deleted_at is not null then raise exception 'VIDEO_NOT_FOUND'; end if;
  select session_row.classroom_id, coalesce(video_row.term_id, session_row.term_id)
    into classroom_id, result_term_id
    from public.class_sessions session_row where session_row.id = video_row.session_id;
  if not public.can_review_video_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  if video_row.reviewed_at is null or video_row.reviewed_by is null then raise exception 'REVIEW_REQUIRED'; end if;
  if result_term_id is null then raise exception 'TERM_NOT_FOUND'; end if;

  snapshot := jsonb_build_object(
    'videoId', video_row.id, 'sessionId', video_row.session_id,
    'reviewScore', video_row.review_score, 'reviewComment', video_row.review_comment,
    'reviewedAt', video_row.reviewed_at
  );
  select * into head_row from public.learning_result_heads
   where kind = 'video_review' and source_key = p_video_id::text for update;
  if not found then
    insert into public.learning_result_heads(
      kind, source_key, student_id, term_id, session_id, video_id,
      status, requires_review, created_by
    ) values (
      'video_review', p_video_id::text, video_row.student_id, result_term_id,
      video_row.session_id, video_row.id, 'draft', false, uid
    ) returning * into head_row;
  end if;
  select content into existing_content from public.learning_result_revisions
   where id = head_row.published_revision_id;
  if head_row.status = 'published' and existing_content = snapshot then return head_row.id; end if;

  revision_id := public.append_learning_result_revision(
    head_row.id, snapshot, null, null, null, null, null, '{}'::jsonb, uid
  );
  update public.learning_result_heads
     set status = 'published', published_revision_id = revision_id,
         published_by = uid, published_at = now(), reviewed_by = video_row.reviewed_by,
         reviewed_at = video_row.reviewed_at, withdrawn_by = null, withdrawn_at = null,
         withdrawal_reason = null
   where id = head_row.id;
  perform public.record_learning_result_transition(
    head_row.id, revision_id, head_row.status, 'published', 'video review published', uid, true
  );
  return head_row.id;
end
$$;
revoke all on function public.publish_session_video_review(uuid) from public, anon, authenticated;
grant execute on function public.publish_session_video_review(uuid) to authenticated;

insert into public.learning_result_heads(
  kind, source_key, student_id, term_id, session_id, video_id, status, requires_review,
  published_by, published_at, reviewed_by, reviewed_at, created_by, created_at, updated_at
)
select 'video_review', video_row.id::text, video_row.student_id,
       coalesce(video_row.term_id, session_row.term_id), video_row.session_id, video_row.id,
       'published', false, video_row.reviewed_by, video_row.reviewed_at,
       video_row.reviewed_by, video_row.reviewed_at, video_row.reviewed_by,
       video_row.submitted_at, coalesce(video_row.reviewed_at, video_row.submitted_at)
  from public.session_videos video_row
  join public.class_sessions session_row on session_row.id = video_row.session_id
 where video_row.reviewed_at is not null and video_row.deleted_at is null
   and coalesce(video_row.term_id, session_row.term_id) is not null
on conflict(kind, source_key) do nothing;

insert into public.learning_result_revisions(
  head_id, revision_no, content, dataset, created_by, created_at
)
select head_row.id, 1,
       jsonb_build_object(
         'videoId', video_row.id, 'sessionId', video_row.session_id,
         'reviewScore', video_row.review_score, 'reviewComment', video_row.review_comment,
         'reviewedAt', video_row.reviewed_at
       ), '{}'::jsonb, video_row.reviewed_by, video_row.reviewed_at
  from public.learning_result_heads head_row
  join public.session_videos video_row on video_row.id = head_row.video_id
 where head_row.kind = 'video_review' and head_row.current_revision_id is null;

update public.learning_result_heads head_row
   set current_revision_id = revision_row.id, published_revision_id = revision_row.id
  from public.learning_result_revisions revision_row
 where revision_row.head_id = head_row.id and revision_row.revision_no = 1
   and head_row.kind = 'video_review' and head_row.current_revision_id is null;

create or replace function public.get_my_reviewed_videos()
returns table(video_id uuid, session_id uuid, student_id uuid, review_score smallint, review_comment text)
language sql security definer stable set search_path = public, pg_temp
as $$
  select head_row.video_id, head_row.session_id, head_row.student_id,
         (revision_row.content ->> 'reviewScore')::smallint,
         coalesce(revision_row.content ->> 'reviewComment', '')
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'video_review' and head_row.status = 'published'
     and student_row.deleted_at is null
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'video')
     )
   order by head_row.published_at desc
$$;
revoke all on function public.get_my_reviewed_videos() from public, anon, authenticated;
grant execute on function public.get_my_reviewed_videos() to authenticated;

create or replace function public.mark_session_learning_results_changed(p_session_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare head_row public.learning_result_heads%rowtype;
begin
  for head_row in
    select * from public.learning_result_heads
     where kind = 'session_result' and session_id = p_session_id
       and status in ('published', 'withdrawn')
     for update
  loop
    update public.learning_result_heads set status = 'revised' where id = head_row.id;
    perform public.record_learning_result_transition(
      head_row.id, head_row.published_revision_id, head_row.status, 'revised',
      'session result source changed', p_actor_id, true
    );
  end loop;
end
$$;
revoke all on function public.mark_session_learning_results_changed(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.save_session_family_brief(
  p_session_id uuid, p_lesson_title text, p_learning_summary text,
  p_homework_summary text default '', p_materials_note text default '',
  p_teacher_public_comment text default ''
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); classroom_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id into classroom_id from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  insert into public.session_family_briefs(
    session_id, lesson_title, learning_summary, homework_summary, materials_note,
    teacher_public_comment, published_by, published_at
  ) values (
    p_session_id, left(btrim(coalesce(p_lesson_title, '')), 200),
    left(btrim(coalesce(p_learning_summary, '')), 2000),
    left(btrim(coalesce(p_homework_summary, '')), 2000),
    left(btrim(coalesce(p_materials_note, '')), 2000),
    left(btrim(coalesce(p_teacher_public_comment, '')), 2000), null, null
  )
  on conflict(session_id) do update set
    lesson_title = excluded.lesson_title,
    learning_summary = excluded.learning_summary,
    homework_summary = excluded.homework_summary,
    materials_note = excluded.materials_note,
    teacher_public_comment = excluded.teacher_public_comment,
    published_by = null, published_at = null, updated_at = now();
  perform public.mark_session_learning_results_changed(p_session_id, uid);
end
$$;
revoke all on function public.save_session_family_brief(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.save_session_family_brief(uuid,text,text,text,text,text) to authenticated;

create or replace function public.invalidate_family_brief_on_review_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare changed_session_id uuid; actor_id uuid;
begin
  changed_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  actor_id := coalesce(auth.uid(), case when tg_op = 'DELETE' then old.created_by else new.created_by end);
  update public.session_family_briefs
     set published_by = null, published_at = null, updated_at = now()
   where session_id = changed_session_id and published_at is not null;
  perform public.mark_session_learning_results_changed(changed_session_id, actor_id);
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function public.invalidate_family_brief_on_review_change() from public, anon, authenticated;

insert into public.learning_result_heads(
  kind, source_key, student_id, term_id, session_id, status, requires_review,
  published_by, published_at, created_by, created_at, updated_at
)
select 'session_result', review_row.session_id::text || ':' || review_row.student_id::text,
       review_row.student_id, coalesce(review_row.term_id, session_row.term_id), review_row.session_id,
       case when brief_row.family_visibility_state = 'published' then 'published' else 'withdrawn' end,
       false, brief_row.published_by,
       coalesce(brief_row.published_at, brief_row.family_visibility_changed_at),
       review_row.created_by, coalesce(review_row.updated_at, brief_row.updated_at),
       greatest(review_row.updated_at, brief_row.updated_at)
  from public.session_reviews review_row
  join public.class_sessions session_row on session_row.id = review_row.session_id
  join public.session_family_briefs brief_row on brief_row.session_id = review_row.session_id
 where brief_row.family_visibility_state in ('published', 'withdrawn')
   and coalesce(review_row.term_id, session_row.term_id) is not null
on conflict(kind, source_key) do nothing;

insert into public.learning_result_revisions(
  head_id, revision_no, content, dataset, created_by, created_at
)
select head_row.id, 1,
       jsonb_build_object(
         'lessonTitle', brief_row.lesson_title,
         'learningSummary', brief_row.learning_summary,
         'homeworkSummary', brief_row.homework_summary,
         'materialsNote', brief_row.materials_note,
         'teacherPublicComment', brief_row.teacher_public_comment,
         'entryScore', review_row.entry_score, 'exitScore', review_row.exit_score,
         'focus', review_row.focus, 'participation', review_row.participation,
         'mastery', review_row.mastery, 'comment', review_row.comment
       ), '{}'::jsonb, coalesce(brief_row.published_by, review_row.created_by),
       coalesce(brief_row.published_at, brief_row.family_visibility_changed_at, brief_row.updated_at)
  from public.learning_result_heads head_row
  join public.session_reviews review_row
    on review_row.session_id = head_row.session_id and review_row.student_id = head_row.student_id
  join public.session_family_briefs brief_row on brief_row.session_id = head_row.session_id
 where head_row.kind = 'session_result' and head_row.current_revision_id is null;

update public.learning_result_heads head_row
   set current_revision_id = revision_row.id, published_revision_id = revision_row.id
  from public.learning_result_revisions revision_row
 where revision_row.head_id = head_row.id and revision_row.revision_no = 1
   and head_row.kind = 'session_result' and head_row.current_revision_id is null;

create or replace function public.publish_session_family_brief(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); classroom_id uuid; result_term_id uuid;
  brief_row public.session_family_briefs%rowtype; review_item record;
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

  for review_item in
    select review_row.*, coalesce(review_row.term_id, result_term_id) as effective_term_id
      from public.session_reviews review_row
      join public.students student_row on student_row.id = review_row.student_id and student_row.deleted_at is null
     where review_row.session_id = p_session_id
     order by review_row.student_id
  loop
    result_count := result_count + 1;
    if review_item.effective_term_id is null then raise exception 'TERM_NOT_FOUND'; end if;
    snapshot := jsonb_build_object(
      'lessonTitle', brief_row.lesson_title,
      'learningSummary', brief_row.learning_summary,
      'homeworkSummary', brief_row.homework_summary,
      'materialsNote', brief_row.materials_note,
      'teacherPublicComment', brief_row.teacher_public_comment,
      'entryScore', review_item.entry_score, 'exitScore', review_item.exit_score,
      'focus', review_item.focus, 'participation', review_item.participation,
      'mastery', review_item.mastery, 'comment', review_item.comment
    );
    select * into head_row from public.learning_result_heads
     where kind = 'session_result'
       and source_key = p_session_id::text || ':' || review_item.student_id::text for update;
    if not found then
      insert into public.learning_result_heads(
        kind, source_key, student_id, term_id, session_id, status, requires_review, created_by
      ) values (
        'session_result', p_session_id::text || ':' || review_item.student_id::text,
        review_item.student_id, review_item.effective_term_id, p_session_id, 'draft', false, uid
      ) returning * into head_row;
    end if;
    select content into existing_content from public.learning_result_revisions
     where id = head_row.published_revision_id;
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
      head_row.id, revision_id, head_row.status, 'published', 'session result published', uid, true
    );
    changed_count := changed_count + 1;
  end loop;
  if result_count = 0 then raise exception 'REVIEW_NOT_FOUND'; end if;
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

create or replace function public.withdraw_session_learning_results(p_session_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); classroom_id uuid; head_row public.learning_result_heads%rowtype; affected integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'VALIDATION'; end if;
  select session_row.classroom_id into classroom_id from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  for head_row in
    select * from public.learning_result_heads
     where kind = 'session_result' and session_id = p_session_id and status = 'published'
     for update
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
  update public.session_family_briefs set published_by = null, published_at = null where session_id = p_session_id;
  perform public.emit_domain_event(
    'session_family_brief.withdrawn', 'class_session', p_session_id,
    jsonb_build_object('resultCount', affected), null, null
  );
  return affected;
end
$$;
revoke all on function public.withdraw_session_learning_results(uuid,text) from public, anon, authenticated;
grant execute on function public.withdraw_session_learning_results(uuid,text) to authenticated;

create or replace function public.get_my_session_reviews(p_from timestamptz, p_to timestamptz)
returns table(
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, entry_score numeric, exit_score numeric,
  focus smallint, participation smallint, mastery smallint, comment text,
  knowledge_summary text
) language sql security definer stable set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at,
         (revision_row.content ->> 'entryScore')::numeric,
         (revision_row.content ->> 'exitScore')::numeric,
         (revision_row.content ->> 'focus')::smallint,
         (revision_row.content ->> 'participation')::smallint,
         (revision_row.content ->> 'mastery')::smallint,
         coalesce(revision_row.content ->> 'comment', ''),
         coalesce(revision_row.content ->> 'learningSummary', '')
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.class_sessions session_row on session_row.id = head_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'session_result' and head_row.status = 'published'
     and student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'grades')
     )
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
         coalesce(revision_row.content ->> 'teacherPublicComment', ''),
         head_row.published_at
    from public.learning_result_heads head_row
    join public.learning_result_revisions revision_row on revision_row.id = head_row.published_revision_id
    join public.students student_row on student_row.id = head_row.student_id
   where head_row.kind = 'session_result' and head_row.session_id = p_session_id
     and head_row.status = 'published' and student_row.deleted_at is null
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'grades')
     )
   order by head_row.student_id
   limit 1
$$;
revoke all on function public.get_family_session_brief(uuid) from public, anon, authenticated;
grant execute on function public.get_family_session_brief(uuid) to authenticated;

create or replace function public.get_my_session_review_states(
  p_from timestamptz, p_to timestamptz
) returns table(
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, availability_state text
) language sql security definer stable set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at,
         case
           when head_row.status = 'published' then 'published'
           when head_row.status in ('withdrawn', 'revised') then 'withdrawn'
           else 'pending'
         end
    from public.session_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = review_row.student_id
    left join public.learning_result_heads head_row
      on head_row.kind = 'session_result'
     and head_row.source_key = review_row.session_id::text || ':' || review_row.student_id::text
   where student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'grades')
     )
   order by session_row.scheduled_at desc, student_row.id
$$;
revoke all on function public.get_my_session_review_states(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_session_review_states(timestamptz,timestamptz) to authenticated;

commit;
