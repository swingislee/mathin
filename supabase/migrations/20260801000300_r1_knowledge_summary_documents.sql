-- R1-6: BlockNote knowledge-summary drafts with optimistic autosave and immutable publication snapshots.
begin;

alter table public.session_family_briefs
  add column if not exists document jsonb not null default '[]'::jsonb,
  add column if not exists template_version text not null default 'mathin-knowledge-summary-v1',
  add column if not exists revision integer not null default 0;

alter table public.session_family_briefs
  drop constraint if exists session_family_briefs_document_array,
  drop constraint if exists session_family_briefs_template_version_length,
  drop constraint if exists session_family_briefs_revision_nonnegative;
alter table public.session_family_briefs
  add constraint session_family_briefs_document_array check (jsonb_typeof(document) = 'array'),
  add constraint session_family_briefs_template_version_length check (char_length(template_version) between 1 and 100),
  add constraint session_family_briefs_revision_nonnegative check (revision >= 0);

-- Convert existing text drafts into a valid BlockNote paragraph without changing publication history.
update public.session_family_briefs brief_row
   set document = jsonb_build_array(
         jsonb_build_object(
           'type', 'paragraph',
           'props', '{}'::jsonb,
           'content', jsonb_build_array(jsonb_build_object(
             'type', 'text', 'text', concat_ws(E'\n\n',
               nullif(brief_row.learning_summary, ''),
               nullif(brief_row.homework_summary, ''),
               nullif(brief_row.materials_note, ''),
               nullif(brief_row.teacher_public_comment, '')
             ),
             'styles', '{}'::jsonb
           )),
           'children', '[]'::jsonb
         )
       ),
       revision = greatest(brief_row.revision, 1)
 where brief_row.document = '[]'::jsonb
   and concat_ws('', brief_row.learning_summary, brief_row.homework_summary,
                 brief_row.materials_note, brief_row.teacher_public_comment) <> '';

create or replace function public.save_session_knowledge_summary(
  p_session_id uuid,
  p_lesson_title text,
  p_document jsonb,
  p_template_version text,
  p_base_revision integer,
  p_plain_text text
)
returns table(result_revision integer, result_status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result_classroom_id uuid;
  brief_row public.session_family_briefs%rowtype;
  next_revision integer;
  status_value text := 'draft';
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id into result_classroom_id
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if result_classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(result_classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_document) is distinct from 'array'
     or pg_column_size(p_document) > 1048576
     or char_length(coalesce(p_template_version, '')) not between 1 and 100
     or p_base_revision is null or p_base_revision < 0
     or char_length(coalesce(p_lesson_title, '')) > 200
     or char_length(coalesce(p_plain_text, '')) > 50000 then
    raise exception 'VALIDATION';
  end if;

  select * into brief_row
    from public.session_family_briefs
   where session_id = p_session_id
   for update;

  if found then
    if brief_row.revision <> p_base_revision then raise exception 'VERSION_CONFLICT'; end if;
    if brief_row.lesson_title = btrim(coalesce(p_lesson_title, ''))
       and brief_row.document = p_document
       and brief_row.template_version = p_template_version then
      next_revision := brief_row.revision;
    else
      next_revision := brief_row.revision + 1;
      update public.session_family_briefs
         set lesson_title = btrim(coalesce(p_lesson_title, '')),
             learning_summary = btrim(coalesce(p_plain_text, '')),
             homework_summary = '', materials_note = '', teacher_public_comment = '',
             document = p_document,
             template_version = p_template_version,
             revision = next_revision,
             published_by = null, published_at = null,
             family_visibility_state = 'pending', family_visibility_changed_at = now()
       where session_id = p_session_id;
      perform public.mark_session_result_kind_changed(p_session_id, 'knowledge_summary', uid);
    end if;
  else
    if p_base_revision <> 0 then raise exception 'VERSION_CONFLICT'; end if;
    next_revision := 1;
    insert into public.session_family_briefs(
      session_id, lesson_title, learning_summary, homework_summary, materials_note,
      teacher_public_comment, document, template_version, revision,
      published_by, published_at, family_visibility_state, family_visibility_changed_at
    ) values (
      p_session_id, btrim(coalesce(p_lesson_title, '')), btrim(coalesce(p_plain_text, '')),
      '', '', '', p_document, p_template_version, next_revision,
      null, null, 'pending', now()
    );
  end if;

  select case
           when bool_or(head_row.status = 'revised') then 'revised'
           when bool_or(head_row.status = 'withdrawn') then 'withdrawn'
           when bool_or(head_row.status = 'published') then 'published'
           else 'draft'
         end
    into status_value
    from public.learning_result_heads head_row
   where head_row.kind = 'knowledge_summary' and head_row.session_id = p_session_id;

  return query select next_revision, coalesce(status_value, 'draft');
end
$$;
revoke all on function public.save_session_knowledge_summary(uuid,text,jsonb,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.save_session_knowledge_summary(uuid,text,jsonb,text,integer,text) to authenticated;

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
  if btrim(brief_row.lesson_title) = '' or btrim(brief_row.learning_summary) = ''
     or jsonb_typeof(brief_row.document) is distinct from 'array'
     or jsonb_array_length(brief_row.document) = 0 then raise exception 'VALIDATION'; end if;
  snapshot := jsonb_build_object(
    'lessonTitle', brief_row.lesson_title,
    'document', brief_row.document,
    'templateVersion', brief_row.template_version,
    'learningSummary', brief_row.learning_summary,
    'homeworkSummary', '', 'materialsNote', '', 'teacherPublicComment', ''
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
     set published_by = uid,
         published_at = case when changed_count > 0 then now() else coalesce(published_at, now()) end,
         family_visibility_state = 'published', family_visibility_changed_at = now()
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

drop function if exists public.get_my_knowledge_summaries_v2(timestamptz,timestamptz);

create or replace function public.get_my_knowledge_summaries_v2(p_from timestamptz, p_to timestamptz)
returns table(
  head_id uuid, session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, lesson_title text, document jsonb,
  template_version text, learning_summary text, homework_summary text, materials_note text,
  teacher_public_comment text, published_at timestamptz
) language sql security definer stable set search_path = public, pg_temp
as $$
  select head_row.id, session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at,
         coalesce(revision_row.content ->> 'lessonTitle', ''),
         case
           when jsonb_typeof(revision_row.content -> 'document') = 'array' then revision_row.content -> 'document'
           when coalesce(revision_row.content ->> 'learningSummary', '') <> '' then jsonb_build_array(
             jsonb_build_object(
               'type', 'paragraph', 'props', '{}'::jsonb,
               'content', jsonb_build_array(jsonb_build_object(
                 'type', 'text', 'text', revision_row.content ->> 'learningSummary', 'styles', '{}'::jsonb
               )),
               'children', '[]'::jsonb
             )
           )
           else '[]'::jsonb
         end,
         coalesce(revision_row.content ->> 'templateVersion', 'legacy-text-v1'),
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
revoke all on function public.get_my_knowledge_summaries_v2(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_knowledge_summaries_v2(timestamptz,timestamptz) to authenticated;

comment on function public.save_session_knowledge_summary(uuid,text,jsonb,text,integer,text)
  is 'Optimistic autosave for a BlockNote knowledge-summary draft; independent from per-student reviews.';
comment on function public.get_my_knowledge_summaries_v2(timestamptz,timestamptz)
  is 'Customer-safe published BlockNote knowledge-summary snapshots.';

commit;