-- 每个续班池保存判断口径；更新采用 revision，保留最后操作人及时间。
create function public.valid_renewal_health_policy(p_policy jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare v_key text; v_rule jsonb; v_min integer; v_threshold integer;
begin
  if jsonb_typeof(p_policy) is distinct from 'object'
    or jsonb_typeof(p_policy->'version') is distinct from 'number'
    or jsonb_typeof(p_policy->'windowDays') is distinct from 'number'
    or p_policy->>'version' is distinct from '1'
    or p_policy->>'windowDays' not in ('7','14','28')
    or jsonb_typeof(p_policy->'rules') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_policy->'rules'))<>8 then return false; end if;
  foreach v_key in array array['communication','attendance','participation','challenge','homework','accuracy','video','trend'] loop
    v_rule:=p_policy->'rules'->v_key;
    if jsonb_typeof(v_rule) is distinct from 'object'
      or jsonb_typeof(v_rule->'enabled') is distinct from 'boolean'
      or jsonb_typeof(v_rule->'minSamples') is distinct from 'number'
      or jsonb_typeof(v_rule->'threshold') is distinct from 'number'
      or (v_rule->>'minSamples')!~'^[0-9]+$' or (v_rule->>'threshold')!~'^-?[0-9]+$' then return false; end if;
    v_min:=(v_rule->>'minSamples')::integer; v_threshold:=(v_rule->>'threshold')::integer;
    if v_min not between 1 and 100 or v_threshold>100
      or v_threshold < (case when v_key='trend' then -100 when v_key in ('attendance','challenge','homework','video') then 1 else 0 end) then return false; end if;
  end loop;
  return p_policy ?& array['version','windowDays','rules'];
exception when others then return false;
end $$;
revoke all on function public.valid_renewal_health_policy(jsonb) from public,anon,authenticated;

alter table public.renewal_cycles
  add column health_policy jsonb not null default '{"version":1,"windowDays":28,"rules":{"communication":{"enabled":true,"minSamples":2,"threshold":2},"attendance":{"enabled":true,"minSamples":1,"threshold":1},"participation":{"enabled":true,"minSamples":5,"threshold":50},"challenge":{"enabled":true,"minSamples":5,"threshold":100},"homework":{"enabled":true,"minSamples":1,"threshold":1},"accuracy":{"enabled":true,"minSamples":3,"threshold":60},"video":{"enabled":true,"minSamples":1,"threshold":1},"trend":{"enabled":true,"minSamples":3,"threshold":0}}}'::jsonb,
  add column health_policy_revision integer not null default 0 check(health_policy_revision>=0),
  add column health_policy_updated_by uuid references public.profiles(id) on delete restrict,
  add column health_policy_updated_at timestamptz,
  add constraint renewal_cycles_health_policy_check check(public.valid_renewal_health_policy(health_policy));

create function public.save_renewal_health_policy(p_cycle_id uuid,p_policy jsonb,p_expected_revision integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_expected_revision is null or p_expected_revision<0 or not public.valid_renewal_health_policy(p_policy) then raise exception 'VALIDATION'; end if;
  select health_policy_revision into v_revision from public.renewal_cycles where id=p_cycle_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_revision<>p_expected_revision then raise exception 'POLICY_CHANGED'; end if;
  update public.renewal_cycles set health_policy=p_policy,health_policy_revision=v_revision+1,
    health_policy_updated_by=auth.uid(),health_policy_updated_at=now() where id=p_cycle_id;
  return v_revision+1;
end $$;
revoke all on function public.save_renewal_health_policy(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_renewal_health_policy(uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
