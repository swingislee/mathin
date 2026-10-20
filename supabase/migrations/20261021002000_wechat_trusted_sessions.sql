-- 已验证的微信证明随原生会话保存；浏览器额外 Cookie 丢失不再要求重复 MFA。
-- 不改变 Auth 的 AAL、MFA 因子或账号资料。会话撤销、微信解绑时自动删除对应证明。
create table public.wechat_trusted_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_id uuid not null references auth.identities(id) on delete cascade,
  proof text not null check (octet_length(proof) between 1 and 2048),
  verified_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > verified_at and expires_at <= verified_at + interval '30 days')
);
create index wechat_trusted_sessions_user_idx on public.wechat_trusted_sessions(user_id);
create index wechat_trusted_sessions_identity_idx on public.wechat_trusted_sessions(identity_id);
alter table public.wechat_trusted_sessions enable row level security;
revoke all on public.wechat_trusted_sessions from public, anon, authenticated, service_role;
grant select, insert, update on public.wechat_trusted_sessions to service_role;

-- 无可指定的用户/会话参数，调用者只能读取自己当前仍有效会话的证明。
-- 应用仍验证签名、站点、用户、会话、期限与权威微信身份，数据库记录本身不授予权限。
create function public.current_wechat_session_proof()
returns text language sql stable security definer set search_path = '' as $$
  select t.proof
  from public.wechat_trusted_sessions t
  join auth.sessions s on s.id = t.session_id and s.user_id = t.user_id
  join auth.identities i on i.id = t.identity_id and i.user_id = t.user_id and i.provider = 'custom:wechat'
  where t.user_id = auth.uid()
    and t.session_id = nullif(auth.jwt()->>'session_id', '')::uuid
    and t.expires_at > now()
    and (s.not_after is null or s.not_after > now())
$$;
revoke all on function public.current_wechat_session_proof() from public, anon, authenticated, service_role;
grant execute on function public.current_wechat_session_proof() to authenticated;

comment on table public.wechat_trusted_sessions is 'Server-verified WeChat proof for one native Auth session; cascades on session or identity removal. No AAL changes or account-wide MFA exemptions.';
notify pgrst, 'reload schema';
