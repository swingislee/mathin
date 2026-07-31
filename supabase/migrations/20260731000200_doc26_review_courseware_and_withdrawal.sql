-- Doc 26 follow-up: reviewers need the session courseware beside preparation
-- artifacts, and lesson-plan submitters need an explicit pending-review
-- withdrawal before they continue editing.

begin;

create function public.get_session_preparation_review_courseware(p_session_id uuid)
returns table(
  classroom_id uuid,
  lecture_id uuid,
  courseware_frozen_at timestamptz,
  courseware jsonb,
  courseware_template jsonb,
  courseware_overlay jsonb
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select session_row.classroom_id,
         session_row.lecture_id,
         session_row.courseware_frozen_at,
         coalesce(session_row.courseware, '[]'::jsonb),
         coalesce(lecture.courseware_template, '[]'::jsonb),
         coalesce(session_row.courseware_overlay, '[]'::jsonb)
    from public.class_sessions session_row
    left join public.course_lectures lecture on lecture.id = session_row.lecture_id
   where session_row.id = p_session_id
     and session_row.deleted_at is null;

  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
end;
$$;

create function public.get_session_preparation_review_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no int, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  session_lecture_id uuid;
  release_id uuid;
  release_snapshot jsonb;
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  select session_row.courseware_resolved, session_row.lecture_id
    into resolved, session_lecture_id
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null
     and resolved ->> 'version' = 'cw-session-resolved-v1'
     and (resolved ->> 'releaseId') ~ '^[0-9a-f-]{36}$' then
    release_id := (resolved ->> 'releaseId')::uuid;
  elsif session_lecture_id is not null then
    select lecture.current_release_id into release_id
      from public.course_lectures lecture
     where lecture.id = session_lecture_id;
  end if;
  if release_id is null then return; end if;

  select release.snapshot into release_snapshot
    from public.cw_lecture_releases release
   where release.id = release_id;
  if release_snapshot is null then return; end if;

  return query
  select page.id,
         page.page_no,
         revision.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'bindingKey', binding ->> 'bindingKey',
                    'objectHash', object.sha256,
                    'kind', object.kind,
                    'launchQuery', page_binding.launch_query))
             from jsonb_array_elements(entry.value -> 'bindings') as binding
             join public.cw_asset_revisions asset_revision
               on asset_revision.id = (binding ->> 'assetRevisionId')::uuid
             join public.cw_asset_objects object on object.id = asset_revision.object_id
             left join public.cw_page_asset_bindings page_binding
               on page_binding.page_doc_id = page.id
              and page_binding.binding_key = binding ->> 'bindingKey'
         ), '[]'::jsonb)
    from jsonb_array_elements(release_snapshot) as entry
    join public.cw_page_docs page on page.id = (entry.value ->> 'pageDocId')::uuid
    join public.cw_page_revisions revision on revision.id = (entry.value ->> 'revisionId')::uuid
   order by page.page_no;
end;
$$;

create function public.list_session_preparation_review_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  session_lecture_id uuid;
  release_snapshot jsonb;
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  select session_row.courseware_resolved, session_row.lecture_id
    into resolved, session_lecture_id
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null and resolved ->> 'version' = 'cw-session-resolved-v1' then
    return query
    with hashes as (
      select distinct binding ->> 'objectHash' as sha256
        from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) as binding
       where jsonb_typeof(binding) = 'object'
         and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
    )
    select object.sha256, object.storage_path, object.kind
      from hashes
      join public.cw_asset_objects object on object.sha256 = hashes.sha256
     where object.kind <> 'h5'
     order by object.sha256;
    return;
  end if;

  if session_lecture_id is null then return; end if;
  select release.snapshot into release_snapshot
    from public.cw_lecture_releases release
    join public.course_lectures lecture on lecture.current_release_id = release.id
   where lecture.id = session_lecture_id;
  if release_snapshot is null then return; end if;

  return query
  select distinct object.sha256, object.storage_path, object.kind
    from jsonb_array_elements(release_snapshot) as entry,
         jsonb_array_elements(entry.value -> 'bindings') as binding
    join public.cw_asset_revisions asset_revision
      on asset_revision.id = (binding ->> 'assetRevisionId')::uuid
    join public.cw_asset_objects object on object.id = asset_revision.object_id
   where object.kind <> 'h5'
   order by object.sha256;
end;
$$;

create function public.withdraw_session_lesson_plan(p_session_id uuid)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  review_row public.session_preparation_reviews%rowtype;
  plan_revision integer;
  reviewer_id uuid;
  session_title text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1
      from public.class_sessions session_row
     where session_row.id = p_session_id
       and (
         session_row.deleted_at is not null
         or session_row.courseware_frozen_at is not null
         or session_row.started_at is not null
       )
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  select * into review_row
    from public.session_preparation_reviews review
   where review.session_id = p_session_id
     and review.artifact_kind = 'lesson_plan'
   for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if review_row.status <> 'pending' then raise exception 'REVIEW_ALREADY_DECIDED'; end if;
  if review_row.submitted_by <> uid then raise exception 'FORBIDDEN'; end if;

  delete from public.session_preparation_reviews review
   where review.session_id = p_session_id
     and review.artifact_kind = 'lesson_plan';

  update public.lesson_plans plan
     set status = 'draft',
         updated_by = uid,
         updated_at = now()
   where plan.session_id = p_session_id
  returning plan.revision into plan_revision;
  if plan_revision is null then raise exception 'LESSON_PLAN_REQUIRED'; end if;

  select preparation.reviewer_id into reviewer_id
    from public.session_preparations preparation
   where preparation.session_id = p_session_id;
  if reviewer_id is not null and reviewer_id <> uid then
    select classroom.name || ' · ' || session_row.title into session_title
      from public.class_sessions session_row
      join public.classrooms classroom on classroom.id = session_row.classroom_id
     where session_row.id = p_session_id;
    perform public.emit_domain_event(
      'session.preparation.withdrawn',
      'class_session',
      p_session_id,
      jsonb_build_object(
        'title', session_title,
        'artifactKind', 'lesson_plan',
        'revision', review_row.revision
      ),
      reviewer_id,
      '/dashboard/courseware/preparation-review?sessionId=' || p_session_id::text
    );
  end if;

  return plan_revision;
end;
$$;

revoke all on function public.get_session_preparation_review_courseware(uuid) from public, anon, authenticated;
revoke all on function public.get_session_preparation_review_page_docs(uuid) from public, anon, authenticated;
revoke all on function public.list_session_preparation_review_resolved_assets(uuid) from public, anon, authenticated;
revoke all on function public.withdraw_session_lesson_plan(uuid) from public, anon, authenticated;
grant execute on function public.get_session_preparation_review_courseware(uuid) to authenticated;
grant execute on function public.get_session_preparation_review_page_docs(uuid) to authenticated;
grant execute on function public.list_session_preparation_review_resolved_assets(uuid) to authenticated;
grant execute on function public.withdraw_session_lesson_plan(uuid) to authenticated;

commit;
