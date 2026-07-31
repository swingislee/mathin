-- R1: the administrator switch amends one session's frozen teaching archive.
-- It never edits the source courseware document or a published release.

begin;

create or replace function public.guard_locked_session_preparation_artifact()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  target_session_id uuid;
begin
  target_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  if exists (
    select 1
      from public.class_sessions session_row
     where session_row.id = target_session_id
       and (
         session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         )
       )
  ) then
    raise exception 'PREPARATION_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Lesson plans and their review lifecycle remain amendable because post-class
-- reflection is part of the lesson plan. The session reviewer and retired page
-- notes remain locked after freeze.
do $migration$
declare
  target_function regprocedure;
  original_definition text;
  amended_definition text;
begin
  foreach target_function in array array[
    to_regprocedure('public.save_session_lesson_plan(uuid,text,jsonb,integer)'),
    to_regprocedure('public.submit_session_lesson_plan(uuid,integer)'),
    to_regprocedure('public.withdraw_session_lesson_plan(uuid)')
  ]
  loop
    continue when target_function is null;
    original_definition := pg_get_functiondef(target_function);
    continue when position('teaching.preparation_archive_edit' in original_definition) > 0;
    amended_definition := regexp_replace(
      original_definition,
      '\(session_row\.courseware_frozen_at is not null or session_row\.started_at is not null\)',
      '((session_row.courseware_frozen_at is not null or session_row.started_at is not null) and not public.is_feature_enabled(''teaching.preparation_archive_edit''))',
      'gi'
    );
    if amended_definition = original_definition then
      raise exception 'PREPARATION_GUARD_NOT_FOUND: %', target_function;
    end if;
    execute amended_definition;
  end loop;

  foreach target_function in array array[
    to_regprocedure('public.save_lesson_page_note(uuid,uuid,text)'),
    to_regprocedure('public.set_session_preparation_reviewer(uuid,uuid)')
  ]
  loop
    continue when target_function is null;
    original_definition := pg_get_functiondef(target_function);
    continue when position('teaching.preparation_archive_edit' in original_definition) = 0;
    amended_definition := regexp_replace(
      original_definition,
      '\([[:space:]]*\(session_row\.courseware_frozen_at is not null or session_row\.started_at is not null\)[[:space:]]*and not public\.is_feature_enabled\(''teaching\.preparation_archive_edit''(::text)?\)[[:space:]]*\)',
      '(session_row.courseware_frozen_at is not null or session_row.started_at is not null)',
      'gi'
    );
    if amended_definition = original_definition then
      raise exception 'PREPARATION_UNLOCK_GUARD_NOT_FOUND: %', target_function;
    end if;
    execute amended_definition;
  end loop;
end;
$migration$;

create or replace function public.amend_session_courseware_snapshot(
  p_session_id uuid,
  p_courseware jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  page_item jsonb;
  page_type text;
  page_id uuid;
  page_doc_id uuid;
  page_path text;
  page_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not public.is_feature_enabled('teaching.preparation_archive_edit') then
    raise exception 'PREPARATION_LOCKED';
  end if;

  select * into session_row
    from public.class_sessions
   where id = p_session_id and deleted_at is null
   for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if session_row.courseware_frozen_at is null then raise exception 'SESSION_NOT_FROZEN'; end if;

  if jsonb_typeof(p_courseware) is distinct from 'array'
     or jsonb_array_length(p_courseware) > 200
     or octet_length(p_courseware::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE';
  end if;

  for page_item in select value from jsonb_array_elements(p_courseware)
  loop
    if jsonb_typeof(page_item) is distinct from 'object'
       or length(btrim(coalesce(page_item->>'title', ''))) not between 1 and 100 then
      raise exception 'INVALID_COURSEWARE';
    end if;
    begin
      page_id := (page_item->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'INVALID_COURSEWARE';
    end;
    page_type := page_item->>'type';
    if page_type not in ('doc', 'image', 'video', 'game', 'board') then
      raise exception 'INVALID_COURSEWARE';
    end if;

    if page_type = 'doc' then
      begin
        page_doc_id := (page_item->>'docId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_COURSEWARE';
      end;
      if session_row.lecture_id is null or not exists (
        select 1 from public.cw_page_docs page_doc
         where page_doc.id = page_doc_id
           and page_doc.lecture_id = session_row.lecture_id
           and page_doc.deleted_at is null
      ) then
        raise exception 'INVALID_COURSEWARE';
      end if;
    elsif page_type in ('image', 'video') then
      page_path := btrim(coalesce(page_item->>'path', ''));
      if length(page_path) not between 1 and 500
         or (
           page_path not like session_row.classroom_id::text || '/%'
           and not exists (
             select 1
               from jsonb_array_elements(coalesce(session_row.courseware, '[]'::jsonb)) existing(value)
              where existing.value->>'id' = page_id::text
                and existing.value->>'type' = page_type
                and existing.value->>'path' = page_path
           )
         ) then
        raise exception 'INVALID_COURSEWARE';
      end if;
    elsif page_type = 'game' then
      if length(btrim(coalesce(page_item->>'gameId', ''))) not between 1 and 50
         or page_item->>'difficulty' not in ('easy', 'medium', 'hard')
         or length(btrim(coalesce(page_item->>'seed', ''))) not between 1 and 100 then
        raise exception 'INVALID_COURSEWARE';
      end if;
    end if;
  end loop;

  if exists (
    select 1
      from jsonb_array_elements(p_courseware) page(value)
     group by page.value->>'id'
    having count(*) > 1
  ) then
    raise exception 'INVALID_COURSEWARE';
  end if;

  page_count := jsonb_array_length(p_courseware);
  update public.class_sessions
     set courseware = p_courseware,
         courseware_overlay = coalesce((
           select jsonb_agg(jsonb_build_object('page', page.value) order by page.position)
             from jsonb_array_elements(p_courseware) with ordinality page(value, position)
         ), '[]'::jsonb),
         current_page = least(current_page, greatest(page_count - 1, 0))
   where id = p_session_id;

  delete from public.session_learning_checks check_row
   where check_row.session_id = p_session_id
     and check_row.source_page_doc_id is not null
     and not exists (
       select 1
         from jsonb_array_elements(p_courseware) page(value)
        where page.value->>'type' = 'doc'
          and page.value->>'docId' = check_row.source_page_doc_id::text
     );

  perform public.emit_domain_event(
    'session.courseware.snapshot.amended',
    'class_session',
    p_session_id,
    jsonb_build_object(
      'previousPageCount', jsonb_array_length(coalesce(session_row.courseware, '[]'::jsonb)),
      'pageCount', page_count,
      'startedAt', session_row.started_at,
      'endedAt', session_row.ended_at
    ),
    null,
    '/dashboard/sessions/' || p_session_id::text || '?stage=pre'
  );
end;
$$;

revoke all on function public.guard_locked_session_preparation_artifact()
  from public, anon, authenticated;
revoke all on function public.amend_session_courseware_snapshot(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.amend_session_courseware_snapshot(uuid, jsonb)
  to authenticated;

comment on function public.guard_locked_session_preparation_artifact() is
  'Keeps frozen or started session preparation artifacts immutable unless the administrator enables session archive amendments.';
comment on function public.amend_session_courseware_snapshot(uuid, jsonb) is
  'Amends only the frozen page composition of one session; published courseware releases and source documents remain unchanged.';

commit;
