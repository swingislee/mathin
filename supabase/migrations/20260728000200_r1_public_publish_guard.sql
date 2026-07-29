-- R1-1：公开内容发布开关必须在数据库写边界生效。
-- 关闭时仍允许读取既有公开快照和撤回（DELETE），但禁止新发布或更新公开快照。

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and public.is_feature_enabled('public_content.publish')
  );

drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check (
    (select auth.uid()) = author_id
    and public.is_feature_enabled('public_content.publish')
  );

comment on policy "posts_insert_own" on public.posts is
  'Owner-only publish; R1 public_content.publish must be explicitly enabled';
comment on policy "posts_update_own" on public.posts is
  'Owner-only published snapshot update; R1 public_content.publish must be explicitly enabled';
