-- Let a PageDoc create its first adapted-4x3 draft from the native head through
-- the same optimistic-lock save RPC used by subsequent edits. The bootstrap is
-- atomic with the draft save and copies track bindings so replacement/publish
-- semantics are available as soon as the 4:3 canvas becomes editable.

create or replace function public.save_cw_track_page_draft(
  p_page_doc_id uuid,
  p_track text,
  p_doc jsonb,
  p_base_revision_no integer,
  p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  page_version text;
  native_base_id uuid;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');

  select doc_version into page_version
  from public.cw_page_docs
  where id = p_page_doc_id and deleted_at is null;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;

  if page_version = 'spatial-page-v1' then
    return query select * from public.save_cw_spatial_page_draft(
      p_page_doc_id, p_track, p_doc, p_base_revision_no, p_note
    );
    return;
  end if;

  if page_version = 'page-doc-v1' and p_track = 'adapted-4x3' then
    if not exists (
      select 1 from public.cw_page_track_heads
      where page_doc_id = p_page_doc_id and track = 'adapted-4x3'
    ) then
      select coalesce(head.draft_revision_id, head.current_revision_id)
      into native_base_id
      from public.cw_page_track_heads head
      where head.page_doc_id = p_page_doc_id and head.track = 'native-16x9'
      for share;

      if native_base_id is null then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;

      insert into public.cw_page_track_heads(
        page_doc_id, track, draft_revision_id
      ) values (
        p_page_doc_id, 'adapted-4x3', native_base_id
      )
      on conflict (page_doc_id, track) do nothing;
    end if;

    insert into public.cw_page_asset_bindings(
      page_doc_id,
      binding_key,
      role,
      kind,
      shared_asset_id,
      pinned_revision_id,
      launch_query,
      track
    )
    select
      binding.page_doc_id,
      binding.binding_key,
      binding.role,
      binding.kind,
      binding.shared_asset_id,
      binding.pinned_revision_id,
      binding.launch_query,
      'adapted-4x3'
    from public.cw_page_asset_bindings binding
    where binding.page_doc_id = p_page_doc_id
      and binding.track = 'native-16x9'
    on conflict (page_doc_id, binding_key, track) do nothing;
  end if;

  return query
  select result.revision_id, result.revision_no
  from public.save_cw_track_page_draft_pre_sml0_impl(
    p_page_doc_id, p_track, p_doc, p_base_revision_no, p_note
  ) result;
end;
$$;

revoke all on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text)
from public, anon, authenticated;
grant execute on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text)
to authenticated;

comment on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) is
  'Save one capability-gated courseware page draft; PageDoc adapted-4x3 may atomically bootstrap its track head and inherited bindings from the native baseline.';
