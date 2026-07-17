-- P6-2 修复：save_page_draft 的 RETURNS TABLE(revision_no) 与未限定查询列同名，
-- PL/pgSQL 会报 ambiguous。保持已应用 migration 不改，以覆盖函数修复。

create or replace function public.save_page_draft(
  p_page_doc_id uuid,
  p_doc jsonb,
  p_base_revision_no int,
  p_note text default ''
)
returns table(revision_id uuid, revision_no int)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  page_row public.cw_page_docs%rowtype;
  base_revision_id uuid;
  base_no int;
  base_doc jsonb;
  next_no int;
  next_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then
    raise exception 'FORBIDDEN';
  end if;
  if p_base_revision_no is null or p_base_revision_no < 1 then
    raise exception 'INVALID_BASE_REVISION';
  end if;
  if jsonb_typeof(p_doc) is distinct from 'object'
     or p_doc ->> 'docVersion' is distinct from 'page-doc-v1'
     or jsonb_typeof(p_doc -> 'canvas') is distinct from 'object'
     or jsonb_typeof(p_doc -> 'nodes') is distinct from 'array'
     or jsonb_typeof(p_doc -> 'interactions') is distinct from 'array'
     or octet_length(p_doc::text) > 1048576 then
    raise exception 'INVALID_PAGE_DOC';
  end if;

  select * into page_row
    from public.cw_page_docs
   where id = p_page_doc_id
   for update;
  if not found or page_row.deleted_at is not null then
    raise exception 'PAGE_NOT_FOUND';
  end if;

  base_revision_id := coalesce(page_row.draft_revision_id, page_row.current_revision_id);
  if base_revision_id is null then
    raise exception 'PAGE_HAS_NO_BASE_REVISION';
  end if;
  select revision.revision_no, revision.doc into base_no, base_doc
    from public.cw_page_revisions as revision
   where revision.id = base_revision_id;
  if base_no is distinct from p_base_revision_no then
    raise exception 'VERSION_CONFLICT';
  end if;

  if (p_doc -> 'sourceCoursewareId') is distinct from (base_doc -> 'sourceCoursewareId')
     or (p_doc -> 'sourcePageId') is distinct from (base_doc -> 'sourcePageId')
     or (p_doc -> 'sourcePageDatabaseId') is distinct from (base_doc -> 'sourcePageDatabaseId')
     or (p_doc -> 'sourceSnapshotId') is distinct from (base_doc -> 'sourceSnapshotId')
     or (p_doc -> 'sourceContentHash') is distinct from (base_doc -> 'sourceContentHash') then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
  end if;

  select coalesce(max(revision.revision_no), 0) + 1 into next_no
    from public.cw_page_revisions as revision
   where revision.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions (
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by
  ) values (
    p_page_doc_id, next_no, p_doc, 'edit', base_revision_id,
    left(trim(coalesce(p_note, '')), 1000), uid
  ) returning id into next_id;

  update public.cw_page_docs
     set draft_revision_id = next_id
   where id = p_page_doc_id;

  return query select next_id, next_no;
end;
$$;

revoke all on function public.save_page_draft(uuid, jsonb, int, text) from public, anon, authenticated;
grant execute on function public.save_page_draft(uuid, jsonb, int, text) to authenticated;
