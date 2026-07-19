-- P6-6 / P6-7: 教研中台第一期与 4:3 审校队列。
-- 所有变更仍只允许经 SECURITY DEFINER RPC 写入；表本身不授 authenticated 直写。

alter table public.cw_page_docs
  add column if not exists adapt_class text check (adapt_class in ('A', 'B', 'C', 'D', 'E'));

create table if not exists public.cw_adapt_reviews (
  page_doc_id uuid primary key references public.cw_page_docs(id) on delete cascade,
  classification text not null check (classification in ('A', 'B', 'C', 'D', 'E')),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  note text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.cw_adapt_reviews enable row level security;
create policy "cw_adapt_reviews_select_staff" on public.cw_adapt_reviews
  for select to authenticated using (public.is_staff((select auth.uid())));
revoke all on public.cw_adapt_reviews from anon, authenticated;
create trigger cw_adapt_reviews_set_updated_at
  before update on public.cw_adapt_reviews
  for each row execute function public.set_updated_at();

create or replace function public.cw_assert_page_editor()
returns uuid language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.page.edit') then
    raise exception 'FORBIDDEN';
  end if;
  return v_uid;
end;
$$;

create or replace function public.reorder_cw_pages(p_lecture_id uuid, p_page_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count int; v_expected int;
begin
  perform public.cw_assert_page_editor();
  if p_lecture_id is null or p_page_ids is null or cardinality(p_page_ids) = 0
     or cardinality(p_page_ids) > 1000
     or cardinality(p_page_ids) <> cardinality(array(select distinct unnest(p_page_ids))) then
    raise exception 'INVALID_PAGE_ORDER';
  end if;
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  select count(*) into v_expected from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null;
  select count(*) into v_count from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null and id = any(p_page_ids);
  if v_expected <> cardinality(p_page_ids) or v_count <> v_expected then raise exception 'PAGE_ORDER_MISMATCH'; end if;
  update public.cw_page_docs page
     set page_no = ordered.ordinality + 10000
    from unnest(p_page_ids) with ordinality as ordered(id, ordinality)
   where page.id = ordered.id;
  update public.cw_page_docs set page_no = page_no - 10000 where lecture_id = p_lecture_id and deleted_at is null;
end;
$$;

create or replace function public.copy_cw_page(
  p_source_page_doc_id uuid,
  p_target_lecture_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default ''
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_source public.cw_page_docs%rowtype; v_target_page uuid; v_source_revision uuid;
declare v_revision_no int; v_insert_after int; v_doc jsonb;
begin
  v_uid := public.cw_assert_page_editor();
  if p_target_lecture_id is null then raise exception 'INVALID_TARGET_LECTURE'; end if;
  select * into v_source from public.cw_page_docs where id = p_source_page_doc_id and deleted_at is null;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  perform 1 from public.course_lectures where id = p_target_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if p_after_page_doc_id is null then
    select coalesce(max(page_no), 0) into v_insert_after from public.cw_page_docs where lecture_id = p_target_lecture_id and deleted_at is null;
  else
    select page_no into v_insert_after from public.cw_page_docs where id = p_after_page_doc_id and lecture_id = p_target_lecture_id and deleted_at is null;
    if not found then raise exception 'AFTER_PAGE_NOT_FOUND'; end if;
  end if;
  update public.cw_page_docs set page_no = page_no + 1
   where lecture_id = p_target_lecture_id and deleted_at is null and page_no > v_insert_after;
  insert into public.cw_page_docs (lecture_id, page_no, title, source_courseware_id, source_page_id, aspect)
  values (p_target_lecture_id, v_insert_after + 1, left(trim(coalesce(p_title, v_source.title)), 500), v_source.source_courseware_id, v_source.source_page_id, v_source.aspect)
  returning id into v_target_page;
  v_source_revision := coalesce(v_source.draft_revision_id, v_source.current_revision_id);
  select doc into v_doc from public.cw_page_revisions where id = v_source_revision;
  if v_doc is null then raise exception 'PAGE_HAS_NO_BASE_REVISION'; end if;
  insert into public.cw_page_revisions (page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by)
  values (v_target_page, 1, v_doc, 'edit', null, 'Copied page', v_uid)
  returning id into v_source_revision;
  update public.cw_page_docs set draft_revision_id = v_source_revision where id = v_target_page;
  insert into public.cw_page_asset_bindings (page_doc_id, binding_key, role, kind, shared_asset_id, pinned_revision_id, launch_query)
  select v_target_page, binding_key, role, kind, shared_asset_id, pinned_revision_id, launch_query
    from public.cw_page_asset_bindings where page_doc_id = p_source_page_doc_id;
  return v_target_page;
end;
$$;

create or replace function public.create_blank_cw_page(
  p_lecture_id uuid, p_after_page_doc_id uuid default null, p_title text default ''
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_page uuid; v_revision uuid; v_after int; v_doc jsonb;
begin
  v_uid := public.cw_assert_page_editor();
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if p_after_page_doc_id is null then
    select coalesce(max(page_no), 0) into v_after from public.cw_page_docs where lecture_id=p_lecture_id and deleted_at is null;
  else
    select page_no into v_after from public.cw_page_docs where id=p_after_page_doc_id and lecture_id=p_lecture_id and deleted_at is null;
    if not found then raise exception 'AFTER_PAGE_NOT_FOUND'; end if;
  end if;
  update public.cw_page_docs set page_no=page_no+1 where lecture_id=p_lecture_id and deleted_at is null and page_no>v_after;
  insert into public.cw_page_docs(lecture_id,page_no,title,source_courseware_id,source_page_id,aspect)
  values(p_lecture_id,v_after+1,left(trim(coalesce(p_title,'')),500),'mathin-manual',null,'4:3') returning id into v_page;
  v_doc := jsonb_build_object(
    'docVersion','page-doc-v1','sourceCoursewareId','mathin-manual','sourcePageId',null,
    'sourcePageDatabaseId',1,'sourceSnapshotId',1,'sourceContentHash',repeat('0',64),
    'canvas',jsonb_build_object('width',960,'height',720,'backgroundColor','#ffffff','backgroundBindingKey',null),
    'nodes','[]'::jsonb,'interactions','[]'::jsonb);
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,note,created_by)
  values(v_page,1,v_doc,'edit','Blank page',v_uid) returning id into v_revision;
  update public.cw_page_docs set draft_revision_id=v_revision where id=v_page;
  return v_page;
end;
$$;

create or replace function public.soft_delete_cw_page(p_page_doc_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_lecture uuid; v_count int;
begin
  perform public.cw_assert_page_editor();
  select lecture_id into v_lecture from public.cw_page_docs where id=p_page_doc_id and deleted_at is null for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  select count(*) into v_count from public.cw_page_docs where lecture_id=v_lecture and deleted_at is null;
  if v_count <= 1 then raise exception 'LAST_PAGE_FORBIDDEN'; end if;
  update public.cw_page_docs set deleted_at=now() where id=p_page_doc_id;
end;
$$;

create or replace function public.revert_cw_page_revision(p_page_doc_id uuid, p_revision_id uuid, p_base_revision_no int, p_note text default '')
returns table(revision_id uuid, revision_no int)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_page public.cw_page_docs%rowtype; v_base int; v_doc jsonb; v_next int; v_id uuid;
begin
  v_uid := public.cw_assert_page_editor();
  select * into v_page from public.cw_page_docs where id=p_page_doc_id and deleted_at is null for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  select revision_no into v_base from public.cw_page_revisions where id=coalesce(v_page.draft_revision_id,v_page.current_revision_id);
  if v_base is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  select doc into v_doc from public.cw_page_revisions where id=p_revision_id and page_doc_id=p_page_doc_id;
  if v_doc is null then raise exception 'REVISION_NOT_FOUND'; end if;
  select coalesce(max(revision_no),0)+1 into v_next from public.cw_page_revisions where page_doc_id=p_page_doc_id;
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,base_revision_id,note,created_by)
  values(p_page_doc_id,v_next,v_doc,'revert',coalesce(v_page.draft_revision_id,v_page.current_revision_id),left(trim(coalesce(p_note,'')),1000),v_uid)
  returning id into v_id;
  update public.cw_page_docs set draft_revision_id=v_id where id=p_page_doc_id;
  return query select v_id,v_next;
end;
$$;

create or replace function public.rollback_cw_lecture_release(p_lecture_id uuid, p_release_id uuid, p_note text default '')
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid; v_snapshot jsonb; v_next int; v_new uuid;
begin
  v_uid := auth.uid();
  if v_uid is null or not public.has_perm(v_uid,'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.course_lectures where id=p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  select snapshot into v_snapshot from public.cw_lecture_releases where id=p_release_id and lecture_id=p_lecture_id;
  if v_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  select coalesce(max(release_no),0)+1 into v_next from public.cw_lecture_releases where lecture_id=p_lecture_id;
  insert into public.cw_lecture_releases(lecture_id,release_no,note,snapshot,published_by)
  values(p_lecture_id,v_next,left(trim(coalesce(p_note,'')),1000),v_snapshot,v_uid) returning id into v_new;
  update public.cw_page_docs page set current_revision_id=(entry.value->>'revisionId')::uuid,draft_revision_id=null,
    aspect=case when (revision.doc->'canvas'->>'width')::numeric*3=(revision.doc->'canvas'->>'height')::numeric*4 then '4:3' else '16:9' end
  from jsonb_array_elements(v_snapshot) entry join public.cw_page_revisions revision on revision.id=(entry.value->>'revisionId')::uuid
  where page.id=(entry.value->>'pageDocId')::uuid and page.lecture_id=p_lecture_id;
  update public.course_lectures set current_release_id=v_new where id=p_lecture_id;
  return v_new;
end;
$$;

create or replace function public.review_cw_adapt_page(p_page_doc_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid,'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('approved','rejected') then raise exception 'INVALID_REVIEW_STATUS'; end if;
  update public.cw_adapt_reviews set status=p_status, reviewed_by=v_uid, reviewed_at=now(), note=left(trim(coalesce(p_note,'')),1000)
  where page_doc_id=p_page_doc_id;
  if not found then raise exception 'ADAPT_REVIEW_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.cw_assert_page_editor() from public, anon, authenticated;
revoke all on function public.reorder_cw_pages(uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.copy_cw_page(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.create_blank_cw_page(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.soft_delete_cw_page(uuid) from public, anon, authenticated;
revoke all on function public.revert_cw_page_revision(uuid,uuid,int,text) from public, anon, authenticated;
revoke all on function public.rollback_cw_lecture_release(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.review_cw_adapt_page(uuid,text,text) from public, anon, authenticated;
grant execute on function public.reorder_cw_pages(uuid,uuid[]) to authenticated;
grant execute on function public.copy_cw_page(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.create_blank_cw_page(uuid,uuid,text) to authenticated;
grant execute on function public.soft_delete_cw_page(uuid) to authenticated;
grant execute on function public.revert_cw_page_revision(uuid,uuid,int,text) to authenticated;
grant execute on function public.rollback_cw_lecture_release(uuid,uuid,text) to authenticated;
grant execute on function public.review_cw_adapt_page(uuid,text,text) to authenticated;
