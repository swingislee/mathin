-- 仅在已识别的隔离数据库运行；所有身份与会话均为合成夹具，事务结束回滚。
begin;

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.wechat_trusted_sessions'::regclass)
    or has_table_privilege('anon', 'public.wechat_trusted_sessions', 'select')
    or has_table_privilege('authenticated', 'public.wechat_trusted_sessions', 'select')
    or has_table_privilege('authenticated', 'public.wechat_trusted_sessions', 'insert')
    or has_table_privilege('authenticated', 'public.wechat_trusted_sessions', 'update')
    or has_table_privilege('authenticated', 'public.wechat_trusted_sessions', 'delete')
    or has_function_privilege('anon', 'public.current_wechat_session_proof()', 'execute')
    or not has_function_privilege('authenticated', 'public.current_wechat_session_proof()', 'execute') then
    raise exception 'WECHAT_SESSION_PRIVILEGE_BOUNDARY';
  end if;
end $$;

insert into auth.users(id) values
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002');
insert into auth.identities(id,user_id,provider,provider_id,identity_data) values
  ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','custom:wechat','fixture:restore-a','{"sub":"fixture:restore-a"}'),
  ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','custom:wechat','fixture:restore-b','{"sub":"fixture:restore-b"}'),
  ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','email','fixture:restore-email','{"sub":"fixture:restore-email"}');
insert into auth.sessions(id,user_id,not_after) values
  ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',null),
  ('c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001',null),
  ('c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002',null),
  ('c0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',null),
  ('c0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001',now()-interval '1 minute'),
  ('c0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001',null),
  ('c0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001',null);

set local role service_role;
insert into public.wechat_trusted_sessions(session_id,user_id,identity_id,proof,verified_at,expires_at) values
  ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','fixture-proof-a',now(),now()+interval '30 days'),
  ('c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','fixture-proof-b',now(),now()+interval '30 days'),
  ('c0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','fixture-expired-proof',now()-interval '31 days',now()-interval '1 day'),
  ('c0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','fixture-expired-session',now(),now()+interval '30 days'),
  ('c0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','fixture-other-identity',now(),now()+interval '30 days'),
  ('c0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003','fixture-email-identity',now(),now()+interval '30 days');
reset role;

set local role authenticated;
do $$
declare other_session text;
begin
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"c0000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
  if public.current_wechat_session_proof() is distinct from 'fixture-proof-a' then raise exception 'CURRENT_SESSION_NOT_RESTORED'; end if;
  -- access token 续期只改变 token 时间，session_id 未变时仍使用同一证明。
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"c0000000-0000-4000-8000-000000000001","aal":"aal1","iat":1800001000}',true);
  if public.current_wechat_session_proof() is distinct from 'fixture-proof-a' then raise exception 'REFRESH_LOST_PROOF'; end if;
  if auth.jwt()->>'aal' <> 'aal1' then raise exception 'NATIVE_AAL_CHANGED'; end if;
  foreach other_session in array array[
    'c0000000-0000-4000-8000-000000000002', -- 同一账号的密码会话
    'c0000000-0000-4000-8000-000000000003', -- 另一个账号的微信会话
    'c0000000-0000-4000-8000-000000000004', -- 已过期证明
    'c0000000-0000-4000-8000-000000000005', -- 已到期原生会话
    'c0000000-0000-4000-8000-000000000006', -- 不属于本人身份
    'c0000000-0000-4000-8000-000000000007'  -- 非微信身份
  ] loop
    perform set_config('request.jwt.claims',json_build_object('sub','a0000000-0000-4000-8000-000000000001','session_id',other_session)::text,true);
    if public.current_wechat_session_proof() is not null then raise exception 'INVALID_SESSION_PROOF_RETURNED'; end if;
  end loop;
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","session_id":"c0000000-0000-4000-8000-000000000003"}',true);
  if public.current_wechat_session_proof() is distinct from 'fixture-proof-b' then raise exception 'OTHER_OWNER_READ_FAILED'; end if;
  perform set_config('request.jwt.claims','{}',true);
  if public.current_wechat_session_proof() is not null then raise exception 'MISSING_CLAIMS_ACCEPTED'; end if;
  begin
    perform 1 from public.wechat_trusted_sessions;
    raise exception 'DIRECT_PROOF_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.wechat_trusted_sessions set expires_at=now()+interval '30 days';
    raise exception 'CLIENT_PROOF_WRITE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 注销本次会话立即清除对应证明。
delete from auth.sessions where id='c0000000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from public.wechat_trusted_sessions where session_id='c0000000-0000-4000-8000-000000000001') then raise exception 'REVOKED_SESSION_LEFT_PROOF'; end if;
end $$;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"c0000000-0000-4000-8000-000000000001"}',true);
  if public.current_wechat_session_proof() is not null then raise exception 'REVOKED_SESSION_ACCEPTED'; end if;
end $$;
reset role;

-- 解绑清除对应证明，但不修改其他账号的证明或原生登录会话。
delete from auth.identities where id='b0000000-0000-4000-8000-000000000002';
do $$ begin
  if exists(select 1 from public.wechat_trusted_sessions where identity_id='b0000000-0000-4000-8000-000000000002') then raise exception 'UNLINK_LEFT_PROOF'; end if;
  if not exists(select 1 from auth.sessions where id='c0000000-0000-4000-8000-000000000003') then raise exception 'UNLINK_CHANGED_NATIVE_SESSION'; end if;
  if not exists(select 1 from public.wechat_trusted_sessions where session_id='c0000000-0000-4000-8000-000000000005') then raise exception 'UNLINK_AFFECTED_OTHER_IDENTITY'; end if;
end $$;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","session_id":"c0000000-0000-4000-8000-000000000003"}',true);
  if public.current_wechat_session_proof() is not null then raise exception 'UNLINKED_IDENTITY_ACCEPTED'; end if;
end $$;
reset role;

rollback;
