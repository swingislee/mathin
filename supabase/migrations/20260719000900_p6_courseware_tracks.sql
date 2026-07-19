-- P6-9：16:9 原生轨与 4:3 适配轨长期并存。
-- revision / release / binding / shared asset 均按轨道维护可变头；已发布 release 快照仍不可变。

-- A-F 契约补齐（F：16:9 居中窄标题组）。
alter table public.cw_page_docs drop constraint if exists cw_page_docs_adapt_class_check;
alter table public.cw_page_docs
  add constraint cw_page_docs_adapt_class_check
  check (adapt_class is null or adapt_class in ('A','B','C','D','E','F'));
alter table public.cw_adapt_reviews drop constraint if exists cw_adapt_reviews_classification_check;
alter table public.cw_adapt_reviews
  add constraint cw_adapt_reviews_classification_check
  check (classification in ('A','B','C','D','E','F'));

-- 历史 revision 以画布比例回填轨道；4:3 手工编辑/revert 也不会被误归到原生轨。
alter table public.cw_page_revisions add column track text;
update public.cw_page_revisions
   set track = case
     when (doc -> 'canvas' ->> 'width')::numeric * 3 = (doc -> 'canvas' ->> 'height')::numeric * 4
       then 'adapted-4x3'
     else 'native-16x9'
   end;
alter table public.cw_page_revisions alter column track set not null;
alter table public.cw_page_revisions alter column track set default 'native-16x9';
alter table public.cw_page_revisions
  add constraint cw_page_revisions_track_check check (track in ('native-16x9','adapted-4x3'));
create index cw_page_revisions_page_track_revision_idx
  on public.cw_page_revisions(page_doc_id, track, revision_no desc);

-- release 轨道由快照中的页面 revision 判定；历史 4:3 发布不会覆盖原生发布头。
alter table public.cw_lecture_releases add column track text;
update public.cw_lecture_releases release
   set track = case when exists (
     select 1
       from jsonb_array_elements(release.snapshot) item
       join public.cw_page_revisions revision on revision.id = (item ->> 'revisionId')::uuid
      where revision.track = 'adapted-4x3'
   ) then 'adapted-4x3' else 'native-16x9' end;
alter table public.cw_lecture_releases alter column track set not null;
alter table public.cw_lecture_releases alter column track set default 'native-16x9';
alter table public.cw_lecture_releases
  add constraint cw_lecture_releases_track_check check (track in ('native-16x9','adapted-4x3'));
alter table public.cw_lecture_releases drop constraint if exists cw_lecture_releases_lecture_id_release_no_key;
alter table public.cw_lecture_releases add unique (lecture_id, track, release_no);
create index cw_lecture_releases_lecture_track_release_idx
  on public.cw_lecture_releases(lecture_id, track, release_no desc);

create table public.cw_page_track_heads (
  page_doc_id uuid not null references public.cw_page_docs(id) on delete cascade,
  track text not null check (track in ('native-16x9','adapted-4x3')),
  draft_revision_id uuid references public.cw_page_revisions(id) on delete set null,
  current_revision_id uuid references public.cw_page_revisions(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (page_doc_id, track),
  check (draft_revision_id is not null or current_revision_id is not null)
);

create table public.cw_lecture_track_heads (
  lecture_id uuid not null references public.course_lectures(id) on delete cascade,
  track text not null check (track in ('native-16x9','adapted-4x3')),
  current_release_id uuid references public.cw_lecture_releases(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (lecture_id, track)
);

create table public.cw_asset_variant_heads (
  shared_asset_id uuid not null references public.cw_shared_assets(id) on delete cascade,
  track text not null check (track in ('native-16x9','adapted-4x3')),
  draft_revision_id uuid references public.cw_asset_revisions(id) on delete set null,
  published_revision_id uuid references public.cw_asset_revisions(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (shared_asset_id, track),
  check (draft_revision_id is not null or published_revision_id is not null)
);

insert into public.cw_lecture_track_heads(lecture_id, track, current_release_id)
select distinct on (lecture_id, track) lecture_id, track, id
  from public.cw_lecture_releases
 order by lecture_id, track, release_no desc;

-- 原生页头优先取最后一个原生 release；没有 release 时取最后一条 16:9 revision。
insert into public.cw_page_track_heads(page_doc_id, track, current_revision_id)
select page.id, 'native-16x9', coalesce(released.revision_id, fallback.id)
  from public.cw_page_docs page
  left join lateral (
    select (item ->> 'revisionId')::uuid revision_id
      from public.cw_lecture_releases release
      cross join lateral jsonb_array_elements(release.snapshot) item
     where release.lecture_id = page.lecture_id and release.track = 'native-16x9'
       and item ->> 'pageDocId' = page.id::text
     order by release.release_no desc limit 1
  ) released on true
  left join lateral (
    select revision.id from public.cw_page_revisions revision
     where revision.page_doc_id = page.id and revision.track = 'native-16x9'
     order by revision.revision_no desc limit 1
  ) fallback on true
 where page.deleted_at is null and coalesce(released.revision_id, fallback.id) is not null;

-- 有 A-F 分类的页均建立 4:3 头；D 可暂时复用原生 revision，等待人工重排。
insert into public.cw_page_track_heads(page_doc_id, track, draft_revision_id, current_revision_id)
select page.id, 'adapted-4x3',
       case when released.revision_id is null then coalesce(adapted.id, native_head.current_revision_id) end,
       released.revision_id
  from public.cw_page_docs page
  join public.cw_page_track_heads native_head on native_head.page_doc_id = page.id and native_head.track = 'native-16x9'
  left join lateral (
    select (item ->> 'revisionId')::uuid revision_id
      from public.cw_lecture_releases release
      cross join lateral jsonb_array_elements(release.snapshot) item
     where release.lecture_id = page.lecture_id and release.track = 'adapted-4x3'
       and item ->> 'pageDocId' = page.id::text
     order by release.release_no desc limit 1
  ) released on true
  left join lateral (
    select revision.id from public.cw_page_revisions revision
     where revision.page_doc_id = page.id and revision.track = 'adapted-4x3'
     order by revision.revision_no desc limit 1
  ) adapted on true
 where page.deleted_at is null and page.adapt_class is not null;

-- 历史 draft 若属于相应轨道，恢复到新页头。
update public.cw_page_track_heads head
   set draft_revision_id = page.draft_revision_id, updated_at = now()
  from public.cw_page_docs page
  join public.cw_page_revisions revision on revision.id = page.draft_revision_id
 where head.page_doc_id = page.id and head.track = revision.track;

insert into public.cw_asset_variant_heads(shared_asset_id, track, draft_revision_id, published_revision_id)
select asset.id, 'native-16x9', asset.draft_revision_id, asset.published_revision_id
  from public.cw_shared_assets asset
 where asset.draft_revision_id is not null or asset.published_revision_id is not null;

insert into public.cw_asset_variant_heads(shared_asset_id, track, draft_revision_id, published_revision_id)
select asset.id, 'adapted-4x3',
       case when approved.id is null then latest.id end,
       approved.id
  from public.cw_shared_assets asset
  left join lateral (
    select revision.id
      from public.cw_asset_revisions revision
      join public.cw_adapt_backgrounds adaptation on adaptation.derived_asset_revision_id = revision.id
     where revision.shared_asset_id = asset.id and revision.variant = 'mathin-4x3'
       and adaptation.status = 'approved'
     order by revision.revision_no desc limit 1
  ) approved on true
  left join lateral (
    select revision.id from public.cw_asset_revisions revision
     where revision.shared_asset_id = asset.id and revision.variant = 'mathin-4x3'
     order by revision.revision_no desc limit 1
  ) latest on true
 where coalesce(approved.id, latest.id) is not null;

-- binding 从此属于某一轨道。先把当前 binding 视为原生，再复制适配轨并修复历史派生背景。
alter table public.cw_page_asset_bindings add column track text not null default 'native-16x9';
alter table public.cw_page_asset_bindings
  add constraint cw_page_asset_bindings_track_check check (track in ('native-16x9','adapted-4x3'));
alter table public.cw_page_asset_bindings drop constraint if exists cw_page_asset_bindings_page_doc_id_binding_key_key;
alter table public.cw_page_asset_bindings add unique (page_doc_id, binding_key, track);

insert into public.cw_page_asset_bindings(
  page_doc_id, binding_key, role, kind, shared_asset_id, pinned_revision_id, launch_query, track
)
select binding.page_doc_id, binding.binding_key, binding.role, binding.kind,
       binding.shared_asset_id, binding.pinned_revision_id, binding.launch_query, 'adapted-4x3'
  from public.cw_page_asset_bindings binding
  join public.cw_page_track_heads head on head.page_doc_id = binding.page_doc_id and head.track = 'adapted-4x3'
 where binding.track = 'native-16x9'
on conflict (page_doc_id, binding_key, track) do nothing;

-- 若旧脚本把唯一 binding 改成 mathin-4x3 派生图，原生副本恢复其 source revision/asset。
update public.cw_page_asset_bindings binding
   set shared_asset_id = source_revision.shared_asset_id,
       pinned_revision_id = adaptation.source_asset_revision_id
  from public.cw_adapt_backgrounds adaptation
  join public.cw_asset_revisions source_revision on source_revision.id = adaptation.source_asset_revision_id
 where binding.track = 'native-16x9'
   and binding.pinned_revision_id = adaptation.derived_asset_revision_id;

-- 新表仅由受控 RPC 写；staff 可读，便于 Server Component 解析。
alter table public.cw_page_track_heads enable row level security;
alter table public.cw_lecture_track_heads enable row level security;
alter table public.cw_asset_variant_heads enable row level security;
create policy "cw_page_track_heads_select_staff" on public.cw_page_track_heads
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_lecture_track_heads_select_staff" on public.cw_lecture_track_heads
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_asset_variant_heads_select_staff" on public.cw_asset_variant_heads
  for select to authenticated using (public.is_staff((select auth.uid())));
revoke all on public.cw_page_track_heads, public.cw_lecture_track_heads, public.cw_asset_variant_heads from anon, authenticated;
grant select on public.cw_page_track_heads, public.cw_lecture_track_heads, public.cw_asset_variant_heads to authenticated;

-- 兼容仍写 legacy 原生指针的导入/插页 RPC；legacy 列只代表 16:9，不再承载 4:3。
create or replace function public.sync_cw_native_page_head() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.draft_revision_id is not null or new.current_revision_id is not null then
    insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id,current_revision_id)
    values(new.id,'native-16x9',new.draft_revision_id,new.current_revision_id)
    on conflict(page_doc_id,track) do update set
      draft_revision_id=excluded.draft_revision_id,current_revision_id=excluded.current_revision_id,updated_at=now();
  end if;
  return new;
end;
$$;
create trigger cw_page_docs_sync_native_head
  after insert or update of draft_revision_id,current_revision_id on public.cw_page_docs
  for each row execute function public.sync_cw_native_page_head();

create or replace function public.sync_cw_native_lecture_head() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.current_release_id is not null then
    insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id)
    values(new.id,'native-16x9',new.current_release_id)
    on conflict(lecture_id,track) do update set current_release_id=excluded.current_release_id,updated_at=now();
  end if;
  return new;
end;
$$;
create trigger course_lectures_sync_native_head
  after insert or update of current_release_id on public.course_lectures
  for each row execute function public.sync_cw_native_lecture_head();

create or replace function public.sync_cw_native_asset_head() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.draft_revision_id is not null or new.published_revision_id is not null then
    insert into public.cw_asset_variant_heads(shared_asset_id,track,draft_revision_id,published_revision_id)
    values(new.id,'native-16x9',new.draft_revision_id,new.published_revision_id)
    on conflict(shared_asset_id,track) do update set
      draft_revision_id=excluded.draft_revision_id,published_revision_id=excluded.published_revision_id,updated_at=now();
  end if;
  return new;
end;
$$;
create trigger cw_shared_assets_sync_native_head
  after insert or update of draft_revision_id,published_revision_id on public.cw_shared_assets
  for each row execute function public.sync_cw_native_asset_head();

-- 班级默认轨道 + 未开课单讲覆盖；冻结后 resolved.track 成为事实记录。
alter table public.classrooms
  add column courseware_track text not null default 'native-16x9'
  check (courseware_track in ('native-16x9','adapted-4x3'));
grant select(courseware_track) on public.classrooms to authenticated;
alter table public.class_sessions
  add column courseware_track_override text
  check (courseware_track_override is null or courseware_track_override in ('native-16x9','adapted-4x3'));

create or replace function public.set_classroom_courseware_track(p_classroom_id uuid, p_track text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if uid is null or not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN'; end if;
  update public.classrooms set courseware_track = p_track where id = p_classroom_id;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
end;
$$;

create or replace function public.set_session_courseware_track_override(p_session_id uuid, p_track text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); cid uuid;
begin
  if p_track is not null and p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if uid is null or not public.can_manage_classroom(cid, uid) then raise exception 'FORBIDDEN'; end if;
  update public.class_sessions set courseware_track_override = p_track
   where id = p_session_id and started_at is null and courseware_frozen_at is null;
  if not found then raise exception 'ALREADY_STARTED_OR_FROZEN'; end if;
end;
$$;

create or replace function public.resolve_session_courseware_release(p_session_id uuid)
returns table(track text, release_id uuid)
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  return query
  select coalesce(session.courseware_track_override, classroom.courseware_track), head.current_release_id
    from public.class_sessions session
    join public.classrooms classroom on classroom.id = session.classroom_id
    left join public.cw_lecture_track_heads head
      on head.lecture_id = session.lecture_id
     and head.track = coalesce(session.courseware_track_override, classroom.courseware_track)
   where session.id = p_session_id and session.deleted_at is null;
end;
$$;

-- 轨道草稿：页本体仍共用 provenance，只有可变头按轨道隔离。
create or replace function public.save_cw_track_page_draft(
  p_page_doc_id uuid, p_track text, p_doc jsonb, p_base_revision_no int, p_note text default ''
)
returns table(revision_id uuid, revision_no int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); head public.cw_page_track_heads%rowtype; base_id uuid; base_no int; base_doc jsonb; next_no int; next_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if p_base_revision_no is null or p_base_revision_no < 1 then raise exception 'INVALID_BASE_REVISION'; end if;
  if jsonb_typeof(p_doc) is distinct from 'object' or p_doc ->> 'docVersion' is distinct from 'page-doc-v1'
     or jsonb_typeof(p_doc -> 'canvas') is distinct from 'object' or jsonb_typeof(p_doc -> 'nodes') is distinct from 'array'
     or jsonb_typeof(p_doc -> 'interactions') is distinct from 'array' or octet_length(p_doc::text) > 1048576 then
    raise exception 'INVALID_PAGE_DOC';
  end if;
  select * into head from public.cw_page_track_heads where page_doc_id = p_page_doc_id and track = p_track for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  base_id := coalesce(head.draft_revision_id, head.current_revision_id);
  select revision.revision_no, revision.doc into base_no, base_doc from public.cw_page_revisions revision where revision.id = base_id;
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  if (p_doc -> 'sourceCoursewareId') is distinct from (base_doc -> 'sourceCoursewareId')
     or (p_doc -> 'sourcePageId') is distinct from (base_doc -> 'sourcePageId')
     or (p_doc -> 'sourcePageDatabaseId') is distinct from (base_doc -> 'sourcePageDatabaseId')
     or (p_doc -> 'sourceSnapshotId') is distinct from (base_doc -> 'sourceSnapshotId')
     or (p_doc -> 'sourceContentHash') is distinct from (base_doc -> 'sourceContentHash') then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
  end if;
  if p_track = 'native-16x9' and (p_doc -> 'canvas' ->> 'width')::numeric * 9 <> (p_doc -> 'canvas' ->> 'height')::numeric * 16 then
    raise exception 'TRACK_ASPECT_MISMATCH';
  end if;
  if p_track = 'adapted-4x3' and (p_doc -> 'canvas' ->> 'width')::numeric * 3 <> (p_doc -> 'canvas' ->> 'height')::numeric * 4 then
    raise exception 'TRACK_ASPECT_MISMATCH';
  end if;
  select coalesce(max(revision.revision_no),0)+1 into next_no from public.cw_page_revisions revision where revision.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,base_revision_id,note,created_by,track)
  values(p_page_doc_id,next_no,p_doc,'edit',base_id,left(trim(coalesce(p_note,'')),1000),uid,p_track) returning id into next_id;
  update public.cw_page_track_heads set draft_revision_id=next_id,updated_at=now()
   where page_doc_id=p_page_doc_id and track=p_track;
  if p_track='native-16x9' then update public.cw_page_docs set draft_revision_id=next_id where id=p_page_doc_id; end if;
  return query select next_id,next_no;
end;
$$;

create or replace function public.publish_cw_track_release(p_lecture_id uuid, p_track text, p_note text default '')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); next_no int; release_id uuid; release_snapshot jsonb;
begin
  if uid is null or not public.has_perm(uid,'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id=p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.cw_page_docs page
    left join public.cw_page_track_heads head on head.page_doc_id=page.id and head.track=p_track
    where page.lecture_id=p_lecture_id and page.deleted_at is null
      and coalesce(head.draft_revision_id,head.current_revision_id) is null
  ) then raise exception 'PAGE_TRACK_NOT_READY'; end if;
  if exists (
    select 1 from public.cw_page_asset_bindings binding
    join public.cw_page_docs page on page.id=binding.page_doc_id
    left join public.cw_asset_variant_heads variant on variant.shared_asset_id=binding.shared_asset_id and variant.track=p_track
    left join public.cw_shared_assets asset on asset.id=binding.shared_asset_id
    where page.lecture_id=p_lecture_id and page.deleted_at is null and binding.track=p_track
      and coalesce(binding.pinned_revision_id,variant.draft_revision_id,variant.published_revision_id,asset.published_revision_id) is null
  ) then raise exception 'UNRESOLVED_ASSET_BINDING'; end if;
  select jsonb_agg(jsonb_build_object('pageDocId',rows.page_id,'revisionId',rows.revision_id,'bindings',rows.bindings) order by rows.page_no)
    into release_snapshot
    from (
      select page.id page_id,page.page_no,coalesce(head.draft_revision_id,head.current_revision_id) revision_id,
        coalesce((select jsonb_agg(jsonb_build_object('bindingKey',binding.binding_key,'assetRevisionId',
          coalesce(binding.pinned_revision_id,variant.draft_revision_id,variant.published_revision_id,asset.published_revision_id)) order by binding.binding_key)
          from public.cw_page_asset_bindings binding
          join public.cw_shared_assets asset on asset.id=binding.shared_asset_id
          left join public.cw_asset_variant_heads variant on variant.shared_asset_id=binding.shared_asset_id and variant.track=p_track
          where binding.page_doc_id=page.id and binding.track=p_track),'[]'::jsonb) bindings
      from public.cw_page_docs page
      join public.cw_page_track_heads head on head.page_doc_id=page.id and head.track=p_track
      where page.lecture_id=p_lecture_id and page.deleted_at is null
    ) rows;
  if release_snapshot is null or octet_length(release_snapshot::text)>1048576 then raise exception 'RELEASE_SNAPSHOT_TOO_LARGE_OR_INVALID'; end if;
  select coalesce(max(release_no),0)+1 into next_no from public.cw_lecture_releases where lecture_id=p_lecture_id and track=p_track;
  insert into public.cw_lecture_releases(lecture_id,release_no,note,snapshot,published_by,track)
  values(p_lecture_id,next_no,left(trim(coalesce(p_note,'')),1000),release_snapshot,uid,p_track) returning id into release_id;
  update public.cw_page_track_heads head set current_revision_id=coalesce(head.draft_revision_id,head.current_revision_id),draft_revision_id=null,updated_at=now()
   from public.cw_page_docs page where page.id=head.page_doc_id and page.lecture_id=p_lecture_id and head.track=p_track;
  insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id)
  values(p_lecture_id,p_track,release_id)
  on conflict(lecture_id,track) do update set current_release_id=excluded.current_release_id,updated_at=now();
  if p_track='native-16x9' then
    update public.cw_page_docs page set current_revision_id=head.current_revision_id,draft_revision_id=null,aspect='16:9'
      from public.cw_page_track_heads head where head.page_doc_id=page.id and page.lecture_id=p_lecture_id and head.track=p_track;
    update public.course_lectures set current_release_id=release_id where id=p_lecture_id;
  end if;
  return release_id;
end;
$$;

create or replace function public.revert_cw_track_page_revision(
  p_page_doc_id uuid,p_track text,p_revision_id uuid,p_base_revision_no int,p_note text default ''
)
returns table(revision_id uuid,revision_no int)
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); target_doc jsonb; target_track text; head public.cw_page_track_heads%rowtype; base_no int; next_no int; next_id uuid;
begin
  if uid is null or not public.has_perm(uid,'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  select * into head from public.cw_page_track_heads where page_doc_id=p_page_doc_id and track=p_track for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  select revision.doc,revision.track into target_doc,target_track from public.cw_page_revisions revision where revision.id=p_revision_id and revision.page_doc_id=p_page_doc_id;
  if target_doc is null or target_track<>p_track then raise exception 'REVISION_NOT_FOUND'; end if;
  select revision.revision_no into base_no from public.cw_page_revisions revision where revision.id=coalesce(head.draft_revision_id,head.current_revision_id);
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  select coalesce(max(revision.revision_no),0)+1 into next_no from public.cw_page_revisions revision where revision.page_doc_id=p_page_doc_id;
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,base_revision_id,note,created_by,track)
  values(p_page_doc_id,next_no,target_doc,'revert',p_revision_id,left(trim(coalesce(p_note,'')),1000),uid,p_track) returning id into next_id;
  update public.cw_page_track_heads set draft_revision_id=next_id,updated_at=now() where page_doc_id=p_page_doc_id and track=p_track;
  if p_track='native-16x9' then update public.cw_page_docs set draft_revision_id=next_id where id=p_page_doc_id; end if;
  return query select next_id,next_no;
end;
$$;

create or replace function public.rollback_cw_track_release(p_lecture_id uuid,p_track text,p_release_id uuid,p_note text default '')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); old_snapshot jsonb; next_no int; next_id uuid;
begin
  if uid is null or not public.has_perm(uid,'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id=p_lecture_id for update;
  select snapshot into old_snapshot from public.cw_lecture_releases where id=p_release_id and lecture_id=p_lecture_id and track=p_track;
  if old_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  select coalesce(max(release_no),0)+1 into next_no from public.cw_lecture_releases where lecture_id=p_lecture_id and track=p_track;
  insert into public.cw_lecture_releases(lecture_id,release_no,note,snapshot,published_by,track)
  values(p_lecture_id,next_no,left(trim(coalesce(p_note,'')),1000),old_snapshot,uid,p_track) returning id into next_id;
  update public.cw_page_track_heads head set current_revision_id=(item.value->>'revisionId')::uuid,draft_revision_id=null,updated_at=now()
    from jsonb_array_elements(old_snapshot) item
   where head.page_doc_id=(item.value->>'pageDocId')::uuid and head.track=p_track;
  insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id) values(p_lecture_id,p_track,next_id)
  on conflict(lecture_id,track) do update set current_release_id=excluded.current_release_id,updated_at=now();
  if p_track='native-16x9' then
    update public.cw_page_docs page set current_revision_id=head.current_revision_id,draft_revision_id=null,aspect='16:9'
      from public.cw_page_track_heads head where head.page_doc_id=page.id and page.lecture_id=p_lecture_id and head.track=p_track;
    update public.course_lectures set current_release_id=next_id where id=p_lecture_id;
  end if;
  return next_id;
end;
$$;

-- 页面编辑器内的图片替换：current-page 建分支；all-track 只推进所选轨道的引用，不跨画幅。
create or replace function public.replace_cw_track_image_binding(
  p_page_doc_id uuid,p_binding_key text,p_track text,p_scope text,
  p_sha256 text,p_mime text,p_byte_count bigint,p_width int,p_height int,p_name text default ''
)
returns table(revision_id uuid,affected_count int)
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); object_id uuid; source_asset uuid; target_asset uuid; next_no int; next_revision uuid; affected int;
begin
  if uid is null or not public.has_perm(uid,'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if p_scope not in ('current-page','all-track') then raise exception 'INVALID_REPLACEMENT_SCOPE'; end if;
  if p_page_doc_id is null or p_binding_key !~ '^[0-9a-f]{64}$' or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_mime not in ('image/png','image/jpeg','image/webp','image/gif') or p_byte_count<=0 or p_byte_count>52428800
     or p_width<=0 or p_height<=0 then raise exception 'INVALID_IMAGE_UPLOAD'; end if;
  select shared_asset_id into source_asset from public.cw_page_asset_bindings
   where page_doc_id=p_page_doc_id and binding_key=p_binding_key and track=p_track and kind='image' for update;
  if source_asset is null then raise exception 'IMAGE_BINDING_NOT_FOUND'; end if;
  insert into public.cw_asset_objects(sha256,mime,byte_count,width,height,kind,storage_path)
  values(p_sha256,p_mime,p_byte_count,p_width,p_height,'image','sha256/'||substr(p_sha256,1,2)||'/'||p_sha256)
  on conflict(sha256) do update set sha256=excluded.sha256 returning id into object_id;
  if p_scope='current-page' then
    insert into public.cw_shared_assets(name,kind,role,candidate_key,created_by)
    values(left(trim(coalesce(p_name,'')),500),'image','source','manual:'||p_sha256||':'||gen_random_uuid()::text,uid) returning id into target_asset;
    next_no:=1;
  else
    target_asset:=source_asset;
    select coalesce(max(revision_no),0)+1 into next_no from public.cw_asset_revisions where shared_asset_id=target_asset;
  end if;
  insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,variant,note,created_by)
  values(target_asset,next_no,object_id,'manual-edit',case when p_scope='all-track' then 'Track-scoped shared replacement' else 'Page-only image replacement' end,uid)
  returning id into next_revision;
  insert into public.cw_asset_variant_heads(shared_asset_id,track,draft_revision_id,published_revision_id)
  values(target_asset,p_track,next_revision,case when p_scope='current-page' then next_revision else null end)
  on conflict(shared_asset_id,track) do update set draft_revision_id=excluded.draft_revision_id,updated_at=now();
  if p_scope='current-page' then
    update public.cw_shared_assets set published_revision_id=next_revision where id=target_asset;
    update public.cw_page_asset_bindings set shared_asset_id=target_asset,pinned_revision_id=next_revision
     where page_doc_id=p_page_doc_id and binding_key=p_binding_key and track=p_track;
  else
    update public.cw_page_asset_bindings set pinned_revision_id=next_revision
     where shared_asset_id=source_asset and track=p_track;
  end if;
  get diagnostics affected=row_count;
  return query select next_revision,affected;
end;
$$;

-- 开课冻结必须匹配“单讲覆盖 > 班级默认”的轨道 release；冻结后的旧课次不受后续切换影响。
create or replace function public.freeze_session_courseware(p_session_id uuid,p_courseware jsonb,p_courseware_resolved jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); expected_release uuid; expected_track text; session_lecture uuid;
begin
  if uid is null or not public.is_session_teacher(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_courseware) is distinct from 'array' or octet_length(p_courseware::text)>1048576
     or jsonb_typeof(p_courseware_resolved) is distinct from 'object'
     or p_courseware_resolved->>'version' is distinct from 'cw-session-resolved-v1'
     or jsonb_typeof(p_courseware_resolved->'bindings') is distinct from 'array'
     or octet_length(p_courseware_resolved::text)>1048576 then raise exception 'INVALID_COURSEWARE_FREEZE'; end if;
  select session.lecture_id,coalesce(session.courseware_track_override,classroom.courseware_track)
    into session_lecture,expected_track
    from public.class_sessions session join public.classrooms classroom on classroom.id=session.classroom_id
   where session.id=p_session_id and session.deleted_at is null for update of session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if session_lecture is not null then
    select current_release_id into expected_release from public.cw_lecture_track_heads where lecture_id=session_lecture and track=expected_track;
  end if;
  if p_courseware_resolved->>'track' is distinct from expected_track then raise exception 'TRACK_MISMATCH'; end if;
  if (p_courseware_resolved->>'releaseId') is distinct from expected_release::text then raise exception 'RELEASE_MISMATCH'; end if;
  update public.class_sessions set courseware=p_courseware,courseware_resolved=p_courseware_resolved,courseware_frozen_at=now(),started_at=now()
   where id=p_session_id and started_at is null and courseware_frozen_at is null;
  if not found then raise exception 'ALREADY_STARTED_OR_FROZEN'; end if;
end;
$$;

-- 4:3 审核闸门在 track binding 中精确找角色，避免同 binding_key 的原生副本造成重复/误判。
create or replace function public.assert_cw_adapt_release_ready() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.track='adapted-4x3' and exists (
    select 1 from jsonb_array_elements(new.snapshot) page_item
    join public.cw_page_revisions page_revision on page_revision.id=(page_item->>'revisionId')::uuid
    cross join lateral jsonb_array_elements(page_item->'bindings') binding_item
    join public.cw_page_asset_bindings binding on binding.page_doc_id=page_revision.page_doc_id
      and binding.binding_key=binding_item->>'bindingKey' and binding.track=new.track
    join public.cw_asset_revisions asset_revision on asset_revision.id=(binding_item->>'assetRevisionId')::uuid
    left join public.cw_adapt_backgrounds adaptation on adaptation.derived_asset_revision_id=asset_revision.id
    where binding.role='background' and asset_revision.variant='mathin-4x3'
      and coalesce(adaptation.status,'pending')<>'approved'
  ) then raise exception 'ADAPT_BACKGROUND_REVIEW_REQUIRED'; end if;
  return new;
end;
$$;

revoke all on function public.set_classroom_courseware_track(uuid,text),
  public.set_session_courseware_track_override(uuid,text), public.resolve_session_courseware_release(uuid),
  public.save_cw_track_page_draft(uuid,text,jsonb,int,text), public.publish_cw_track_release(uuid,text,text),
  public.revert_cw_track_page_revision(uuid,text,uuid,int,text), public.rollback_cw_track_release(uuid,text,uuid,text),
  public.replace_cw_track_image_binding(uuid,text,text,text,text,text,bigint,int,int,text),
  public.freeze_session_courseware(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.set_classroom_courseware_track(uuid,text),
  public.set_session_courseware_track_override(uuid,text), public.resolve_session_courseware_release(uuid),
  public.save_cw_track_page_draft(uuid,text,jsonb,int,text), public.publish_cw_track_release(uuid,text,text),
  public.revert_cw_track_page_revision(uuid,text,uuid,int,text), public.rollback_cw_track_release(uuid,text,uuid,text),
  public.replace_cw_track_image_binding(uuid,text,text,text,text,text,bigint,int,int,text),
  public.freeze_session_courseware(uuid,jsonb,jsonb) to authenticated;
