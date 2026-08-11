-- ============================================================================
-- R1-11 Notebook 互动与发布边界加固
-- 1. 点赞关系只允许本人读取，避免公开枚举用户 UUID。
-- 2. 只有公开、审核通过的帖子可以新增点赞。
-- 3. 发布必须引用作者本人且未归档的源笔记；发布后 note_id 不可改绑。
-- 4. 发布开关关闭时仍允许作者把帖子隐藏，确保归档保持 fail-closed。
-- ============================================================================

revoke select on public.post_likes from anon;

drop policy if exists "post_likes_select_all" on public.post_likes;
drop policy if exists "post_likes_select_own" on public.post_likes;
create policy "post_likes_select_own" on public.post_likes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own" on public.post_likes
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.posts p
       where p.id = post_id
         and not p.hidden
         and p.review_status = 'approved'
    )
  );

comment on policy "post_likes_select_own" on public.post_likes is
  'Users may inspect only their own like relation; public counts come from posts.like_count';
comment on policy "post_likes_insert_own" on public.post_likes is
  'Users may like only a visible, approved post as themselves';

-- note_id 只在 INSERT 时绑定。应用更新公开快照从不改绑源笔记。
revoke update (note_id) on public.posts from authenticated;

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and public.is_feature_enabled('public_content.publish')
    and exists (
      select 1
        from public.notes n
       where n.id = note_id
         and n.owner_id = (select auth.uid())
         and not n.is_archived
    )
  );

drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check (
    (select auth.uid()) = author_id
    and (
      -- 归档必须能在发布开关关闭时继续隐藏既有快照。
      hidden
      or (
        public.is_feature_enabled('public_content.publish')
        and exists (
          select 1
            from public.notes n
           where n.id = note_id
             and n.owner_id = (select auth.uid())
             and not n.is_archived
        )
      )
    )
  );

comment on policy "posts_insert_own" on public.posts is
  'Publish an owned, active note only while public publishing is enabled';
comment on policy "posts_update_own" on public.posts is
  'Update an owned active publication while enabled, or hide it fail-closed';
