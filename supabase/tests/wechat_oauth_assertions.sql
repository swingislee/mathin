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

-- 复用本机 manifest 中的固定开发身份；所有合成身份关系随外层事务回滚。
do $$
declare
  owner_id uuid := current_setting('mathin.wechat_test.owner')::uuid;
  other_id uuid := current_setting('mathin.wechat_test.other')::uuid;
begin
  if owner_id is null or other_id is null or owner_id=other_id then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if exists(select 1 from auth.identities where user_id in (owner_id,other_id) and provider='custom:wechat') then raise exception 'FIXTURE_ALREADY_LINKED'; end if;
  insert into auth.identities(id,user_id,provider,provider_id,identity_data)
    values(gen_random_uuid(),owner_id,'custom:wechat','assertion:wechat-owner','{"sub":"assertion:wechat-owner"}');
  if public.find_wechat_auth_user('assertion:wechat-owner') is distinct from owner_id then raise exception 'EXACT_IDENTITY_LOOKUP_FAILED'; end if;
  if public.find_wechat_auth_user('assertion:unknown') is not null then raise exception 'UNKNOWN_IDENTITY_MATCHED'; end if;
  if not exists(select 1 from public.wechat_binding_audits where user_id=owner_id and event='linked') then raise exception 'LINK_AUDIT_MISSING'; end if;
  begin
    insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(gen_random_uuid(),owner_id,'custom:wechat','assertion:second-wechat','{"sub":"assertion:second-wechat"}');
    raise exception 'SECOND_WECHAT_IDENTITY_ALLOWED';
  exception when unique_violation then null;
  end;
  begin
    insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(gen_random_uuid(),other_id,'custom:wechat','assertion:wechat-owner','{"sub":"assertion:wechat-owner"}');
    raise exception 'CROSS_ACCOUNT_IDENTITY_ALLOWED';
  exception when unique_violation then null;
  end;
  insert into public.wechat_profile_snapshots(user_id,subject,openid,unionid,nickname,authorized_at)
    values(owner_id,'assertion:wechat-owner','synthetic-openid','synthetic-unionid','Synthetic',now());
  begin
    insert into public.wechat_profile_snapshots(user_id,subject,openid,unionid,nickname,authorized_at)
      values(other_id,'assertion:missing-identity','synthetic-other','synthetic-other','Synthetic',now());
    raise exception 'SNAPSHOT_WITHOUT_IDENTITY_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'WECHAT_IDENTITY_MISSING' then raise; end if;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('mathin.wechat_test.owner'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.wechat_profile_snapshots) <> 1 then raise exception 'OWNER_SNAPSHOT_READ_FAILED'; end if;
  if (select count(*) from public.wechat_binding_audits) <> 1 then raise exception 'OWNER_AUDIT_READ_FAILED'; end if;
  begin
    perform 1 from public.wechat_oauth_tickets;
    raise exception 'AUTHENTICATED_TICKET_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('mathin.wechat_test.other'),'role','authenticated')::text,true);
do $$ begin
  if exists(select 1 from public.wechat_profile_snapshots) or exists(select 1 from public.wechat_binding_audits) then raise exception 'CROSS_ACCOUNT_PII_READ_ALLOWED'; end if;
end $$;
reset role;

delete from auth.identities where user_id=current_setting('mathin.wechat_test.owner')::uuid and provider='custom:wechat';
do $$ begin
  if exists(select 1 from public.wechat_profile_snapshots) then raise exception 'UNLINK_LEFT_PII'; end if;
  if not exists(select 1 from public.wechat_binding_audits where event='unlinked') then raise exception 'UNLINK_AUDIT_MISSING'; end if;
  begin
    delete from public.wechat_binding_audits;
    raise exception 'AUDIT_DELETE_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'SECURITY_LEDGER_APPEND_ONLY' then raise; end if;
  end;
end $$;
