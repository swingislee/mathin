-- P6-8：公共图片资源的批量替换、集合审计与前向安全回滚。
--
-- 上传先由受信 Server Action 写不可变 CAS + 本表的短期 staging 记录；
-- 绑定/指针变更始终由下方单个 SECURITY DEFINER RPC 在一个事务内完成。
-- 已发布 release 与已冻结 class_sessions 均保存具体 revision，绝不会被本操作改写。

create table public.cw_replacement_uploads (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_count bigint not null check (byte_count > 0 and byte_count <= 52428800),
  width int not null check (width > 0),
  height int not null check (height > 0),
  storage_path text not null check (storage_path ~ '^sha256/[0-9a-f]{2}/[0-9a-f]{64}$'),
  original_name text not null default '' check (length(original_name) <= 500),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour')
);

create index cw_replacement_uploads_expiry_idx
  on public.cw_replacement_uploads (expires_at);

create table public.cw_replacement_batches (
  id uuid primary key default gen_random_uuid(),
  source_shared_asset_id uuid not null references public.cw_shared_assets(id) on delete restrict,
  target_shared_asset_id uuid not null references public.cw_shared_assets(id) on delete restrict,
  new_revision_id uuid not null references public.cw_asset_revisions(id) on delete restrict,
  mode text not null check (mode in ('publish_pointer', 'branch_rebind')),
  selected_usage_count int not null check (selected_usage_count > 0),
  note text not null default '' check (length(note) <= 1000),
  status text not null default 'applied' check (status in ('applied', 'rolled_back')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  rolled_back_by uuid references public.profiles(id) on delete restrict,
  rolled_back_at timestamptz
);

create table public.cw_replacement_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.cw_replacement_batches(id) on delete restrict,
  binding_id uuid not null references public.cw_page_asset_bindings(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  lecture_id uuid not null references public.course_lectures(id) on delete restrict,
  page_doc_id uuid not null references public.cw_page_docs(id) on delete restrict,
  before_shared_asset_id uuid not null references public.cw_shared_assets(id) on delete restrict,
  before_asset_revision_id uuid not null references public.cw_asset_revisions(id) on delete restrict,
  before_pinned_revision_id uuid references public.cw_asset_revisions(id) on delete restrict,
  after_shared_asset_id uuid not null references public.cw_shared_assets(id) on delete restrict,
  after_asset_revision_id uuid not null references public.cw_asset_revisions(id) on delete restrict,
  after_pinned_revision_id uuid references public.cw_asset_revisions(id) on delete restrict,
  unique (batch_id, binding_id)
);

create index cw_replacement_batches_source_idx
  on public.cw_replacement_batches (source_shared_asset_id, created_at desc);
create index cw_replacement_items_batch_idx
  on public.cw_replacement_items (batch_id);
create index cw_replacement_items_binding_idx
  on public.cw_replacement_items (binding_id);

alter table public.cw_replacement_uploads enable row level security;
alter table public.cw_replacement_batches enable row level security;
alter table public.cw_replacement_items enable row level security;

create policy "cw_replacement_batches_select_staff" on public.cw_replacement_batches
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_replacement_items_select_staff" on public.cw_replacement_items
  for select to authenticated using (public.is_staff((select auth.uid())));

revoke all on public.cw_replacement_uploads, public.cw_replacement_batches, public.cw_replacement_items
  from anon, authenticated;
grant select on public.cw_replacement_batches, public.cw_replacement_items to authenticated;

-- 资源库列表：由资产管理权限保护，避免普通 staff 扫描全部课件资源。
create or replace function public.list_cw_shared_assets(
  p_query text default '',
  p_kind text default null,
  p_role text default null,
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
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if length(v_query) > 200 or (p_kind is not null and p_kind not in ('image', 'video', 'audio', 'svg', 'h5'))
     or (p_role is not null and (length(trim(p_role)) = 0 or length(p_role) > 100))
     or p_min_usage < 0 or p_limit < 1 or p_limit > 101 or p_offset < 0 or p_offset > 100000 then
    raise exception 'INVALID_ASSET_FILTER';
  end if;

  return query
  select
    asset.id,
    asset.name,
    asset.kind,
    asset.role,
    asset.published_revision_id,
    revision.revision_no,
    object.sha256,
    object.mime,
    object.byte_count,
    object.width,
    object.height,
    coalesce(usage.usage_count, 0),
    coalesce(usage.course_count, 0),
    coalesce(usage.lecture_count, 0),
    asset.updated_at
  from public.cw_shared_assets as asset
  left join public.cw_asset_revisions as revision on revision.id = asset.published_revision_id
  left join public.cw_asset_objects as object on object.id = revision.object_id
  left join lateral (
    select
      count(*) as usage_count,
      count(distinct lecture.course_id) as course_count,
      count(distinct page.lecture_id) as lecture_count
    from public.cw_page_asset_bindings as binding
    join public.cw_page_docs as page on page.id = binding.page_doc_id and page.deleted_at is null
    join public.course_lectures as lecture on lecture.id = page.lecture_id
    where binding.shared_asset_id = asset.id
  ) as usage on true
  where (v_query = '' or asset.name ilike '%' || v_query || '%' or coalesce(asset.candidate_key, '') ilike '%' || v_query || '%')
    and (p_kind is null or asset.kind = p_kind)
    and (p_role is null or asset.role = p_role)
    and coalesce(usage.usage_count, 0) >= p_min_usage
  order by coalesce(usage.usage_count, 0) desc, asset.updated_at desc, asset.id
  limit p_limit offset p_offset;
end;
$$;

-- 某资源的使用树：pinned binding 是独立版本，不能放入“全量指针推进”的可选集合。
create or replace function public.list_cw_shared_asset_usages(p_shared_asset_id uuid)
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
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.cw_shared_assets where id = p_shared_asset_id and kind = 'image') then
    raise exception 'SOURCE_ASSET_NOT_FOUND';
  end if;

  return query
  with frozen as (
    select
      (entry.binding ->> 'pageDocId')::uuid as page_doc_id,
      entry.binding ->> 'bindingKey' as binding_key,
      count(*) as session_count
    from public.class_sessions as session
    cross join lateral jsonb_array_elements(coalesce(session.courseware_resolved -> 'bindings', '[]'::jsonb)) as entry(binding)
    where session.deleted_at is null
      and session.courseware_resolved ->> 'version' = 'cw-session-resolved-v1'
      and jsonb_typeof(entry.binding) = 'object'
      and entry.binding ->> 'pageDocId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by 1, 2
  )
  select
    binding.id,
    binding.binding_key,
    page.id,
    page.page_no,
    page.title,
    lecture.id,
    lecture.no::int,
    lecture.name,
    course.id,
    course.title,
    course.product_code,
    binding.pinned_revision_id,
    coalesce(binding.pinned_revision_id, asset.published_revision_id),
    coalesce(frozen.session_count, 0)
  from public.cw_page_asset_bindings as binding
  join public.cw_page_docs as page on page.id = binding.page_doc_id and page.deleted_at is null
  join public.course_lectures as lecture on lecture.id = page.lecture_id
  join public.courses as course on course.id = lecture.course_id
  join public.cw_shared_assets as asset on asset.id = binding.shared_asset_id
  left join frozen on frozen.page_doc_id = page.id and frozen.binding_key = binding.binding_key
  where binding.shared_asset_id = p_shared_asset_id
  order by course.product_code nulls last, course.title, lecture.no, page.page_no, binding.binding_key;
end;
$$;

-- 全选未固定的使用位置 → 推 source 的 published 指针；否则建 semantic branch 后集合重绑。
create or replace function public.apply_cw_asset_replacement(
  p_source_shared_asset_id uuid,
  p_selected_binding_ids uuid[],
  p_upload_id uuid,
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
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if coalesce(cardinality(p_selected_binding_ids), 0) < 1 or cardinality(p_selected_binding_ids) > 50000
     or cardinality(p_selected_binding_ids) <> (select count(distinct selected_id) from unnest(p_selected_binding_ids) as selected_id)
     or length(coalesce(p_note, '')) > 1000 then
    raise exception 'INVALID_REPLACEMENT_SELECTION';
  end if;

  select * into v_upload
    from public.cw_replacement_uploads as upload
   where upload.id = p_upload_id and upload.created_by = v_uid
   for update;
  if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
  if v_upload.expires_at <= now() then raise exception 'UPLOAD_EXPIRED'; end if;

  select * into v_source
    from public.cw_shared_assets as asset
   where asset.id = p_source_shared_asset_id and asset.kind = 'image'
   for update;
  if not found then raise exception 'SOURCE_ASSET_NOT_FOUND'; end if;
  if v_source.published_revision_id is null then raise exception 'SOURCE_ASSET_UNPUBLISHED'; end if;
  v_previous_revision_id := v_source.published_revision_id;

  -- 锁住源资源的全部使用位置，让“全选”判定与批量更新之间不可穿插另一次重绑。
  perform binding.id
    from public.cw_page_asset_bindings as binding
   where binding.shared_asset_id = p_source_shared_asset_id
   for update;

  if exists (
    select 1 from unnest(p_selected_binding_ids) as selected(id)
    where not exists (select 1 from public.cw_page_asset_bindings as binding where binding.id = selected.id)
  ) then
    raise exception 'SELECTED_BINDING_NOT_FOUND';
  end if;
  if exists (
    select 1
      from public.cw_page_asset_bindings as binding
      join unnest(p_selected_binding_ids) as selected(id) on selected.id = binding.id
     where binding.shared_asset_id <> p_source_shared_asset_id
  ) then
    raise exception 'SELECTED_BINDING_NOT_FROM_SOURCE';
  end if;
  if exists (
    select 1
      from public.cw_page_asset_bindings as binding
      join unnest(p_selected_binding_ids) as selected(id) on selected.id = binding.id
     where binding.pinned_revision_id is not null
  ) then
    raise exception 'PINNED_BINDING_EXCLUDED';
  end if;

  select count(*) into v_selected_count
    from public.cw_page_asset_bindings as binding
    join unnest(p_selected_binding_ids) as selected(id) on selected.id = binding.id
   where binding.shared_asset_id = p_source_shared_asset_id;
  select count(*) into v_selectable_count
    from public.cw_page_asset_bindings as binding
   where binding.shared_asset_id = p_source_shared_asset_id and binding.pinned_revision_id is null;
  if v_selected_count <> cardinality(p_selected_binding_ids) or v_selected_count = 0 then
    raise exception 'INVALID_REPLACEMENT_SELECTION';
  end if;

  select object.id into v_object_id
    from public.cw_asset_objects as object
   where object.sha256 = v_upload.sha256
   for update;
  if found then
    if not exists (
      select 1 from public.cw_asset_objects as object
       where object.id = v_object_id
         and object.kind = 'image'
         and object.mime = v_upload.mime
         and object.byte_count = v_upload.byte_count
         and object.width = v_upload.width
         and object.height = v_upload.height
         and object.storage_path = v_upload.storage_path
    ) then
      raise exception 'OBJECT_METADATA_CONFLICT';
    end if;
  else
    insert into public.cw_asset_objects (sha256, mime, byte_count, width, height, kind, storage_path)
    values (v_upload.sha256, v_upload.mime, v_upload.byte_count, v_upload.width, v_upload.height, 'image', v_upload.storage_path)
    returning id into v_object_id;
  end if;

  if v_selected_count = v_selectable_count then
    v_mode := 'publish_pointer';
    v_target_asset_id := v_source.id;
    select coalesce(max(revision.revision_no), 0) + 1 into v_next_revision_no
      from public.cw_asset_revisions as revision
     where revision.shared_asset_id = v_source.id;
    insert into public.cw_asset_revisions (
      shared_asset_id, revision_no, object_id, derived_from_revision_id, variant, note, created_by
    ) values (
      v_source.id, v_next_revision_no, v_object_id, v_previous_revision_id, 'manual-edit', left(trim(coalesce(p_note, '')), 1000), v_uid
    ) returning id into v_new_revision_id;
    update public.cw_shared_assets
       set published_revision_id = v_new_revision_id,
           draft_revision_id = null
     where id = v_source.id;
  else
    v_mode := 'branch_rebind';
    insert into public.cw_shared_assets (name, kind, role, candidate_key, created_by)
    values (
      coalesce(nullif(v_source.name, ''), v_upload.original_name),
      'image', v_source.role, 'replacement:' || v_upload.sha256 || ':' || gen_random_uuid()::text, v_uid
    ) returning id into v_target_asset_id;
    insert into public.cw_asset_revisions (
      shared_asset_id, revision_no, object_id, derived_from_revision_id, variant, note, created_by
    ) values (
      v_target_asset_id, 1, v_object_id, v_previous_revision_id, 'manual-edit', left(trim(coalesce(p_note, '')), 1000), v_uid
    ) returning id into v_new_revision_id;
    update public.cw_shared_assets
       set published_revision_id = v_new_revision_id
     where id = v_target_asset_id;
  end if;

  insert into public.cw_replacement_batches (
    source_shared_asset_id, target_shared_asset_id, new_revision_id, mode, selected_usage_count, note, created_by
  ) values (
    v_source.id, v_target_asset_id, v_new_revision_id, v_mode, v_selected_count, left(trim(coalesce(p_note, '')), 1000), v_uid
  ) returning id into v_batch_id;

  insert into public.cw_replacement_items (
    batch_id, binding_id, course_id, lecture_id, page_doc_id,
    before_shared_asset_id, before_asset_revision_id, before_pinned_revision_id,
    after_shared_asset_id, after_asset_revision_id, after_pinned_revision_id
  )
  select
    v_batch_id, binding.id, lecture.course_id, lecture.id, page.id,
    binding.shared_asset_id, v_previous_revision_id, binding.pinned_revision_id,
    v_target_asset_id, v_new_revision_id, case when v_mode = 'publish_pointer' then binding.pinned_revision_id else null end
  from public.cw_page_asset_bindings as binding
  join unnest(p_selected_binding_ids) as selected(id) on selected.id = binding.id
  join public.cw_page_docs as page on page.id = binding.page_doc_id
  join public.course_lectures as lecture on lecture.id = page.lecture_id;

  if v_mode = 'branch_rebind' then
    update public.cw_page_asset_bindings as binding
       set shared_asset_id = v_target_asset_id,
           pinned_revision_id = null
      where binding.id = any(p_selected_binding_ids);
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
  v_previous_revision_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_batch
    from public.cw_replacement_batches as batch
   where batch.id = p_batch_id
   for update;
  if not found then raise exception 'REPLACEMENT_BATCH_NOT_FOUND'; end if;
  if v_batch.status <> 'applied' then raise exception 'REPLACEMENT_ALREADY_ROLLED_BACK'; end if;

  if v_batch.mode = 'publish_pointer' then
    perform 1 from public.cw_shared_assets as asset
     where asset.id = v_batch.source_shared_asset_id
     for update;
    if not found or (select published_revision_id from public.cw_shared_assets where id = v_batch.source_shared_asset_id) <> v_batch.new_revision_id then
      raise exception 'REPLACEMENT_ROLLBACK_CONFLICT';
    end if;
    select item.before_asset_revision_id into v_previous_revision_id
      from public.cw_replacement_items as item
     where item.batch_id = v_batch.id
     limit 1;
    if v_previous_revision_id is null then raise exception 'REPLACEMENT_AUDIT_INCOMPLETE'; end if;
    update public.cw_shared_assets
       set published_revision_id = v_previous_revision_id
     where id = v_batch.source_shared_asset_id;
  elsif v_batch.mode = 'branch_rebind' then
    perform binding.id
      from public.cw_page_asset_bindings as binding
      join public.cw_replacement_items as item on item.binding_id = binding.id
     where item.batch_id = v_batch.id
     for update;
    if exists (
      select 1
        from public.cw_replacement_items as item
        join public.cw_page_asset_bindings as binding on binding.id = item.binding_id
       where item.batch_id = v_batch.id
         and (binding.shared_asset_id is distinct from item.after_shared_asset_id
              or binding.pinned_revision_id is distinct from item.after_pinned_revision_id)
    ) then
      raise exception 'REPLACEMENT_ROLLBACK_CONFLICT';
    end if;
    update public.cw_page_asset_bindings as binding
       set shared_asset_id = item.before_shared_asset_id,
           pinned_revision_id = item.before_pinned_revision_id
      from public.cw_replacement_items as item
     where item.batch_id = v_batch.id and item.binding_id = binding.id;
  else
    raise exception 'INVALID_REPLACEMENT_BATCH';
  end if;

  update public.cw_replacement_batches
     set status = 'rolled_back', rolled_back_by = v_uid, rolled_back_at = now()
   where id = v_batch.id;
end;
$$;

revoke all on function public.list_cw_shared_assets(text,text,text,int,int,int) from public, anon, authenticated;
revoke all on function public.list_cw_shared_asset_usages(uuid) from public, anon, authenticated;
revoke all on function public.apply_cw_asset_replacement(uuid,uuid[],uuid,text) from public, anon, authenticated;
revoke all on function public.rollback_cw_asset_replacement(uuid) from public, anon, authenticated;
grant execute on function public.list_cw_shared_assets(text,text,text,int,int,int) to authenticated;
grant execute on function public.list_cw_shared_asset_usages(uuid) to authenticated;
grant execute on function public.apply_cw_asset_replacement(uuid,uuid[],uuid,text) to authenticated;
grant execute on function public.rollback_cw_asset_replacement(uuid) to authenticated;
