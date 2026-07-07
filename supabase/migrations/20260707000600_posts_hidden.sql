-- ============================================================================
-- P3 修正：笔记移入回收站后，其公开帖子应从瀑布流消失；恢复后回归。
-- 用 hidden 标记而不是删行，保留 like_count 与点赞关系。
-- ============================================================================

alter table public.posts add column hidden boolean not null default false;

-- 公开读取只放行未隐藏的帖子；作者始终可见自己的（工作区发布状态查询需要）。
drop policy "posts_select_all" on public.posts;
create policy "posts_select_visible" on public.posts
  for select using (
    not hidden
    or (select auth.uid()) = author_id
  );

-- 归档/恢复动作需要作者能写 hidden 列（行级仍受 posts_update_own 限制）。
grant update (hidden) on public.posts to authenticated;

-- 回填：源笔记已在回收站的帖子立即隐藏。
update public.posts p
   set hidden = true
  from public.notes n
 where p.note_id = n.id
   and n.is_archived
   and not p.hidden;
