create table public.learning_reward_prizes (
  id uuid primary key,
  version integer not null default 1,
  offer_version integer not null default 1,
  title jsonb not null,
  description jsonb not null default '{"zh":"","en":""}',
  pickup_instructions jsonb not null default '{"zh":"向工作人员出示领取码","en":"Show your pickup code to staff"}',
  kind text not null check(kind in ('digital','physical')),
  image text not null default '',
  points_cost integer not null check(points_cost between 1 and 1000000),
  stock integer check(stock between 0 and 1000000),
  enabled boolean not null default false,
  redeem_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  check(kind='digital' or stock is not null)
);
create table public.learning_reward_orders (
  id uuid primary key,
  student_id uuid not null references public.students(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  prize_id uuid not null references public.learning_reward_prizes(id) on delete restrict,
  origin text not null check(origin in ('redeem','draw')),
  points_spent integer not null check(points_spent between 0 and 1000000),
  snapshot jsonb not null,
  metadata jsonb not null default '{}',
  status text not null check(status in ('collected','pending','received')),
  pickup_code text unique,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid references public.profiles(id)
);
create index learning_reward_orders_child on public.learning_reward_orders(student_id,created_at desc,id desc);
create index learning_reward_orders_pickup on public.learning_reward_orders(created_at,id) where status='pending';
create table public.learning_reward_inventory (
  id uuid primary key default gen_random_uuid(),
  prize_id uuid not null references public.learning_reward_prizes(id) on delete restrict,
  reason text not null check(reason in ('configure','redeem','draw')),
  before_stock integer, after_stock integer,
  order_id uuid references public.learning_reward_orders(id) on delete restrict,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create trigger learning_reward_inventory_immutable before update or delete on public.learning_reward_inventory for each row execute function public.reject_immutable_security_row();

create function mathin_internal.guard_reward_order() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'IMMUTABLE'; end if;
  if (to_jsonb(new)-array['status','fulfilled_at','fulfilled_by']) is distinct from (to_jsonb(old)-array['status','fulfilled_at','fulfilled_by'])
    or old.status<>'pending' or new.status<>'received' or new.fulfilled_at is null or new.fulfilled_by is null then raise exception 'IMMUTABLE'; end if;
  return new;
end $$;
create trigger learning_reward_orders_immutable before update or delete on public.learning_reward_orders for each row execute function mathin_internal.guard_reward_order();

alter table public.learning_reward_prizes enable row level security;
alter table public.learning_reward_orders enable row level security;
alter table public.learning_reward_inventory enable row level security;
revoke all on public.learning_reward_prizes,public.learning_reward_orders,public.learning_reward_inventory from public,anon,authenticated;
grant select on public.learning_reward_prizes,public.learning_reward_orders,public.learning_reward_inventory to authenticated;
create policy learning_reward_prizes_staff on public.learning_reward_prizes for select to authenticated using(public.has_perm(auth.uid(),'organization.profile.manage'));
create policy learning_reward_orders_read on public.learning_reward_orders for select to authenticated using(public.can_read_learning_rewards(student_id));
create policy learning_reward_inventory_staff on public.learning_reward_inventory for select to authenticated using(public.has_perm(auth.uid(),'organization.profile.manage'));

create function mathin_internal.reward_text_valid(p_value jsonb,p_max integer,p_required boolean default false) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(p_value)='object' and jsonb_typeof(p_value->'zh')='string' and jsonb_typeof(p_value->'en')='string'
    and length(p_value->>'zh')<=p_max and length(p_value->>'en')<=p_max and (not p_required or length(btrim(p_value->>'zh'))>0),false);
$$;

create function public.save_learning_reward_prize(p_id uuid,p_version integer,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare old learning_reward_prizes; saved learning_reward_prizes; quantity integer; cost integer;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_version is null or p_version<0 or not mathin_internal.reward_text_valid(p_config->'title',80,true)
    or not mathin_internal.reward_text_valid(p_config->'description',1000) or not mathin_internal.reward_text_valid(p_config->'pickup_instructions',500)
    or p_config->>'kind' is null or p_config->>'kind' not in ('digital','physical')
    or jsonb_typeof(p_config->'enabled') is distinct from 'boolean' or jsonb_typeof(p_config->'redeem_enabled') is distinct from 'boolean'
    or coalesce(p_config->>'points_cost','') !~ '^[0-9]{1,7}$' or (p_config->>'points_cost')::int not between 1 and 1000000
    or (p_config->>'stock' is not null and (p_config->>'stock' !~ '^[0-9]{1,7}$' or (p_config->>'stock')::int not between 0 and 1000000))
    or (p_config->>'kind'='physical' and p_config->>'stock' is null)
    or p_config->>'image' is null or length(p_config->>'image')>500
    or (p_config->>'image'<>'' and p_config->>'image' !~ '^https://[^[:space:]]+$' and p_config->>'image' !~ '^asset:icons/[a-z-]+$') then raise exception 'VALIDATION'; end if;
  quantity:=(p_config->>'stock')::int; cost:=(p_config->>'points_cost')::int;
  perform pg_advisory_xact_lock(hashtextextended('reward-prize:'||p_id::text,0));
  select * into old from learning_reward_prizes where id=p_id for update;
  if p_version is distinct from coalesce(old.version,0) then raise exception 'FORM_CHANGED'; end if;
  if old.id is not null and old.kind<>p_config->>'kind' then raise exception 'VALIDATION'; end if;
  insert into learning_reward_prizes(id,title,description,pickup_instructions,kind,image,points_cost,stock,enabled,redeem_enabled,updated_by)
    values(p_id,p_config->'title',p_config->'description',p_config->'pickup_instructions',p_config->>'kind',p_config->>'image',cost,quantity,(p_config->>'enabled')::boolean,(p_config->>'redeem_enabled')::boolean,auth.uid())
    on conflict(id) do update set version=learning_reward_prizes.version+1,offer_version=learning_reward_prizes.offer_version+1,
      title=excluded.title,description=excluded.description,pickup_instructions=excluded.pickup_instructions,image=excluded.image,points_cost=excluded.points_cost,
      stock=excluded.stock,enabled=excluded.enabled,redeem_enabled=excluded.redeem_enabled,updated_at=now(),updated_by=auth.uid() returning * into saved;
  if old.id is null or old.stock is distinct from quantity then
    insert into learning_reward_inventory(prize_id,reason,before_stock,after_stock,actor_id) values(p_id,'configure',old.stock,quantity,auth.uid());
  end if;
  return to_jsonb(saved);
end $$;

create function public.learning_reward_catalog_admin() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from learning_reward_prizes p),'[]');
end $$;

-- Caller holds the per-child lock and decides/charges the price in the same transaction.
create function mathin_internal.issue_learning_prize(p_id uuid,p_student uuid,p_prize uuid,p_origin text,p_cost integer,p_actor uuid,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prize learning_reward_prizes; result learning_reward_orders;
begin
  select * into prize from learning_reward_prizes where id=p_prize for update;
  if not found or not prize.enabled then raise exception 'NOT_FOUND'; end if;
  if prize.stock is not null and prize.stock<1 then raise exception 'OUT_OF_STOCK'; end if;
  insert into learning_reward_orders(id,student_id,actor_id,prize_id,origin,points_spent,snapshot,metadata,status,pickup_code)
    values(p_id,p_student,p_actor,p_prize,p_origin,p_cost,jsonb_build_object('title',prize.title,'description',prize.description,'image',prize.image,
      'kind',prize.kind,'pickupInstructions',prize.pickup_instructions,'offerVersion',prize.offer_version,'pointsCost',prize.points_cost),p_metadata,
      case when prize.kind='physical' then 'pending' else 'collected' end,
      case when prize.kind='physical' then left(upper(replace(gen_random_uuid()::text,'-','')),12) end) returning * into result;
  update learning_reward_prizes set stock=case when stock is null then null else stock-1 end,version=version+1 where id=p_prize;
  insert into learning_reward_inventory(prize_id,reason,before_stock,after_stock,order_id,actor_id)
    values(p_prize,p_origin,prize.stock,case when prize.stock is null then null else prize.stock-1 end,p_id,p_actor);
  return to_jsonb(result);
end $$;

create function public.redeem_learning_prize(p_id uuid,p_student uuid,p_prize uuid,p_offer_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prize learning_reward_prizes; previous learning_reward_orders; result jsonb;
begin
  if not coalesce(public.miniapp_can_participate(p_student,'grades'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_prize is null or p_offer_version is null or p_offer_version<1 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-request:'||p_id::text,0));
  select * into previous from learning_reward_orders where id=p_id;
  if found then
    if previous.student_id<>p_student or previous.actor_id<>auth.uid() or previous.prize_id<>p_prize or previous.origin<>'redeem'
      or (previous.snapshot->>'offerVersion')::int<>p_offer_version then raise exception 'CONFLICT'; end if;
    return to_jsonb(previous);
  end if;
  perform mathin_internal.lock_learning_rewards(p_student);
  select * into prize from learning_reward_prizes where id=p_prize for update;
  if not found or not prize.enabled or not prize.redeem_enabled then raise exception 'NOT_FOUND'; end if;
  if prize.offer_version<>p_offer_version then raise exception 'FORM_CHANGED'; end if;
  if (select balance from learning_reward_accounts where student_id=p_student)<prize.points_cost then raise exception 'INSUFFICIENT_POINTS'; end if;
  result:=mathin_internal.issue_learning_prize(p_id,p_student,p_prize,'redeem',prize.points_cost,auth.uid(),'{}');
  perform mathin_internal.append_learning_reward(p_id,p_student,'redeem',p_id::text,-prize.points_cost,'兑换：'||left(prize.title->>'zh',400),jsonb_build_object('orderId',p_id,'prize',result->'snapshot'),auth.uid());
  return result;
end $$;

create function public.read_learning_reward_catalog(p_student uuid,p_before uuid default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare boundary learning_reward_prizes; rows jsonb;
begin
  if not coalesce(public.miniapp_can_participate(p_student,'grades'),false) then raise exception 'FORBIDDEN'; end if;
  if p_before is not null then select * into boundary from learning_reward_prizes where id=p_before; if not found then raise exception 'NOT_FOUND'; end if; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into rows from (
    select id,offer_version,title,description,pickup_instructions,kind,image,points_cost,stock,created_at from learning_reward_prizes
      where enabled and redeem_enabled and (p_before is null or (created_at,id)<(boundary.created_at,boundary.id)) order by created_at desc,id desc limit 30
  ) x;
  return jsonb_build_object('items',rows,'next',case when jsonb_array_length(rows)=30 then rows->29->>'id' end);
end $$;

create function public.read_learning_reward_orders(p_student uuid,p_kind text default '',p_before uuid default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare boundary learning_reward_orders; rows jsonb;
begin
  if not public.can_read_learning_rewards(p_student) then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('','digital','physical') then raise exception 'VALIDATION'; end if;
  if p_before is not null then select * into boundary from learning_reward_orders where id=p_before and student_id=p_student; if not found then raise exception 'NOT_FOUND'; end if; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into rows from (
    select id,origin,points_spent,snapshot,status,pickup_code,created_at,fulfilled_at from learning_reward_orders
      where student_id=p_student and (p_kind='' or snapshot->>'kind'=p_kind)
      and (p_before is null or (created_at,id)<(boundary.created_at,boundary.id)) order by created_at desc,id desc limit 30
  ) x;
  return jsonb_build_object('items',rows,'next',case when jsonb_array_length(rows)=30 then rows->29->>'id' end);
end $$;

create function public.read_learning_reward_pickups(p_code text default '',p_before uuid default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare boundary learning_reward_orders; rows jsonb;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_code is null or length(p_code)>64 then raise exception 'VALIDATION'; end if;
  if p_before is not null then select * into boundary from learning_reward_orders where id=p_before; if not found then raise exception 'NOT_FOUND'; end if; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into rows from (
    select o.id,o.origin,o.points_spent,o.snapshot,o.status,o.pickup_code,o.created_at,o.fulfilled_at,s.name student_name from learning_reward_orders o join students s on s.id=o.student_id
      where (case when btrim(p_code)<>'' then o.pickup_code=upper(btrim(p_code)) else o.status='pending' end)
      and (p_before is null or (o.created_at,o.id)<(boundary.created_at,boundary.id)) order by o.created_at desc,o.id desc limit 30
  ) x;
  return jsonb_build_object('items',rows,'next',case when jsonb_array_length(rows)=30 then rows->29->>'id' end);
end $$;

create function public.fulfil_learning_reward(p_order uuid,p_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r learning_reward_orders;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select * into r from learning_reward_orders where id=p_order for update;
  if not found or r.snapshot->>'kind'<>'physical' then raise exception 'NOT_FOUND'; end if;
  if p_code is null or r.pickup_code is distinct from upper(btrim(p_code)) then raise exception 'VALIDATION'; end if;
  if r.status='received' then return to_jsonb(r); end if;
  update learning_reward_orders set status='received',fulfilled_at=now(),fulfilled_by=auth.uid() where id=p_order returning * into r;
  return to_jsonb(r);
end $$;

revoke all on function mathin_internal.guard_reward_order(),mathin_internal.reward_text_valid(jsonb,integer,boolean),
  mathin_internal.issue_learning_prize(uuid,uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_learning_reward_prize(uuid,integer,jsonb),public.learning_reward_catalog_admin(),public.redeem_learning_prize(uuid,uuid,uuid,integer),
  public.read_learning_reward_catalog(uuid,uuid),public.read_learning_reward_orders(uuid,text,uuid),public.read_learning_reward_pickups(text,uuid),public.fulfil_learning_reward(uuid,text) from public,anon,authenticated;
grant execute on function public.save_learning_reward_prize(uuid,integer,jsonb),public.learning_reward_catalog_admin(),public.redeem_learning_prize(uuid,uuid,uuid,integer),
  public.read_learning_reward_catalog(uuid,uuid),public.read_learning_reward_orders(uuid,text,uuid),public.read_learning_reward_pickups(text,uuid),public.fulfil_learning_reward(uuid,text) to authenticated;
notify pgrst,'reload schema';
