-- Align the session workspace read model with the relationships that can open
-- its preparation surface.  The old courseware RPCs only accepted
-- classroom_members, while the workspace also admits teaching overrides,
-- assigned staff, preparation reviewers, class-wide managers, and research
-- staff authoring proposals for a free session.

begin;

create or replace function public.can_read_session_courseware(
  p_session_id uuid,
  p_uid uuid
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and exists (
    select 1
      from public.class_sessions session
     where session.id = p_session_id
       and session.deleted_at is null
       and (
         public.is_session_member(session.id, p_uid)
         or public.is_session_teacher(session.id, p_uid)
         or public.is_classroom_staff_assigned(session.classroom_id, p_uid)
         or public.can_review_session_preparation(session.id, p_uid)
         or public.has_perm(p_uid, 'class.view.all')
         or (
           session.lecture_id is null
           and public.has_perm(p_uid, 'courseware.review')
         )
       )
  );
$$;

revoke all on function public.can_read_session_courseware(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.get_session_courseware_template(
  p_session_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.can_read_session_courseware(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  return public.cw_session_selected_courseware_template(p_session_id);
end;
$$;

revoke all on function public.get_session_courseware_template(uuid)
  from public, anon, authenticated;
grant execute on function public.get_session_courseware_template(uuid)
  to authenticated;

create or replace function public.get_session_page_docs(
  p_session_id uuid
)
returns table(page_doc_id uuid, page_no integer, doc jsonb, bindings jsonb)
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
  if uid is null or not public.can_read_session_courseware(p_session_id, uid) then
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
         entry.ordinality::integer,
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

revoke all on function public.get_session_page_docs(uuid)
  from public, anon, authenticated;
grant execute on function public.get_session_page_docs(uuid)
  to authenticated;

create or replace function public.list_session_resolved_assets(
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
  if uid is null or not public.can_read_session_courseware(p_session_id, uid) then
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

revoke all on function public.list_session_resolved_assets(uuid)
  from public, anon, authenticated;
grant execute on function public.list_session_resolved_assets(uuid)
  to authenticated;

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
  if uid is null or not public.can_read_session_courseware(p_session_id, uid) then
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

comment on function public.can_read_session_courseware(uuid, uuid) is
  'Read-only session courseware scope shared by preparation, rehearsal, and authorized review surfaces.';

notify pgrst, 'reload schema';

commit;
