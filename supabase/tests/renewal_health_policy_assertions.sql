-- 固定开发账号与既有 P5 验收周期；由 runner 包裹事务并回滚。
do $$
declare
  v_cycle uuid; v_policy jsonb; v_revision integer; v_saved integer;
  v_actor uuid:=current_setting('mathin.seed_principal')::uuid;
begin
  select id,health_policy,health_policy_revision into strict v_cycle,v_policy,v_revision
    from public.renewal_cycles where name='P5验收 · 暑期衔接→秋季续报';
  if not public.valid_renewal_health_policy(v_policy) then raise exception 'DEFAULT_INVALID'; end if;
  if public.valid_renewal_health_policy(jsonb_set(v_policy,'{rules,participation,threshold}','101'))
    or public.valid_renewal_health_policy(jsonb_set(v_policy,'{rules,trend,minSamples}','0'))
    or public.valid_renewal_health_policy(jsonb_set(v_policy,'{windowDays}','"28"'))
    or public.valid_renewal_health_policy(v_policy#-'{rules,video}') then raise exception 'INVALID_POLICY_ACCEPTED'; end if;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  set local role authenticated;
  v_policy:=jsonb_set(v_policy,'{rules,communication,threshold}','1');
  v_saved:=public.save_renewal_health_policy(v_cycle,v_policy,v_revision);
  if v_saved<>v_revision+1 or not exists(select 1 from public.renewal_cycles
    where id=v_cycle and health_policy=v_policy and health_policy_updated_by=v_actor and health_policy_updated_at is not null) then raise exception 'SAVE_NOT_PERSISTED'; end if;
  begin
    perform public.save_renewal_health_policy(v_cycle,v_policy,v_revision);
    raise exception 'STALE_WRITE_ACCEPTED';
  exception when others then if sqlerrm<>'POLICY_CHANGED' then raise; end if; end;
  begin
    perform public.save_renewal_health_policy(v_cycle,jsonb_set(v_policy,'{windowDays}','100'),v_saved);
    raise exception 'BAD_INPUT_ACCEPTED';
  exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  reset role;
  perform set_config('request.jwt.claim.sub',current_setting('mathin.seed_student'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mathin.seed_student'),'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.save_renewal_health_policy(v_cycle,v_policy,v_saved);
    raise exception 'STUDENT_WRITE_ACCEPTED';
  exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  reset role;
  set local role anon;
  begin
    perform public.save_renewal_health_policy(v_cycle,v_policy,v_saved);
    raise exception 'ANON_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'HEALTH_POLICY_ASSERTIONS_PASSED';
end $$;
