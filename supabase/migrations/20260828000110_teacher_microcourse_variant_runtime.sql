-- DEV-TMC-2 runtime: freeze the session teacher's selected proposal and expose
-- that proposal to the ordinary preparation preview before class starts.

begin;

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

  -- Starting class from a proposal is itself an explicit teacher selection.
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
  -- The live classroom still uses class_sessions.courseware as its ordered
  -- stage index. A free session has no lecture_id, so persisting only the
  -- resolved snapshot would leave LiveShell with zero pages and it would
  -- never request get_session_page_docs. Project the pinned page order to the
  -- same lightweight doc-page entries used by released courseware.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page_row.id,
    'type', 'doc',
    'docId', page_row.id,
    'title', page_row.title
  ) order by page_item.ordinality), '[]'::jsonb)
  into courseware_value
  from jsonb_array_elements(snapshot_bundle -> 'contentSnapshot')
    with ordinality page_item(value, ordinality)
  join public.cw_page_docs page_row
    on page_row.id = (page_item.value ->> 'pageDocId')::uuid
   and page_row.lecture_id = microcourse_row.lecture_id;
  perform public.freeze_session_courseware(
    microcourse_row.source_session_id, courseware_value, resolved_value
  );
  return resolved_value;
end;
$$;

create function public.freeze_selected_teacher_microcourse_source_session(
  p_session_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  selected_id uuid;
  selected_lecture_id uuid;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.selected_teacher_microcourse_id, microcourse.lecture_id
  into selected_id, selected_lecture_id
  from public.class_sessions session
  left join public.teacher_microcourses microcourse
    on microcourse.id = session.selected_teacher_microcourse_id
   and microcourse.source_session_id = session.id
  where session.id = p_session_id
    and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if selected_id is null or selected_lecture_id is null then return null; end if;
  if not exists (
    select 1
    from public.cw_page_docs page
    join public.cw_page_track_heads head
      on head.page_doc_id = page.id
     and head.track = 'native-16x9'
    where page.lecture_id = selected_lecture_id
      and page.deleted_at is null
  ) then return null; end if;
  return public.freeze_teacher_microcourse_source_session(selected_id);
end;
$$;

create or replace function public.get_session_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no integer, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  context record;
  release_snapshot jsonb;
  resolved_value jsonb;
  draft_snapshot jsonb;
  microcourse_id uuid;
  selected_microcourse_id uuid;
  frozen_at timestamptz;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.courseware_resolved,
         session.selected_teacher_microcourse_id,
         session.courseware_frozen_at
  into resolved_value, selected_microcourse_id, frozen_at
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if jsonb_typeof(resolved_value #> '{microcourseDraft,pages}') = 'array' then
    microcourse_id := (resolved_value #>> '{microcourseDraft,microcourseId}')::uuid;
    if not public.can_read_teacher_microcourse_draft(microcourse_id, uid) then
      raise exception 'FORBIDDEN';
    end if;
    draft_snapshot := resolved_value #> '{microcourseDraft,pages}';
    return query
    select page_row.id,
           entry.ordinality::integer,
           revision_row.doc,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'bindingKey', binding.value ->> 'bindingKey',
               'objectHash', object_row.sha256,
               'kind', object_row.kind,
               'launchQuery', page_binding.launch_query
             ) order by binding.value ->> 'bindingKey')
             from jsonb_array_elements(entry.value -> 'bindings') binding
             join public.cw_asset_revisions asset_revision
               on asset_revision.id = (binding.value ->> 'assetRevisionId')::uuid
             join public.cw_asset_objects object_row
               on object_row.id = asset_revision.object_id
             left join public.cw_page_asset_bindings page_binding
               on page_binding.page_doc_id = page_row.id
              and page_binding.binding_key = binding.value ->> 'bindingKey'
              and page_binding.track = 'native-16x9'
           ), '[]'::jsonb)
    from jsonb_array_elements(draft_snapshot) with ordinality entry(value, ordinality)
    join public.cw_page_docs page_row
      on page_row.id = (entry.value ->> 'pageDocId')::uuid
    join public.cw_page_revisions revision_row
      on revision_row.id = (entry.value ->> 'revisionId')::uuid
     and revision_row.page_doc_id = page_row.id
    order by entry.ordinality;
    return;
  end if;

  -- Before freeze, the ordinary session workspace previews the proposal that
  -- the teacher selected. This is a live head; freeze below turns it into pins.
  if frozen_at is null and selected_microcourse_id is not null then
    if not public.can_read_teacher_microcourse_draft(selected_microcourse_id, uid) then
      raise exception 'FORBIDDEN';
    end if;
    return query
    select page.id,
           row_number() over(order by page.page_no)::integer,
           revision.doc,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'bindingKey', binding.binding_key,
               'objectHash', object.sha256,
               'kind', object.kind,
               'launchQuery', binding.launch_query
             ) order by binding.binding_key)
             from public.cw_page_asset_bindings binding
             join public.cw_asset_revisions asset_revision
               on asset_revision.id = binding.pinned_revision_id
             join public.cw_asset_objects object on object.id = asset_revision.object_id
             where binding.page_doc_id = page.id
               and binding.track = 'native-16x9'
           ), '[]'::jsonb)
    from public.teacher_microcourses microcourse
    join public.cw_page_docs page
      on page.lecture_id = microcourse.lecture_id and page.deleted_at is null
    join public.cw_page_track_heads head
      on head.page_doc_id = page.id and head.track = 'native-16x9'
    join public.cw_page_revisions revision
      on revision.id = coalesce(head.draft_revision_id, head.current_revision_id)
    where microcourse.id = selected_microcourse_id
      and microcourse.source_session_id = p_session_id
    order by page.page_no;
    return;
  end if;

  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  return query
  select page_row.id,
         entry.ordinality::integer,
         revision_row.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'bindingKey', binding.value ->> 'bindingKey',
             'objectHash', object_row.sha256,
             'kind', object_row.kind,
             'launchQuery', page_binding.launch_query
           ) order by binding.value ->> 'bindingKey')
           from jsonb_array_elements(entry.value -> 'bindings') binding
           join public.cw_asset_revisions asset_revision
             on asset_revision.id = (binding.value ->> 'assetRevisionId')::uuid
           join public.cw_asset_objects object_row
             on object_row.id = asset_revision.object_id
           left join public.cw_page_asset_bindings page_binding
             on page_binding.page_doc_id = page_row.id
            and page_binding.binding_key = binding.value ->> 'bindingKey'
            and page_binding.track = context.track
         ), '[]'::jsonb)
  from jsonb_array_elements(release_snapshot) with ordinality entry(value, ordinality)
  join public.cw_page_docs page_row
    on page_row.id = (entry.value ->> 'pageDocId')::uuid
  join public.cw_page_revisions revision_row
    on revision_row.id = (entry.value ->> 'revisionId')::uuid
   and revision_row.page_doc_id = page_row.id
  order by entry.ordinality;
end;
$$;

create or replace function public.list_session_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  selected_microcourse_id uuid;
  frozen_at timestamptz;
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.courseware_resolved,
         session.selected_teacher_microcourse_id,
         session.courseware_frozen_at
  into resolved, selected_microcourse_id, frozen_at
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  if resolved is not null and resolved ->> 'version' = 'cw-session-resolved-v1' then
    if jsonb_typeof(resolved #> '{microcourseDraft,pages}') = 'array' then
      return query
      select distinct object_row.sha256, object_row.storage_path, object_row.kind
      from jsonb_array_elements(resolved #> '{microcourseDraft,pages}') page_item
      cross join lateral jsonb_array_elements(
        coalesce(page_item.value -> 'bindings', '[]'::jsonb)
      ) binding
      join public.cw_asset_revisions revision_row
        on revision_row.id = (binding.value ->> 'assetRevisionId')::uuid
      join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
      where object_row.kind <> 'h5'
      order by object_row.sha256;
      return;
    end if;
    return query
    with hashes as (
      select distinct binding ->> 'objectHash' sha256
      from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) binding
      where jsonb_typeof(binding) = 'object'
        and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
    )
    select object_row.sha256, object_row.storage_path, object_row.kind
    from hashes
    join public.cw_asset_objects object_row on object_row.sha256 = hashes.sha256
    where object_row.kind <> 'h5'
    order by object_row.sha256;
    return;
  end if;

  if frozen_at is null and selected_microcourse_id is not null then
    return query
    select distinct object.sha256, object.storage_path, object.kind
    from public.teacher_microcourses microcourse
    join public.cw_page_docs page
      on page.lecture_id = microcourse.lecture_id and page.deleted_at is null
    join public.cw_page_asset_bindings binding
      on binding.page_doc_id = page.id and binding.track = 'native-16x9'
    join public.cw_asset_revisions revision
      on revision.id = binding.pinned_revision_id
    join public.cw_asset_objects object on object.id = revision.object_id
    where microcourse.id = selected_microcourse_id
      and microcourse.source_session_id = p_session_id
      and object.kind <> 'h5'
    order by object.sha256;
    return;
  end if;

  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  return query
  select distinct object_row.sha256, object_row.storage_path, object_row.kind
  from jsonb_array_elements(release_snapshot) entry,
       jsonb_array_elements(entry.value -> 'bindings') binding
  join public.cw_asset_revisions revision_row
    on revision_row.id = (binding ->> 'assetRevisionId')::uuid
  join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
  where object_row.kind <> 'h5'
  order by object_row.sha256;
end;
$$;

revoke all on function public.freeze_selected_teacher_microcourse_source_session(uuid)
  from public, anon, authenticated;
grant execute on function public.freeze_selected_teacher_microcourse_source_session(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
