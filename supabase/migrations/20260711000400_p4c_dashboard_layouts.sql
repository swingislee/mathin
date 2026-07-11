-- P4C-4 §5.2 磁贴式工作台：每用户一行布局（顺序 + 尺寸档），jsonb 形如
-- [{"k":"todaySchedule","s":"3x2"},...]。服务端合并算法是安全边界（§10），
-- 本表只保证「只能读写自己那行」。

create table if not exists public.dashboard_layouts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tiles jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table public.dashboard_layouts enable row level security;

drop policy if exists "layouts_own" on public.dashboard_layouts;
create policy "layouts_own" on public.dashboard_layouts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.dashboard_layouts from anon;
grant select, insert, update, delete on public.dashboard_layouts to authenticated;
