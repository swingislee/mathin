-- 工具目录草稿分组：所有访客可读，只有管理员可以把工具移入或移出草稿。
-- 不在表中的工具即正式工具；工具本身的路由、嵌入和备课不受分组影响。
create table public.tool_catalog_drafts (
  tool_id text primary key check (char_length(tool_id) between 1 and 80 and tool_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  moved_by uuid references public.profiles(id) on delete set null default auth.uid(),
  moved_at timestamptz not null default now()
);
alter table public.tool_catalog_drafts enable row level security;
create policy tool_catalog_drafts_read on public.tool_catalog_drafts for select to anon, authenticated
  using (true);
create policy tool_catalog_drafts_admin_insert on public.tool_catalog_drafts for insert to authenticated
  with check ((select public.is_admin(auth.uid())) and moved_by = (select auth.uid()));
create policy tool_catalog_drafts_admin_delete on public.tool_catalog_drafts for delete to authenticated
  using ((select public.is_admin(auth.uid())));
revoke all on public.tool_catalog_drafts from public, anon, authenticated;
grant select on public.tool_catalog_drafts to anon, authenticated;
grant insert, delete on public.tool_catalog_drafts to authenticated;
notify pgrst, 'reload schema';
