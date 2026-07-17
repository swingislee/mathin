-- P6-1 export contract completion for P6-2:
-- an H5 package can serve different page-level activities through its launch query.
-- Persist that usage-level metadata on the binding and pin it in every release snapshot.

alter table public.cw_page_asset_bindings
  add column launch_query jsonb;

alter table public.cw_page_asset_bindings
  add constraint cw_page_asset_bindings_launch_query_shape check (
    (
      kind = 'h5'
      and launch_query is not null
      and jsonb_typeof(launch_query) = 'object'
      and coalesce(jsonb_typeof(launch_query -> 'query') = 'object', false)
      and coalesce(jsonb_typeof(launch_query -> 'coursewareIdParam') in ('string', 'null'), false)
    )
    or (kind <> 'h5' and launch_query is null)
  );

-- A release must contain the full H5 launch contract as well as the pinned
-- asset revision. Otherwise a later binding edit could make a historical
-- release open the package at a different level.
create or replace function public.publish_lecture_release(
  p_lecture_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  next_no int;
  release_id uuid;
  release_snapshot jsonb;
begin
  if uid is null or not public.has_perm(uid, 'courseware.release.publish') then
    raise exception 'FORBIDDEN';
  end if;

  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then
    raise exception 'LECTURE_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null
  ) then
    raise exception 'LECTURE_HAS_NO_PAGES';
  end if;
  if exists (
    select 1
      from public.cw_page_docs
     where lecture_id = p_lecture_id
       and deleted_at is null
       and coalesce(draft_revision_id, current_revision_id) is null
  ) then
    raise exception 'PAGE_HAS_NO_REVISION';
  end if;
  if exists (
    select 1
      from public.cw_page_asset_bindings b
      join public.cw_page_docs p on p.id = b.page_doc_id
      left join public.cw_shared_assets a on a.id = b.shared_asset_id
     where p.lecture_id = p_lecture_id
       and p.deleted_at is null
       and coalesce(b.pinned_revision_id, a.published_revision_id) is null
  ) then
    raise exception 'UNRESOLVED_ASSET_BINDING';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'pageDocId', snapshot_rows.page_doc_id,
      'revisionId', snapshot_rows.revision_id,
      'bindings', snapshot_rows.bindings
    ) order by snapshot_rows.page_no
  ) into release_snapshot
  from (
    select
      p.id as page_doc_id,
      p.page_no,
      coalesce(p.draft_revision_id, p.current_revision_id) as revision_id,
      coalesce((
        select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'bindingKey', b.binding_key,
            'assetRevisionId', coalesce(b.pinned_revision_id, a.published_revision_id),
            'launchQuery', b.launch_query
          )) order by b.binding_key
        )
          from public.cw_page_asset_bindings b
          join public.cw_shared_assets a on a.id = b.shared_asset_id
         where b.page_doc_id = p.id
      ), '[]'::jsonb) as bindings
    from public.cw_page_docs p
    where p.lecture_id = p_lecture_id and p.deleted_at is null
  ) as snapshot_rows;
  if release_snapshot is null or octet_length(release_snapshot::text) > 1048576 then
    raise exception 'RELEASE_SNAPSHOT_TOO_LARGE_OR_INVALID';
  end if;

  select coalesce(max(release_no), 0) + 1 into next_no
    from public.cw_lecture_releases
   where lecture_id = p_lecture_id;
  insert into public.cw_lecture_releases (
    lecture_id, release_no, note, snapshot, published_by
  ) values (
    p_lecture_id, next_no, left(trim(coalesce(p_note, '')), 1000), release_snapshot, uid
  ) returning id into release_id;

  update public.cw_page_docs p
     set current_revision_id = coalesce(p.draft_revision_id, p.current_revision_id),
         draft_revision_id = null,
         aspect = case
           when (r.doc -> 'canvas' ->> 'width')::numeric * 3
              = (r.doc -> 'canvas' ->> 'height')::numeric * 4 then '4:3'
           else '16:9'
         end
    from public.cw_page_revisions r
   where p.lecture_id = p_lecture_id
     and p.deleted_at is null
     and r.id = coalesce(p.draft_revision_id, p.current_revision_id);

  update public.course_lectures set current_release_id = release_id where id = p_lecture_id;
  return release_id;
end;
$$;

revoke all on function public.publish_lecture_release(uuid, text) from public, anon, authenticated;
grant execute on function public.publish_lecture_release(uuid, text) to authenticated;
