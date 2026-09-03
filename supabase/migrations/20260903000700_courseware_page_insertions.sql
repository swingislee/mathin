-- Shared PageDoc/source-runtime insertion path.
-- Objects stay immutable; a new page-local semantic asset and binding are
-- created before the editable document starts referencing the binding key.

begin;

create or replace function public.register_cw_page_inserted_asset(
  p_page_doc_id uuid,
  p_track text,
  p_binding_key text,
  p_sha256 text,
  p_mime text,
  p_byte_count bigint,
  p_width integer,
  p_height integer,
  p_name text,
  p_role text,
  p_kind text,
  p_storage_path text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  object_id uuid;
  asset_id uuid;
  revision_id uuid;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  if p_track not in ('native-16x9', 'adapted-4x3') then
    raise exception 'INVALID_COURSEWARE_TRACK';
  end if;
  if p_binding_key !~ '^[0-9a-f]{64}$'
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_byte_count <= 0
     or length(coalesce(p_storage_path, '')) not between 1 and 1000
     or p_kind not in ('image', 'h5')
     or p_role is distinct from (case p_kind when 'image' then 'image' else 'entry' end)
     or (p_kind = 'image' and (
       p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
       or p_byte_count > 52428800 or p_width <= 0 or p_height <= 0
       or p_storage_path <> 'sha256/' || substr(p_sha256, 1, 2) || '/' || p_sha256
     ))
     or (p_kind = 'h5' and (
       p_mime <> 'text/html' or p_byte_count > 5242880
       or p_width is not null or p_height is not null
       or p_storage_path <> 'packages/' || p_sha256 || '/index.html'
     )) then
    raise exception 'COURSEWARE_INSERT_BINDING_FAILED';
  end if;

  insert into public.cw_asset_objects(
    sha256, mime, byte_count, width, height, kind, storage_path
  ) values (
    p_sha256, p_mime, p_byte_count, p_width, p_height, p_kind, p_storage_path
  ) on conflict (sha256) do nothing;

  select object_row.id into object_id
  from public.cw_asset_objects object_row
  where object_row.sha256 = p_sha256
    and object_row.mime = p_mime
    and object_row.byte_count = p_byte_count
    and object_row.width is not distinct from p_width
    and object_row.height is not distinct from p_height
    and object_row.kind = p_kind
    and object_row.storage_path = p_storage_path;
  if object_id is null then raise exception 'OBJECT_METADATA_CONFLICT'; end if;

  insert into public.cw_shared_assets(
    name, kind, role, candidate_key, created_by
  ) values (
    left(trim(coalesce(p_name, '')), 500), p_kind, p_role,
    'page-insert:' || p_binding_key, uid
  ) returning id into asset_id;

  insert into public.cw_asset_revisions(
    shared_asset_id, revision_no, object_id, variant, note, created_by
  ) values (
    asset_id, 1, object_id, 'manual-edit', 'Page-local inserted asset', uid
  ) returning id into revision_id;

  update public.cw_shared_assets
  set draft_revision_id = revision_id, published_revision_id = revision_id
  where id = asset_id;

  insert into public.cw_asset_variant_heads(
    shared_asset_id, track, draft_revision_id, published_revision_id
  ) values (
    asset_id, p_track, revision_id, revision_id
  ) on conflict (shared_asset_id, track) do update
    set draft_revision_id = excluded.draft_revision_id,
        published_revision_id = excluded.published_revision_id,
        updated_at = now();

  insert into public.cw_page_asset_bindings(
    page_doc_id, binding_key, role, kind, shared_asset_id,
    pinned_revision_id, launch_query, track
  ) values (
    p_page_doc_id, p_binding_key, p_role, p_kind, asset_id,
    revision_id, null, p_track
  );
end;
$$;

create or replace function public.cw_source_runtime_mathin_editor_is_valid(p_state jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select p_state is null or (
    jsonb_typeof(p_state) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(p_state) key_name
      where key_name not in ('visible', 'opacity', 'fontSize', 'color', 'textAlign')
    )
    and jsonb_typeof(p_state -> 'visible') = 'boolean'
    and jsonb_typeof(p_state -> 'opacity') = 'number'
    and (p_state -> 'fontSize' = 'null'::jsonb or jsonb_typeof(p_state -> 'fontSize') = 'number')
    and (p_state -> 'color' = 'null'::jsonb or jsonb_typeof(p_state -> 'color') = 'string')
    and (p_state -> 'textAlign' = 'null'::jsonb or p_state ->> 'textAlign' in ('left', 'center', 'right', 'justify'))
  );
$$;

create or replace function public.cw_source_runtime_inserted_node_is_valid(p_node jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_node) = 'object'
    and p_node -> 'mathinInserted' = 'true'::jsonb
    and p_node ->> 'mathinNodeKind' in ('text', 'formula', 'shape', 'image', 'h5')
    and coalesce(p_node ->> 'id', '') ~ '^mathin-[A-Za-z0-9_-]+$'
    and coalesce(p_node ->> 'sourcePath', '') ~ '^[$][.]mathin[.]inserted[.]mathin-[A-Za-z0-9_-]+$'
    and coalesce(p_node ->> 'sourceType', '') ~ '^mathin:(text|formula|shape|image|h5)$'
    and p_node ->> 'kind' = 'widget_html'
    and jsonb_typeof(p_node -> 'title') = 'string'
    and jsonb_typeof(p_node -> 'html') = 'string'
    and not exists (
      select 1 from unnest(array['x', 'y', 'width', 'height', 'zIndex', 'rotation']) field_name
      where jsonb_typeof(p_node -> field_name) <> 'number'
    )
    and (p_node ->> 'width')::numeric > 0
    and (p_node ->> 'height')::numeric > 0
    and public.cw_source_runtime_mathin_editor_is_valid(p_node -> 'mathinEditor')
    and (
      p_node ->> 'mathinNodeKind' in ('text', 'formula', 'shape')
      and not (p_node ? 'mathinBindingKey') and not (p_node ? 'mathinResourceId')
      or p_node ->> 'mathinNodeKind' in ('image', 'h5')
      and coalesce(p_node ->> 'mathinBindingKey', '') ~ '^[0-9a-f]{64}$'
      and coalesce(p_node ->> 'mathinResourceId', '') ~ '^[0-9]+$'
    )
    and not exists (
      select 1 from jsonb_object_keys(p_node) key_name
      where key_name not in (
        'id', 'sourcePath', 'sourceType', 'kind', 'title', 'x', 'y', 'width',
        'height', 'zIndex', 'rotation', 'html', 'mathinInserted', 'mathinNodeKind',
        'mathinBindingKey', 'mathinResourceId', 'mathinEditor'
      )
    );
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
  if (p_candidate_doc - 'payload' - 'bindings') is distinct from (p_base_doc - 'payload' - 'bindings')
     or (p_candidate_doc #> '{payload,format}') is distinct from (p_base_doc #> '{payload,format}')
     or (p_candidate_doc #> '{bindings,routes}') is distinct from (p_base_doc #> '{bindings,routes}') then
    return false;
  end if;
  if exists (
    select 1
    from jsonb_each_text(p_base_doc #> '{bindings,resources}') base_resource
    where p_candidate_doc #>> array['bindings', 'resources', base_resource.key]
      is distinct from base_resource.value
  ) then return false; end if;

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
     or (candidate_layout - 'nodes') is distinct from (base_layout - 'nodes') then
    return false;
  end if;

  -- Every producer-owned node remains present and may only change the shared
  -- editor fields. Mathin-owned nodes may be added/removed by undo/redo.
  for base_node in
    select value from jsonb_array_elements(base_layout -> 'nodes')
    where value -> 'mathinInserted' is distinct from 'true'::jsonb
  loop
    select value into candidate_node
    from jsonb_array_elements(candidate_layout -> 'nodes')
    where value -> 'mathinInserted' is distinct from 'true'::jsonb
      and value ->> 'sourcePath' = base_node ->> 'sourcePath';
    if not found
       or jsonb_typeof(base_node) <> 'object'
       or jsonb_typeof(candidate_node) <> 'object'
       or (candidate_node - 'x' - 'y' - 'width' - 'height' - 'zIndex' - 'html' - 'mathinEditor')
          is distinct from (base_node - 'x' - 'y' - 'width' - 'height' - 'zIndex' - 'html' - 'mathinEditor')
       or not public.cw_source_runtime_mathin_editor_is_valid(candidate_node -> 'mathinEditor') then
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
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(candidate_layout -> 'nodes') candidate(value)
    where candidate.value -> 'mathinInserted' is distinct from 'true'::jsonb
      and not exists (
        select 1 from jsonb_array_elements(base_layout -> 'nodes') base(value)
        where base.value -> 'mathinInserted' is distinct from 'true'::jsonb
          and base.value ->> 'sourcePath' = candidate.value ->> 'sourcePath'
      )
  ) then return false; end if;

  if exists (
    select 1 from jsonb_array_elements(candidate_layout -> 'nodes') candidate(value)
    where candidate.value -> 'mathinInserted' = 'true'::jsonb
      and not public.cw_source_runtime_inserted_node_is_valid(candidate.value)
  ) then return false; end if;

  if exists (
    select 1
    from jsonb_array_elements(candidate_layout -> 'nodes') candidate(value)
    where candidate.value -> 'mathinInserted' = 'true'::jsonb
      and candidate.value ? 'mathinBindingKey'
      and p_candidate_doc #>> array['bindings', 'resources', candidate.value ->> 'mathinResourceId']
        is distinct from candidate.value ->> 'mathinBindingKey'
  ) then return false; end if;

  return true;
exception when others then
  return false;
end;
$$;

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
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if p_base_revision_no is null or p_base_revision_no < 1 then raise exception 'INVALID_BASE_REVISION'; end if;
  if not public.cw_source_runtime_page_doc_is_valid(p_doc) then raise exception 'INVALID_SOURCE_RUNTIME_DOC'; end if;

  select * into head from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = p_track for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  base_id := coalesce(head.draft_revision_id, head.current_revision_id);
  select revision_row.revision_no, revision_row.doc into base_no, base_doc
  from public.cw_page_revisions revision_row
  where revision_row.id = base_id and revision_row.page_doc_id = p_page_doc_id;
  if not found or base_doc ->> 'docVersion' <> 'source-runtime-page-v1' then raise exception 'INVALID_SOURCE_RUNTIME_DOC'; end if;
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  if not public.cw_source_runtime_payload_patch_is_valid(base_doc, p_doc) then
    raise exception 'SOURCE_RUNTIME_DOCUMENT_IMMUTABLE';
  end if;
  if exists (
    select 1
    from jsonb_each_text(p_doc #> '{bindings,resources}') resource_row
    left join public.cw_page_asset_bindings binding
      on binding.page_doc_id = p_page_doc_id
     and binding.track = p_track
     and binding.binding_key = resource_row.value
    where binding.id is null
  ) then raise exception 'COURSEWARE_DOC_BINDING_MISSING'; end if;

  select coalesce(max(revision_row.revision_no), 0) + 1 into next_no
  from public.cw_page_revisions revision_row where revision_row.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by, track
  ) values (
    p_page_doc_id, next_no, p_doc, 'edit', base_id,
    left(trim(coalesce(p_note, '')), 1000), uid, p_track
  ) returning id into next_id;
  update public.cw_page_track_heads set draft_revision_id = next_id, updated_at = now()
  where page_doc_id = p_page_doc_id and track = p_track;
  if p_track = 'native-16x9' then
    update public.cw_page_docs set draft_revision_id = next_id where id = p_page_doc_id;
  end if;
  return query select next_id, next_no;
end;
$$;

revoke all on function public.register_cw_page_inserted_asset(
  uuid, text, text, text, text, bigint, integer, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_cw_page_inserted_asset(
  uuid, text, text, text, text, bigint, integer, integer, text, text, text, text
) to authenticated;
revoke all on function public.cw_source_runtime_mathin_editor_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.cw_source_runtime_inserted_node_is_valid(jsonb)
  from public, anon, authenticated, service_role;

comment on function public.register_cw_page_inserted_asset(
  uuid, text, text, text, text, bigint, integer, integer, text, text, text, text
) is 'Capability-gated page-local image/H5 binding registration for the shared editor insertion toolbar.';
comment on function public.cw_source_runtime_payload_patch_is_valid(jsonb, jsonb) is
  'Preserves every producer node while allowing strictly shaped Mathin-owned nodes and monotonic resource bindings.';

notify pgrst, 'reload schema';

commit;
