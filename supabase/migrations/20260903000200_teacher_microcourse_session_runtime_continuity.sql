-- Keep every session-side consumer on the same courseware page set.
-- Free sessions use the selected teacher/research microcourse instead of a
-- formal class_sessions.lecture_id, so lecture-only membership checks make
-- learning checks, annotations, rehearsal, review, and freeze diverge.

begin;

create or replace function public.resolve_session_courseware_page_snapshot(
  p_session_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  session_row record;
  context record;
  microcourse_lecture uuid;
  snapshot_value jsonb;
begin
  select session.lecture_id,
         session.courseware_resolved,
         session.selected_teacher_microcourse_id,
         session.courseware_frozen_at
    into session_row
    from public.class_sessions session
   where session.id = p_session_id
     and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  -- A frozen teacher-microcourse session owns immutable revision pins here.
  if jsonb_typeof(session_row.courseware_resolved #> '{microcourseDraft,pages}') = 'array' then
    return session_row.courseware_resolved #> '{microcourseDraft,pages}';
  end if;

  -- Before class starts, every consumer follows the selected proposal's live
  -- native head. Completing preparation does not pin this head; class start does.
  if session_row.courseware_frozen_at is null
     and session_row.selected_teacher_microcourse_id is not null then
    select microcourse.lecture_id
      into microcourse_lecture
      from public.teacher_microcourses microcourse
     where microcourse.id = session_row.selected_teacher_microcourse_id
       and microcourse.source_session_id = p_session_id;
    if not found then raise exception 'SELECTED_MICROCOURSE_SESSION_MISMATCH'; end if;
    return coalesce(
      public.build_cw_track_snapshot(microcourse_lecture, 'native-16x9'),
      '[]'::jsonb
    );
  end if;

  select * into context
    from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return '[]'::jsonb; end if;

  select release.snapshot
    into snapshot_value
    from public.cw_lecture_releases release
   where release.id = context.release_id
     and release.lecture_id = context.lecture_id
     and release.track = context.track;
  if snapshot_value is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  if jsonb_typeof(snapshot_value) is distinct from 'array' then
    raise exception 'INVALID_COURSEWARE_SNAPSHOT';
  end if;
  return snapshot_value;
end;
$$;

revoke all on function public.resolve_session_courseware_page_snapshot(uuid)
  from public, anon, authenticated;

create or replace function public.cw_session_selected_courseware_template(
  p_session_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  session_lecture uuid;
  selected_track text;
  selected_release uuid;
  snapshot_value jsonb;
  result jsonb;
begin
  select session.lecture_id,
         coalesce(session.courseware_track_override, classroom.courseware_track)
    into session_lecture, selected_track
    from public.class_sessions session
    join public.classrooms classroom on classroom.id = session.classroom_id
   where session.id = p_session_id
     and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if session_lecture is null then
    snapshot_value := public.resolve_session_courseware_page_snapshot(p_session_id);
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', page_row.id,
      'type', 'doc',
      'docId', page_row.id,
      'title', page_row.title
    ) order by entry.ordinality), '[]'::jsonb)
      into result
      from jsonb_array_elements(coalesce(snapshot_value, '[]'::jsonb))
        with ordinality entry(value, ordinality)
      join public.cw_page_docs page_row
        on page_row.id = (entry.value ->> 'pageDocId')::uuid;
    return result;
  end if;

  select head.current_release_id
    into selected_release
    from public.cw_lecture_track_heads head
   where head.lecture_id = session_lecture
     and head.track = selected_track;
  if selected_release is not null then
    select release.courseware_pages
      into result
      from public.cw_lecture_releases release
     where release.id = selected_release
       and release.lecture_id = session_lecture
       and release.track = selected_track;
  else
    select lecture.courseware_template
      into result
      from public.course_lectures lecture
     where lecture.id = session_lecture;
  end if;
  if jsonb_typeof(result) is distinct from 'array' then
    raise exception 'INVALID_COURSEWARE_TEMPLATE';
  end if;
  return result;
end;
$$;

create or replace function public.get_session_courseware_learning_check_pages(
  p_session_id uuid
)
returns table(
  page_doc_id uuid,
  page_no integer,
  title text,
  learning_check_enabled boolean
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  frozen_at timestamptz;
  frozen_courseware jsonb;
  snapshot_value jsonb;
  template_value jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  select session.courseware_frozen_at, session.courseware
    into frozen_at, frozen_courseware
    from public.class_sessions session
   where session.id = p_session_id
     and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  snapshot_value := public.resolve_session_courseware_page_snapshot(p_session_id);
  template_value := case
    when frozen_at is not null then coalesce(frozen_courseware, '[]'::jsonb)
    else public.cw_session_selected_courseware_template(p_session_id)
  end;

  return query
  with snapshot_rows as (
    select (entry.value ->> 'pageDocId')::uuid as page_id,
           entry.ordinality::integer as ordinal,
           coalesce((entry.value ->> 'learningCheckEnabled')::boolean, false) as enabled
      from jsonb_array_elements(coalesce(snapshot_value, '[]'::jsonb))
        with ordinality entry(value, ordinality)
  )
  select snapshot_rows.page_id,
         snapshot_rows.ordinal,
         coalesce(
           nullif(btrim((
             select template_entry.value ->> 'title'
               from jsonb_array_elements(coalesce(template_value, '[]'::jsonb)) template_entry(value)
              where template_entry.value ->> 'type' = 'doc'
                and template_entry.value ->> 'docId' = snapshot_rows.page_id::text
              limit 1
           )), ''),
           nullif(btrim(page_row.title), ''),
           page_row.id::text
         ),
         snapshot_rows.enabled
    from snapshot_rows
    join public.cw_page_docs page_row on page_row.id = snapshot_rows.page_id
   order by snapshot_rows.ordinal;
end;
$$;

revoke all on function public.get_session_courseware_learning_check_pages(uuid)
  from public, anon, authenticated;
grant execute on function public.get_session_courseware_learning_check_pages(uuid)
  to authenticated;

create or replace function public.is_session_page_doc(
  p_session_id uuid,
  p_page_doc_id uuid
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from jsonb_array_elements(
        public.resolve_session_courseware_page_snapshot(p_session_id)
      ) entry(value)
     where entry.value ->> 'pageDocId' = p_page_doc_id::text
  );
$$;

create or replace function public.replace_session_learning_checks(
  p_session_id uuid,
  p_titles jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  page_snapshot jsonb;
  item jsonb;
  title_value text;
  source_page uuid;
  item_index integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row
    from public.class_sessions
   where id = p_session_id
   for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if session_row.deleted_at is not null
     or (
       (session_row.courseware_frozen_at is not null or session_row.started_at is not null)
       and not public.is_feature_enabled('teaching.preparation_archive_edit')
     ) then
    raise exception 'PREPARATION_LOCKED';
  end if;
  if jsonb_typeof(p_titles) <> 'array' or jsonb_array_length(p_titles) > 30 then
    raise exception 'VALIDATION';
  end if;

  page_snapshot := public.resolve_session_courseware_page_snapshot(p_session_id);
  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item) = 'string' then
      title_value := btrim(item #>> '{}');
      source_page := null;
    elsif jsonb_typeof(item) = 'object' then
      title_value := btrim(coalesce(item ->> 'title', ''));
      begin
        source_page := nullif(item ->> 'sourcePageId', '')::uuid;
      exception when invalid_text_representation then
        raise exception 'VALIDATION';
      end;
    else
      raise exception 'VALIDATION';
    end if;
    if length(title_value) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    if source_page is not null and not exists (
      select 1
        from jsonb_array_elements(page_snapshot) entry(value)
       where entry.value ->> 'pageDocId' = source_page::text
    ) then
      raise exception 'VALIDATION';
    end if;
  end loop;

  if exists (
    select 1
      from (
        select nullif(value ->> 'sourcePageId', '') source_id, count(*)
          from jsonb_array_elements(p_titles)
         where jsonb_typeof(value) = 'object'
           and nullif(value ->> 'sourcePageId', '') is not null
         group by 1
        having count(*) > 1
      ) duplicate
  ) then raise exception 'VALIDATION'; end if;

  delete from public.session_learning_checks where session_id = p_session_id;
  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item) = 'string' then
      title_value := btrim(item #>> '{}');
      source_page := null;
    else
      title_value := btrim(item ->> 'title');
      source_page := nullif(item ->> 'sourcePageId', '')::uuid;
    end if;
    insert into public.session_learning_checks(
      session_id, position, title, source_page_doc_id, created_by
    ) values (
      p_session_id, item_index, title_value, source_page, uid
    );
    item_index := item_index + 1;
  end loop;

  update public.class_sessions
     set learning_checks_configured_at = coalesce(learning_checks_configured_at, now())
   where id = p_session_id;
end;
$$;

create or replace function public.save_session_prepared_courseware(
  p_session_id uuid,
  p_courseware jsonb,
  p_courseware_resolved jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  started timestamptz;
  expected_release uuid;
  expected_track text;
  session_lecture uuid;
  selected_microcourse uuid;
  session_overlay jsonb;
  expected_courseware jsonb;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_courseware) is distinct from 'array'
     or octet_length(p_courseware::text) > 1048576
     or jsonb_typeof(p_courseware_resolved) is distinct from 'object'
     or p_courseware_resolved ->> 'version' is distinct from 'cw-session-resolved-v1'
     or jsonb_typeof(p_courseware_resolved -> 'bindings') is distinct from 'array'
     or octet_length(p_courseware_resolved::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE_FREEZE';
  end if;

  select session.started_at,
         session.lecture_id,
         session.selected_teacher_microcourse_id,
         session.courseware_overlay,
         coalesce(session.courseware_track_override, classroom.courseware_track)
    into started, session_lecture, selected_microcourse, session_overlay, expected_track
    from public.class_sessions session
    join public.classrooms classroom on classroom.id = session.classroom_id
   where session.id = p_session_id
     and session.deleted_at is null
   for update of session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if started is not null then raise exception 'ALREADY_STARTED'; end if;

  if session_lecture is not null then
    select head.current_release_id
      into expected_release
      from public.cw_lecture_track_heads head
     where head.lecture_id = session_lecture
       and head.track = expected_track;
  end if;
  if p_courseware_resolved ->> 'track' is distinct from expected_track then raise exception 'TRACK_MISMATCH'; end if;
  if (p_courseware_resolved ->> 'releaseId') is distinct from expected_release::text then raise exception 'RELEASE_MISMATCH'; end if;

  expected_courseware := public.resolve_cw_courseware_overlay(
    public.cw_session_selected_courseware_template(p_session_id),
    coalesce(session_overlay, '[]'::jsonb)
  );
  if p_courseware is distinct from expected_courseware then
    raise exception 'COURSEWARE_RELEASE_PROJECTION_MISMATCH';
  end if;

  -- A selected proposal remains live during preparation. Mark the workflow
  -- ready now, but pin revisions/resources only when the teacher enters class.
  if session_lecture is null and selected_microcourse is not null then
    if not exists (
      select 1
        from public.teacher_microcourses microcourse
       where microcourse.id = selected_microcourse
         and microcourse.source_session_id = p_session_id
    ) then raise exception 'SELECTED_MICROCOURSE_SESSION_MISMATCH'; end if;

    insert into public.session_preparations(
      session_id, status, source_release_id, track, prepared_by, prepared_at,
      auto_frozen, last_contributor_id
    ) values (
      p_session_id, 'ready', null, expected_track, uid, now(), false, uid
    )
    on conflict(session_id) do update
      set status = 'ready',
          source_release_id = null,
          track = excluded.track,
          prepared_by = uid,
          prepared_at = now(),
          auto_frozen = false,
          last_contributor_id = uid,
          updated_at = now();
    return;
  end if;

  update public.class_sessions
     set courseware = p_courseware,
         courseware_resolved = p_courseware_resolved,
         courseware_frozen_at = now()
   where id = p_session_id;

  insert into public.session_preparations(
    session_id, status, source_release_id, track, prepared_by, prepared_at,
    auto_frozen, last_contributor_id
  ) values (
    p_session_id, 'ready', expected_release, expected_track, uid, now(), false, uid
  )
  on conflict(session_id) do update
    set status = 'ready',
        source_release_id = excluded.source_release_id,
        track = excluded.track,
        prepared_by = uid,
        prepared_at = now(),
        auto_frozen = false,
        last_contributor_id = uid,
        updated_at = now();
end;
$$;

create or replace function public.freeze_teacher_microcourse_source_session(
  p_microcourse_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  microcourse_row public.teacher_microcourses%rowtype;
  session_row public.class_sessions%rowtype;
  track_value text;
  snapshot_bundle jsonb;
  resolved_value jsonb;
  template_value jsonb;
  courseware_value jsonb;
begin
  select * into microcourse_row
    from public.teacher_microcourses
   where id = p_microcourse_id
   for update;
  if not found then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  if uid is null or not public.is_session_teacher(microcourse_row.source_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;

  select session.* into session_row
    from public.class_sessions session
   where session.id = microcourse_row.source_session_id
     and session.deleted_at is null
   for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if session_row.courseware_frozen_at is not null or session_row.started_at is not null then
    raise exception 'ALREADY_STARTED_OR_FROZEN';
  end if;

  update public.class_sessions
     set selected_teacher_microcourse_id = microcourse_row.id
   where id = microcourse_row.source_session_id;

  select coalesce(session.courseware_track_override, classroom.courseware_track)
    into track_value
    from public.class_sessions session
    join public.classrooms classroom on classroom.id = session.classroom_id
   where session.id = microcourse_row.source_session_id;

  snapshot_bundle := public.build_teacher_microcourse_draft_snapshot(
    p_microcourse_id, false
  );
  resolved_value := jsonb_build_object(
    'version', 'cw-session-resolved-v1',
    'track', track_value,
    'releaseId', null,
    'microcourseDraft', jsonb_build_object(
      'microcourseId', p_microcourse_id,
      'variantName', microcourse_row.variant_name,
      'basedOnMicrocourseId', microcourse_row.based_on_microcourse_id,
      'metadataRevisionId', microcourse_row.draft_metadata_revision_id,
      'pages', snapshot_bundle -> 'contentSnapshot'
    ),
    'bindings', coalesce((
      select jsonb_agg(binding.value order by page_item.ordinality, binding.value ->> 'bindingKey')
        from jsonb_array_elements(snapshot_bundle -> 'contentSnapshot')
          with ordinality page_item(value, ordinality)
        cross join lateral jsonb_array_elements(page_item.value -> 'bindings') binding
    ), '[]'::jsonb)
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page_row.id,
    'type', 'doc',
    'docId', page_row.id,
    'title', page_row.title
  ) order by page_item.ordinality), '[]'::jsonb)
    into template_value
    from jsonb_array_elements(snapshot_bundle -> 'contentSnapshot')
      with ordinality page_item(value, ordinality)
    join public.cw_page_docs page_row
      on page_row.id = (page_item.value ->> 'pageDocId')::uuid
     and page_row.lecture_id = microcourse_row.lecture_id;

  courseware_value := public.resolve_cw_courseware_overlay(
    template_value,
    coalesce(session_row.courseware_overlay, '[]'::jsonb)
  );
  perform public.freeze_session_courseware(
    microcourse_row.source_session_id,
    courseware_value,
    resolved_value
  );
  return resolved_value;
end;
$$;

create or replace function public.get_session_preparation_review_courseware(
  p_session_id uuid
)
returns table(
  classroom_id uuid,
  lecture_id uuid,
  courseware_frozen_at timestamptz,
  courseware jsonb,
  courseware_template jsonb,
  courseware_overlay jsonb
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  return query
  select session.classroom_id,
         session.lecture_id,
         session.courseware_frozen_at,
         coalesce(session.courseware, '[]'::jsonb),
         case
           when session.courseware_frozen_at is null
             or jsonb_typeof(session.courseware_resolved #> '{microcourseDraft,pages}') = 'array'
             then public.cw_session_selected_courseware_template(session.id)
           else public.cw_session_courseware_template(session.id)
         end,
         coalesce(session.courseware_overlay, '[]'::jsonb)
    from public.class_sessions session
   where session.id = p_session_id
     and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
end;
$$;

create or replace function public.get_session_preparation_review_page_docs(
  p_session_id uuid
)
returns table(page_doc_id uuid, page_no int, doc jsonb, bindings jsonb)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved_value jsonb;
  selected_microcourse uuid;
  frozen_at timestamptz;
  selected_track text;
  snapshot_value jsonb;
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.courseware_resolved,
         session.selected_teacher_microcourse_id,
         session.courseware_frozen_at,
         coalesce(session.courseware_track_override, classroom.courseware_track)
    into resolved_value, selected_microcourse, frozen_at, selected_track
    from public.class_sessions session
    join public.classrooms classroom on classroom.id = session.classroom_id
   where session.id = p_session_id
     and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if jsonb_typeof(resolved_value #> '{microcourseDraft,pages}') = 'array'
     or (frozen_at is null and selected_microcourse is not null) then
    selected_track := 'native-16x9';
  end if;
  snapshot_value := public.resolve_session_courseware_page_snapshot(p_session_id);

  return query
  select page_row.id,
         entry.ordinality::int,
         revision_row.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'bindingKey', binding.value ->> 'bindingKey',
             'objectHash', object_row.sha256,
             'kind', object_row.kind,
             'launchQuery', page_binding.launch_query
           ) order by binding.value ->> 'bindingKey')
             from jsonb_array_elements(coalesce(entry.value -> 'bindings', '[]'::jsonb)) binding
             join public.cw_asset_revisions asset_revision
               on asset_revision.id = (binding.value ->> 'assetRevisionId')::uuid
             join public.cw_asset_objects object_row
               on object_row.id = asset_revision.object_id
             left join public.cw_page_asset_bindings page_binding
               on page_binding.page_doc_id = page_row.id
              and page_binding.binding_key = binding.value ->> 'bindingKey'
              and page_binding.track = selected_track
         ), '[]'::jsonb)
    from jsonb_array_elements(coalesce(snapshot_value, '[]'::jsonb))
      with ordinality entry(value, ordinality)
    join public.cw_page_docs page_row
      on page_row.id = (entry.value ->> 'pageDocId')::uuid
    join public.cw_page_revisions revision_row
      on revision_row.id = (entry.value ->> 'revisionId')::uuid
     and revision_row.page_doc_id = page_row.id
   order by entry.ordinality;
end;
$$;

create or replace function public.list_session_preparation_review_resolved_assets(
  p_session_id uuid
)
returns table(object_hash text, storage_path text, kind text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  snapshot_value jsonb;
begin
  if uid is null or not public.can_review_session_preparation(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  snapshot_value := public.resolve_session_courseware_page_snapshot(p_session_id);

  return query
  select distinct object_row.sha256, object_row.storage_path, object_row.kind
    from jsonb_array_elements(coalesce(snapshot_value, '[]'::jsonb)) page_item,
         jsonb_array_elements(coalesce(page_item.value -> 'bindings', '[]'::jsonb)) binding
    join public.cw_asset_revisions asset_revision
      on asset_revision.id = (binding.value ->> 'assetRevisionId')::uuid
    join public.cw_asset_objects object_row
      on object_row.id = asset_revision.object_id
   where object_row.kind <> 'h5'
   order by object_row.sha256;
end;
$$;

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
  page_snapshot jsonb;
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
   where id = p_session_id
     and deleted_at is null
   for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if session_row.courseware_frozen_at is null then raise exception 'SESSION_NOT_FROZEN'; end if;

  if jsonb_typeof(p_courseware) is distinct from 'array'
     or jsonb_array_length(p_courseware) > 200
     or octet_length(p_courseware::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE';
  end if;
  page_snapshot := public.resolve_session_courseware_page_snapshot(p_session_id);

  for page_item in select value from jsonb_array_elements(p_courseware)
  loop
    if jsonb_typeof(page_item) is distinct from 'object'
       or length(btrim(coalesce(page_item ->> 'title', ''))) not between 1 and 100 then
      raise exception 'INVALID_COURSEWARE';
    end if;
    begin
      page_id := (page_item ->> 'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'INVALID_COURSEWARE';
    end;
    page_type := page_item ->> 'type';
    if page_type not in ('doc', 'image', 'video', 'game', 'board') then
      raise exception 'INVALID_COURSEWARE';
    end if;

    if page_type = 'doc' then
      begin
        page_doc_id := (page_item ->> 'docId')::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_COURSEWARE';
      end;
      if not exists (
        select 1
          from jsonb_array_elements(page_snapshot) snapshot_entry(value)
         where snapshot_entry.value ->> 'pageDocId' = page_doc_id::text
      ) then
        raise exception 'INVALID_COURSEWARE';
      end if;
    elsif page_type in ('image', 'video') then
      page_path := btrim(coalesce(page_item ->> 'path', ''));
      if length(page_path) not between 1 and 500
         or (
           page_path not like session_row.classroom_id::text || '/%'
           and not exists (
             select 1
               from jsonb_array_elements(coalesce(session_row.courseware, '[]'::jsonb)) existing(value)
              where existing.value ->> 'id' = page_id::text
                and existing.value ->> 'type' = page_type
                and existing.value ->> 'path' = page_path
           )
         ) then
        raise exception 'INVALID_COURSEWARE';
      end if;
    elsif page_type = 'game' then
      if length(btrim(coalesce(page_item ->> 'gameId', ''))) not between 1 and 50
         or page_item ->> 'difficulty' not in ('easy', 'medium', 'hard')
         or length(btrim(coalesce(page_item ->> 'seed', ''))) not between 1 and 100 then
        raise exception 'INVALID_COURSEWARE';
      end if;
    end if;
  end loop;

  if exists (
    select 1
      from jsonb_array_elements(p_courseware) page(value)
     group by page.value ->> 'id'
    having count(*) > 1
  ) then raise exception 'INVALID_COURSEWARE'; end if;

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
        where page.value ->> 'type' = 'doc'
          and page.value ->> 'docId' = check_row.source_page_doc_id::text
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

comment on function public.resolve_session_courseware_page_snapshot(uuid) is
  'Internal authoritative page pins for formal releases and selected teacher-microcourse sessions.';
comment on function public.get_session_courseware_learning_check_pages(uuid) is
  'Returns page-level learning-check defaults from the same live or frozen snapshot used by the session.';

notify pgrst, 'reload schema';

commit;
