-- P6-7 修复：RETURNS TABLE 的 revision_no 在 PL/pgSQL 内是变量，查询必须限定表别名。
create or replace function public.revert_cw_page_revision(p_page_doc_id uuid, p_revision_id uuid, p_base_revision_no int, p_note text default '')
returns table(revision_id uuid, revision_no int)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_page public.cw_page_docs%rowtype; v_base int; v_doc jsonb; v_next int; v_id uuid;
begin
  v_uid := public.cw_assert_page_editor();
  select * into v_page from public.cw_page_docs as page where page.id=p_page_doc_id and page.deleted_at is null for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  select revision.revision_no into v_base
    from public.cw_page_revisions as revision
   where revision.id=coalesce(v_page.draft_revision_id,v_page.current_revision_id);
  if v_base is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  select revision.doc into v_doc
    from public.cw_page_revisions as revision
   where revision.id=p_revision_id and revision.page_doc_id=p_page_doc_id;
  if v_doc is null then raise exception 'REVISION_NOT_FOUND'; end if;
  select coalesce(max(revision.revision_no),0)+1 into v_next
    from public.cw_page_revisions as revision where revision.page_doc_id=p_page_doc_id;
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,base_revision_id,note,created_by)
  values(p_page_doc_id,v_next,v_doc,'revert',coalesce(v_page.draft_revision_id,v_page.current_revision_id),left(trim(coalesce(p_note,'')),1000),v_uid)
  returning id into v_id;
  update public.cw_page_docs set draft_revision_id=v_id where id=p_page_doc_id;
  return query select v_id,v_next;
end;
$$;
revoke all on function public.revert_cw_page_revision(uuid,uuid,int,text) from public, anon, authenticated;
grant execute on function public.revert_cw_page_revision(uuid,uuid,int,text) to authenticated;
