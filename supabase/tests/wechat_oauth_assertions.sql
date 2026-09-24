-- 在核对过的隔离数据库事务中执行；runner 负责 BEGIN、加载 migration、运行本文件、ROLLBACK。
do $$
declare result jsonb; i integer;
begin
  if has_table_privilege('anon','public.wechat_oauth_tickets','select')
    or has_table_privilege('authenticated','public.wechat_oauth_tickets','select')
    or has_function_privilege('authenticated','public.consume_wechat_oauth_ticket(text,text,text)','execute')
    or has_function_privilege('anon','public.find_wechat_auth_user(text)','execute')
    or has_table_privilege('authenticated','public.wechat_profile_snapshots','update')
    or has_table_privilege('service_role','public.wechat_binding_audits','delete') then
    raise exception 'WECHAT_PRIVILEGE_BOUNDARY_FAILED';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname in ('wechat_oauth_tickets','wechat_profile_snapshots','wechat_binding_audits','wechat_oauth_rate_limits') and c.relrowsecurity) <> 4 then
    raise exception 'WECHAT_RLS_REQUIRED';
  end if;
  insert into public.wechat_oauth_tickets(token_hash,kind,browser_hash,payload,expires_at)
  values(repeat('1',64),'state',repeat('2',64),'{"proof":"synthetic"}',now()+interval '1 minute');
  result := public.consume_wechat_oauth_ticket(repeat('1',64),'state',repeat('3',64));
  if result is not null then raise exception 'WRONG_BROWSER_CONSUMED'; end if;
  result := public.consume_wechat_oauth_ticket(repeat('1',64),'grant',repeat('2',64));
  if result is not null then raise exception 'WRONG_KIND_CONSUMED'; end if;
  result := public.consume_wechat_oauth_ticket(repeat('1',64),'state',repeat('2',64));
  if result->>'proof' <> 'synthetic' then raise exception 'VALID_PROOF_NOT_RETURNED'; end if;
  if public.consume_wechat_oauth_ticket(repeat('1',64),'state',repeat('2',64)) is not null then raise exception 'REPLAY_ACCEPTED'; end if;
  insert into public.wechat_oauth_tickets(token_hash,kind,browser_hash,payload,created_at,expires_at)
  values(repeat('4',64),'guest',repeat('4',64),'{}',now()-interval '2 minutes',now()-interval '1 minute');
  if public.consume_wechat_oauth_ticket(repeat('4',64),'guest',repeat('4',64)) is not null then raise exception 'EXPIRED_PROOF_ACCEPTED'; end if;
  for i in 1..8 loop
    if not public.allow_wechat_oauth_attempt(repeat('5',64),8) then raise exception 'RATE_LIMIT_EARLY'; end if;
  end loop;
  if public.allow_wechat_oauth_attempt(repeat('5',64),8) then raise exception 'RATE_LIMIT_MISSING'; end if;
  perform public.prune_wechat_oauth_tickets();
  if exists(select 1 from public.wechat_oauth_tickets where token_hash=repeat('4',64)) then raise exception 'EXPIRED_PII_NOT_PRUNED'; end if;
  if not exists(select 1 from pg_indexes where schemaname='auth' and indexname='auth_identities_one_wechat_per_user') then raise exception 'WECHAT_ACCOUNT_UNIQUENESS_MISSING'; end if;
end $$;
