-- ============================================================================
-- P3-1 笔记工作区、公开帖子与点赞（docs/plan/07-§4）
-- 私人笔记使用整数 version 做乐观锁；公开帖子是发布时快照，与源笔记解耦。
-- ============================================================================

create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  parent_id   uuid,
  title       text not null default '',
  icon        text,
  document    jsonb,
  version     integer not null default 0 check (version >= 0),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id),
  constraint notes_parent_owner_fk
    foreign key (parent_id, owner_id)
    references public.notes (id, owner_id)
    on delete cascade,
  constraint notes_not_own_parent check (parent_id is null or parent_id <> id)
);

comment on table public.notes is
  '私人树形笔记；document 为 BlockNote block 数组，version 用于防止并发静默覆盖';

create index notes_owner_parent_idx
  on public.notes (owner_id, parent_id)
  where not is_archived;
create index notes_owner_archived_idx
  on public.notes (owner_id, updated_at desc)
  where is_archived;

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

create policy "notes_select_own" on public.notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "notes_insert_own" on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "notes_update_own" on public.notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "notes_delete_own" on public.notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.notes from anon, authenticated;
grant select, insert, update, delete on public.notes to authenticated;

create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid unique references public.notes (id) on delete set null,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  content      jsonb not null,
  content_html text not null,
  excerpt      text not null default '',
  like_count   integer not null default 0 check (like_count >= 0),
  published_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.posts is
  '公开发布快照；content_html 在服务端生成并消毒，like_count 仅由点赞触发器维护';

create index posts_published_idx on public.posts (published_at desc);
create index posts_likes_idx on public.posts (like_count desc, published_at desc);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

create policy "posts_select_all" on public.posts
  for select using (true);
create policy "posts_insert_own" on public.posts
  for insert to authenticated
  with check ((select auth.uid()) = author_id);
create policy "posts_update_own" on public.posts
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);
create policy "posts_delete_own" on public.posts
  for delete to authenticated
  using ((select auth.uid()) = author_id);

-- 先撤销默认表级写权限，再只授予不含 like_count 的列级权限。
-- 表级 INSERT/UPDATE 会覆盖列级 revoke，因此不能先 grant 整表再 revoke 单列。
revoke all on public.posts from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant delete on public.posts to authenticated;
grant insert (note_id, author_id, title, content, content_html, excerpt)
  on public.posts to authenticated;
grant update (note_id, title, content, content_html, excerpt, published_at)
  on public.posts to authenticated;

create table public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

comment on table public.post_likes is '公开帖子点赞关系；每位用户对每篇帖子至多一条';

create index post_likes_user_idx on public.post_likes (user_id, created_at desc);

alter table public.post_likes enable row level security;

create policy "post_likes_select_all" on public.post_likes
  for select using (true);
create policy "post_likes_insert_own" on public.post_likes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "post_likes_delete_own" on public.post_likes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.post_likes from anon, authenticated;
grant select on public.post_likes to anon, authenticated;
grant insert (post_id, user_id), delete on public.post_likes to authenticated;

create function public.sync_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
       set like_count = like_count + 1
     where id = new.post_id;
    return new;
  end if;

  update public.posts
     set like_count = greatest(like_count - 1, 0)
   where id = old.post_id;
  return old;
end;
$$;

create trigger post_likes_sync_count
  after insert or delete on public.post_likes
  for each row execute function public.sync_post_like_count();

-- 笔记图片：公开读取，只有路径首段与 auth.uid() 相同的用户可上传/删除。
insert into storage.buckets (id, name, public)
values ('note-assets', 'note-assets', true)
on conflict (id) do update set public = excluded.public;

create policy "note_assets_select_public" on storage.objects
  for select using (bucket_id = 'note-assets');
create policy "note_assets_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "note_assets_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 当前自托管 Realtime 支持私有频道授权。频道固定为 notes:<当前用户 id>。
create policy "notes_broadcast_receive_own" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'notes:' || (select auth.uid())::text
  );
create policy "notes_broadcast_send_own" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and (select realtime.topic()) = 'notes:' || (select auth.uid())::text
  );
