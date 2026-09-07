-- 正式讲次追加自包含立方体组合页；已有页面、发布和冻结快照保持不变。
begin;

create function public.cw_formal_cube_page_is_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare block jsonb; node jsonb;
begin
  if public.cw_courseware_composition_doc_is_valid(p_doc) is not true
    or p_doc -> 'source' is distinct from 'null'::jsonb
    or p_doc #> '{overlay,canvas,backgroundBindingKey}' is distinct from 'null'::jsonb
    or p_doc #> '{overlay,interactions}' is distinct from '[]'::jsonb
    or octet_length(p_doc::text) > 750000 then return false; end if;
  for block in select value from jsonb_array_elements(p_doc #> '{layout,blocks}') loop
    if block ->> 'type' = 'tool' then
      if block #>> '{tool,contentVersion}' is distinct from 'cube-structures-lesson-v2'
        or public.cw_cube_structures_tool_is_valid(block -> 'tool') is not true then return false; end if;
    elsif block ->> 'type' is distinct from 'node' then return false;
    end if;
  end loop;
  for node in select value from jsonb_array_elements(p_doc #> '{overlay,nodes}') loop
    if coalesce(node ->> 'adapter', '') not in ('text','rich_text','shape')
      or node -> 'resources' is distinct from '[]'::jsonb
      or node -> 'children' is distinct from '[]'::jsonb then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.create_cw_formal_cube_page(p_lecture_id uuid, p_page_doc_id uuid, p_title text, p_doc jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); next_no integer; revision_id uuid;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'page.edit');
  if p_page_doc_id is null or char_length(trim(coalesce(p_title, ''))) not between 1 and 100
    or public.cw_formal_cube_page_is_valid(p_doc) is not true
    or not exists (select 1 from jsonb_array_elements(p_doc #> '{layout,blocks}') b where b ->> 'type' = 'tool')
    then raise exception 'INVALID_FORMAL_CUBE_PAGE'; end if;
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;

  -- 同一创建请求可安全重试；当前草稿和页面标题不因此回退。
  if exists (select 1 from public.cw_page_docs where id = p_page_doc_id) then
    if exists (
      select 1 from public.cw_page_docs p join public.cw_page_revisions r on r.page_doc_id = p.id and r.revision_no = 1
      where p.id = p_page_doc_id and p.lecture_id = p_lecture_id and p.deleted_at is null
        and p.source_courseware_id = 'mathin-formal-cube' and p.doc_version = 'courseware-composition-v1'
        and r.created_by = uid and r.doc = p_doc
    ) then return p_page_doc_id; end if;
    raise exception 'PAGE_ID_CONFLICT';
  end if;
  if (select count(*) from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null) >= 200
    then raise exception 'PAGE_LIMIT_EXCEEDED'; end if;
  select coalesce(max(page_no), 0) + 1 into next_no from public.cw_page_docs where lecture_id = p_lecture_id;
  insert into public.cw_page_docs(id, lecture_id, page_no, title, source_courseware_id, aspect, doc_version)
    values(p_page_doc_id, p_lecture_id, next_no, trim(p_title), 'mathin-formal-cube', '4:3', 'courseware-composition-v1');
  insert into public.cw_page_revisions(page_doc_id, revision_no, doc, origin, note, created_by, track)
    values(p_page_doc_id, 1, p_doc, 'edit', 'Create formal cube composition page', uid, 'adapted-4x3') returning id into revision_id;
  insert into public.cw_page_track_heads(page_doc_id, track, draft_revision_id) values
    (p_page_doc_id, 'native-16x9', revision_id), (p_page_doc_id, 'adapted-4x3', revision_id);
  update public.cw_page_docs set draft_revision_id = revision_id where id = p_page_doc_id;
  return p_page_doc_id;
end;
$$;

create function public.save_cw_formal_cube_page(p_page_doc_id uuid, p_track text, p_doc jsonb, p_base_revision_no integer, p_note text default '')
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); base_id uuid; base_no integer; next_no integer; next_id uuid;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  if p_track is null or p_track not in ('native-16x9','adapted-4x3')
    or p_base_revision_no is null or p_base_revision_no < 1
    or public.cw_formal_cube_page_is_valid(p_doc) is not true then raise exception 'INVALID_FORMAL_CUBE_PAGE'; end if;
  perform 1 from public.cw_page_docs where id = p_page_doc_id and deleted_at is null
    and source_courseware_id = 'mathin-formal-cube' and doc_version = 'courseware-composition-v1' for update;
  if not found then raise exception 'FORMAL_CUBE_PAGE_REQUIRED'; end if;
  select coalesce(draft_revision_id, current_revision_id) into base_id
    from public.cw_page_track_heads where page_doc_id = p_page_doc_id and track = p_track for update;
  if base_id is null then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  select r.revision_no into base_no from public.cw_page_revisions r where r.id = base_id and r.page_doc_id = p_page_doc_id;
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  select coalesce(max(r.revision_no), 0) + 1 into next_no from public.cw_page_revisions r where r.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by, track)
    values(p_page_doc_id, next_no, p_doc, 'edit', base_id, left(trim(coalesce(p_note, '')), 1000), uid, p_track) returning id into next_id;
  update public.cw_page_track_heads set draft_revision_id = next_id, updated_at = now() where page_doc_id = p_page_doc_id and track = p_track;
  if p_track = 'native-16x9' then update public.cw_page_docs set draft_revision_id = next_id where id = p_page_doc_id; end if;
  return query select next_id, next_no;
end;
$$;

revoke all on function public.cw_formal_cube_page_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_cw_formal_cube_page(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_cw_formal_cube_page(uuid,text,jsonb,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.create_cw_formal_cube_page(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.save_cw_formal_cube_page(uuid,text,jsonb,integer,text) to authenticated;
comment on function public.create_cw_formal_cube_page(uuid,uuid,text,jsonb) is 'Append a self-contained cube composition draft using existing lecture page.edit capability; preserve released page order and snapshots.';
comment on function public.save_cw_formal_cube_page(uuid,text,jsonb,integer,text) is 'Revision-checked, track-isolated saves for Mathin formal cube pages only; no release or private draft updates.';
commit;
