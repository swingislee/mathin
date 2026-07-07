-- ============================================================================
-- P4-1 白板（docs/plan/08-§4）
-- snapshot 为有序绘制项数组（ink/erase 两种笔迹），整体防抖落盘，无 op 流水表。
-- 成员表本期即建（P4-2 邀请协作复用），RLS 互查用 security definer 函数避免递归。
-- ============================================================================

create table public.whiteboards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  title      text not null default '',
  snapshot   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whiteboards is
  '协作白板；snapshot 为有序笔迹数组（含 erase 项，重放即得画面），防抖整体落盘';

create index whiteboards_owner_idx on public.whiteboards (owner_id, updated_at desc);

create trigger whiteboards_set_updated_at
  before update on public.whiteboards
  for each row execute function public.set_updated_at();

create table public.whiteboard_members (
  whiteboard_id uuid not null references public.whiteboards (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  can_edit      boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (whiteboard_id, user_id)
);

comment on table public.whiteboard_members is '白板成员；owner 由触发器自动写入，can_edit=false 为只读旁观';

create index whiteboard_members_user_idx on public.whiteboard_members (user_id);

-- RLS 互查辅助（security definer 绕过 RLS，杜绝 whiteboards ↔ members 策略递归）
create function public.is_whiteboard_member(wb_id uuid, uid uuid, require_edit boolean default false)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.whiteboard_members m
     where m.whiteboard_id = wb_id
       and m.user_id = uid
       and (not require_edit or m.can_edit)
  );
$$;

create function public.is_whiteboard_owner(wb_id uuid, uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.whiteboards w
     where w.id = wb_id and w.owner_id = uid
  );
$$;

revoke all on function public.is_whiteboard_member(uuid, uuid, boolean) from public;
revoke all on function public.is_whiteboard_owner(uuid, uuid) from public;
grant execute on function public.is_whiteboard_member(uuid, uuid, boolean) to authenticated;
grant execute on function public.is_whiteboard_owner(uuid, uuid) to authenticated;

-- owner 建板时自动成为可编辑成员
create function public.add_whiteboard_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.whiteboard_members (whiteboard_id, user_id, can_edit)
  values (new.id, new.owner_id, true)
  on conflict do nothing;
  return new;
end;
$$;

create trigger whiteboards_add_owner_member
  after insert on public.whiteboards
  for each row execute function public.add_whiteboard_owner_member();

alter table public.whiteboards enable row level security;

create policy "whiteboards_select_member" on public.whiteboards
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_whiteboard_member(id, (select auth.uid()))
  );
create policy "whiteboards_insert_own" on public.whiteboards
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "whiteboards_update_editor" on public.whiteboards
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_whiteboard_member(id, (select auth.uid()), true)
  )
  with check (
    owner_id = (select auth.uid())
    or public.is_whiteboard_member(id, (select auth.uid()), true)
  );
create policy "whiteboards_delete_own" on public.whiteboards
  for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.whiteboards from anon, authenticated;
grant select, delete on public.whiteboards to authenticated;
grant insert (owner_id, title) on public.whiteboards to authenticated;
grant update (title, snapshot) on public.whiteboards to authenticated;

alter table public.whiteboard_members enable row level security;

create policy "wb_members_select_related" on public.whiteboard_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_whiteboard_owner(whiteboard_id, (select auth.uid()))
    or public.is_whiteboard_member(whiteboard_id, (select auth.uid()))
  );
create policy "wb_members_insert_owner" on public.whiteboard_members
  for insert to authenticated
  with check (public.is_whiteboard_owner(whiteboard_id, (select auth.uid())));
create policy "wb_members_update_owner" on public.whiteboard_members
  for update to authenticated
  using (public.is_whiteboard_owner(whiteboard_id, (select auth.uid())))
  with check (public.is_whiteboard_owner(whiteboard_id, (select auth.uid())));
create policy "wb_members_delete_owner_or_self" on public.whiteboard_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_whiteboard_owner(whiteboard_id, (select auth.uid()))
  );

revoke all on public.whiteboard_members from anon, authenticated;
grant select, delete on public.whiteboard_members to authenticated;
grant insert (whiteboard_id, user_id, can_edit) on public.whiteboard_members to authenticated;
grant update (can_edit) on public.whiteboard_members to authenticated;
