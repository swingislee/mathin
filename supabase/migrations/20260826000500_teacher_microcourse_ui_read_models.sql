-- DEV-TMC-1: UI-safe controlled-topic read model. The table remains RLS
-- protected; this RPC gives the authoring route a stable typed contract.

begin;

create or replace function public.list_teacher_microcourse_topics()
returns table(
  id uuid,
  slug text,
  title_zh text,
  title_en text,
  enabled boolean
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  return query
  select topic.id, topic.slug, topic.title_zh, topic.title_en, topic.enabled
  from public.teacher_microcourse_topics topic
  where topic.enabled
  order by topic.sort_order, topic.slug;
end;
$$;

revoke all on function public.list_teacher_microcourse_topics() from public, anon, authenticated;
grant execute on function public.list_teacher_microcourse_topics() to authenticated;

-- Frozen free sessions carry revision pins rather than the object hashes used
-- by ordinary published-session snapshots. Resolve those pins here so
-- preparation and live-class preload can sign the exact teacher-draft assets.
create or replace function public.list_session_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  context record;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.courseware_resolved into resolved
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

-- H5 bytes must not enter the public immutable bucket during an intermediate
-- review round. Tell the server action whether this decision can publish.
create or replace function public.prepare_teacher_microcourse_review_publish(
  p_review_cycle_id uuid
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  snapshot_row public.teacher_microcourse_review_snapshots%rowtype;
  cycle_row public.cw_review_cycles%rowtype;
  required_rounds smallint;
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  select * into snapshot_row
  from public.teacher_microcourse_review_snapshots
  where review_cycle_id = p_review_cycle_id;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  select * into cycle_row
  from public.cw_review_cycles
  where id = p_review_cycle_id and status = 'submitted';
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  select workflow.required_review_rounds_snapshot into required_rounds
  from public.cw_lecture_workflows workflow
  where workflow.lecture_id = cycle_row.lecture_id
    and workflow.track = cycle_row.track
    and workflow.active_review_cycle_id = cycle_row.id;
  return jsonb_build_object(
    'microcourseId', snapshot_row.microcourse_id,
    'finalApproval', cycle_row.review_round_no >= coalesce(required_rounds, 1),
    'artifacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'artifactId', artifact.id,
        'sha256', artifact.sha256,
        'privatePath', artifact.private_path,
        'publicPath', 'packages/' || artifact.sha256 || '/index.html'
      ) order by artifact.sha256), '[]'::jsonb)
      from jsonb_array_elements_text(snapshot_row.h5_hashes) hash_item
      join public.teacher_microcourse_h5_artifacts artifact
        on artifact.microcourse_id = snapshot_row.microcourse_id
       and artifact.sha256 = hash_item.value
    )
  );
end;
$$;

commit;
