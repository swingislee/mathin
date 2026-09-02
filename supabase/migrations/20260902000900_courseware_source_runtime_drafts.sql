-- Persist only the typed Mathin patch surface of source-runtime-page-v1.
-- Producer identity, runtime package, bindings and behavior remain immutable;
-- native/adapted tracks keep independent optimistic-lock draft heads.

begin;

create or replace function public.cw_source_runtime_page_doc_is_valid(p_doc jsonb)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_doc) <> 'object'
     or p_doc ->> 'docVersion' <> 'source-runtime-page-v1'
     or jsonb_typeof(p_doc -> 'source') <> 'object'
     or jsonb_typeof(p_doc -> 'viewport') <> 'object'
     or jsonb_typeof(p_doc -> 'runtime') <> 'object'
     or jsonb_typeof(p_doc -> 'payload') <> 'object'
     or jsonb_typeof(p_doc #> '{payload,data}') <> 'object'
     or jsonb_typeof(p_doc -> 'bindings') <> 'object'
     or jsonb_typeof(p_doc #> '{bindings,resources}') <> 'object'
     or jsonb_typeof(p_doc #> '{bindings,routes}') <> 'array'
     or jsonb_typeof(p_doc -> 'behavior') <> 'object'
     or coalesce(p_doc #>> '{runtime,protocol}', '') <> 'mathin-source-runtime-v1'
     or coalesce(p_doc #>> '{runtime,bindingKey}', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_doc #>> '{runtime,packageHash}', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_doc #>> '{runtime,sourceFingerprint}', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_doc #>> '{source,sourceContentHash}', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_doc #>> '{payload,format}', '') !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
     or coalesce(p_doc #>> '{viewport,width}', '') !~ '^[0-9]+([.][0-9]+)?$'
     or coalesce(p_doc #>> '{viewport,height}', '') !~ '^[0-9]+([.][0-9]+)?$'
     or (p_doc #>> '{viewport,width}')::numeric <= 0
     or (p_doc #>> '{viewport,height}')::numeric <= 0
     or jsonb_typeof(p_doc #> '{behavior,advanceOnCanvasClick}') <> 'boolean'
     or octet_length(p_doc::text) > 1048576 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_doc) key_name
    where key_name not in (
      'docVersion', 'source', 'viewport', 'runtime', 'payload', 'bindings', 'behavior'
    )
  ) then return false; end if;

  if exists (
    select 1
    from jsonb_each_text(p_doc #> '{bindings,resources}') resource_row
    where resource_row.key !~ '^[0-9]+$'
       or resource_row.value !~ '^[0-9a-f]{64}$'
  ) then return false; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_doc #> '{bindings,routes}') route_row
    where jsonb_typeof(route_row.value) <> 'object'
       or coalesce(route_row.value ->> 'path', '') !~ '^/[^\\]*$'
       or coalesce(route_row.value ->> 'path', '') like '%..%'
       or coalesce(route_row.value ->> 'bindingKey', '') !~ '^[0-9a-f]{64}$'
  ) then return false; end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.cw_source_runtime_payload_patch_is_valid(
  p_base_doc jsonb,
  p_candidate_doc jsonb
)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  base_data jsonb;
  candidate_data jsonb;
  base_layout jsonb;
  candidate_layout jsonb;
  metadata jsonb;
  base_node jsonb;
  candidate_node jsonb;
begin
  if not public.cw_source_runtime_page_doc_is_valid(p_base_doc)
     or not public.cw_source_runtime_page_doc_is_valid(p_candidate_doc) then
    return false;
  end if;
  if (p_candidate_doc - 'payload') is distinct from (p_base_doc - 'payload')
     or (p_candidate_doc #> '{payload,format}') is distinct from (p_base_doc #> '{payload,format}') then
    return false;
  end if;

  base_data := p_base_doc #> '{payload,data}';
  candidate_data := p_candidate_doc #> '{payload,data}';
  if (candidate_data - 'mathinCourseware' - 'layout')
     is distinct from (base_data - 'mathinCourseware' - 'layout') then
    return false;
  end if;

  metadata := candidate_data -> 'mathinCourseware';
  if metadata is not null and (
    jsonb_typeof(metadata) <> 'object'
    or metadata ->> 'adapt43Strategy' not in (
      'fit-width-top', 'fit-width-center', 'fit-height-left', 'fit-height-center'
    )
    or exists (
      select 1 from jsonb_object_keys(metadata) key_name
      where key_name <> 'adapt43Strategy'
    )
  ) then return false; end if;

  base_layout := base_data -> 'layout';
  candidate_layout := candidate_data -> 'layout';
  if base_layout is null or candidate_layout is null then
    return base_layout is not distinct from candidate_layout;
  end if;
  if jsonb_typeof(base_layout) <> 'object'
     or jsonb_typeof(candidate_layout) <> 'object'
     or jsonb_typeof(base_layout -> 'nodes') <> 'array'
     or jsonb_typeof(candidate_layout -> 'nodes') <> 'array'
     or (candidate_layout - 'nodes') is distinct from (base_layout - 'nodes')
     or jsonb_array_length(candidate_layout -> 'nodes') <> jsonb_array_length(base_layout -> 'nodes') then
    return false;
  end if;

  for base_node, candidate_node in
    select base_item.value, candidate_item.value
    from jsonb_array_elements(base_layout -> 'nodes') with ordinality base_item(value, position)
    join jsonb_array_elements(candidate_layout -> 'nodes') with ordinality candidate_item(value, position)
      using (position)
  loop
    if jsonb_typeof(base_node) <> 'object'
       or jsonb_typeof(candidate_node) <> 'object'
       or candidate_node ->> 'sourcePath' is distinct from base_node ->> 'sourcePath'
       or (
         candidate_node - 'x' - 'y' - 'width' - 'height' - 'zIndex' - 'html' - 'mathinEditor'
       ) is distinct from (
         base_node - 'x' - 'y' - 'width' - 'height' - 'zIndex' - 'html' - 'mathinEditor'
       ) then
      return false;
    end if;
    if exists (
      select 1
      from unnest(array['x', 'y', 'width', 'height', 'zIndex']) fields(field_name)
      where candidate_node ? field_name
        and jsonb_typeof(candidate_node -> field_name) <> 'number'
    ) then return false; end if;
    if candidate_node ? 'html' and jsonb_typeof(candidate_node -> 'html') <> 'string' then
      return false;
    end if;
    if candidate_node ? 'mathinEditor' and (
      jsonb_typeof(candidate_node -> 'mathinEditor') <> 'object'
      or exists (
        select 1 from jsonb_object_keys(candidate_node -> 'mathinEditor') key_name
        where key_name not in ('visible', 'opacity', 'fontSize', 'color', 'textAlign')
      )
      or jsonb_typeof(candidate_node #> '{mathinEditor,visible}') <> 'boolean'
      or jsonb_typeof(candidate_node #> '{mathinEditor,opacity}') <> 'number'
      or (
        candidate_node #> '{mathinEditor,fontSize}' <> 'null'::jsonb
        and jsonb_typeof(candidate_node #> '{mathinEditor,fontSize}') <> 'number'
      )
      or (
        candidate_node #> '{mathinEditor,color}' <> 'null'::jsonb
        and jsonb_typeof(candidate_node #> '{mathinEditor,color}') <> 'string'
      )
      or (
        candidate_node #> '{mathinEditor,textAlign}' <> 'null'::jsonb
        and candidate_node #>> '{mathinEditor,textAlign}' not in ('left', 'center', 'right', 'justify')
      )
    ) then return false; end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

alter table public.cw_page_revisions
  drop constraint cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
      'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1',
      'courseware-composition-v1'
    )
    and (doc ->> 'docVersion' <> 'source-runtime-page-v1' or public.cw_source_runtime_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'spatial-page-v1' or public.cw_spatial_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'microcourse-page-v1' or public.cw_microcourse_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'game-page-v1' or public.cw_game_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'courseware-composition-v1' or public.cw_courseware_composition_doc_is_valid(doc))
    and octet_length(doc::text) <= case
      when doc ->> 'docVersion' = 'courseware-composition-v1' then 3145728
      when doc ->> 'docVersion' in ('microcourse-page-v1', 'game-page-v1') then 2097152
      else 1048576
    end
  );

create or replace function public.save_cw_source_runtime_page_draft(
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
  uid uuid := auth.uid();
  head public.cw_page_track_heads%rowtype;
  base_id uuid;
  base_no integer;
  base_doc jsonb;
  next_no integer;
  next_id uuid;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  if p_track not in ('native-16x9', 'adapted-4x3') then
    raise exception 'INVALID_COURSEWARE_TRACK';
  end if;
  if p_base_revision_no is null or p_base_revision_no < 1 then
    raise exception 'INVALID_BASE_REVISION';
  end if;
  if not public.cw_source_runtime_page_doc_is_valid(p_doc) then
    raise exception 'INVALID_SOURCE_RUNTIME_DOC';
  end if;

  select * into head
  from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = p_track
  for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;

  base_id := coalesce(head.draft_revision_id, head.current_revision_id);
  select revision_row.revision_no, revision_row.doc
  into base_no, base_doc
  from public.cw_page_revisions revision_row
  where revision_row.id = base_id
    and revision_row.page_doc_id = p_page_doc_id;
  if not found or base_doc ->> 'docVersion' <> 'source-runtime-page-v1' then
    raise exception 'INVALID_SOURCE_RUNTIME_DOC';
  end if;
  if base_no is distinct from p_base_revision_no then
    raise exception 'VERSION_CONFLICT';
  end if;

  -- Only stable source-node edit fields and Mathin's host 4:3 strategy are
  -- mutable. Unknown producer fields, node identity/order and layout canvas
  -- must remain byte-for-byte JSON equal.
  if not public.cw_source_runtime_payload_patch_is_valid(base_doc, p_doc) then
    raise exception 'SOURCE_RUNTIME_DOCUMENT_IMMUTABLE';
  end if;

  select coalesce(max(revision_row.revision_no), 0) + 1
  into next_no
  from public.cw_page_revisions revision_row
  where revision_row.page_doc_id = p_page_doc_id;

  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by, track
  ) values (
    p_page_doc_id, next_no, p_doc, 'edit', base_id,
    left(trim(coalesce(p_note, '')), 1000), uid, p_track
  ) returning id into next_id;

  update public.cw_page_track_heads
  set draft_revision_id = next_id, updated_at = now()
  where page_doc_id = p_page_doc_id and track = p_track;
  if p_track = 'native-16x9' then
    update public.cw_page_docs
    set draft_revision_id = next_id
    where id = p_page_doc_id;
  end if;

  return query select next_id, next_no;
end;
$$;

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

  if page_version in ('page-doc-v1', 'source-runtime-page-v1')
     and p_track = 'adapted-4x3' then
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

      insert into public.cw_page_track_heads(page_doc_id, track, draft_revision_id)
      values (p_page_doc_id, 'adapted-4x3', native_base_id)
      on conflict (page_doc_id, track) do nothing;
    end if;

    insert into public.cw_page_asset_bindings(
      page_doc_id, binding_key, role, kind, shared_asset_id,
      pinned_revision_id, launch_query, track
    )
    select
      binding.page_doc_id, binding.binding_key, binding.role, binding.kind,
      binding.shared_asset_id, binding.pinned_revision_id,
      binding.launch_query, 'adapted-4x3'
    from public.cw_page_asset_bindings binding
    where binding.page_doc_id = p_page_doc_id
      and binding.track = 'native-16x9'
    on conflict (page_doc_id, binding_key, track) do nothing;
  end if;

  if page_version = 'source-runtime-page-v1' then
    return query
    select result.revision_id, result.revision_no
    from public.save_cw_source_runtime_page_draft(
      p_page_doc_id, p_track, p_doc, p_base_revision_no, p_note
    ) result;
    return;
  end if;

  return query
  select result.revision_id, result.revision_no
  from public.save_cw_track_page_draft_pre_sml0_impl(
    p_page_doc_id, p_track, p_doc, p_base_revision_no, p_note
  ) result;
end;
$$;

revoke all on function public.cw_source_runtime_page_doc_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.cw_source_runtime_payload_patch_is_valid(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.save_cw_source_runtime_page_draft(uuid, text, jsonb, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text)
  to authenticated;

comment on function public.cw_source_runtime_page_doc_is_valid(jsonb) is
  'Strict database shape gate for source-runtime-page-v1 draft revisions.';
comment on function public.cw_source_runtime_payload_patch_is_valid(jsonb, jsonb) is
  'Typed source-runtime patch gate: stable nodes may change editor geometry/text/style fields and Mathin may store one host 4:3 strategy.';
comment on function public.save_cw_source_runtime_page_draft(uuid, text, jsonb, integer, text) is
  'Private typed-patch saver: only payload.data may change; source/runtime/binding provenance stays immutable.';
comment on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) is
  'Capability-gated PageDoc, spatial and source-runtime draft save with adapted-track bootstrap.';

notify pgrst, 'reload schema';

commit;
