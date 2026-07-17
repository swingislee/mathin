-- P6-2 修复续：cw_page_revisions.base_revision_id 与 PL/pgSQL 局部变量同名。
-- 局部变量统一 v_ 前缀，避免函数体内任何列/变量歧义。

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
  v_uid uuid := auth.uid();
  v_page_row public.cw_page_docs%rowtype;
  v_base_revision_id uuid;
  v_base_no int;
  v_base_doc jsonb;
  v_next_no int;
  v_next_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.page.edit') then
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

  select * into v_page_row
    from public.cw_page_docs
   where id = p_page_doc_id
   for update;
  if not found or v_page_row.deleted_at is not null then
    raise exception 'PAGE_NOT_FOUND';
  end if;

  v_base_revision_id := coalesce(v_page_row.draft_revision_id, v_page_row.current_revision_id);
  if v_base_revision_id is null then
    raise exception 'PAGE_HAS_NO_BASE_REVISION';
  end if;
  select revision.revision_no, revision.doc into v_base_no, v_base_doc
    from public.cw_page_revisions as revision
   where revision.id = v_base_revision_id;
  if v_base_no is distinct from p_base_revision_no then
    raise exception 'VERSION_CONFLICT';
  end if;

  if (p_doc -> 'sourceCoursewareId') is distinct from (v_base_doc -> 'sourceCoursewareId')
     or (p_doc -> 'sourcePageId') is distinct from (v_base_doc -> 'sourcePageId')
     or (p_doc -> 'sourcePageDatabaseId') is distinct from (v_base_doc -> 'sourcePageDatabaseId')
     or (p_doc -> 'sourceSnapshotId') is distinct from (v_base_doc -> 'sourceSnapshotId')
     or (p_doc -> 'sourceContentHash') is distinct from (v_base_doc -> 'sourceContentHash') then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
  end if;

  select coalesce(max(revision.revision_no), 0) + 1 into v_next_no
    from public.cw_page_revisions as revision
   where revision.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions (
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by
  ) values (
    p_page_doc_id, v_next_no, p_doc, 'edit', v_base_revision_id,
    left(trim(coalesce(p_note, '')), 1000), v_uid
  ) returning id into v_next_id;

  update public.cw_page_docs
     set draft_revision_id = v_next_id
   where id = p_page_doc_id;

  return query select v_next_id, v_next_no;
end;
$$;

revoke all on function public.save_page_draft(uuid, jsonb, int, text) from public, anon, authenticated;
grant execute on function public.save_page_draft(uuid, jsonb, int, text) to authenticated;
