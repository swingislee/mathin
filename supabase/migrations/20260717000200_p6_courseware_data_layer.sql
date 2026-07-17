-- ============================================================================
-- P6-2 课件资产数据层（docs/plan/16 §3 D2/D4/D6、§4、§8）
--
-- 资源对象 → 语义资源 → 版本；页面 → revision → 讲 release；开课冻结 pin。
-- replacement batches/items 留给 P6-8，故本 migration 刻意不建那两张表。
-- 所有新表只允许 staff 读；所有写路径由 SECURITY DEFINER RPC 或导入服务完成。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 资源三层（D2）
-- ---------------------------------------------------------------------------

create table public.cw_asset_objects (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null check (length(mime) <= 255),
  byte_count bigint not null check (byte_count >= 0),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  kind text not null check (kind in ('image', 'video', 'audio', 'svg', 'h5')),
  storage_path text not null check (length(storage_path) > 0 and length(storage_path) <= 1000),
  source_url text,
  created_at timestamptz not null default now()
);

create table public.cw_shared_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  kind text not null check (kind in ('image', 'video', 'audio', 'svg', 'h5')),
  role text not null check (length(trim(role)) > 0 and length(role) <= 100),
  candidate_key text unique,
  draft_revision_id uuid,
  published_revision_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cw_asset_revisions (
  id uuid primary key default gen_random_uuid(),
  shared_asset_id uuid not null references public.cw_shared_assets(id) on delete cascade,
  revision_no int not null check (revision_no > 0),
  object_id uuid not null references public.cw_asset_objects(id),
  derived_from_revision_id uuid references public.cw_asset_revisions(id),
  variant text not null default 'source' check (variant in ('source', 'mathin-4x3', 'manual-edit')),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (shared_asset_id, revision_no)
);

alter table public.cw_shared_assets
  add constraint cw_shared_assets_draft_revision_fk
    foreign key (draft_revision_id) references public.cw_asset_revisions(id) on delete set null,
  add constraint cw_shared_assets_published_revision_fk
    foreign key (published_revision_id) references public.cw_asset_revisions(id) on delete set null;

create index cw_asset_revisions_shared_revision_idx
  on public.cw_asset_revisions (shared_asset_id, revision_no desc);

create trigger cw_shared_assets_set_updated_at
  before update on public.cw_shared_assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 页面 / revision / release（D6）与 binding（D2）
-- ---------------------------------------------------------------------------

create table public.cw_page_docs (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.course_lectures(id) on delete cascade,
  page_no int not null check (page_no > 0),
  title text not null default '',
  source_courseware_id text,
  source_page_id text,
  aspect text not null default '16:9' check (aspect in ('16:9', '4:3')),
  draft_revision_id uuid,
  current_revision_id uuid,
  deleted_at timestamptz,
  unique (lecture_id, page_no) deferrable initially deferred
);

create table public.cw_page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_doc_id uuid not null references public.cw_page_docs(id) on delete cascade,
  revision_no int not null check (revision_no > 0),
  doc jsonb not null check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' = 'page-doc-v1'
    and octet_length(doc::text) <= 1048576
  ),
  origin text not null check (origin in ('import', 'edit', 'adapt-4x3', 'revert')),
  base_revision_id uuid references public.cw_page_revisions(id),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_doc_id, revision_no)
);

alter table public.cw_page_docs
  add constraint cw_page_docs_draft_revision_fk
    foreign key (draft_revision_id) references public.cw_page_revisions(id) on delete set null,
  add constraint cw_page_docs_current_revision_fk
    foreign key (current_revision_id) references public.cw_page_revisions(id) on delete set null;

create table public.cw_page_asset_bindings (
  id uuid primary key default gen_random_uuid(),
  page_doc_id uuid not null references public.cw_page_docs(id) on delete cascade,
  binding_key text not null check (binding_key ~ '^[0-9a-f]{64}$'),
  role text not null check (length(trim(role)) > 0 and length(role) <= 100),
  kind text not null check (kind in ('image', 'video', 'audio', 'svg', 'h5')),
  shared_asset_id uuid not null references public.cw_shared_assets(id),
  pinned_revision_id uuid references public.cw_asset_revisions(id),
  unique (page_doc_id, binding_key)
);

create table public.cw_lecture_releases (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.course_lectures(id) on delete cascade,
  release_no int not null check (release_no > 0),
  note text not null default '',
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'array'
    and octet_length(snapshot::text) <= 1048576
  ),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (lecture_id, release_no)
);

alter table public.course_lectures
  add column current_release_id uuid references public.cw_lecture_releases(id) on delete set null;

alter table public.class_sessions
  add column courseware_resolved jsonb;

create index cw_page_docs_lecture_page_idx
  on public.cw_page_docs (lecture_id, page_no) where deleted_at is null;
create index cw_page_revisions_page_revision_idx
  on public.cw_page_revisions (page_doc_id, revision_no desc);
create index cw_page_asset_bindings_page_idx
  on public.cw_page_asset_bindings (page_doc_id);
create index cw_page_asset_bindings_shared_idx
  on public.cw_page_asset_bindings (shared_asset_id);
create index cw_lecture_releases_lecture_release_idx
  on public.cw_lecture_releases (lecture_id, release_no desc);

-- ---------------------------------------------------------------------------
-- RLS：学生/家长不直接读课件资产表；写权限一律收回到 RPC / service key。
-- ---------------------------------------------------------------------------

alter table public.cw_asset_objects enable row level security;
alter table public.cw_shared_assets enable row level security;
alter table public.cw_asset_revisions enable row level security;
alter table public.cw_page_docs enable row level security;
alter table public.cw_page_revisions enable row level security;
alter table public.cw_page_asset_bindings enable row level security;
alter table public.cw_lecture_releases enable row level security;

create policy "cw_asset_objects_select_staff" on public.cw_asset_objects
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_shared_assets_select_staff" on public.cw_shared_assets
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_asset_revisions_select_staff" on public.cw_asset_revisions
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_page_docs_select_staff" on public.cw_page_docs
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_page_revisions_select_staff" on public.cw_page_revisions
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_page_asset_bindings_select_staff" on public.cw_page_asset_bindings
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy "cw_lecture_releases_select_staff" on public.cw_lecture_releases
  for select to authenticated using (public.is_staff((select auth.uid())));

revoke all on public.cw_asset_objects, public.cw_shared_assets, public.cw_asset_revisions,
  public.cw_page_docs, public.cw_page_revisions, public.cw_page_asset_bindings,
  public.cw_lecture_releases from anon, authenticated;
grant select on public.cw_asset_objects, public.cw_shared_assets, public.cw_asset_revisions,
  public.cw_page_docs, public.cw_page_revisions, public.cw_page_asset_bindings,
  public.cw_lecture_releases to authenticated;

-- courseware_resolved 是开课冻结物化，不给 authenticated 裸 update 权限；
-- freeze_session_courseware 以单条事务完成 courseware / resolved / 时间戳三者写入。
revoke update(courseware_resolved) on public.class_sessions from authenticated;

-- ---------------------------------------------------------------------------
-- RBAC：目录和 research 默认画像同步更新。
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','courseware.template.edit','courseware.overlay.edit',
    'courseware.page.edit','courseware.asset.manage','courseware.release.publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage','schedule.view.all','attendance.mark','grading.write','report.view.all',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view','staff.manage','permission.configure','audit.view'
  ]::text[];
$$;

insert into public.role_permissions (role_id, perm_key)
select r.id, p.perm_key
  from public.staff_roles r
 cross join (values
   ('courseware.page.edit'),
   ('courseware.asset.manage'),
   ('courseware.release.publish')
 ) as p(perm_key)
 where r.key = 'research'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 受控写路径：页草稿 / 讲发布 / 开课冻结 / 候课对象范围。
-- ---------------------------------------------------------------------------

create function public.save_page_draft(
  p_page_doc_id uuid,
  p_doc jsonb,
  p_base_revision_no int,
  p_note text default ''
)
returns table(revision_id uuid, revision_no int)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  page_row public.cw_page_docs%rowtype;
  base_revision_id uuid;
  base_no int;
  base_doc jsonb;
  next_no int;
  next_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then
    raise exception 'FORBIDDEN';
  end if;
  if p_base_revision_no is null or p_base_revision_no < 1 then
    raise exception 'INVALID_BASE_REVISION';
  end if;
  if jsonb_typeof(p_doc) is distinct from 'object'
     or p_doc ->> 'docVersion' is distinct from 'page-doc-v1'
     or jsonb_typeof(p_doc -> 'canvas') is distinct from 'object'
     or jsonb_typeof(p_doc -> 'nodes') is distinct from 'array'
     or jsonb_typeof(p_doc -> 'interactions') is distinct from 'array'
     or octet_length(p_doc::text) > 1048576 then
    raise exception 'INVALID_PAGE_DOC';
  end if;

  select * into page_row
    from public.cw_page_docs
   where id = p_page_doc_id
   for update;
  if not found or page_row.deleted_at is not null then
    raise exception 'PAGE_NOT_FOUND';
  end if;

  base_revision_id := coalesce(page_row.draft_revision_id, page_row.current_revision_id);
  if base_revision_id is null then
    raise exception 'PAGE_HAS_NO_BASE_REVISION';
  end if;
  select revision_no, doc into base_no, base_doc
    from public.cw_page_revisions
   where id = base_revision_id;
  if base_no is distinct from p_base_revision_no then
    raise exception 'VERSION_CONFLICT';
  end if;

  -- 溯源是导入基线的只读字段；教研仅能改布局/内容，不能伪造来源。
  if (p_doc -> 'sourceCoursewareId') is distinct from (base_doc -> 'sourceCoursewareId')
     or (p_doc -> 'sourcePageId') is distinct from (base_doc -> 'sourcePageId')
     or (p_doc -> 'sourcePageDatabaseId') is distinct from (base_doc -> 'sourcePageDatabaseId')
     or (p_doc -> 'sourceSnapshotId') is distinct from (base_doc -> 'sourceSnapshotId')
     or (p_doc -> 'sourceContentHash') is distinct from (base_doc -> 'sourceContentHash') then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
  end if;

  select coalesce(max(revision_no), 0) + 1 into next_no
    from public.cw_page_revisions
   where page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions (
    page_doc_id, revision_no, doc, origin, base_revision_id, note, created_by
  ) values (
    p_page_doc_id, next_no, p_doc, 'edit', base_revision_id,
    left(trim(coalesce(p_note, '')), 1000), uid
  ) returning id into next_id;

  update public.cw_page_docs
     set draft_revision_id = next_id
   where id = p_page_doc_id;

  return query select next_id, next_no;
end;
$$;

create function public.publish_lecture_release(
  p_lecture_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  next_no int;
  release_id uuid;
  release_snapshot jsonb;
begin
  if uid is null or not public.has_perm(uid, 'courseware.release.publish') then
    raise exception 'FORBIDDEN';
  end if;

  -- 锁住讲次行，串行化 release_no 和 current_release_id 的推进。
  perform 1 from public.course_lectures where id = p_lecture_id for update;
  if not found then
    raise exception 'LECTURE_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.cw_page_docs where lecture_id = p_lecture_id and deleted_at is null
  ) then
    raise exception 'LECTURE_HAS_NO_PAGES';
  end if;
  if exists (
    select 1
      from public.cw_page_docs
     where lecture_id = p_lecture_id
       and deleted_at is null
       and coalesce(draft_revision_id, current_revision_id) is null
  ) then
    raise exception 'PAGE_HAS_NO_REVISION';
  end if;
  if exists (
    select 1
      from public.cw_page_asset_bindings b
      join public.cw_page_docs p on p.id = b.page_doc_id
      left join public.cw_shared_assets a on a.id = b.shared_asset_id
     where p.lecture_id = p_lecture_id
       and p.deleted_at is null
       and coalesce(b.pinned_revision_id, a.published_revision_id) is null
  ) then
    raise exception 'UNRESOLVED_ASSET_BINDING';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'pageDocId', snapshot_rows.page_doc_id,
      'revisionId', snapshot_rows.revision_id,
      'bindings', snapshot_rows.bindings
    ) order by snapshot_rows.page_no
  ) into release_snapshot
  from (
    select
      p.id as page_doc_id,
      p.page_no,
      coalesce(p.draft_revision_id, p.current_revision_id) as revision_id,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'bindingKey', b.binding_key,
            'assetRevisionId', coalesce(b.pinned_revision_id, a.published_revision_id)
          ) order by b.binding_key
        )
          from public.cw_page_asset_bindings b
          join public.cw_shared_assets a on a.id = b.shared_asset_id
         where b.page_doc_id = p.id
      ), '[]'::jsonb) as bindings
    from public.cw_page_docs p
    where p.lecture_id = p_lecture_id and p.deleted_at is null
  ) as snapshot_rows;
  if release_snapshot is null or octet_length(release_snapshot::text) > 1048576 then
    raise exception 'RELEASE_SNAPSHOT_TOO_LARGE_OR_INVALID';
  end if;

  select coalesce(max(release_no), 0) + 1 into next_no
    from public.cw_lecture_releases
   where lecture_id = p_lecture_id;
  insert into public.cw_lecture_releases (
    lecture_id, release_no, note, snapshot, published_by
  ) values (
    p_lecture_id, next_no, left(trim(coalesce(p_note, '')), 1000), release_snapshot, uid
  ) returning id into release_id;

  update public.cw_page_docs p
     set current_revision_id = coalesce(p.draft_revision_id, p.current_revision_id),
         draft_revision_id = null,
         aspect = case
           when (r.doc -> 'canvas' ->> 'width')::numeric * 3
              = (r.doc -> 'canvas' ->> 'height')::numeric * 4 then '4:3'
           else '16:9'
         end
    from public.cw_page_revisions r
   where p.lecture_id = p_lecture_id
     and p.deleted_at is null
     and r.id = coalesce(p.draft_revision_id, p.current_revision_id);

  update public.course_lectures set current_release_id = release_id where id = p_lecture_id;
  return release_id;
end;
$$;

create function public.freeze_session_courseware(
  p_session_id uuid,
  p_courseware jsonb,
  p_courseware_resolved jsonb
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  expected_release_id uuid;
  session_lecture_id uuid;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_courseware) is distinct from 'array'
     or octet_length(p_courseware::text) > 1048576
     or jsonb_typeof(p_courseware_resolved) is distinct from 'object'
     or p_courseware_resolved ->> 'version' is distinct from 'cw-session-resolved-v1'
     or jsonb_typeof(p_courseware_resolved -> 'bindings') is distinct from 'array'
     or octet_length(p_courseware_resolved::text) > 1048576 then
    raise exception 'INVALID_COURSEWARE_FREEZE';
  end if;

  select lecture_id into session_lecture_id
    from public.class_sessions
   where id = p_session_id and deleted_at is null
   for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if session_lecture_id is not null then
    select current_release_id into expected_release_id
      from public.course_lectures where id = session_lecture_id;
    if expected_release_id is not null
       and (p_courseware_resolved ->> 'releaseId') is distinct from expected_release_id::text then
      raise exception 'RELEASE_MISMATCH';
    end if;
  end if;

  update public.class_sessions
     set courseware = p_courseware,
         courseware_resolved = p_courseware_resolved,
         courseware_frozen_at = now(),
         started_at = now()
   where id = p_session_id
     and started_at is null
     and courseware_frozen_at is null;
  if not found then
    raise exception 'ALREADY_STARTED_OR_FROZEN';
  end if;
end;
$$;

-- 该 RPC 只返回本课冻结对象的元数据；真正的 signed URL 只能由 Server Action
-- 在完成本 RPC 的成员校验后，以 service key 签发（D3）。
create function public.list_session_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select courseware_resolved into resolved
    from public.class_sessions
   where id = p_session_id and deleted_at is null;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if resolved is null or resolved ->> 'version' is distinct from 'cw-session-resolved-v1' then
    return;
  end if;

  return query
  with hashes as (
    select distinct binding ->> 'objectHash' as sha256
      from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) as binding
     where jsonb_typeof(binding) = 'object'
       and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
  )
  select object.sha256, object.storage_path, object.kind
    from hashes
    join public.cw_asset_objects object on object.sha256 = hashes.sha256
   where object.kind <> 'h5'
   order by object.sha256;
end;
$$;

revoke all on function public.save_page_draft(uuid, jsonb, int, text) from public, anon, authenticated;
revoke all on function public.publish_lecture_release(uuid, text) from public, anon, authenticated;
revoke all on function public.freeze_session_courseware(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.list_session_resolved_assets(uuid) from public, anon, authenticated;
grant execute on function public.save_page_draft(uuid, jsonb, int, text) to authenticated;
grant execute on function public.publish_lecture_release(uuid, text) to authenticated;
grant execute on function public.freeze_session_courseware(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.list_session_resolved_assets(uuid) to authenticated;
