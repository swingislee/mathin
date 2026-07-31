-- R1-5: administrators may temporarily reopen locked preparation archives through an organization-wide switch.
-- The session courseware snapshot and formal release stay immutable.

begin;

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled',
    'notifications.email',
    'notifications.sms',
    'notifications.wechat',
    'public_content.publish',
    'teaching.preparation_archive_edit'
  ]::text[]
$$;

insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'teaching.preparation_archive_edit', 1, false, now(),
       'R1-5 fail-closed default'
  from public.organizations organization_row
 where organization_row.singleton_key = 1
on conflict do nothing;

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

drop trigger if exists session_preparation_artifacts_locked_guard
  on public.session_preparation_artifacts;
create trigger session_preparation_artifacts_locked_guard
before insert or update or delete on public.session_preparation_artifacts
for each row execute function public.guard_locked_session_preparation_artifact();

create or replace function public.replace_session_learning_checks(p_session_id uuid,p_titles jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid:=auth.uid();
  session_row public.class_sessions%rowtype;
  item jsonb;
  title_value text;
  source_page uuid;
  item_index integer:=0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row from public.class_sessions where id=p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  if session_row.deleted_at is not null
     or (
       (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
       and not public.is_feature_enabled('teaching.preparation_archive_edit')
     )
  then raise exception 'PREPARATION_LOCKED'; end if;
  if jsonb_typeof(p_titles)<>'array' or jsonb_array_length(p_titles)>30 then raise exception 'VALIDATION'; end if;

  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item)='string' then
      title_value:=btrim(item #>> '{}');
      source_page:=null;
    elsif jsonb_typeof(item)='object' then
      title_value:=btrim(coalesce(item->>'title',''));
      begin source_page:=nullif(item->>'sourcePageId','')::uuid;
      exception when invalid_text_representation then raise exception 'VALIDATION'; end;
    else
      raise exception 'VALIDATION';
    end if;
    if length(title_value) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    if source_page is not null and not exists (
      select 1 from public.cw_page_docs page
       where page.id=source_page and page.lecture_id=session_row.lecture_id and page.deleted_at is null
    ) then raise exception 'VALIDATION'; end if;
  end loop;

  if exists (
    select 1 from (
      select nullif(value->>'sourcePageId','') source_id,count(*)
        from jsonb_array_elements(p_titles)
       where jsonb_typeof(value)='object' and nullif(value->>'sourcePageId','') is not null
       group by 1 having count(*)>1
    ) duplicate
  ) then raise exception 'VALIDATION'; end if;

  delete from public.session_learning_checks where session_id=p_session_id;
  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item)='string' then
      title_value:=btrim(item #>> '{}'); source_page:=null;
    else
      title_value:=btrim(item->>'title'); source_page:=nullif(item->>'sourcePageId','')::uuid;
    end if;
    insert into public.session_learning_checks(session_id,position,title,source_page_doc_id,created_by)
    values(p_session_id,item_index,title_value,source_page,uid);
    item_index:=item_index+1;
  end loop;
end
$$;

create or replace function public.save_courseware_annotation(
  p_session_id uuid,
  p_page_doc_id uuid,
  p_content jsonb,
  p_base_version integer default 0
)
returns table(annotation_id uuid, version integer, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  current_row public.courseware_annotations%rowtype;
  valid_content jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         ))
  ) then raise exception 'PREPARATION_LOCKED'; end if;
  if not public.is_session_page_doc(p_session_id, p_page_doc_id) then raise exception 'PAGE_NOT_IN_SESSION'; end if;
  valid_content := public.validate_courseware_annotation_content(coalesce(p_content, '[]'::jsonb));

  select * into current_row
    from public.courseware_annotations annotation
   where annotation.session_id = p_session_id
     and annotation.page_doc_id = p_page_doc_id
     and annotation.user_id = uid
     and annotation.annotation_type = 'board'
   for update;

  if found and current_row.version <> p_base_version then raise exception 'VERSION_CONFLICT'; end if;
  if not found and p_base_version <> 0 then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.courseware_annotations(
    session_id, page_doc_id, user_id, annotation_type, content
  ) values (
    p_session_id, p_page_doc_id, uid, 'board', valid_content
  )
  on conflict(session_id, page_doc_id, user_id, annotation_type) do update set
    content = excluded.content,
    version = public.courseware_annotations.version + 1,
    updated_at = now()
  returning id, public.courseware_annotations.version, public.courseware_annotations.updated_at
    into annotation_id, version, updated_at;
  return next;
end;
$$;

create or replace function public.generate_solution_record_from_board(
  p_session_id uuid,
  p_page_doc_id uuid
)
returns table(solution_record_id uuid, revision integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  annotation_row public.courseware_annotations%rowtype;
  review_revision integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         ))
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  select * into annotation_row
    from public.courseware_annotations annotation
   where annotation.session_id = p_session_id
     and annotation.page_doc_id = p_page_doc_id
     and annotation.user_id = uid
     and annotation.annotation_type = 'board'
   for update;
  if not found or jsonb_array_length(annotation_row.content) = 0 then
    raise exception 'ANNOTATION_REQUIRED';
  end if;

  insert into public.solution_records(
    session_id, solution_source, annotation_id, page_doc_id, content,
    created_by, updated_by
  ) values (
    p_session_id, 'board', annotation_row.id, p_page_doc_id,
    jsonb_build_object(
      'annotationVersion', annotation_row.version,
      'annotationUpdatedAt', annotation_row.updated_at,
      'strokes', annotation_row.content
    ), uid, uid
  )
  on conflict(annotation_id) where solution_source = 'board' do update set
    content = excluded.content,
    revision = public.solution_records.revision + 1,
    updated_by = uid,
    updated_at = now()
  returning id, public.solution_records.revision
    into solution_record_id, revision;

  insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
    values(p_session_id, 'solution', uid)
  on conflict(session_id, artifact_kind) do update set
    status = 'pending', revision = public.session_preparation_reviews.revision + 1,
    submitted_by = uid, submitted_at = now(), reviewed_by = null,
    reviewed_at = null, review_note = ''
  returning public.session_preparation_reviews.revision into review_revision;
  perform public.notify_session_preparation_reviewers(p_session_id, 'solution', review_revision, uid);
  return next;
end;
$$;

create or replace function public.save_session_lesson_plan(
  p_session_id uuid,
  p_template_version text,
  p_content jsonb,
  p_base_revision integer default 0
)
returns table(lesson_plan_id uuid, revision integer, status text, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  current_row public.lesson_plans%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_template_version, '') <> 'mathin-teaching-plan-v1'
     or jsonb_typeof(p_content) <> 'array'
     or octet_length(p_content::text) > 524288 then
    raise exception 'VALIDATION';
  end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         ))
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  select * into current_row from public.lesson_plans plan
   where plan.session_id = p_session_id for update;
  if found and current_row.revision <> p_base_revision then raise exception 'VERSION_CONFLICT'; end if;
  if not found and p_base_revision <> 0 then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.lesson_plans(
    session_id, template_version, content, status, revision, created_by, updated_by
  ) values (
    p_session_id, p_template_version, p_content, 'draft', 1, uid, uid
  )
  on conflict(session_id) do update set
    template_version = excluded.template_version,
    content = excluded.content,
    status = 'draft',
    revision = public.lesson_plans.revision + 1,
    updated_by = uid,
    updated_at = now()
  returning id, public.lesson_plans.revision, public.lesson_plans.status, public.lesson_plans.updated_at
    into lesson_plan_id, revision, status, updated_at;

  -- Editing invalidates the submitted lesson-plan package. A later explicit
  -- submit creates the next review revision for the current document/files.
  delete from public.session_preparation_reviews
   where session_id = p_session_id and artifact_kind = 'lesson_plan';
  return next;
end;
$$;

create or replace function public.submit_session_lesson_plan(
  p_session_id uuid,
  p_revision integer
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  plan_row public.lesson_plans%rowtype;
  review_revision integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into plan_row from public.lesson_plans plan
   where plan.session_id = p_session_id for update;
  if not found then raise exception 'LESSON_PLAN_REQUIRED'; end if;
  if plan_row.revision <> p_revision then raise exception 'VERSION_CONFLICT'; end if;
  if jsonb_array_length(plan_row.content) = 0 then raise exception 'LESSON_PLAN_REQUIRED'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         ))
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  update public.lesson_plans set status = 'pending', updated_by = uid, updated_at = now()
   where id = plan_row.id;
  insert into public.session_preparation_reviews(
    session_id, artifact_kind, status, revision, submitted_by
  ) values (
    p_session_id, 'lesson_plan', 'pending', greatest(plan_row.revision, 1), uid
  )
  on conflict(session_id, artifact_kind) do update set
    status = 'pending', revision = greatest(public.session_preparation_reviews.revision + 1, plan_row.revision),
    submitted_by = uid, submitted_at = now(), reviewed_by = null,
    reviewed_at = null, review_note = ''
  returning revision into review_revision;
  perform public.notify_session_preparation_reviewers(p_session_id, 'lesson_plan', review_revision, uid);
  return review_revision;
end;
$$;

create or replace function public.save_lesson_page_note(
  p_session_id uuid,
  p_page_doc_id uuid,
  p_content text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  plan_id uuid;
  normalized text := btrim(coalesce(p_content, ''));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if length(normalized) > 5000 then raise exception 'VALIDATION'; end if;
  if not public.is_session_page_doc(p_session_id, p_page_doc_id) then raise exception 'PAGE_NOT_IN_SESSION'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled('teaching.preparation_archive_edit')
         ))
  ) then raise exception 'PREPARATION_LOCKED'; end if;
  select plan.id into plan_id from public.lesson_plans plan where plan.session_id = p_session_id;
  if plan_id is null then raise exception 'LESSON_PLAN_REQUIRED'; end if;

  if normalized = '' then
    delete from public.lesson_page_notes note
     where note.lesson_plan_id = plan_id and note.page_doc_id = p_page_doc_id;
    return;
  end if;
  insert into public.lesson_page_notes(
    lesson_plan_id, page_doc_id, content, created_by, updated_by
  ) values (plan_id, p_page_doc_id, normalized, uid, uid)
  on conflict(lesson_plan_id, page_doc_id) do update set
    content = excluded.content, updated_by = uid, updated_at = now();
end;
$$;

-- These review-workflow RPCs were introduced by the adjacent doc 26
-- migrations. Keeping the rewrite conditional makes this migration safe in
-- a partial development checkout while a full rebuild still updates them.
do $migration$
declare
  target_function regprocedure;
  original_definition text;
  unlocked_definition text;
begin
  foreach target_function in array array[
    to_regprocedure('public.set_session_preparation_reviewer(uuid,uuid)'),
    to_regprocedure('public.withdraw_session_lesson_plan(uuid)')
  ]
  loop
    continue when target_function is null;
    original_definition := pg_get_functiondef(target_function);
    continue when position('teaching.preparation_archive_edit' in original_definition) > 0;
    unlocked_definition := regexp_replace(
      original_definition,
      'session_row\.deleted_at is not null[[:space:]]+or session_row\.courseware_frozen_at is not null[[:space:]]+or session_row\.started_at is not null',
      'session_row.deleted_at is not null
         or (
           (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
           and not public.is_feature_enabled(''teaching.preparation_archive_edit'')
         )',
      'g'
    );
    if unlocked_definition = original_definition then
      raise exception 'PREPARATION_GUARD_NOT_FOUND: %', target_function;
    end if;
    execute unlocked_definition;
  end loop;
end;
$migration$;

revoke all on function public.guard_locked_session_preparation_artifact() from public, anon, authenticated;

comment on function public.organization_feature_keys() is
  'Organization-wide fail-closed feature keys, including the temporary preparation-archive edit switch.';
comment on function public.guard_locked_session_preparation_artifact() is
  'Keeps frozen/started session preparation artifacts immutable unless the administrator switch is effective.';

commit;
