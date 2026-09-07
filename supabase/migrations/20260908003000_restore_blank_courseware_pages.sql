-- 通用建页接口继续只创建空白页，新页面使用既有组合文档；旧页面和发布版本保持原样。
begin;

create function public.cw_manual_composition_doc_is_valid(p_doc jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare node jsonb; block jsonb; resource jsonb;
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
    if node -> 'children' is distinct from '[]'::jsonb then return false; end if;
    if node ->> 'adapter' in ('text','rich_text','shape') then
      if node -> 'resources' is distinct from '[]'::jsonb then return false; end if;
    elsif node ->> 'adapter' in ('image','h5') then
      if jsonb_array_length(node -> 'resources') is distinct from 1 then return false; end if;
      resource := node #> '{resources,0}';
      if resource ->> 'kind' is distinct from node ->> 'adapter'
        or coalesce(resource ->> 'bindingKey','') !~ '^[0-9a-f]{64}$'
        or resource ->> 'role' is distinct from (case node ->> 'adapter' when 'image' then 'image' else 'entry' end)
        or resource ->> 'bindingPath' is distinct from (case node ->> 'adapter' when 'image' then '$.src' else '$.entry' end)
        then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.create_blank_cw_page(
  p_lecture_id uuid, p_after_page_doc_id uuid default null, p_title text default ''
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare page_id uuid; revision_id uuid; overlay_doc jsonb; initial_doc jsonb;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'page.edit');
  -- 复用原有建页、页面顺序及授权规则，只调整本次新建页的初始文档。
  page_id := public.create_blank_cw_page_pre_sml0_impl(p_lecture_id, p_after_page_doc_id, p_title);
  select p.draft_revision_id into revision_id from public.cw_page_docs p where p.id = page_id;
  select r.doc into overlay_doc from public.cw_page_revisions r where r.id = revision_id;
  overlay_doc := jsonb_set(jsonb_set(overlay_doc, '{sourceCoursewareId}', '"teacher-composition-overlay"'), '{canvas,backgroundColor}', 'null');
  initial_doc := jsonb_build_object('docVersion','courseware-composition-v1',
    'canvas',jsonb_build_object('width',960,'height',720,'backgroundColor','#ffffff'),
    'source',null,'overlay',overlay_doc,
    'layout',jsonb_build_object('version','courseware-composition-grid-v1','columns',12,'rows',9,'blocks','[]'::jsonb));
  if public.cw_manual_composition_doc_is_valid(initial_doc) is not true then raise exception 'INVALID_MANUAL_COMPOSITION_PAGE'; end if;
  update public.cw_page_revisions set doc = initial_doc, track = 'native-16x9' where id = revision_id;
  update public.cw_page_docs set doc_version = 'courseware-composition-v1' where id = page_id;
  insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id) values
    (page_id,'native-16x9',revision_id),(page_id,'adapted-4x3',revision_id)
    on conflict (page_doc_id,track) do update set draft_revision_id = excluded.draft_revision_id;
  return page_id;
end;
$$;

create function public.save_cw_manual_composition_page(
  p_page_doc_id uuid, p_track text, p_doc jsonb, p_base_revision_no integer, p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); base_id uuid; base_no integer; next_no integer; next_id uuid;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  if p_track is null or p_track not in ('native-16x9','adapted-4x3') or p_base_revision_no is null or p_base_revision_no < 1
    or public.cw_manual_composition_doc_is_valid(p_doc) is not true then raise exception 'INVALID_MANUAL_COMPOSITION_PAGE'; end if;
  perform 1 from public.cw_page_docs where id = p_page_doc_id and deleted_at is null
    and source_courseware_id = 'mathin-manual' and doc_version = 'courseware-composition-v1' for update;
  if not found then raise exception 'MANUAL_COMPOSITION_PAGE_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_doc #> '{overlay,nodes}') node,
      jsonb_array_elements(node -> 'resources') resource
    where not exists (select 1 from public.cw_page_asset_bindings binding
      where binding.page_doc_id = p_page_doc_id and binding.track = p_track
        and binding.binding_key = resource ->> 'bindingKey'
        and binding.kind = resource ->> 'kind' and binding.role = resource ->> 'role')
  ) then raise exception 'COURSEWARE_DOC_BINDING_MISSING'; end if;
  select coalesce(draft_revision_id,current_revision_id) into base_id
    from public.cw_page_track_heads where page_doc_id = p_page_doc_id and track = p_track for update;
  if base_id is null then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  select r.revision_no into base_no from public.cw_page_revisions r where r.id = base_id and r.page_doc_id = p_page_doc_id;
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  select coalesce(max(r.revision_no),0)+1 into next_no from public.cw_page_revisions r where r.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,base_revision_id,note,created_by,track)
    values(p_page_doc_id,next_no,p_doc,'edit',base_id,left(trim(coalesce(p_note,'')),1000),uid,p_track) returning id into next_id;
  update public.cw_page_track_heads set draft_revision_id = next_id, updated_at = now() where page_doc_id = p_page_doc_id and track = p_track;
  if p_track = 'native-16x9' then update public.cw_page_docs set draft_revision_id = next_id where id = p_page_doc_id; end if;
  return query select next_id,next_no;
end;
$$;

revoke all on function public.cw_manual_composition_doc_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_cw_manual_composition_page(uuid,text,jsonb,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.save_cw_manual_composition_page(uuid,text,jsonb,integer,text) to authenticated;
comment on function public.create_blank_cw_page(uuid,uuid,text) is 'Create a blank manual composition through the original page creation workflow; existing pages and releases are unchanged.';
commit;
