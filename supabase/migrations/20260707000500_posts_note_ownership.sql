-- ============================================================================
-- P3 加固：posts.note_id 必须指向作者本人的笔记。
-- 否则直连 REST 可把自己的帖子挂到他人 note id 上（note_id 唯一约束会让
-- 受害者后续 publish 时 upsert 失败，构成骚扰面）。
-- 策略内的 exists 子查询以调用者身份执行，notes 的 RLS（仅 owner 可 select）
-- 恰好使「能查到 = 归属本人」。
-- ============================================================================

drop policy "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and (
      note_id is null
      or exists (select 1 from public.notes n where n.id = note_id)
    )
  );

drop policy "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check (
    (select auth.uid()) = author_id
    and (
      note_id is null
      or exists (select 1 from public.notes n where n.id = note_id)
    )
  );
