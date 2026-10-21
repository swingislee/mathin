create table public.learning_reward_draw_pools (
  id uuid primary key, version integer not null default 1,
  title jsonb not null, description jsonb not null, enabled boolean not null default false,
  points_cost integer not null check(points_cost between 1 and 1000000),
  daily_limit integer not null check(daily_limit between 0 and 10000),
  total_limit integer not null check(total_limit between 0 and 1000000),
  pity_after integer not null check(pity_after between 0 and 1000000),
  entries jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);
create table public.learning_reward_draw_state (
  student_id uuid not null references public.students(id) on delete restrict,
  pool_id uuid not null references public.learning_reward_draw_pools(id) on delete restrict,
  total_draws integer not null default 0 check(total_draws>=0),
  since_pity integer not null default 0 check(since_pity>=0),
  primary key(student_id,pool_id)
);
create table public.learning_reward_draws (
  id uuid primary key references public.learning_reward_orders(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  pool_id uuid not null references public.learning_reward_draw_pools(id) on delete restrict,
  rule_version integer not null, total_before integer not null,
  since_before integer not null, since_after integer not null,
  guaranteed boolean not null, snapshot jsonb not null, created_at timestamptz not null default now()
);
create index learning_reward_draws_counts on public.learning_reward_draws(student_id,pool_id,created_at);
create trigger learning_reward_draws_immutable before update or delete on public.learning_reward_draws for each row execute function public.reject_immutable_security_row();
alter table public.learning_reward_draw_pools enable row level security;
alter table public.learning_reward_draw_state enable row level security;
alter table public.learning_reward_draws enable row level security;
revoke all on public.learning_reward_draw_pools,public.learning_reward_draw_state,public.learning_reward_draws from public,anon,authenticated;
grant select on public.learning_reward_draw_pools,public.learning_reward_draw_state,public.learning_reward_draws to authenticated;
create policy learning_reward_draw_pools_staff on public.learning_reward_draw_pools for select to authenticated using(public.has_perm(auth.uid(),'organization.profile.manage'));
create policy learning_reward_draw_state_read on public.learning_reward_draw_state for select to authenticated using(public.can_read_learning_rewards(student_id));
create policy learning_reward_draws_read on public.learning_reward_draws for select to authenticated using(public.can_read_learning_rewards(student_id));

create function public.save_learning_reward_draw_pool(p_id uuid,p_version integer,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior learning_reward_draw_pools; saved learning_reward_draw_pools; entry jsonb; ids uuid[]:='{}'; prize uuid;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_version is null or p_version<0 or not mathin_internal.reward_text_valid(p_config->'title',80,true)
    or not mathin_internal.reward_text_valid(p_config->'description',1000) or jsonb_typeof(p_config->'enabled') is distinct from 'boolean'
    or coalesce(p_config->>'points_cost','') !~ '^[0-9]{1,7}$' or (p_config->>'points_cost')::int not between 1 and 1000000
    or coalesce(p_config->>'daily_limit','') !~ '^[0-9]{1,5}$' or (p_config->>'daily_limit')::int not between 0 and 10000
    or coalesce(p_config->>'total_limit','') !~ '^[0-9]{1,7}$' or (p_config->>'total_limit')::int not between 0 and 1000000
    or coalesce(p_config->>'pity_after','') !~ '^[0-9]{1,7}$' or (p_config->>'pity_after')::int not between 0 and 1000000
    or jsonb_typeof(p_config->'entries') is distinct from 'array' then raise exception 'VALIDATION'; end if;
  if jsonb_array_length(p_config->'entries') not between 1 and 50 then raise exception 'VALIDATION'; end if;
  for entry in select value from jsonb_array_elements(p_config->'entries') loop
    if coalesce(entry->>'prize_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(entry->>'weight','') !~ '^[0-9]{1,7}$' or (entry->>'weight')::int not between 1 and 1000000
      or not mathin_internal.reward_text_valid(entry->'tier',40)
      or jsonb_typeof(entry->'is_pity') is distinct from 'boolean' then raise exception 'VALIDATION'; end if;
    prize:=(entry->>'prize_id')::uuid;
    if prize=any(ids) or not exists(select 1 from learning_reward_prizes where id=prize) then raise exception 'VALIDATION'; end if;
    ids:=array_append(ids,prize);
  end loop;
  if (p_config->>'pity_after')::int>0 and not exists(select 1 from jsonb_array_elements(p_config->'entries') e where (e->>'is_pity')::boolean) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-pool:'||p_id::text,0));
  select * into prior from learning_reward_draw_pools where id=p_id for update;
  if p_version is distinct from coalesce(prior.version,0) then raise exception 'FORM_CHANGED'; end if;
  insert into learning_reward_draw_pools(id,title,description,enabled,points_cost,daily_limit,total_limit,pity_after,entries,updated_by)
    values(p_id,p_config->'title',p_config->'description',(p_config->>'enabled')::boolean,(p_config->>'points_cost')::int,
      (p_config->>'daily_limit')::int,(p_config->>'total_limit')::int,(p_config->>'pity_after')::int,p_config->'entries',auth.uid())
    on conflict(id) do update set version=learning_reward_draw_pools.version+1,title=excluded.title,description=excluded.description,
      enabled=excluded.enabled,points_cost=excluded.points_cost,daily_limit=excluded.daily_limit,total_limit=excluded.total_limit,
      pity_after=excluded.pity_after,entries=excluded.entries,updated_at=now(),updated_by=auth.uid() returning * into saved;
  return to_jsonb(saved);
end $$;

create function public.learning_reward_draw_pools_admin() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from learning_reward_draw_pools p),'[]');
end $$;

-- Rejection sampling avoids modulo bias. The caller bounds total weight to 50,000,000.
create function mathin_internal.reward_random_below(p_bound integer) returns integer
language plpgsql volatile set search_path=public,pg_temp as $$
declare bytes bytea; n bigint; ceiling bigint;
begin
  if p_bound<1 or p_bound>50000000 then raise exception 'VALIDATION'; end if;
  ceiling:=(4294967296::bigint/p_bound)*p_bound;
  loop
    bytes:=extensions.gen_random_bytes(4);
    n:=get_byte(bytes,0)::bigint*16777216+get_byte(bytes,1)::bigint*65536+get_byte(bytes,2)::bigint*256+get_byte(bytes,3);
    if n<ceiling then return (n%p_bound)::integer; end if;
  end loop;
end $$;

create function mathin_internal.learning_draw_view(p_pool uuid,p_student uuid) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare pool learning_reward_draw_pools; state learning_reward_draw_state; today integer; entries jsonb; blocked boolean;
begin
  select * into pool from learning_reward_draw_pools where id=p_pool;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into state from learning_reward_draw_state where student_id=p_student and pool_id=p_pool;
  select count(*) into today from learning_reward_draws where student_id=p_student and pool_id=p_pool
    and created_at >= (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');
  select jsonb_agg(e || jsonb_build_object('title',p.title,'image',p.image,'kind',p.kind,'stock',p.stock,'enabled',p.enabled) order by n),
    bool_or(p.id is null or not p.enabled or p.stock=0) into entries,blocked
    from jsonb_array_elements(pool.entries) with ordinality a(e,n) left join learning_reward_prizes p on p.id=(e->>'prize_id')::uuid;
  return to_jsonb(pool)-array['updated_by','updated_at'] || jsonb_build_object('entries',entries,
    'total_draws',coalesce(state.total_draws,0),'since_pity',coalesce(state.since_pity,0),'today_draws',today,
    'guaranteed',pool.pity_after>0 and coalesce(state.since_pity,0)+1>=pool.pity_after,
    'blocked',case when not pool.enabled then 'NOT_FOUND' when blocked then 'POOL_UNAVAILABLE'
      when (pool.daily_limit>0 and today>=pool.daily_limit) or (pool.total_limit>0 and coalesce(state.total_draws,0)>=pool.total_limit) then 'DRAW_LIMIT' else '' end);
end $$;

create function public.read_learning_reward_draws(p_student uuid,p_pool uuid default null,p_before uuid default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare rows jsonb;
begin
  if not coalesce(public.miniapp_can_participate(p_student,'grades'),false) then raise exception 'FORBIDDEN'; end if;
  if p_pool is not null then return jsonb_build_object('items',jsonb_build_array(mathin_internal.learning_draw_view(p_pool,p_student)),'next',null); end if;
  select coalesce(jsonb_agg(mathin_internal.learning_draw_view(id,p_student) order by id),'[]') into rows from (
    select id from learning_reward_draw_pools where enabled and (p_before is null or id>p_before) order by id limit 30
  ) x;
  return jsonb_build_object('items',rows,'next',case when jsonb_array_length(rows)=30 then rows->29->>'id' end);
end $$;

create function public.draw_learning_reward(p_id uuid,p_student uuid,p_pool uuid,p_version integer,p_expected_total integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pool learning_reward_draw_pools; state learning_reward_draw_state; previous learning_reward_orders; receipt learning_reward_draws;
  entry jsonb; chosen jsonb; total_weight integer; ticket integer; forced boolean; result jsonb; view jsonb; after_count integer;
begin
  if not coalesce(public.miniapp_can_participate(p_student,'grades'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_pool is null or p_version is null or p_version<1 or p_expected_total is null or p_expected_total<0 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-request:'||p_id::text,0));
  select * into previous from learning_reward_orders where id=p_id;
  if found then
    select * into receipt from learning_reward_draws where id=p_id;
    if previous.student_id<>p_student or previous.actor_id<>auth.uid() or previous.origin<>'draw' or receipt.pool_id is distinct from p_pool
      or receipt.rule_version is distinct from p_version or receipt.total_before is distinct from p_expected_total then raise exception 'CONFLICT'; end if;
    return to_jsonb(previous);
  end if;
  perform mathin_internal.lock_learning_rewards(p_student);
  select * into pool from learning_reward_draw_pools where id=p_pool for update;
  if not found or not pool.enabled then raise exception 'NOT_FOUND'; end if;
  if pool.version<>p_version then raise exception 'FORM_CHANGED'; end if;
  insert into learning_reward_draw_state(student_id,pool_id) values(p_student,p_pool) on conflict do nothing;
  select * into state from learning_reward_draw_state where student_id=p_student and pool_id=p_pool for update;
  if state.total_draws<>p_expected_total then raise exception 'FORM_CHANGED'; end if;
  -- All pool prizes are locked in a common order, including across overlapping pools.
  perform p.id from learning_reward_prizes p where p.id in (select (e->>'prize_id')::uuid from jsonb_array_elements(pool.entries) e) order by p.id for update;
  view:=mathin_internal.learning_draw_view(p_pool,p_student);
  if view->>'blocked'<>'' then raise exception '%',view->>'blocked'; end if;
  if (select balance from learning_reward_accounts where student_id=p_student)<pool.points_cost then raise exception 'INSUFFICIENT_POINTS'; end if;
  forced:=pool.pity_after>0 and state.since_pity+1>=pool.pity_after;
  select sum((e->>'weight')::int) into total_weight from jsonb_array_elements(pool.entries) e where not forced or (e->>'is_pity')::boolean;
  ticket:=mathin_internal.reward_random_below(total_weight);
  for entry in select value from jsonb_array_elements(pool.entries) loop
    if forced and not (entry->>'is_pity')::boolean then continue; end if;
    ticket:=ticket-(entry->>'weight')::int;
    if ticket<0 then chosen:=entry; exit; end if;
  end loop;
  after_count:=case when (chosen->>'is_pity')::boolean then 0 else state.since_pity+1 end;
  result:=mathin_internal.issue_learning_prize(p_id,p_student,(chosen->>'prize_id')::uuid,'draw',pool.points_cost,auth.uid(),
    jsonb_build_object('poolId',p_pool,'poolTitle',pool.title,'tier',chosen->'tier','guaranteed',forced,'isPity',chosen->'is_pity','drawNumber',state.total_draws+1));
  perform mathin_internal.append_learning_reward(p_id,p_student,'draw',p_id::text,-pool.points_cost,'抽取：'||left(pool.title->>'zh',400),
    jsonb_build_object('orderId',p_id,'poolId',p_pool,'ruleVersion',pool.version,'prize',result->'snapshot','guaranteed',forced),auth.uid());
  insert into learning_reward_draws(id,student_id,pool_id,rule_version,total_before,since_before,since_after,guaranteed,snapshot)
    values(p_id,p_student,p_pool,pool.version,state.total_draws,state.since_pity,after_count,forced,
      jsonb_build_object('rules',view,'selected',chosen,'eligibleWeight',total_weight));
  update learning_reward_draw_state set total_draws=state.total_draws+1,since_pity=after_count where student_id=p_student and pool_id=p_pool;
  return result;
end $$;

create or replace function public.read_learning_reward_orders(p_student uuid,p_kind text default '',p_before uuid default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare boundary learning_reward_orders; rows jsonb;
begin
  if not public.can_read_learning_rewards(p_student) then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('','digital','physical') then raise exception 'VALIDATION'; end if;
  if p_before is not null then select * into boundary from learning_reward_orders where id=p_before and student_id=p_student; if not found then raise exception 'NOT_FOUND'; end if; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into rows from (
    select id,origin,points_spent,snapshot,metadata,status,pickup_code,created_at,fulfilled_at from learning_reward_orders
      where student_id=p_student and (p_kind='' or snapshot->>'kind'=p_kind)
      and (p_before is null or (created_at,id)<(boundary.created_at,boundary.id)) order by created_at desc,id desc limit 30
  ) x;
  return jsonb_build_object('items',rows,'next',case when jsonb_array_length(rows)=30 then rows->29->>'id' end);
end $$;

revoke all on function mathin_internal.reward_random_below(integer),mathin_internal.learning_draw_view(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_learning_reward_draw_pool(uuid,integer,jsonb),public.learning_reward_draw_pools_admin(),public.read_learning_reward_draws(uuid,uuid,uuid),public.draw_learning_reward(uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.save_learning_reward_draw_pool(uuid,integer,jsonb),public.learning_reward_draw_pools_admin(),public.read_learning_reward_draws(uuid,uuid,uuid),public.draw_learning_reward(uuid,uuid,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
