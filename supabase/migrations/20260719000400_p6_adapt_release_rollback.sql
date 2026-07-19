-- P6-6：按讲灰度回滚。复制旧 release 快照形成新的向前 release，不删除任何 revision。
-- 后续版本管理 migration 会以同签名 create or replace 扩展此函数，本阶段即可独立使用。
create or replace function public.rollback_cw_lecture_release(
  p_lecture_id uuid,
  p_release_id uuid,
  p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); snapshot jsonb; next_no int; release_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  select r.snapshot into snapshot from public.cw_lecture_releases r where r.id = p_release_id and r.lecture_id = p_lecture_id;
  if snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  select coalesce(max(release_no), 0) + 1 into next_no from public.cw_lecture_releases where lecture_id = p_lecture_id;
  insert into public.cw_lecture_releases (lecture_id, release_no, note, snapshot, published_by)
  values (p_lecture_id, next_no, left(trim(coalesce(p_note, '')), 1000), snapshot, uid) returning id into release_id;
  update public.cw_page_docs page
     set current_revision_id = (item.value ->> 'revisionId')::uuid,
         draft_revision_id = null,
         aspect = case when (revision.doc -> 'canvas' ->> 'width')::numeric * 3 = (revision.doc -> 'canvas' ->> 'height')::numeric * 4 then '4:3' else '16:9' end
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision on revision.id = (item.value ->> 'revisionId')::uuid
   where page.id = (item.value ->> 'pageDocId')::uuid and page.lecture_id = p_lecture_id;
  update public.course_lectures set current_release_id = release_id where id = p_lecture_id;
  return release_id;
end;
$$;
revoke all on function public.rollback_cw_lecture_release(uuid, uuid, text) from public, anon;
grant execute on function public.rollback_cw_lecture_release(uuid, uuid, text) to authenticated;
