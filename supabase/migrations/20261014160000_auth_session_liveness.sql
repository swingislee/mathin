-- 服务端以本机验签识别登录身份后，确认该会话仍然存在：
-- 本设备退出、在其他设备上被注销或会话到期时立即失效，不必等待 access token 过期。
-- 只读会话表主键，不返回会话内容。
create function public.current_auth_session_active()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from auth.sessions s
    where s.id = nullif(auth.jwt()->>'session_id','')::uuid
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  )
$$;

revoke all on function public.current_auth_session_active() from public, anon;
grant execute on function public.current_auth_session_active() to authenticated;
notify pgrst, 'reload schema';
