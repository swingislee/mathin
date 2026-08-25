-- ============================================================================
-- CI 平台垫片（docs/plan/15-§5）。
--
-- 自托管 Supabase 的 auth / storage / realtime schema 由各服务容器自行建表，不在
-- supabase/migrations/ 里。CI 要验证「从零重建库」这条路径，就必须先把 migrations
-- 依赖的那部分平台对象补出来。本文件**只**复刻 migrations 与 RLS 断言真正用到的
-- 表、函数与授权，不是完整的 Supabase 复制品。
--
-- 只在一次性 CI 容器里执行；绝不对自托管开发库或生产库运行。
-- ============================================================================

-- 角色：与 Supabase 同名，migrations 的 grant/revoke 与 RLS 的 `to authenticated` 依赖它们。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- Supabase installs pgcrypto in `extensions` and includes that schema in the
-- database search path. Standard postgres:15 does neither, so reproduce both
-- facts before replaying migrations in their separate psql sessions.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
set search_path = public, extensions;
do $$
begin
  execute format(
    'alter database %I set search_path = public, extensions',
    current_database()
  );
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase 的默认授权：public 下新建对象自动授予三个角色。RLS 断言里
-- 「即使存在默认表级 grant 也必须被策略拒绝」正是以此为前提。
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth：GoTrue 的用户表与 JWT 声明访问器。
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  phone              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- R1-3 的会话撤销与管理员 MFA 姿态只依赖 GoTrue 表的最小字段。
create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified','verified')),
  factor_type text not null default 'totp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_sessions_user_idx on auth.sessions(user_id);
create index if not exists auth_mfa_factors_user_idx on auth.mfa_factors(user_id,status);

-- GoTrue 把 JWT 声明注入到 request.jwt.claims；旧版单键 request.jwt.claim.sub 仍被支持。
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ),
    ''
  )
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage：桶与对象元数据。函数保持与 Supabase Storage 当前定义一致。
-- ---------------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id               text primary key,
  name             text not null,
  public           boolean not null default false,
  file_size_limit  bigint,
  created_at       timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner_id   text,
  created_at timestamptz not null default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1 : array_length(parts, 1) - 1];
end
$$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable
as $$
declare
  parts text[];
  file_name text;
begin
  select string_to_array(name, '/') into parts;
  select parts[array_length(parts, 1)] into file_name;
  return reverse(split_part(reverse(file_name), '.', 1));
end
$$;

grant execute on function storage.foldername(text), storage.extension(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- realtime：私有频道授权走 realtime.messages 的 RLS，topic 从会话变量读取。
-- Supabase 平台预建同名 publication；原生 PostgreSQL CI 需要补齐该平台对象。
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
end $$;

create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table if not exists realtime.messages (
  id           bigserial primary key,
  topic        text not null,
  extension    text not null,
  event        text,
  payload      jsonb,
  private      boolean not null default false,
  inserted_at  timestamptz not null default now()
);

alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
grant usage, select on all sequences in schema realtime to authenticated;

create or replace function realtime.topic() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('realtime.topic', true), ''), '')
$$;

grant execute on function realtime.topic() to anon, authenticated, service_role;
