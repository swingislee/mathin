-- ============================================================================
-- P2-1 账户档案 profiles（docs/plan/03-3.1）
-- 约定：所有表默认 uuid 主键 + created_at；每张表必须启用 RLS 并写策略。
-- 应用方式：在自托管 Supabase 的 SQL Editor（或 psql）按文件名顺序执行。
-- ============================================================================

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  role         text not null default 'student'
               check (role in ('student', 'teacher', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  '用户档案；注册触发器自动创建，role 仅 service role 可改（普通用户改 role 被触发器拦截）';

alter table public.profiles enable row level security;

-- 所有人可读：排行榜、笔记等公开场景需要展示昵称/头像
create policy "profiles_select_all" on public.profiles
  for select using (true);

-- 本人可改自己的档案（display_name / avatar_url）；role 变更由下方触发器拦截
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 拦截 anon/authenticated 修改 role；service role 与 psql 管理连接不受限
create function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'profiles.role can only be changed by service role';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- 通用 updated_at 触发器函数（后续所有带 updated_at 的表复用）
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 注册触发器：auth.users 插入时自动建 profiles 行，昵称默认取邮箱前缀
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 为迁移前已注册的用户补建档案（幂等）
insert into public.profiles (id, display_name)
select u.id, coalesce(split_part(u.email, '@', 1), '')
from auth.users u
on conflict (id) do nothing;
