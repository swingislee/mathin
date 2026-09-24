-- 待隔离数据库事务验证与类型生成后晋级 migrations；当前不进入迁移账本。
-- 微信桥接只保存短期票据。游客不创建 auth user/profile，业务角色继续走管理员邀请。
create unique index auth_identities_one_wechat_per_user on auth.identities(user_id) where provider = 'custom:wechat';
create table public.wechat_oauth_tickets (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('flow','state','guest','grant','access','completion')),
  browser_hash text not null check (browser_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index wechat_oauth_tickets_expiry_idx on public.wechat_oauth_tickets(expires_at);
alter table public.wechat_oauth_tickets enable row level security;
revoke all on public.wechat_oauth_tickets from public, anon, authenticated, service_role;
grant select, insert, delete on public.wechat_oauth_tickets to service_role;

create function public.consume_wechat_oauth_ticket(p_token_hash text, p_kind text, p_browser_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  delete from public.wechat_oauth_tickets
  where token_hash = p_token_hash and kind = p_kind and browser_hash = p_browser_hash and expires_at > now()
  returning payload;
$$;
revoke all on function public.consume_wechat_oauth_ticket(text,text,text) from public, anon, authenticated;
grant execute on function public.consume_wechat_oauth_ticket(text,text,text) to service_role;

-- 仅受信服务端精确查找，不能按昵称/邮箱/手机号推断微信绑定。
create function public.find_wechat_auth_user(p_subject text)
returns uuid language sql stable security definer set search_path = '' as $$
  select i.user_id from auth.identities i
  where i.provider = 'custom:wechat' and i.provider_id = p_subject;
$$;
revoke all on function public.find_wechat_auth_user(text) from public, anon, authenticated;
grant execute on function public.find_wechat_auth_user(text) to service_role;

create table public.wechat_oauth_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
alter table public.wechat_oauth_rate_limits enable row level security;
revoke all on public.wechat_oauth_rate_limits from public, anon, authenticated, service_role;
create function public.allow_wechat_oauth_attempt(p_key_hash text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  if p_limit not between 1 and 30 then return false; end if;
  insert into public.wechat_oauth_rate_limits(key_hash,attempts,expires_at)
  values(p_key_hash,1,now()+interval '10 minutes')
  on conflict(key_hash) do update set
    attempts = case when wechat_oauth_rate_limits.expires_at <= now() then 1 else least(wechat_oauth_rate_limits.attempts + 1, 100000) end,
    expires_at = case when wechat_oauth_rate_limits.expires_at <= now() then now()+interval '10 minutes' else wechat_oauth_rate_limits.expires_at end
  returning attempts into count_now;
  return count_now <= p_limit;
end $$;
revoke all on function public.allow_wechat_oauth_attempt(text,integer) from public, anon, authenticated;
grant execute on function public.allow_wechat_oauth_attempt(text,integer) to service_role;

create function public.prune_wechat_oauth_tickets()
returns void language sql security definer set search_path = '' as $$
  delete from public.wechat_oauth_tickets where expires_at <= now();
  delete from public.wechat_oauth_rate_limits where expires_at <= now();
$$;
revoke all on function public.prune_wechat_oauth_tickets() from public, anon, authenticated;
grant execute on function public.prune_wechat_oauth_tickets() to service_role;

-- 每分钟清除过期个人资料与一次性凭据；没有 pg_cron 的环境由部署任务调用相同 RPC。
do $$ begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prune-wechat-oauth-tickets','* * * * *','select public.prune_wechat_oauth_tickets()');
  end if;
end $$;

comment on table public.wechat_oauth_tickets is 'Server-only, max 15-minute OAuth handoff. No WeChat access/refresh tokens or passwords. No guest accounts or role grants.';

create table public.wechat_profile_snapshots (
  user_id uuid primary key references public.profiles(id),
  subject text not null unique,
  openid text not null,
  unionid text not null,
  nickname text not null check (length(nickname) <= 100),
  avatar_url text,
  authorized_at timestamptz not null
);
alter table public.wechat_profile_snapshots enable row level security;
revoke all on public.wechat_profile_snapshots from public, anon, authenticated, service_role;
grant select on public.wechat_profile_snapshots to authenticated;
grant select, insert, update, delete on public.wechat_profile_snapshots to service_role;
create policy wechat_snapshot_self_read on public.wechat_profile_snapshots for select to authenticated using (user_id = auth.uid());

create function public.guard_wechat_snapshot_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 行锁与解绑串行化，避免解绑已清除资料后，旧回调又写回快照。
  perform 1 from auth.identities where user_id = new.user_id and provider = 'custom:wechat' and provider_id = new.subject for key share;
  if not found then raise exception 'WECHAT_IDENTITY_MISSING'; end if;
  return new;
end $$;
revoke all on function public.guard_wechat_snapshot_identity() from public, anon, authenticated;
create trigger wechat_snapshot_identity_guard before insert or update on public.wechat_profile_snapshots
  for each row execute function public.guard_wechat_snapshot_identity();

create table public.wechat_binding_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  event text not null check (event in ('linked','unlinked','conflict')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.wechat_binding_audits enable row level security;
revoke all on public.wechat_binding_audits from public, anon, authenticated, service_role;
grant select on public.wechat_binding_audits to authenticated;
grant select, insert on public.wechat_binding_audits to service_role;
create policy wechat_binding_audit_self_read on public.wechat_binding_audits for select to authenticated using (user_id = auth.uid());
create trigger wechat_binding_audits_immutable before update or delete on public.wechat_binding_audits
  for each row execute function public.reject_immutable_security_row();

-- 和原生 identity 的提交一起审计；即使应用回调中断也保留事实。解绑后清除资料快照。
create function public.audit_wechat_identity_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.provider = 'custom:wechat' then
    insert into public.wechat_binding_audits(user_id,event,subject_hash)
    values(new.user_id,'linked',encode(extensions.digest(new.provider_id,'sha256'),'hex'));
  elsif tg_op = 'DELETE' and old.provider = 'custom:wechat' then
    insert into public.wechat_binding_audits(user_id,event,subject_hash)
    values(old.user_id,'unlinked',encode(extensions.digest(old.provider_id,'sha256'),'hex'));
    delete from public.wechat_profile_snapshots where user_id = old.user_id;
  end if;
  return null;
end $$;
revoke all on function public.audit_wechat_identity_change() from public, anon, authenticated;
create trigger mathin_wechat_identity_audit after insert or delete on auth.identities
  for each row execute function public.audit_wechat_identity_change();
