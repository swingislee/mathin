-- SML-0：空间页 4:3-first 的 docVersion-aware 双轨生命周期。
--
-- native-16x9 / adapted-4x3 在本迁移后只表示旧平台的兼容选择键。旧导入页仍按
-- revision.track 隔离；spatial-page-v1 则按文档内 layout.profile 决定实际布局：
-- standard-4x3 revision 同时服务两条 head，wide-16x9-exception 只服务 native head。
-- 含空间页的讲次提交一次评审、发布一次事务，同时推进两条 release；任一步失败整笔回滚。

begin;

-- ---------------------------------------------------------------------------
-- 1. 显式文档版本与布局元数据
-- ---------------------------------------------------------------------------

alter table public.cw_page_docs
  add column doc_version text;

update public.cw_page_docs page
set doc_version = coalesce(
  (
    select revision.doc ->> 'docVersion'
    from public.cw_page_revisions revision
    where revision.page_doc_id = page.id
    order by revision.revision_no desc
    limit 1
  ),
  'page-doc-v1'
);

alter table public.cw_page_docs
  alter column doc_version set default 'page-doc-v1',
  alter column doc_version set not null,
  add constraint cw_page_docs_doc_version_check check (
    doc_version in ('page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1')
  );

alter table public.cw_page_revisions
  add column doc_version text,
  add column layout_profile text;

update public.cw_page_revisions revision
set doc_version = revision.doc ->> 'docVersion',
    layout_profile = case
      when revision.doc ->> 'docVersion' = 'spatial-page-v1'
        then revision.doc #>> '{layout,profile}'
      when revision.track = 'adapted-4x3'
        then 'legacy-4x3-adaptation'
      else 'legacy-16x9-import'
    end;

alter table public.cw_page_revisions
  alter column doc_version set not null,
  alter column layout_profile set not null,
  add constraint cw_page_revisions_doc_version_check check (
    doc_version in ('page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1')
  ),
  add constraint cw_page_revisions_layout_profile_check check (
    layout_profile in (
      'legacy-16x9-import',
      'legacy-4x3-adaptation',
      'standard-4x3',
      'wide-16x9-exception'
    )
  );

create function public.cw_spatial_page_doc_is_valid(p_doc jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_doc) = 'object'
    and p_doc ->> 'docVersion' = 'spatial-page-v1'
    and p_doc #>> '{layout,profile}' in ('standard-4x3', 'wide-16x9-exception')
    and jsonb_typeof(p_doc -> 'scene') = 'object'
    and coalesce(p_doc ->> 'sceneHash', '') ~ '^[0-9a-f]{64}$'
    and jsonb_typeof(p_doc -> 'source') = 'object'
    and jsonb_typeof(p_doc -> 'presentation') = 'object'
    and jsonb_typeof(p_doc -> 'classroom') = 'object'
    and jsonb_typeof(p_doc -> 'learningCheck') = 'object'
    and jsonb_typeof(p_doc -> 'fallback') = 'object'
    and jsonb_typeof(p_doc #> '{presentation,viewport}') = 'object'
    and (p_doc #>> '{presentation,viewport,width}') ~ '^[0-9]+$'
    and (p_doc #>> '{presentation,viewport,height}') ~ '^[0-9]+$'
    and (
      (
        p_doc #>> '{layout,profile}' = 'standard-4x3'
        and (p_doc #>> '{presentation,viewport,width}')::bigint * 3
          = (p_doc #>> '{presentation,viewport,height}')::bigint * 4
      )
      or (
        p_doc #>> '{layout,profile}' = 'wide-16x9-exception'
        and jsonb_typeof(p_doc #> '{layout,reason}') = 'object'
        and (p_doc #>> '{presentation,viewport,width}')::bigint * 9
          = (p_doc #>> '{presentation,viewport,height}')::bigint * 16
      )
    )
    and not exists (
      select 1
      from jsonb_object_keys(p_doc) key_name
      where key_name not in (
        'docVersion', 'layout', 'sceneHash', 'scene', 'source',
        'presentation', 'classroom', 'learningCheck', 'fallback'
      )
    )
    and octet_length(p_doc::text) <= 655360,
    false
  );
$$;

alter table public.cw_page_revisions
  drop constraint if exists cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in ('page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1')
    and (
      doc ->> 'docVersion' <> 'spatial-page-v1'
      or public.cw_spatial_page_doc_is_valid(doc)
    )
    and octet_length(doc::text) <= 1048576
  );

create function public.cw_set_revision_document_metadata()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  page_version text;
  existing_revision boolean;
begin
  new.doc_version := new.doc ->> 'docVersion';
  if new.doc_version is null then raise exception 'INVALID_PAGE_DOC'; end if;

  new.layout_profile := case
    when new.doc_version = 'spatial-page-v1' then new.doc #>> '{layout,profile}'
    when new.track = 'adapted-4x3' then 'legacy-4x3-adaptation'
    else 'legacy-16x9-import'
  end;

  select page.doc_version into page_version
  from public.cw_page_docs page
  where page.id = new.page_doc_id
  for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;

  if page_version is distinct from new.doc_version then
    select exists (
      select 1 from public.cw_page_revisions revision
      where revision.page_doc_id = new.page_doc_id
        and (tg_op = 'INSERT' or revision.id <> new.id)
    ) into existing_revision;
    if existing_revision then raise exception 'PAGE_DOC_VERSION_IMMUTABLE'; end if;
    update public.cw_page_docs
    set doc_version = new.doc_version,
        aspect = case
          when new.doc_version = 'spatial-page-v1' then '4:3'
          else aspect
        end
    where id = new.page_doc_id;
  end if;

  return new;
end;
$$;

create trigger cw_page_revisions_set_document_metadata
  before insert or update of page_doc_id, doc, track
  on public.cw_page_revisions
  for each row execute function public.cw_set_revision_document_metadata();

alter table public.cw_page_track_heads
  add column draft_layout_profile text,
  add column current_layout_profile text;

update public.cw_page_track_heads head
set draft_layout_profile = (
      select revision.layout_profile
      from public.cw_page_revisions revision
      where revision.id = head.draft_revision_id
    ),
    current_layout_profile = (
      select revision.layout_profile
      from public.cw_page_revisions revision
      where revision.id = head.current_revision_id
    );

alter table public.cw_page_track_heads
  add constraint cw_page_track_heads_draft_layout_check check (
    (draft_revision_id is null and draft_layout_profile is null)
    or (
      draft_revision_id is not null
      and draft_layout_profile in (
        'legacy-16x9-import', 'legacy-4x3-adaptation',
        'standard-4x3', 'wide-16x9-exception'
      )
    )
  ),
  add constraint cw_page_track_heads_current_layout_check check (
    (current_revision_id is null and current_layout_profile is null)
    or (
      current_revision_id is not null
      and current_layout_profile in (
        'legacy-16x9-import', 'legacy-4x3-adaptation',
        'standard-4x3', 'wide-16x9-exception'
      )
    )
  );

create function public.cw_revision_supports_track(p_revision_id uuid, p_page_doc_id uuid, p_track text)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select revision.page_doc_id = p_page_doc_id
      and case
        when revision.doc_version = 'spatial-page-v1'
          then revision.layout_profile = 'standard-4x3'
            or (revision.layout_profile = 'wide-16x9-exception' and p_track = 'native-16x9')
        else revision.track = p_track
          or (p_track = 'adapted-4x3' and revision.track = 'native-16x9')
      end
    from public.cw_page_revisions revision
    where revision.id = p_revision_id
  ), false);
$$;

create function public.cw_set_page_track_head_layout()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.track not in ('native-16x9', 'adapted-4x3') then
    raise exception 'INVALID_COURSEWARE_TRACK';
  end if;

  if new.draft_revision_id is null then
    new.draft_layout_profile := null;
  else
    if not public.cw_revision_supports_track(new.draft_revision_id, new.page_doc_id, new.track) then
      raise exception 'REVISION_TRACK_INCOMPATIBLE';
    end if;
    select revision.layout_profile into new.draft_layout_profile
    from public.cw_page_revisions revision where revision.id = new.draft_revision_id;
  end if;

  if new.current_revision_id is null then
    new.current_layout_profile := null;
  else
    if not public.cw_revision_supports_track(new.current_revision_id, new.page_doc_id, new.track) then
      raise exception 'REVISION_TRACK_INCOMPATIBLE';
    end if;
    select revision.layout_profile into new.current_layout_profile
    from public.cw_page_revisions revision where revision.id = new.current_revision_id;
  end if;

  return new;
end;
$$;

create trigger cw_page_track_heads_set_layout
  before insert or update of page_doc_id, track, draft_revision_id, current_revision_id
  on public.cw_page_track_heads
  for each row execute function public.cw_set_page_track_head_layout();

-- legacy page pointers remain a native import compatibility surface. Spatial identities keep
-- their canonical standard-4x3 pointer and must not rewrite the native head through this trigger.
create or replace function public.sync_cw_native_page_head()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.doc_version <> 'spatial-page-v1'
     and (new.draft_revision_id is not null or new.current_revision_id is not null) then
    insert into public.cw_page_track_heads(page_doc_id, track, draft_revision_id, current_revision_id)
    values(new.id, 'native-16x9', new.draft_revision_id, new.current_revision_id)
    on conflict(page_doc_id, track) do update set
      draft_revision_id = excluded.draft_revision_id,
      current_revision_id = excluded.current_revision_id,
      updated_at = now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 空间页创建、复制、保存、回退与学习检查
-- ---------------------------------------------------------------------------

create function public.create_cw_spatial_page(
  p_lecture_id uuid,
  p_after_page_doc_id uuid,
  p_title text,
  p_doc jsonb
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  page_id uuid;
  revision_id uuid;
  after_no integer;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'page.edit');
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 100 then
    raise exception 'INVALID_PAGE_TITLE';
  end if;
  if not public.cw_spatial_page_doc_is_valid(p_doc)
     or p_doc #>> '{layout,profile}' <> 'standard-4x3' then
    raise exception 'INVALID_SPATIAL_PAGE_DOC';
  end if;

  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if (select count(*) from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null) >= 200 then
    raise exception 'PAGE_LIMIT_EXCEEDED';
  end if;

  if p_after_page_doc_id is null then
    select coalesce(max(page_no), 0) into after_no
    from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null;
  else
    select page_no into after_no
    from public.cw_page_docs
    where id = p_after_page_doc_id and lecture_id = p_lecture_id and deleted_at is null;
    if not found then raise exception 'AFTER_PAGE_NOT_FOUND'; end if;
  end if;

  update public.cw_page_docs
  set page_no = page_no + 1
  where lecture_id = p_lecture_id and deleted_at is null and page_no > after_no;

  insert into public.cw_page_docs(
    lecture_id, page_no, title, source_courseware_id, source_page_id,
    aspect, doc_version
  ) values (
    p_lecture_id, after_no + 1, left(trim(coalesce(p_title, '')), 100),
    'mathin-spatial', null, '4:3', 'spatial-page-v1'
  ) returning id into page_id;

  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, note, created_by, track
  ) values (
    page_id, 1, p_doc, 'edit', 'Create spatial page', uid, 'adapted-4x3'
  ) returning id into revision_id;

  insert into public.cw_page_track_heads(
    page_doc_id, track, draft_revision_id, current_revision_id
  ) values
    (page_id, 'native-16x9', revision_id, null),
    (page_id, 'adapted-4x3', revision_id, null);

  update public.cw_page_docs
  set draft_revision_id = revision_id, aspect = '4:3'
  where id = page_id;

  return page_id;
end;
$$;

create function public.copy_cw_spatial_page(
  p_source_page_doc_id uuid,
  p_target_lecture_id uuid,
  p_after_page_doc_id uuid,
  p_title text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  source_page public.cw_page_docs%rowtype;
  source_revision_id uuid;
  source_doc jsonb;
  source_native_revision_id uuid;
  source_native_doc jsonb;
  source_native_layout text;
  target_page_id uuid;
  target_revision_id uuid;
  target_native_revision_id uuid;
  after_no integer;
begin
  select * into source_page
  from public.cw_page_docs
  where id = p_source_page_doc_id and deleted_at is null;
  if not found or source_page.doc_version <> 'spatial-page-v1' then raise exception 'PAGE_NOT_FOUND'; end if;

  select coalesce(head.draft_revision_id, head.current_revision_id) into source_revision_id
  from public.cw_page_track_heads head
  where head.page_doc_id = p_source_page_doc_id and head.track = 'adapted-4x3';
  select revision.doc into source_doc
  from public.cw_page_revisions revision where revision.id = source_revision_id;
  if source_doc is null then raise exception 'PAGE_HAS_NO_BASE_REVISION'; end if;
  select coalesce(head.draft_revision_id, head.current_revision_id) into source_native_revision_id
  from public.cw_page_track_heads head
  where head.page_doc_id = p_source_page_doc_id and head.track = 'native-16x9';
  select revision.doc, revision.layout_profile into source_native_doc, source_native_layout
  from public.cw_page_revisions revision where revision.id = source_native_revision_id;
  if source_native_doc is null then raise exception 'PAGE_HAS_NO_BASE_REVISION'; end if;
  if source_native_revision_id <> source_revision_id
     and source_native_layout <> 'wide-16x9-exception' then
    raise exception 'PAGE_TRACK_NOT_READY';
  end if;

  perform 1 from public.course_lectures where id = p_target_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if (select count(*) from public.cw_page_docs where lecture_id = p_target_lecture_id and deleted_at is null) >= 200 then
    raise exception 'PAGE_LIMIT_EXCEEDED';
  end if;

  if p_after_page_doc_id is null then
    select coalesce(max(page_no), 0) into after_no
    from public.cw_page_docs where lecture_id = p_target_lecture_id and deleted_at is null;
  else
    select page_no into after_no
    from public.cw_page_docs
    where id = p_after_page_doc_id and lecture_id = p_target_lecture_id and deleted_at is null;
    if not found then raise exception 'AFTER_PAGE_NOT_FOUND'; end if;
  end if;

  update public.cw_page_docs set page_no = page_no + 1
  where lecture_id = p_target_lecture_id and deleted_at is null and page_no > after_no;

  insert into public.cw_page_docs(
    lecture_id, page_no, title, source_courseware_id, source_page_id,
    aspect, doc_version
  ) values (
    p_target_lecture_id, after_no + 1,
    left(trim(coalesce(nullif(p_title, ''), source_page.title)), 100),
    source_page.source_courseware_id, source_page.source_page_id,
    '4:3', 'spatial-page-v1'
  ) returning id into target_page_id;

  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, note, created_by, track
  ) values (
    target_page_id, 1, source_doc, 'edit', 'Copied spatial page', uid, 'adapted-4x3'
  ) returning id into target_revision_id;

  if source_native_revision_id <> source_revision_id then
    insert into public.cw_page_revisions(
      page_doc_id, revision_no, doc, origin, note, created_by, track
    ) values (
      target_page_id, 2, source_native_doc, 'edit',
      'Copied spatial wide exception', uid, 'native-16x9'
    ) returning id into target_native_revision_id;
  end if;

  insert into public.cw_page_track_heads(page_doc_id, track, draft_revision_id)
  values
    (target_page_id, 'native-16x9', coalesce(target_native_revision_id, target_revision_id)),
    (target_page_id, 'adapted-4x3', target_revision_id);

  insert into public.cw_page_asset_bindings(
    page_doc_id, binding_key, role, kind, shared_asset_id,
    pinned_revision_id, launch_query, track
  )
  select target_page_id, binding.binding_key, binding.role, binding.kind,
         binding.shared_asset_id, binding.pinned_revision_id,
         binding.launch_query, binding.track
  from public.cw_page_asset_bindings binding
  where binding.page_doc_id = p_source_page_doc_id;

  update public.cw_page_docs
  set draft_revision_id = target_revision_id, aspect = '4:3'
  where id = target_page_id;

  return target_page_id;
end;
$$;

create or replace function public.copy_cw_page(
  p_source_page_doc_id uuid,
  p_target_lecture_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare source_version text;
begin
  perform public.assert_cw_lecture_capability(p_target_lecture_id, 'page.edit');
  select doc_version into source_version
  from public.cw_page_docs where id = p_source_page_doc_id and deleted_at is null;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if source_version = 'spatial-page-v1' then
    return public.copy_cw_spatial_page(
      p_source_page_doc_id, p_target_lecture_id, p_after_page_doc_id, p_title
    );
  end if;
  return public.copy_cw_page_pre_sml0_impl(
    p_source_page_doc_id, p_target_lecture_id, p_after_page_doc_id, p_title
  );
end;
$$;

create function public.save_cw_spatial_page_draft(
  p_page_doc_id uuid,
  p_track text,
  p_doc jsonb,
  p_base_revision_no integer,
  p_note text
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  requested_head public.cw_page_track_heads%rowtype;
  base_id uuid;
  base_no integer;
  base_doc jsonb;
  layout_value text;
  next_no integer;
  next_id uuid;
begin
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if p_base_revision_no is null or p_base_revision_no < 1 then raise exception 'INVALID_BASE_REVISION'; end if;
  if not public.cw_spatial_page_doc_is_valid(p_doc) then raise exception 'INVALID_SPATIAL_PAGE_DOC'; end if;

  perform 1 from public.cw_page_docs
  where id = p_page_doc_id and deleted_at is null and doc_version = 'spatial-page-v1'
  for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;

  select * into requested_head
  from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = p_track
  for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;

  base_id := coalesce(requested_head.draft_revision_id, requested_head.current_revision_id);
  select revision.revision_no, revision.doc into base_no, base_doc
  from public.cw_page_revisions revision where revision.id = base_id;
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  if (p_doc -> 'source') is distinct from (base_doc -> 'source') then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
  end if;

  layout_value := p_doc #>> '{layout,profile}';
  if layout_value = 'wide-16x9-exception' and p_track <> 'native-16x9' then
    raise exception 'LAYOUT_TRACK_INCOMPATIBLE';
  end if;

  if layout_value = 'standard-4x3' then
    perform 1 from public.cw_page_track_heads
    where page_doc_id = p_page_doc_id
      and track in ('native-16x9', 'adapted-4x3')
    for update;
    if (select count(*) from public.cw_page_track_heads
        where page_doc_id = p_page_doc_id
          and track in ('native-16x9', 'adapted-4x3')) <> 2 then
      raise exception 'PAGE_TRACK_NOT_READY';
    end if;
  end if;

  select coalesce(max(revision.revision_no), 0) + 1 into next_no
  from public.cw_page_revisions revision where revision.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by, track
  ) values (
    p_page_doc_id, next_no, p_doc, 'edit', base_id,
    left(trim(coalesce(p_note, '')), 1000), uid,
    case when layout_value = 'standard-4x3' then 'adapted-4x3' else 'native-16x9' end
  ) returning id into next_id;

  update public.cw_page_track_heads
  set draft_revision_id = next_id, updated_at = now()
  where page_doc_id = p_page_doc_id
    and (
      (layout_value = 'standard-4x3' and track in ('native-16x9', 'adapted-4x3'))
      or (layout_value = 'wide-16x9-exception' and track = 'native-16x9')
    );

  if layout_value = 'standard-4x3' then
    update public.cw_page_docs
    set draft_revision_id = next_id, aspect = '4:3'
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
declare page_version text;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  select doc_version into page_version
  from public.cw_page_docs where id = p_page_doc_id and deleted_at is null;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if page_version = 'spatial-page-v1' then
    return query select * from public.save_cw_spatial_page_draft(
      p_page_doc_id, p_track, p_doc, p_base_revision_no, p_note
    );
    return;
  end if;
  return query
  select result.revision_id, result.revision_no
  from public.save_cw_track_page_draft_pre_sml0_impl(
    p_page_doc_id, p_track, p_doc, p_base_revision_no, p_note
  ) result;
end;
$$;

create function public.revert_cw_spatial_page_revision(
  p_page_doc_id uuid,
  p_track text,
  p_revision_id uuid,
  p_base_revision_no integer,
  p_note text
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  requested_head public.cw_page_track_heads%rowtype;
  target_doc jsonb;
  target_layout text;
  base_no integer;
  next_no integer;
  next_id uuid;
begin
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.cw_page_docs
  where id = p_page_doc_id and deleted_at is null and doc_version = 'spatial-page-v1'
  for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;

  select * into requested_head
  from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = p_track
  for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;

  select revision.doc, revision.layout_profile into target_doc, target_layout
  from public.cw_page_revisions revision
  where revision.id = p_revision_id
    and revision.page_doc_id = p_page_doc_id
    and revision.doc_version = 'spatial-page-v1';
  if target_doc is null
     or not public.cw_revision_supports_track(p_revision_id, p_page_doc_id, p_track) then
    raise exception 'REVISION_NOT_FOUND';
  end if;

  select revision.revision_no into base_no
  from public.cw_page_revisions revision
  where revision.id = coalesce(requested_head.draft_revision_id, requested_head.current_revision_id);
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;

  if target_layout = 'standard-4x3' then
    perform 1 from public.cw_page_track_heads
    where page_doc_id = p_page_doc_id
      and track in ('native-16x9', 'adapted-4x3')
    for update;
  end if;

  select coalesce(max(revision.revision_no), 0) + 1 into next_no
  from public.cw_page_revisions revision where revision.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by, track
  ) values (
    p_page_doc_id, next_no, target_doc, 'revert', p_revision_id,
    left(trim(coalesce(p_note, '')), 1000), uid,
    case when target_layout = 'standard-4x3' then 'adapted-4x3' else 'native-16x9' end
  ) returning id into next_id;

  update public.cw_page_track_heads
  set draft_revision_id = next_id, updated_at = now()
  where page_doc_id = p_page_doc_id
    and (
      (target_layout = 'standard-4x3' and track in ('native-16x9', 'adapted-4x3'))
      or (target_layout = 'wide-16x9-exception' and track = 'native-16x9')
    );
  if target_layout = 'standard-4x3' then
    update public.cw_page_docs
    set draft_revision_id = next_id, aspect = '4:3'
    where id = p_page_doc_id;
  end if;
  return query select next_id, next_no;
end;
$$;

create or replace function public.revert_cw_track_page_revision(
  p_page_doc_id uuid,
  p_track text,
  p_revision_id uuid,
  p_base_revision_no integer,
  p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare page_version text;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  select doc_version into page_version
  from public.cw_page_docs where id = p_page_doc_id and deleted_at is null
  for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if page_version = 'spatial-page-v1' then
    return query select * from public.revert_cw_spatial_page_revision(
      p_page_doc_id, p_track, p_revision_id, p_base_revision_no, p_note
    );
    return;
  end if;
  return query
  select result.revision_id, result.revision_no
  from public.revert_cw_track_page_revision_pre_sml0_impl(
    p_page_doc_id, p_track, p_revision_id, p_base_revision_no, p_note
  ) result;
end;
$$;

create or replace function public.set_cw_page_learning_check_flag(
  p_page_doc_id uuid,
  p_track text,
  p_enabled boolean
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare page_version text;
begin
  perform public.assert_cw_page_capability(p_page_doc_id, 'page.edit');
  select doc_version into page_version
  from public.cw_page_docs where id = p_page_doc_id and deleted_at is null
  for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if page_version = 'spatial-page-v1' then
    perform public.set_cw_page_learning_check_flag_pre_sml0_impl(
      p_page_doc_id, 'native-16x9', p_enabled
    );
    perform public.set_cw_page_learning_check_flag_pre_sml0_impl(
      p_page_doc_id, 'adapted-4x3', p_enabled
    );
    return;
  end if;
  perform public.set_cw_page_learning_check_flag_pre_sml0_impl(
    p_page_doc_id, p_track, p_enabled
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. paired delivery snapshot 与 release group
-- ---------------------------------------------------------------------------

alter table public.cw_lecture_releases
  add column delivery_group_id uuid,
  add column delivery_mode text;

update public.cw_lecture_releases
set delivery_group_id = id,
    delivery_mode = 'legacy-single-track';

alter table public.cw_lecture_releases
  alter column delivery_group_id set default gen_random_uuid(),
  alter column delivery_group_id set not null,
  alter column delivery_mode set default 'legacy-single-track',
  alter column delivery_mode set not null,
  add constraint cw_lecture_releases_delivery_mode_check check (
    delivery_mode in (
      'legacy-single-track',
      'shared-standard-4x3',
      'wide-16x9-exception'
    )
  ),
  add constraint cw_lecture_releases_delivery_group_track_key
    unique (delivery_group_id, track);

alter table public.cw_review_cycles
  add column delivery_mode text not null default 'legacy-single-track',
  add column published_release_ids jsonb,
  add constraint cw_review_cycles_delivery_mode_check check (
    delivery_mode in (
      'legacy-single-track',
      'shared-standard-4x3',
      'wide-16x9-exception'
    )
  ),
  add constraint cw_review_cycles_published_release_ids_check check (
    published_release_ids is null
    or (
      jsonb_typeof(published_release_ids) = 'object'
      and coalesce(published_release_ids ->> 'native-16x9', '') ~ '^[0-9a-f-]{36}$'
      and coalesce(published_release_ids ->> 'adapted-4x3', '') ~ '^[0-9a-f-]{36}$'
    )
  );

create function public.cw_lecture_has_spatial_pages(p_lecture_id uuid)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.cw_page_docs page
    where page.lecture_id = p_lecture_id
      and page.deleted_at is null
      and page.doc_version = 'spatial-page-v1'
  );
$$;

create or replace function public.build_cw_track_snapshot(p_lecture_id uuid, p_track text)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_agg(
    jsonb_build_object(
      'pageDocId', rows.page_id,
      'revisionId', rows.revision_id,
      'bindings', rows.bindings,
      'learningCheckEnabled', rows.learning_check_enabled
    ) order by rows.page_no
  )
  from (
    select
      page.id page_id,
      page.page_no,
      coalesce(head.draft_revision_id, head.current_revision_id) revision_id,
      coalesce(flags.draft_enabled, flags.published_enabled, false) learning_check_enabled,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'bindingKey', binding.binding_key,
            'assetRevisionId', coalesce(
              binding.pinned_revision_id,
              variant.draft_revision_id,
              variant.published_revision_id,
              asset.published_revision_id
            )
          ) order by binding.binding_key
        )
        from public.cw_page_asset_bindings binding
        join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
        left join public.cw_asset_variant_heads variant
          on variant.shared_asset_id = binding.shared_asset_id
         and variant.track = p_track
        where binding.page_doc_id = page.id and binding.track = p_track
      ), '[]'::jsonb) bindings
    from public.cw_page_docs page
    join public.cw_page_track_heads head
      on head.page_doc_id = page.id and head.track = p_track
    left join public.cw_page_learning_check_flags flags
      on flags.page_doc_id = page.id and flags.track = p_track
    where page.lecture_id = p_lecture_id and page.deleted_at is null
  ) rows;
$$;

create function public.cw_paired_delivery_is_ready(p_lecture_id uuid)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select public.cw_lecture_has_spatial_pages(p_lecture_id)
    and public.cw_track_is_ready(p_lecture_id, 'native-16x9')
    and public.cw_track_is_ready(p_lecture_id, 'adapted-4x3')
    and not exists (
      select 1
      from public.cw_page_docs page
      join public.cw_page_track_heads native_head
        on native_head.page_doc_id = page.id and native_head.track = 'native-16x9'
      join public.cw_page_track_heads adapted_head
        on adapted_head.page_doc_id = page.id and adapted_head.track = 'adapted-4x3'
      join public.cw_page_revisions native_revision
        on native_revision.id = coalesce(native_head.draft_revision_id, native_head.current_revision_id)
      join public.cw_page_revisions adapted_revision
        on adapted_revision.id = coalesce(adapted_head.draft_revision_id, adapted_head.current_revision_id)
      where page.lecture_id = p_lecture_id
        and page.deleted_at is null
        and page.doc_version = 'spatial-page-v1'
        and (
          adapted_revision.layout_profile <> 'standard-4x3'
          or native_revision.layout_profile not in ('standard-4x3', 'wide-16x9-exception')
          or (
            native_revision.layout_profile = 'standard-4x3'
            and native_revision.id <> adapted_revision.id
          )
          or (
            native_revision.layout_profile = 'wide-16x9-exception'
            and (
              native_revision.doc - 'layout' - 'presentation'
              is distinct from
              adapted_revision.doc - 'layout' - 'presentation'
            )
          )
        )
    );
$$;

create function public.cw_paired_delivery_mode(p_lecture_id uuid)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select case when exists (
    select 1
    from public.cw_page_docs page
    join public.cw_page_track_heads head
      on head.page_doc_id = page.id and head.track = 'native-16x9'
    join public.cw_page_revisions revision
      on revision.id = coalesce(head.draft_revision_id, head.current_revision_id)
    where page.lecture_id = p_lecture_id
      and page.deleted_at is null
      and page.doc_version = 'spatial-page-v1'
      and revision.layout_profile = 'wide-16x9-exception'
  ) then 'wide-16x9-exception' else 'shared-standard-4x3' end;
$$;

create function public.build_cw_paired_delivery_snapshot(p_lecture_id uuid)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  native_snapshot jsonb;
  adapted_snapshot jsonb;
  result jsonb;
begin
  if not public.cw_paired_delivery_is_ready(p_lecture_id) then
    raise exception 'PAIRED_TRACKS_NOT_READY';
  end if;
  native_snapshot := public.build_cw_track_snapshot(p_lecture_id, 'native-16x9');
  adapted_snapshot := public.build_cw_track_snapshot(p_lecture_id, 'adapted-4x3');
  result := jsonb_build_object(
    'deliveryVersion', 'cw-paired-delivery-v1',
    'mode', public.cw_paired_delivery_mode(p_lecture_id),
    'tracks', jsonb_build_object(
      'native-16x9', native_snapshot,
      'adapted-4x3', adapted_snapshot
    )
  );
  if octet_length(result::text) > 2097152 then
    raise exception 'PAIRED_SNAPSHOT_TOO_LARGE';
  end if;
  return result;
end;
$$;

create function public.cw_paired_snapshot_is_valid(p_snapshot jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_snapshot) = 'object'
    and p_snapshot ->> 'deliveryVersion' = 'cw-paired-delivery-v1'
    and p_snapshot ->> 'mode' in ('shared-standard-4x3', 'wide-16x9-exception')
    and jsonb_typeof(p_snapshot #> '{tracks,native-16x9}') = 'array'
    and jsonb_typeof(p_snapshot #> '{tracks,adapted-4x3}') = 'array'
    and jsonb_array_length(p_snapshot #> '{tracks,native-16x9}') between 1 and 200
    and jsonb_array_length(p_snapshot #> '{tracks,adapted-4x3}') between 1 and 200
    and octet_length(p_snapshot::text) <= 2097152,
    false
  );
$$;

create function public.sync_cw_spatial_page_pointers(p_lecture_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.cw_page_docs page
  set current_revision_id = adapted_head.current_revision_id,
      draft_revision_id = adapted_head.draft_revision_id,
      aspect = '4:3'
  from public.cw_page_track_heads adapted_head
  where page.lecture_id = p_lecture_id
    and page.deleted_at is null
    and page.doc_version = 'spatial-page-v1'
    and adapted_head.page_doc_id = page.id
    and adapted_head.track = 'adapted-4x3';
end;
$$;

create or replace function public.perform_cw_publish(
  p_lecture_id uuid,
  p_track text,
  p_note text,
  p_snapshot jsonb,
  p_uid uuid
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  next_no integer;
  release_id uuid;
begin
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if jsonb_typeof(p_snapshot) <> 'array'
     or jsonb_array_length(p_snapshot) < 1
     or jsonb_array_length(p_snapshot) > 200
     or octet_length(p_snapshot::text) > 1048576 then
    raise exception 'RELEASE_SNAPSHOT_TOO_LARGE_OR_INVALID';
  end if;

  select coalesce(max(release_no), 0) + 1 into next_no
  from public.cw_lecture_releases where lecture_id = p_lecture_id and track = p_track;
  insert into public.cw_lecture_releases(
    lecture_id, release_no, note, snapshot, published_by, track
  ) values (
    p_lecture_id, next_no, left(trim(coalesce(p_note, '')), 1000),
    p_snapshot, p_uid, p_track
  ) returning id into release_id;

  update public.cw_page_track_heads head
  set current_revision_id = (item.value ->> 'revisionId')::uuid,
      draft_revision_id = case
        when head.draft_revision_id = (item.value ->> 'revisionId')::uuid then null
        else head.draft_revision_id
      end,
      updated_at = now()
  from jsonb_array_elements(p_snapshot) item
  where head.page_doc_id = (item.value ->> 'pageDocId')::uuid
    and head.track = p_track;

  insert into public.cw_page_learning_check_flags(
    page_doc_id, track, published_enabled, updated_by, updated_at
  )
  select (item.value ->> 'pageDocId')::uuid,
         p_track,
         coalesce((item.value ->> 'learningCheckEnabled')::boolean, false),
         p_uid,
         now()
  from jsonb_array_elements(p_snapshot) item
  where item.value ? 'learningCheckEnabled'
  on conflict(page_doc_id, track) do update
    set published_enabled = excluded.published_enabled,
        draft_enabled = null,
        updated_by = p_uid,
        updated_at = now();

  insert into public.cw_lecture_track_heads(lecture_id, track, current_release_id)
  values (p_lecture_id, p_track, release_id)
  on conflict (lecture_id, track) do update
    set current_release_id = excluded.current_release_id,
        updated_at = now();

  if p_track = 'native-16x9' then
    update public.cw_page_docs page
    set current_revision_id = (item.value ->> 'revisionId')::uuid,
        draft_revision_id = case
          when page.draft_revision_id = (item.value ->> 'revisionId')::uuid then null
          else page.draft_revision_id
        end,
        aspect = '16:9'
    from jsonb_array_elements(p_snapshot) item
    where page.id = (item.value ->> 'pageDocId')::uuid
      and page.lecture_id = p_lecture_id
      and page.doc_version <> 'spatial-page-v1';
    update public.course_lectures
    set current_release_id = release_id
    where id = p_lecture_id;
  end if;

  return release_id;
end;
$$;

create function public.perform_cw_paired_publish(
  p_lecture_id uuid,
  p_note text,
  p_snapshot jsonb,
  p_uid uuid
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  group_id uuid := gen_random_uuid();
  mode_value text;
  native_release_id uuid;
  adapted_release_id uuid;
begin
  if not public.cw_paired_snapshot_is_valid(p_snapshot) then
    raise exception 'INVALID_PAIRED_SNAPSHOT';
  end if;
  mode_value := p_snapshot ->> 'mode';
  native_release_id := public.perform_cw_publish(
    p_lecture_id, 'native-16x9', p_note,
    p_snapshot #> '{tracks,native-16x9}', p_uid
  );
  adapted_release_id := public.perform_cw_publish(
    p_lecture_id, 'adapted-4x3', p_note,
    p_snapshot #> '{tracks,adapted-4x3}', p_uid
  );

  update public.cw_lecture_releases
  set delivery_group_id = group_id,
      delivery_mode = mode_value
  where id in (native_release_id, adapted_release_id);

  perform public.sync_cw_spatial_page_pointers(p_lecture_id);

  return jsonb_build_object(
    'deliveryGroupId', group_id,
    'mode', mode_value,
    'native-16x9', native_release_id,
    'adapted-4x3', adapted_release_id
  );
end;
$$;

create or replace function public.publish_cw_track_release(
  p_lecture_id uuid,
  p_track text,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.publish');
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if not public.cw_lecture_has_spatial_pages(p_lecture_id) then
    return public.publish_cw_track_release_pre_sml0_impl(p_lecture_id, p_track, p_note);
  end if;

  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not public.cw_paired_delivery_is_ready(p_lecture_id) then
    raise exception 'PAIRED_TRACKS_NOT_READY';
  end if;
  result := public.perform_cw_paired_publish(
    p_lecture_id,
    p_note,
    public.build_cw_paired_delivery_snapshot(p_lecture_id),
    auth.uid()
  );
  return (result ->> p_track)::uuid;
end;
$$;

create function public.rollback_cw_single_release_internal(
  p_lecture_id uuid,
  p_track text,
  p_release_id uuid,
  p_note text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_courseware jsonb;
  rollback_release_id uuid;
begin
  select release_value.courseware_pages into source_courseware
  from public.cw_lecture_releases release_value
  where release_value.id = p_release_id
    and release_value.lecture_id = p_lecture_id
    and release_value.track = p_track;
  if source_courseware is null then raise exception 'RELEASE_NOT_FOUND'; end if;

  rollback_release_id := public.rollback_cw_track_release_pre_sml0_impl(
    p_lecture_id, p_track, p_release_id, p_note
  );
  update public.cw_lecture_releases
  set courseware_pages = source_courseware
  where id = rollback_release_id;
  if p_track = 'native-16x9' then
    update public.course_lectures
    set courseware_template = source_courseware
    where id = p_lecture_id and current_release_id = rollback_release_id;
  end if;
  return rollback_release_id;
end;
$$;

create or replace function public.rollback_cw_track_release(
  p_lecture_id uuid,
  p_track text,
  p_release_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_release public.cw_lecture_releases%rowtype;
  source_native uuid;
  source_adapted uuid;
  next_native uuid;
  next_adapted uuid;
  next_group uuid := gen_random_uuid();
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback');
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;

  select * into source_release
  from public.cw_lecture_releases release_value
  where release_value.id = p_release_id
    and release_value.lecture_id = p_lecture_id
    and release_value.track = p_track;
  if not found then raise exception 'RELEASE_NOT_FOUND'; end if;

  if source_release.delivery_mode = 'legacy-single-track' then
    if public.cw_lecture_has_spatial_pages(p_lecture_id) then
      raise exception 'PAIRED_RELEASE_REQUIRED';
    end if;
    return public.rollback_cw_single_release_internal(
      p_lecture_id, p_track, p_release_id, p_note
    );
  end if;

  select
    (array_agg(release_value.id order by release_value.published_at desc, release_value.id desc)
      filter (where release_value.track = 'native-16x9'))[1],
    (array_agg(release_value.id order by release_value.published_at desc, release_value.id desc)
      filter (where release_value.track = 'adapted-4x3'))[1]
  into source_native, source_adapted
  from public.cw_lecture_releases release_value
  where release_value.delivery_group_id = source_release.delivery_group_id
    and release_value.lecture_id = p_lecture_id;
  if source_native is null or source_adapted is null then
    raise exception 'PAIRED_RELEASE_INCOMPLETE';
  end if;

  next_native := public.rollback_cw_single_release_internal(
    p_lecture_id, 'native-16x9', source_native, p_note
  );
  next_adapted := public.rollback_cw_single_release_internal(
    p_lecture_id, 'adapted-4x3', source_adapted, p_note
  );
  update public.cw_lecture_releases
  set delivery_group_id = next_group,
      delivery_mode = source_release.delivery_mode
  where id in (next_native, next_adapted);
  perform public.sync_cw_spatial_page_pointers(p_lecture_id);

  return case when p_track = 'native-16x9' then next_native else next_adapted end;
end;
$$;

create or replace function public.rollback_cw_lecture_release(
  p_lecture_id uuid,
  p_release_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare release_track text;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback');
  select release_value.track into release_track
  from public.cw_lecture_releases release_value
  where release_value.id = p_release_id
    and release_value.lecture_id = p_lecture_id;
  if not found then raise exception 'RELEASE_NOT_FOUND'; end if;
  return public.rollback_cw_track_release(
    p_lecture_id, release_track, p_release_id, p_note
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 一次评审驱动 paired workflow 与双 release
-- ---------------------------------------------------------------------------

create function public.sync_cw_paired_workflow(
  p_lecture_id uuid,
  p_source_track text,
  p_uid uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_track text;
begin
  target_track := case
    when p_source_track = 'native-16x9' then 'adapted-4x3'
    else 'native-16x9'
  end;
  insert into public.cw_lecture_workflows(
    lecture_id, track, stage, current_review_round,
    required_review_rounds_snapshot, active_review_cycle_id,
    internal_due_at, updated_by, updated_at
  )
  select workflow_row.lecture_id, target_track, workflow_row.stage,
         workflow_row.current_review_round,
         workflow_row.required_review_rounds_snapshot,
         workflow_row.active_review_cycle_id,
         workflow_row.internal_due_at,
         p_uid,
         now()
  from public.cw_lecture_workflows workflow_row
  where workflow_row.lecture_id = p_lecture_id
    and workflow_row.track = p_source_track
  on conflict(lecture_id, track) do update
    set stage = excluded.stage,
        current_review_round = excluded.current_review_round,
        required_review_rounds_snapshot = excluded.required_review_rounds_snapshot,
        active_review_cycle_id = excluded.active_review_cycle_id,
        internal_due_at = excluded.internal_due_at,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.submit_cw_review(
  p_lecture_id uuid,
  p_track text,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  snapshot jsonb;
  new_cycle_id uuid;
  source_active uuid;
  other_active uuid;
  other_track text;
  mode_value text;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'review.submit');
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if not public.cw_lecture_has_spatial_pages(p_lecture_id) then
    return public.submit_cw_review_pre_sml0_impl(p_lecture_id, p_track, p_note);
  end if;

  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not public.cw_paired_delivery_is_ready(p_lecture_id) then
    raise exception 'PAIRED_TRACKS_NOT_READY';
  end if;
  snapshot := public.build_cw_paired_delivery_snapshot(p_lecture_id);
  mode_value := snapshot ->> 'mode';
  other_track := case when p_track = 'native-16x9' then 'adapted-4x3' else 'native-16x9' end;

  select workflow_row.active_review_cycle_id into source_active
  from public.cw_lecture_workflows workflow_row
  where workflow_row.lecture_id = p_lecture_id and workflow_row.track = p_track
  for update;
  select workflow_row.active_review_cycle_id into other_active
  from public.cw_lecture_workflows workflow_row
  where workflow_row.lecture_id = p_lecture_id and workflow_row.track = other_track
  for update;
  if other_active is not null and other_active is distinct from source_active then
    raise exception 'PAIRED_WORKFLOW_CONFLICT';
  end if;

  new_cycle_id := public.submit_cw_review_pre_sml0_impl(p_lecture_id, p_track, p_note);
  update public.cw_review_cycles
  set content_snapshot = snapshot,
      delivery_mode = mode_value,
      policy_snapshot = policy_snapshot || jsonb_build_object(
        'deliveryVersion', 'cw-paired-delivery-v1',
        'pairedTracks', jsonb_build_array('native-16x9', 'adapted-4x3')
      )
  where id = new_cycle_id;
  perform public.sync_cw_paired_workflow(p_lecture_id, p_track, uid);
  return new_cycle_id;
end;
$$;

create or replace function public.withdraw_cw_review(p_review_cycle_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cycle public.cw_review_cycles%rowtype;
begin
  perform public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.submit');
  select * into cycle from public.cw_review_cycles where id = p_review_cycle_id;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  perform public.withdraw_cw_review_pre_sml0_impl(p_review_cycle_id);
  if cycle.delivery_mode <> 'legacy-single-track' then
    perform public.sync_cw_paired_workflow(cycle.lecture_id, cycle.track, auth.uid());
  end if;
end;
$$;

create or replace function public.approve_cw_review(
  p_review_cycle_id uuid,
  p_note text default '',
  p_reviewed_pages integer[] default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cycle public.cw_review_cycles%rowtype;
  result_cycle_id uuid;
begin
  perform public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.decide');
  select * into cycle from public.cw_review_cycles where id = p_review_cycle_id;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  result_cycle_id := public.approve_cw_review_pre_sml0_impl(
    p_review_cycle_id, p_note, p_reviewed_pages
  );
  if cycle.delivery_mode <> 'legacy-single-track' then
    update public.cw_review_cycles
    set delivery_mode = cycle.delivery_mode
    where id = result_cycle_id;
    perform public.sync_cw_paired_workflow(cycle.lecture_id, cycle.track, auth.uid());
  end if;
  return result_cycle_id;
end;
$$;

create or replace function public.reject_cw_review(
  p_review_cycle_id uuid,
  p_note text,
  p_reviewed_pages integer[] default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare cycle public.cw_review_cycles%rowtype;
begin
  perform public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.decide');
  select * into cycle from public.cw_review_cycles where id = p_review_cycle_id;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  perform public.reject_cw_review_pre_sml0_impl(
    p_review_cycle_id, p_note, p_reviewed_pages
  );
  if cycle.delivery_mode <> 'legacy-single-track' then
    perform public.sync_cw_paired_workflow(cycle.lecture_id, cycle.track, auth.uid());
  end if;
end;
$$;

create or replace function public.publish_cw_review_cycle(
  p_lecture_id uuid,
  p_track text,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  workflow_row public.cw_lecture_workflows%rowtype;
  cycle public.cw_review_cycles%rowtype;
  result jsonb;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.publish');
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  select * into workflow_row
  from public.cw_lecture_workflows
  where lecture_id = p_lecture_id and track = p_track
  for update;
  if not found or workflow_row.stage <> 'ready_to_publish'
     or workflow_row.active_review_cycle_id is null then
    raise exception 'NOT_READY_TO_PUBLISH';
  end if;
  select * into cycle
  from public.cw_review_cycles
  where id = workflow_row.active_review_cycle_id
  for update;
  if not found or cycle.status <> 'passed' then raise exception 'NOT_READY_TO_PUBLISH'; end if;

  if cycle.delivery_mode = 'legacy-single-track' then
    return public.publish_cw_review_cycle_pre_sml0_impl(p_lecture_id, p_track, p_note);
  end if;
  if not public.cw_paired_snapshot_is_valid(cycle.content_snapshot) then
    raise exception 'INVALID_PAIRED_SNAPSHOT';
  end if;

  result := public.perform_cw_paired_publish(
    p_lecture_id, p_note, cycle.content_snapshot, uid
  );
  update public.cw_review_cycles
  set published_release_id = (result ->> p_track)::uuid,
      published_release_ids = jsonb_build_object(
        'native-16x9', result ->> 'native-16x9',
        'adapted-4x3', result ->> 'adapted-4x3'
      )
  where id = cycle.id;
  update public.cw_lecture_workflows
  set stage = 'idle',
      current_review_round = null,
      required_review_rounds_snapshot = null,
      active_review_cycle_id = null,
      internal_due_at = null,
      updated_by = uid,
      updated_at = now()
  where lecture_id = p_lecture_id
    and track in ('native-16x9', 'adapted-4x3');
  return (result ->> p_track)::uuid;
end;
$$;

create or replace function public.emergency_publish_cw_review(
  p_lecture_id uuid,
  p_track text,
  p_reason text,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  snapshot jsonb;
  requested_release_id uuid;
  other_release_id uuid;
  other_track text;
  group_id uuid := gen_random_uuid();
  mode_value text;
begin
  perform public.assert_cw_lecture_capability(p_lecture_id, 'release.emergency_publish');
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if not public.cw_lecture_has_spatial_pages(p_lecture_id) then
    return public.emergency_publish_cw_review_pre_sml0_impl(
      p_lecture_id, p_track, p_reason, p_note
    );
  end if;

  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not public.cw_paired_delivery_is_ready(p_lecture_id) then
    raise exception 'PAIRED_TRACKS_NOT_READY';
  end if;
  snapshot := public.build_cw_paired_delivery_snapshot(p_lecture_id);
  mode_value := snapshot ->> 'mode';
  other_track := case when p_track = 'native-16x9' then 'adapted-4x3' else 'native-16x9' end;

  requested_release_id := public.emergency_publish_cw_review_pre_sml0_impl(
    p_lecture_id, p_track, p_reason, p_note
  );
  other_release_id := public.perform_cw_publish(
    p_lecture_id,
    other_track,
    p_note,
    snapshot #> array['tracks', other_track],
    auth.uid()
  );

  update public.cw_lecture_releases
  set delivery_group_id = group_id,
      delivery_mode = mode_value
  where id in (requested_release_id, other_release_id);
  update public.cw_review_cycles
  set content_snapshot = snapshot,
      delivery_mode = mode_value,
      published_release_ids = jsonb_build_object(
        'native-16x9', case
          when p_track = 'native-16x9' then requested_release_id else other_release_id
        end,
        'adapted-4x3', case
          when p_track = 'adapted-4x3' then requested_release_id else other_release_id
        end
      )
  where published_release_id = requested_release_id;
  update public.cw_lecture_workflows
  set stage = 'idle',
      current_review_round = null,
      required_review_rounds_snapshot = null,
      active_review_cycle_id = null,
      internal_due_at = null,
      updated_by = auth.uid(),
      updated_at = now()
  where lecture_id = p_lecture_id
    and track in ('native-16x9', 'adapted-4x3');
  perform public.sync_cw_spatial_page_pointers(p_lecture_id);
  return requested_release_id;
end;
$$;

-- 旧批量适配发布只面向导入课件；出现空间页时必须走 paired publish，禁止半发布。
create or replace function public.publish_cw_adapt_releases(
  p_lecture_ids uuid[],
  p_note text default ''
)
returns table (lecture_id uuid, release_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  preflight record;
  requested_count integer := coalesce(cardinality(p_lecture_ids), 0);
  requested_lecture_id uuid;
begin
  select * into preflight
  from public.resolve_cw_lecture_capability_for(
    auth.uid(), null, 'release.publish', now()
  );
  if preflight.denial_code is distinct from 'LECTURE_NOT_FOUND' then
    raise exception '%', preflight.denial_code using errcode = '42501';
  end if;
  if requested_count < 1 or requested_count > 30
     or (select count(distinct item) from unnest(p_lecture_ids) item) <> requested_count then
    raise exception 'INVALID_LECTURE_SELECTION';
  end if;
  foreach requested_lecture_id in array p_lecture_ids loop
    perform public.assert_cw_lecture_capability(requested_lecture_id, 'release.publish');
    if public.cw_lecture_has_spatial_pages(requested_lecture_id) then
      raise exception 'PAIRED_PUBLISH_REQUIRED';
    end if;
  end loop;
  return query
  select result.lecture_id, result.release_id
  from public.publish_cw_adapt_releases_pre_sml0_impl(p_lecture_ids, p_note) result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 权限收口与合同说明
-- ---------------------------------------------------------------------------

revoke all on function public.cw_spatial_page_doc_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.cw_set_revision_document_metadata() from public, anon, authenticated;
revoke all on function public.cw_revision_supports_track(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cw_set_page_track_head_layout() from public, anon, authenticated;
revoke all on function public.create_cw_spatial_page(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.copy_cw_spatial_page(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_cw_spatial_page_draft(uuid, text, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.revert_cw_spatial_page_revision(uuid, text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.cw_lecture_has_spatial_pages(uuid) from public, anon, authenticated;
revoke all on function public.build_cw_track_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function public.cw_paired_delivery_is_ready(uuid) from public, anon, authenticated;
revoke all on function public.cw_paired_delivery_mode(uuid) from public, anon, authenticated;
revoke all on function public.build_cw_paired_delivery_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.cw_paired_snapshot_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.sync_cw_spatial_page_pointers(uuid) from public, anon, authenticated;
revoke all on function public.perform_cw_publish(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.perform_cw_paired_publish(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.rollback_cw_single_release_internal(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_cw_paired_workflow(uuid, text, uuid) from public, anon, authenticated;

revoke all on function public.copy_cw_page(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.revert_cw_track_page_revision(uuid, text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.set_cw_page_learning_check_flag(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.publish_cw_track_release(uuid, text, text) from public, anon, authenticated;
revoke all on function public.rollback_cw_track_release(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.rollback_cw_lecture_release(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.submit_cw_review(uuid, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_cw_review(uuid) from public, anon, authenticated;
revoke all on function public.approve_cw_review(uuid, text, integer[]) from public, anon, authenticated;
revoke all on function public.reject_cw_review(uuid, text, integer[]) from public, anon, authenticated;
revoke all on function public.publish_cw_review_cycle(uuid, text, text) from public, anon, authenticated;
revoke all on function public.emergency_publish_cw_review(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.publish_cw_adapt_releases(uuid[], text) from public, anon, authenticated;

grant execute on function public.create_cw_spatial_page(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.copy_cw_page(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_cw_track_page_draft(uuid, text, jsonb, integer, text) to authenticated;
grant execute on function public.revert_cw_track_page_revision(uuid, text, uuid, integer, text) to authenticated;
grant execute on function public.set_cw_page_learning_check_flag(uuid, text, boolean) to authenticated;
grant execute on function public.publish_cw_track_release(uuid, text, text) to authenticated;
grant execute on function public.rollback_cw_track_release(uuid, text, uuid, text) to authenticated;
grant execute on function public.rollback_cw_lecture_release(uuid, uuid, text) to authenticated;
grant execute on function public.submit_cw_review(uuid, text, text) to authenticated;
grant execute on function public.withdraw_cw_review(uuid) to authenticated;
grant execute on function public.approve_cw_review(uuid, text, integer[]) to authenticated;
grant execute on function public.reject_cw_review(uuid, text, integer[]) to authenticated;
grant execute on function public.publish_cw_review_cycle(uuid, text, text) to authenticated;
grant execute on function public.emergency_publish_cw_review(uuid, text, text, text) to authenticated;
grant execute on function public.publish_cw_adapt_releases(uuid[], text) to authenticated;

comment on column public.cw_page_docs.doc_version is
  'Stable page identity document version; revisions of one page may not cross document families.';
comment on column public.cw_page_revisions.layout_profile is
  'Actual document layout, independent from legacy compatibility track selection.';
comment on column public.cw_lecture_releases.delivery_group_id is
  'Atomic delivery group. Spatial paired publication creates exactly one release per compatibility track.';
comment on function public.create_cw_spatial_page(uuid, uuid, text, jsonb) is
  'SML-0: create one standard-4x3 spatial revision and atomically point both compatibility heads at it.';
comment on function public.publish_cw_track_release(uuid, text, text) is
  'SML-0: legacy lectures publish one requested track; lectures containing spatial-page-v1 atomically publish both tracks.';

commit;
