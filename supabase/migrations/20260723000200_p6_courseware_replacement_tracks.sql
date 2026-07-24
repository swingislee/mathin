-- P6-8：公共资源替换与审计也必须按画幅轨道隔离，不能再推进全局资源指针。
-- 历史批次发生在双轨上线前，全部视为原生 16:9；release 与已冻结课次仍保持 immutable snapshot。

alter table public.cw_replacement_batches
  add column track text not null default 'native-16x9',
  add column before_variant_published_revision_id uuid references public.cw_asset_revisions(id) on delete restrict,
  add column before_variant_draft_revision_id uuid references public.cw_asset_revisions(id) on delete restrict;
alter table public.cw_replacement_batches
  add constraint cw_replacement_batches_track_check check (track in ('native-16x9', 'adapted-4x3'));
alter table public.cw_replacement_items
  add column track text not null default 'native-16x9';
alter table public.cw_replacement_items
  add constraint cw_replacement_items_track_check check (track in ('native-16x9', 'adapted-4x3'));
create index cw_replacement_batches_source_track_idx
  on public.cw_replacement_batches (source_shared_asset_id, track, created_at desc);

-- 旧单轨签名不再暴露，PostgREST 只注册带 p_track 的双轨版本。
drop function if exists public.list_cw_shared_assets(text, text, text, integer, integer, integer);
drop function if exists public.list_cw_shared_asset_usages(uuid);
drop function if exists public.apply_cw_asset_replacement(uuid, uuid[], uuid, text);

create function public.list_cw_shared_assets(
  p_query text default '',
  p_kind text default null,
  p_role text default null,
  p_track text default 'native-16x9',
  p_min_usage int default 0,
  p_limit int default 101,
  p_offset int default 0
)
returns table(
  id uuid,
  name text,
  kind text,
  role text,
  published_revision_id uuid,
  published_revision_no int,
  object_sha256 text,
  mime text,
  byte_count bigint,
  width int,
  height int,
  usage_count bigint,
  course_count bigint,
  lecture_count bigint,
  updated_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_query text := trim(coalesce(p_query, ''));
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3')
     or length(v_query) > 200
     or (p_kind is not null and p_kind not in ('image', 'video', 'audio', 'svg', 'h5'))
     or (p_role is not null and (length(trim(p_role)) = 0 or length(p_role) > 100))
     or p_min_usage < 0 or p_limit < 1 or p_limit > 101 or p_offset < 0 or p_offset > 100000 then
    raise exception 'INVALID_ASSET_FILTER';
  end if;

  return query
  select asset.id, asset.name, asset.kind, asset.role,
         coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id),
         revision.revision_no, object.sha256, object.mime, object.byte_count, object.width, object.height,
         coalesce(usage.usage_count, 0), coalesce(usage.course_count, 0), coalesce(usage.lecture_count, 0), asset.updated_at
    from public.cw_shared_assets asset
    left join public.cw_asset_variant_heads variant
      on variant.shared_asset_id = asset.id and variant.track = p_track
    left join public.cw_asset_revisions revision
      on revision.id = coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id)
    left join public.cw_asset_objects object on object.id = revision.object_id
    left join lateral (
      select count(*) usage_count, count(distinct lecture.course_id) course_count, count(distinct page.lecture_id) lecture_count
        from public.cw_page_asset_bindings binding
        join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
        join public.course_lectures lecture on lecture.id = page.lecture_id
       where binding.shared_asset_id = asset.id and binding.track = p_track
    ) usage on true
   where (v_query = '' or asset.name ilike '%' || v_query || '%' or coalesce(asset.candidate_key, '') ilike '%' || v_query || '%')
     and (p_kind is null or asset.kind = p_kind)
     and (p_role is null or asset.role = p_role)
     and coalesce(usage.usage_count, 0) >= p_min_usage
   order by coalesce(usage.usage_count, 0) desc, asset.updated_at desc, asset.id
   limit p_limit offset p_offset;
end;
$$;

create function public.list_cw_shared_asset_usages(p_shared_asset_id uuid, p_track text)
returns table(
  binding_id uuid,
  binding_key text,
  page_doc_id uuid,
  page_no int,
  page_title text,
  lecture_id uuid,
  lecture_no int,
  lecture_name text,
  course_id uuid,
  course_title text,
  product_code text,
  pinned_revision_id uuid,
  resolved_revision_id uuid,
  frozen_session_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if not exists (select 1 from public.cw_shared_assets where id = p_shared_asset_id and kind = 'image') then
    raise exception 'SOURCE_ASSET_NOT_FOUND';
  end if;

  return query
  with frozen as (
    select (entry.binding ->> 'pageDocId')::uuid page_doc_id, entry.binding ->> 'bindingKey' binding_key, count(*) session_count
      from public.class_sessions session
      cross join lateral jsonb_array_elements(coalesce(session.courseware_resolved -> 'bindings', '[]'::jsonb)) entry(binding)
     where session.deleted_at is null
       and session.courseware_resolved ->> 'version' = 'cw-session-resolved-v1'
       and coalesce(session.courseware_resolved ->> 'track', 'native-16x9') = p_track
       and jsonb_typeof(entry.binding) = 'object'
       and entry.binding ->> 'pageDocId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     group by 1, 2
  )
  select binding.id, binding.binding_key, page.id, page.page_no, page.title,
         lecture.id, lecture.no::int, lecture.name, course.id, course.title, course.product_code,
         binding.pinned_revision_id,
         coalesce(binding.pinned_revision_id, variant.draft_revision_id, variant.published_revision_id, asset.published_revision_id),
         coalesce(frozen.session_count, 0)
    from public.cw_page_asset_bindings binding
    join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
    join public.course_lectures lecture on lecture.id = page.lecture_id
    join public.courses course on course.id = lecture.course_id
    join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
    left join public.cw_asset_variant_heads variant on variant.shared_asset_id = asset.id and variant.track = p_track
    left join frozen on frozen.page_doc_id = page.id and frozen.binding_key = binding.binding_key
   where binding.shared_asset_id = p_shared_asset_id and binding.track = p_track
   order by course.product_code nulls last, course.title, lecture.no, page.page_no, binding.binding_key;
end;
$$;

create function public.apply_cw_asset_replacement(
  p_source_shared_asset_id uuid,
  p_selected_binding_ids uuid[],
  p_upload_id uuid,
  p_track text,
  p_note text default ''
)
returns table(batch_id uuid, mode text, affected_count int)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_upload public.cw_replacement_uploads%rowtype;
  v_source public.cw_shared_assets%rowtype;
  v_variant public.cw_asset_variant_heads%rowtype;
  v_object_id uuid;
  v_target_asset_id uuid;
  v_new_revision_id uuid;
  v_previous_revision_id uuid;
  v_next_revision_no int;
  v_batch_id uuid;
  v_selected_count int;
  v_selectable_count int;
  v_mode text;
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if coalesce(cardinality(p_selected_binding_ids), 0) < 1 or cardinality(p_selected_binding_ids) > 50000
     or cardinality(p_selected_binding_ids) <> (select count(distinct selected_id) from unnest(p_selected_binding_ids) selected_id)
     or length(coalesce(p_note, '')) > 1000 then raise exception 'INVALID_REPLACEMENT_SELECTION'; end if;

  select * into v_upload from public.cw_replacement_uploads upload
   where upload.id = p_upload_id and upload.created_by = v_uid for update;
  if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if v_upload.expires_at <= now() then raise exception 'UPLOAD_EXPIRED'; end if;

  select * into v_source from public.cw_shared_assets asset
   where asset.id = p_source_shared_asset_id and asset.kind = 'image' for update;
  if not found then raise exception 'SOURCE_ASSET_NOT_FOUND'; end if;
  select * into v_variant from public.cw_asset_variant_heads variant
   where variant.shared_asset_id = p_source_shared_asset_id and variant.track = p_track for update;
  v_previous_revision_id := coalesce(v_variant.published_revision_id, v_variant.draft_revision_id, v_source.published_revision_id);
  if v_previous_revision_id is null then raise exception 'SOURCE_ASSET_UNPUBLISHED'; end if;

  -- 锁住当前画幅的全部可选使用位置，使全选判定、批次审计和重绑不可被并发操作拆开。
  perform binding.id from public.cw_page_asset_bindings binding
   where binding.shared_asset_id = p_source_shared_asset_id and binding.track = p_track for update;
  if exists (
    select 1 from unnest(p_selected_binding_ids) selected(id)
     where not exists (select 1 from public.cw_page_asset_bindings binding where binding.id = selected.id)
  ) then raise exception 'SELECTED_BINDING_NOT_FOUND'; end if;
  if exists (
    select 1 from public.cw_page_asset_bindings binding
    join unnest(p_selected_binding_ids) selected(id) on selected.id = binding.id
     where binding.shared_asset_id <> p_source_shared_asset_id or binding.track <> p_track
  ) then raise exception 'SELECTED_BINDING_NOT_FROM_SOURCE'; end if;
  if exists (
    select 1 from public.cw_page_asset_bindings binding
    join unnest(p_selected_binding_ids) selected(id) on selected.id = binding.id
     where binding.pinned_revision_id is not null
  ) then raise exception 'PINNED_BINDING_EXCLUDED'; end if;

  select count(*) into v_selected_count from public.cw_page_asset_bindings binding
    join unnest(p_selected_binding_ids) selected(id) on selected.id = binding.id
   where binding.shared_asset_id = p_source_shared_asset_id and binding.track = p_track;
  select count(*) into v_selectable_count from public.cw_page_asset_bindings binding
   where binding.shared_asset_id = p_source_shared_asset_id and binding.track = p_track and binding.pinned_revision_id is null;
  if v_selected_count <> cardinality(p_selected_binding_ids) or v_selected_count = 0 then
    raise exception 'INVALID_REPLACEMENT_SELECTION';
  end if;

  select object.id into v_object_id from public.cw_asset_objects object where object.sha256 = v_upload.sha256 for update;
  if found then
    if not exists (
      select 1 from public.cw_asset_objects object
       where object.id = v_object_id and object.kind = 'image' and object.mime = v_upload.mime
         and object.byte_count = v_upload.byte_count and object.width = v_upload.width and object.height = v_upload.height
         and object.storage_path = v_upload.storage_path
    ) then raise exception 'OBJECT_METADATA_CONFLICT'; end if;
  else
    insert into public.cw_asset_objects (sha256, mime, byte_count, width, height, kind, storage_path)
    values (v_upload.sha256, v_upload.mime, v_upload.byte_count, v_upload.width, v_upload.height, 'image', v_upload.storage_path)
    returning id into v_object_id;
  end if;

  if v_selected_count = v_selectable_count then
    v_mode := 'publish_pointer';
    v_target_asset_id := v_source.id;
    select coalesce(max(revision.revision_no), 0) + 1 into v_next_revision_no
      from public.cw_asset_revisions revision where revision.shared_asset_id = v_source.id;
    insert into public.cw_asset_revisions(shared_asset_id, revision_no, object_id, derived_from_revision_id, variant, note, created_by)
    values (v_source.id, v_next_revision_no, v_object_id, v_previous_revision_id, 'manual-edit', left(trim(coalesce(p_note, '')), 1000), v_uid)
    returning id into v_new_revision_id;
  else
    v_mode := 'branch_rebind';
    insert into public.cw_shared_assets(name, kind, role, candidate_key, created_by)
    values (coalesce(nullif(v_source.name, ''), v_upload.original_name), 'image', v_source.role,
            'replacement:' || p_track || ':' || v_upload.sha256 || ':' || gen_random_uuid()::text, v_uid)
    returning id into v_target_asset_id;
    insert into public.cw_asset_revisions(shared_asset_id, revision_no, object_id, derived_from_revision_id, variant, note, created_by)
    values (v_target_asset_id, 1, v_object_id, v_previous_revision_id, 'manual-edit', left(trim(coalesce(p_note, '')), 1000), v_uid)
    returning id into v_new_revision_id;
  end if;

  insert into public.cw_asset_variant_heads(shared_asset_id, track, draft_revision_id, published_revision_id)
  values (v_target_asset_id, p_track, null, v_new_revision_id)
  on conflict (shared_asset_id, track) do update set
    draft_revision_id = null, published_revision_id = excluded.published_revision_id, updated_at = now();
  if p_track = 'native-16x9' then
    update public.cw_shared_assets set published_revision_id = v_new_revision_id, draft_revision_id = null where id = v_target_asset_id;
  end if;

  insert into public.cw_replacement_batches(
    source_shared_asset_id, target_shared_asset_id, new_revision_id, mode, selected_usage_count, note, created_by,
    track, before_variant_published_revision_id, before_variant_draft_revision_id
  ) values (
    v_source.id, v_target_asset_id, v_new_revision_id, v_mode, v_selected_count, left(trim(coalesce(p_note, '')), 1000), v_uid,
    p_track, v_variant.published_revision_id, v_variant.draft_revision_id
  ) returning id into v_batch_id;

  insert into public.cw_replacement_items(
    batch_id, binding_id, course_id, lecture_id, page_doc_id, track,
    before_shared_asset_id, before_asset_revision_id, before_pinned_revision_id,
    after_shared_asset_id, after_asset_revision_id, after_pinned_revision_id
  )
  select v_batch_id, binding.id, lecture.course_id, lecture.id, page.id, p_track,
         binding.shared_asset_id, v_previous_revision_id, binding.pinned_revision_id,
         v_target_asset_id, v_new_revision_id, null
    from public.cw_page_asset_bindings binding
    join unnest(p_selected_binding_ids) selected(id) on selected.id = binding.id
    join public.cw_page_docs page on page.id = binding.page_doc_id
    join public.course_lectures lecture on lecture.id = page.lecture_id;

  if v_mode = 'branch_rebind' then
    update public.cw_page_asset_bindings binding set shared_asset_id = v_target_asset_id, pinned_revision_id = null
     where binding.id = any(p_selected_binding_ids) and binding.track = p_track;
  end if;

  delete from public.cw_replacement_uploads where id = v_upload.id;
  return query select v_batch_id, v_mode, v_selected_count;
end;
$$;

create or replace function public.rollback_cw_asset_replacement(p_batch_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.cw_replacement_batches%rowtype;
  v_head public.cw_asset_variant_heads%rowtype;
  v_previous_revision_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.cw_replacement_batches batch where batch.id = p_batch_id for update;
  if not found then raise exception 'REPLACEMENT_BATCH_NOT_FOUND'; end if;
  if v_batch.status <> 'applied' then raise exception 'REPLACEMENT_ALREADY_ROLLED_BACK'; end if;

  if v_batch.mode = 'publish_pointer' then
    perform 1 from public.cw_shared_assets asset where asset.id = v_batch.source_shared_asset_id for update;
    select * into v_head from public.cw_asset_variant_heads head
     where head.shared_asset_id = v_batch.source_shared_asset_id and head.track = v_batch.track for update;
    if not found or v_head.published_revision_id is distinct from v_batch.new_revision_id then
      raise exception 'REPLACEMENT_ROLLBACK_CONFLICT';
    end if;
    select coalesce(v_batch.before_variant_published_revision_id, item.before_asset_revision_id)
      into v_previous_revision_id from public.cw_replacement_items item where item.batch_id = v_batch.id limit 1;
    if v_previous_revision_id is null then raise exception 'REPLACEMENT_AUDIT_INCOMPLETE'; end if;
    update public.cw_asset_variant_heads
       set published_revision_id = v_previous_revision_id,
           draft_revision_id = v_batch.before_variant_draft_revision_id,
           updated_at = now()
     where shared_asset_id = v_batch.source_shared_asset_id and track = v_batch.track;
    if v_batch.track = 'native-16x9' then
      update public.cw_shared_assets
         set published_revision_id = v_previous_revision_id,
             draft_revision_id = v_batch.before_variant_draft_revision_id
       where id = v_batch.source_shared_asset_id;
    end if;
  elsif v_batch.mode = 'branch_rebind' then
    perform binding.id from public.cw_page_asset_bindings binding
      join public.cw_replacement_items item on item.binding_id = binding.id
     where item.batch_id = v_batch.id for update;
    if exists (
      select 1 from public.cw_replacement_items item
      left join public.cw_page_asset_bindings binding on binding.id = item.binding_id
     where item.batch_id = v_batch.id
       and (item.track <> v_batch.track or binding.id is null or binding.track is distinct from v_batch.track
            or binding.shared_asset_id is distinct from item.after_shared_asset_id
            or binding.pinned_revision_id is distinct from item.after_pinned_revision_id)
    ) then raise exception 'REPLACEMENT_ROLLBACK_CONFLICT'; end if;
    update public.cw_page_asset_bindings binding
       set shared_asset_id = item.before_shared_asset_id, pinned_revision_id = item.before_pinned_revision_id
      from public.cw_replacement_items item
     where item.batch_id = v_batch.id and item.binding_id = binding.id and binding.track = v_batch.track;
  else
    raise exception 'INVALID_REPLACEMENT_BATCH';
  end if;

  update public.cw_replacement_batches set status = 'rolled_back', rolled_back_by = v_uid, rolled_back_at = now()
   where id = v_batch.id;
end;
$$;

revoke all on function public.list_cw_shared_assets(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.list_cw_shared_asset_usages(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_cw_asset_replacement(uuid, uuid[], uuid, text, text) from public, anon, authenticated;
revoke all on function public.rollback_cw_asset_replacement(uuid) from public, anon, authenticated;
grant execute on function public.list_cw_shared_assets(text, text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.list_cw_shared_asset_usages(uuid, text) to authenticated;
grant execute on function public.apply_cw_asset_replacement(uuid, uuid[], uuid, text, text) to authenticated;
grant execute on function public.rollback_cw_asset_replacement(uuid) to authenticated;