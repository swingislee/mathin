begin;

-- 自动粗版只创建缺失轨道；唯一键的插入结果是并发裁决，已有手调稿保持原样。
create or replace function public.create_missing_cw_adapted_draft(
  p_page_doc_id uuid, p_source_revision_id uuid, p_doc jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  source_id uuid; source_no integer; inserted_id uuid;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  perform 1 from public.cw_page_docs where id=p_page_doc_id and deleted_at is null for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if exists(select 1 from public.cw_page_track_heads where page_doc_id=p_page_doc_id and track='adapted-4x3' and coalesce(draft_revision_id,current_revision_id) is not null) then return false; end if;
  select coalesce(h.draft_revision_id,h.current_revision_id) into source_id
    from public.cw_page_track_heads h where h.page_doc_id=p_page_doc_id and h.track='native-16x9' for share;
  if source_id is null or source_id is distinct from p_source_revision_id then raise exception 'VERSION_CONFLICT'; end if;
  select revision_no into source_no from public.cw_page_revisions where id=source_id and page_doc_id=p_page_doc_id;
  if source_no is null then raise exception 'VERSION_CONFLICT'; end if;
  if p_doc->>'docVersion' not in ('page-doc-v1','source-runtime-page-v1') or p_doc is null then raise exception 'UNSUPPORTED_AUTO_ADAPTATION'; end if;
  insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id)
    values(p_page_doc_id,'adapted-4x3',source_id)
    on conflict(page_doc_id,track) do update set draft_revision_id=excluded.draft_revision_id
      where cw_page_track_heads.draft_revision_id is null and cw_page_track_heads.current_revision_id is null
    returning page_doc_id into inserted_id;
  if inserted_id is null then return false; end if;
  perform public.save_cw_track_page_draft(p_page_doc_id,'adapted-4x3',p_doc,source_no,'Automatic lecture rough draft');
  return true;
end;
$$;
revoke all on function public.create_missing_cw_adapted_draft(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_missing_cw_adapted_draft(uuid,uuid,jsonb) to authenticated;
commit;
