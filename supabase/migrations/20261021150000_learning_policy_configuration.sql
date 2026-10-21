-- Drafts and publication are separate. Existing live rules are preserved by default.
alter table public.learning_reward_draw_pools add column mechanism jsonb not null default '{"mode":"weighted"}';
alter table public.learning_reward_draw_state add column rarity_counts jsonb not null default '{}';
alter table public.learning_mistake_rules add column history_mode text not null default 'current' check(history_mode in ('current','retain')),
  add column mastered_statuses text[] not null default '{}' check(mastered_statuses <@ array['explained','independent','prompted','imitated','incomplete','unchecked']::text[]);

create function mathin_internal.reward_rarity_rank(p_value text) returns integer language sql immutable set search_path=public,pg_temp as $$
  select coalesce(array_position(array['R','SR','SSR','SP','UR'],p_value),0)
$$;
create function mathin_internal.validate_draw_mechanism(p_config jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare m jsonb:=coalesce(p_config->'mechanism','{"mode":"weighted"}'::jsonb); r text; e jsonb; total integer:=0; ranks integer[]:='{}'; rank integer;
begin
  if jsonb_typeof(m) is distinct from 'object' or m->>'mode' not in ('weighted','rarity') or m->>'mode' is null then raise exception 'VALIDATION'; end if;
  if m->>'mode'='weighted' then return; end if;
  if jsonb_typeof(m->'rates') is distinct from 'object' or jsonb_typeof(m->'pities') is distinct from 'array'
    or jsonb_array_length(m->'pities')>4 or (p_config->>'pity_after')::integer<>0 then raise exception 'VALIDATION'; end if;
  if exists(select 1 from jsonb_object_keys(m->'rates') x where mathin_internal.reward_rarity_rank(x)=0) then raise exception 'VALIDATION'; end if;
  foreach r in array array['R','SR','SSR','SP','UR'] loop
    if coalesce(m->'rates'->>r,'') !~ '^[0-9]{1,7}$' or (m->'rates'->>r)::int>1000000 then raise exception 'VALIDATION'; end if;
    total:=total+(m->'rates'->>r)::int;
    if (m->'rates'->>r)::int>0 and not exists(select 1 from jsonb_array_elements(p_config->'entries') x where x->>'rarity'=r) then raise exception 'VALIDATION'; end if;
  end loop;
  if total<>1000000 then raise exception 'VALIDATION'; end if;
  for e in select value from jsonb_array_elements(p_config->'entries') loop
    if mathin_internal.reward_rarity_rank(e->>'rarity')=0 or (m->'rates'->>(e->>'rarity'))::int=0 then raise exception 'VALIDATION'; end if;
  end loop;
  for e in select value from jsonb_array_elements(m->'pities') loop
    rank:=mathin_internal.reward_rarity_rank(e->>'minRarity');
    if rank<2 or rank=any(ranks) or coalesce(e->>'after','') !~ '^[0-9]{1,7}$' or (e->>'after')::int not between 1 and 1000000
      or not exists(select 1 from jsonb_each_text(m->'rates') x where mathin_internal.reward_rarity_rank(x.key)>=rank and x.value::int>0) then raise exception 'VALIDATION'; end if;
    ranks:=array_append(ranks,rank);
  end loop;
end $$;
create function mathin_internal.draw_forced_rank(p_mechanism jsonb,p_counts jsonb) returns integer language sql immutable set search_path=public,pg_temp as $$
  select coalesce(max(mathin_internal.reward_rarity_rank(e->>'minRarity')),0) from jsonb_array_elements(coalesce(p_mechanism->'pities','[]')) e
  where coalesce((p_counts->>(e->>'minRarity'))::int,0)+1 >= (e->>'after')::int
$$;

create or replace function public.save_learning_reward_draw_pool(p_id uuid,p_version integer,p_config jsonb) returns jsonb
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
  perform mathin_internal.validate_draw_mechanism(p_config);
  select * into prior from learning_reward_draw_pools where id=p_id for update;
  if p_version is distinct from coalesce(prior.version,0) then raise exception 'FORM_CHANGED'; end if;
  insert into learning_reward_draw_pools(id,title,description,enabled,points_cost,daily_limit,total_limit,pity_after,entries,updated_by)
    values(p_id,p_config->'title',p_config->'description',(p_config->>'enabled')::boolean,(p_config->>'points_cost')::int,
      (p_config->>'daily_limit')::int,(p_config->>'total_limit')::int,(p_config->>'pity_after')::int,p_config->'entries',auth.uid())
    on conflict(id) do update set version=learning_reward_draw_pools.version+1,title=excluded.title,description=excluded.description,
      enabled=excluded.enabled,points_cost=excluded.points_cost,daily_limit=excluded.daily_limit,total_limit=excluded.total_limit,
      pity_after=excluded.pity_after,entries=excluded.entries,updated_at=now(),updated_by=auth.uid() returning * into saved;
  update learning_reward_draw_pools set mechanism=coalesce(p_config->'mechanism','{"mode":"weighted"}'::jsonb) where id=p_id returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function mathin_internal.learning_draw_view(p_pool uuid,p_student uuid) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare pool learning_reward_draw_pools; state learning_reward_draw_state; today integer; entries jsonb; blocked boolean; forced_rank integer; rate_total integer;
begin
  select * into pool from learning_reward_draw_pools where id=p_pool;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into state from learning_reward_draw_state where student_id=p_student and pool_id=p_pool;
  select count(*) into today from learning_reward_draws where student_id=p_student and pool_id=p_pool
    and created_at >= (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');
  select jsonb_agg(e || jsonb_build_object('title',p.title,'image',p.image,'kind',p.kind,'stock',p.stock,'enabled',p.enabled) order by n),
    bool_or(p.id is null or not p.enabled or p.stock=0) into entries,blocked
    from jsonb_array_elements(pool.entries) with ordinality a(e,n) left join learning_reward_prizes p on p.id=(e->>'prize_id')::uuid;
  forced_rank:=mathin_internal.draw_forced_rank(pool.mechanism,coalesce(state.rarity_counts,'{}'));
  if pool.mechanism->>'mode'='rarity' then
    select sum(value::int) into rate_total from jsonb_each_text(pool.mechanism->'rates') where mathin_internal.reward_rarity_rank(key)>=forced_rank;
    select jsonb_agg(e || jsonb_build_object('tier',jsonb_build_object('zh',e->>'rarity','en',e->>'rarity'),
      'base_probability',(pool.mechanism->'rates'->>(e->>'rarity'))::numeric/1000000*(e->>'weight')::numeric/
        (select sum((x->>'weight')::numeric) from jsonb_array_elements(pool.entries) x where x->>'rarity'=e->>'rarity'),
      'actual_probability',case when mathin_internal.reward_rarity_rank(e->>'rarity')<forced_rank then 0 else
        (pool.mechanism->'rates'->>(e->>'rarity'))::numeric/rate_total*(e->>'weight')::numeric/
        (select sum((x->>'weight')::numeric) from jsonb_array_elements(pool.entries) x where x->>'rarity'=e->>'rarity') end)) into entries from jsonb_array_elements(entries) e;
  end if;
  return to_jsonb(pool)-array['updated_by','updated_at'] || jsonb_build_object('entries',entries,
    'total_draws',coalesce(state.total_draws,0),'since_pity',coalesce(state.since_pity,0),'today_draws',today,
    'rarity_counts',coalesce(state.rarity_counts,'{}'),'forced_rank',forced_rank,
    'guaranteed',case when pool.mechanism->>'mode'='rarity' then forced_rank>0 else pool.pity_after>0 and coalesce(state.since_pity,0)+1>=pool.pity_after end,
    'blocked',case when not pool.enabled then 'NOT_FOUND' when blocked then 'POOL_UNAVAILABLE'
      when (pool.daily_limit>0 and today>=pool.daily_limit) or (pool.total_limit>0 and coalesce(state.total_draws,0)>=pool.total_limit) then 'DRAW_LIMIT' else '' end);
end $$;

create or replace function public.draw_learning_reward(p_id uuid,p_student uuid,p_pool uuid,p_version integer,p_expected_total integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pool learning_reward_draw_pools; state learning_reward_draw_state; previous learning_reward_orders; receipt learning_reward_draws;
  entry jsonb; chosen jsonb; total_weight integer; ticket integer; forced boolean; result jsonb; view jsonb; after_count integer; rarity text; rate record; rank integer; counts jsonb;
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
  if pool.mechanism->>'mode'='rarity' then
    rank:=mathin_internal.draw_forced_rank(pool.mechanism,state.rarity_counts); forced:=rank>0;
    select sum(value::int) into total_weight from jsonb_each_text(pool.mechanism->'rates') where mathin_internal.reward_rarity_rank(key)>=rank;
    ticket:=mathin_internal.reward_random_below(total_weight);
    for rate in select key,value::int as weight from jsonb_each_text(pool.mechanism->'rates') where mathin_internal.reward_rarity_rank(key)>=rank order by mathin_internal.reward_rarity_rank(key) loop
      ticket:=ticket-rate.weight; if ticket<0 then rarity:=rate.key; exit; end if;
    end loop;
    select sum((e->>'weight')::int) into total_weight from jsonb_array_elements(pool.entries) e where e->>'rarity'=rarity;
    ticket:=mathin_internal.reward_random_below(total_weight);
    for entry in select value from jsonb_array_elements(pool.entries) where value->>'rarity'=rarity loop
      ticket:=ticket-(entry->>'weight')::int; if ticket<0 then chosen:=entry; exit; end if;
    end loop;
    chosen:=chosen||jsonb_build_object('tier',jsonb_build_object('zh',rarity,'en',rarity),'is_pity',forced);
    counts:=state.rarity_counts;
    for rate in select unnest(array['SR','SSR','SP','UR']) as key loop
      counts:=jsonb_set(counts,array[rate.key],to_jsonb(case when mathin_internal.reward_rarity_rank(rarity)>=mathin_internal.reward_rarity_rank(rate.key) then 0 else coalesce((counts->>rate.key)::int,0)+1 end));
    end loop;
  else
  forced:=pool.pity_after>0 and state.since_pity+1>=pool.pity_after;
  select sum((e->>'weight')::int) into total_weight from jsonb_array_elements(pool.entries) e where not forced or (e->>'is_pity')::boolean;
  ticket:=mathin_internal.reward_random_below(total_weight);
  for entry in select value from jsonb_array_elements(pool.entries) loop
    if forced and not (entry->>'is_pity')::boolean then continue; end if;
    ticket:=ticket-(entry->>'weight')::int;
    if ticket<0 then chosen:=entry; exit; end if;
  end loop;
    counts:=state.rarity_counts;
  end if;
  -- Legacy and rarity guarantee counters are independent; switching mode preserves each.
  after_count:=case when pool.mechanism->>'mode'='rarity' then state.since_pity when (chosen->>'is_pity')::boolean then 0 else state.since_pity+1 end;
  result:=mathin_internal.issue_learning_prize(p_id,p_student,(chosen->>'prize_id')::uuid,'draw',pool.points_cost,auth.uid(),
    jsonb_build_object('poolId',p_pool,'poolTitle',pool.title,'tier',chosen->'tier','guaranteed',forced,'isPity',chosen->'is_pity','drawNumber',state.total_draws+1));
  perform mathin_internal.append_learning_reward(p_id,p_student,'draw',p_id::text,-pool.points_cost,'抽取：'||left(pool.title->>'zh',400),
    jsonb_build_object('orderId',p_id,'poolId',p_pool,'ruleVersion',pool.version,'prize',result->'snapshot','guaranteed',forced),auth.uid());
  insert into learning_reward_draws(id,student_id,pool_id,rule_version,total_before,since_before,since_after,guaranteed,snapshot)
    values(p_id,p_student,p_pool,pool.version,state.total_draws,state.since_pity,after_count,forced,
      jsonb_build_object('rules',view,'selected',chosen,'eligibleWeight',total_weight));
  update learning_reward_draw_state set total_draws=state.total_draws+1,since_pity=after_count,rarity_counts=counts where student_id=p_student and pool_id=p_pool;
  return result;
end $$;

create table public.learning_mistake_history (
  student_id uuid not null references public.students(id) on delete restrict,
  record_id text not null, first_collected_at timestamptz not null default now(), snapshot jsonb not null,
  primary key(student_id,record_id)
);
alter table public.learning_mistake_history enable row level security;
revoke all on public.learning_mistake_history from public,anon,authenticated;
-- Families read current authorized source records through the RPC, not stored snapshots.
create function mathin_internal.capture_learning_mistakes(p_student uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare rules learning_mistake_rules;
begin
  select * into rules from learning_mistake_rules where singleton;
  if not rules.enabled or rules.history_mode<>'retain' then return; end if;
  insert into learning_mistake_history(student_id,record_id,snapshot)
    select p_student,r.id,to_jsonb(r) from mathin_internal.learning_mistake_records(p_student) r
    where r.status=any(rules.statuses) and case r.kind when 'classroom' then rules.classroom_enabled else rules.homework_enabled end
    on conflict do nothing;
end $$;
create function mathin_internal.capture_mistake_mark() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform mathin_internal.capture_learning_mistakes(new.student_id); return null;
end $$;
create trigger zz_capture_mistake_classroom after insert or update on public.session_learning_check_results for each row execute function mathin_internal.capture_mistake_mark();
create trigger zz_capture_mistake_reset after insert or update on public.learning_mistake_classroom_resets for each row execute function mathin_internal.capture_mistake_mark();
create trigger zz_capture_mistake_homework after insert or update on public.assignment_question_results for each row execute function mathin_internal.capture_mistake_mark();
create function mathin_internal.capture_mistake_session() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare child uuid;
begin
  if new.ended_at is not null and old.ended_at is null then
    for child in select distinct r.student_id from session_learning_check_results r join session_learning_checks q on q.id=r.check_id where q.session_id=new.id
      union select r.student_id from learning_mistake_classroom_resets r join session_learning_checks q on q.id=r.check_id where q.session_id=new.id loop
      perform mathin_internal.capture_learning_mistakes(child);
    end loop;
  end if;
  return null;
end $$;
create trigger zz_capture_mistake_session after update of ended_at on public.class_sessions for each row execute function mathin_internal.capture_mistake_session();
create function mathin_internal.learning_mistake_book(p_student uuid)
returns table(id text,kind text,question_id uuid,title text,source_id uuid,source_title text,classroom_name text,
  lesson_at timestamptz,status text,note text,marked_at timestamptz,source_page uuid,instructions text,collected_at timestamptz,mastered boolean)
language sql stable set search_path=public,pg_temp as $$
  select r.*,h.first_collected_at,rules.history_mode='retain' and h.record_id is not null and r.status=any(rules.mastered_statuses)
  from mathin_internal.learning_mistake_records(p_student) r cross join learning_mistake_rules rules
  left join learning_mistake_history h on h.student_id=p_student and h.record_id=r.id
$$;

create or replace function public.read_learning_mistakes(p_student uuid,p_before text default null,p_item text default null,p_kind text default '',p_status text default '') returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare rules learning_mistake_rules; boundary_at timestamptz; boundary_id text; rows jsonb; is_staff boolean;
begin
  if not public.can_read_learning_rewards(p_student) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from students where id=p_student and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
  if p_kind is null or p_kind not in ('','classroom','homework') or p_status is null
    or p_status not in ('','explained','independent','prompted','imitated','incomplete','unchecked','mastered','review')
    or (p_before is not null and p_before !~ '^(classroom|homework):[0-9a-fA-F-]{36}$')
    or (p_item is not null and p_item !~ '^(classroom|homework):[0-9a-fA-F-]{36}$') then raise exception 'VALIDATION'; end if;
  select * into rules from learning_mistake_rules where singleton;
  is_staff:=coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false);
  if not rules.enabled and not is_staff then return jsonb_build_object('enabled',false,'items','[]'::jsonb,'next',null,'rules',to_jsonb(rules)-'updated_by'); end if;
  if p_item is not null then
    select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('included',(r.status=any(rules.statuses) or rules.history_mode='retain' and r.collected_at is not null)
      and case r.kind when 'classroom' then rules.classroom_enabled else rules.homework_enabled end)),'[]') into rows
      from mathin_internal.learning_mistake_book(p_student) r where r.id=p_item;
    if jsonb_array_length(rows)=0 then raise exception 'NOT_FOUND'; end if;
  else
    if p_before is not null then
      select marked_at,id into boundary_at,boundary_id from mathin_internal.learning_mistake_book(p_student) where id=p_before;
      if not found then raise exception 'NOT_FOUND'; end if;
    end if;
    select coalesce(jsonb_agg(to_jsonb(r)-'instructions' order by r.marked_at desc,r.id desc),'[]') into rows from (
      select x.*,true as included from mathin_internal.learning_mistake_book(p_student) x
        where (x.status=any(rules.statuses) or rules.history_mode='retain' and x.collected_at is not null) and case x.kind when 'classroom' then rules.classroom_enabled else rules.homework_enabled end
        and (p_kind='' or x.kind=p_kind) and (p_status='' or x.status=p_status or p_status='mastered' and x.mastered or p_status='review' and not x.mastered)
        and (p_before is null or (x.marked_at,x.id)<(boundary_at,boundary_id))
        order by x.marked_at desc,x.id desc limit 30
    ) r;
  end if;
  return jsonb_build_object('enabled',rules.enabled,'items',rows,'next',case when p_item is null and jsonb_array_length(rows)=30 then rows->29->>'id' end,
    'rules',to_jsonb(rules)-'updated_by');
end $$;

create sequence public.learning_policy_draft_versions;
create table public.learning_policy_drafts (
  key text primary key check(key='mistakes' or key ~ '^draw:[0-9a-f-]{36}$'),
  version integer not null default nextval('public.learning_policy_draft_versions'), base_version integer not null, config jsonb not null,
  updated_at timestamptz not null default now(), updated_by uuid not null references public.profiles(id)
);
alter table public.learning_policy_drafts enable row level security;
revoke all on public.learning_policy_drafts from public,anon,authenticated;
grant select on public.learning_policy_drafts to authenticated;
create policy learning_policy_drafts_staff on public.learning_policy_drafts for select to authenticated using(public.has_perm(auth.uid(),'organization.profile.manage'));
create function public.read_learning_policy(p_key text) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare live jsonb; draft learning_policy_drafts;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_key='mistakes' then select to_jsonb(r) into live from learning_mistake_rules r where singleton;
  elsif p_key ~ '^draw:[0-9a-f-]{36}$' then select to_jsonb(p) into live from learning_reward_draw_pools p where id=substring(p_key from 6)::uuid;
  else raise exception 'VALIDATION'; end if;
  select * into draft from learning_policy_drafts where key=p_key;
  return jsonb_build_object('published',live,'draft',draft.config,'draftVersion',coalesce(draft.version,0),'baseVersion',coalesce(draft.base_version,(live->>'version')::integer,0));
end $$;
create function public.save_learning_policy_draft(p_key text,p_draft_version integer,p_base_version integer,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior learning_policy_drafts; live jsonb;
begin
  live:=public.read_learning_policy(p_key)->'published';
  if p_draft_version is null or p_base_version is null or jsonb_typeof(p_config) is distinct from 'object' or octet_length(p_config::text)>100000 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('learning-policy:'||p_key,0));
  select * into prior from learning_policy_drafts where key=p_key for update;
  if coalesce(prior.version,0)<>p_draft_version or coalesce((live->>'version')::int,0)<>p_base_version then raise exception 'FORM_CHANGED'; end if;
  insert into learning_policy_drafts(key,base_version,config,updated_by) values(p_key,p_base_version,p_config,auth.uid())
    on conflict(key) do update set version=nextval('public.learning_policy_draft_versions'),base_version=excluded.base_version,config=excluded.config,updated_at=now(),updated_by=auth.uid();
  return public.read_learning_policy(p_key);
end $$;
create function public.publish_learning_policy(p_key text,p_draft_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare draft learning_policy_drafts; c jsonb; saved jsonb; statuses text[]; mastered text[]; child uuid;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('learning-policy:'||p_key,0));
  select * into draft from learning_policy_drafts where key=p_key for update;
  if not found or draft.version is distinct from p_draft_version then raise exception 'FORM_CHANGED'; end if;
  c:=draft.config;
  if p_key='mistakes' then
    if jsonb_typeof(c->'enabled') is distinct from 'boolean' or jsonb_typeof(c->'classroom_enabled') is distinct from 'boolean' or jsonb_typeof(c->'homework_enabled') is distinct from 'boolean' then raise exception 'VALIDATION'; end if;
    if c->>'history_mode' not in ('current','retain') or c->>'history_mode' is null or jsonb_typeof(c->'mastered_statuses') is distinct from 'array' then raise exception 'VALIDATION'; end if;
    select array_agg(x) into statuses from jsonb_array_elements_text(c->'statuses') x;
    select coalesce(array_agg(x),'{}') into mastered from jsonb_array_elements_text(c->'mastered_statuses') x;
    if cardinality(mastered)>6 or array_position(mastered,null) is not null or not mastered <@ array['explained','independent','prompted','imitated','incomplete','unchecked']::text[]
      or (select count(distinct x) from unnest(mastered) x)<>cardinality(mastered) or mastered && statuses then raise exception 'VALIDATION'; end if;
    saved:=public.save_learning_mistake_rules(draft.base_version,(c->>'enabled')::boolean,(c->>'classroom_enabled')::boolean,(c->>'homework_enabled')::boolean,statuses);
    update learning_mistake_rules set history_mode=c->>'history_mode',mastered_statuses=mastered where singleton;
    if c->>'history_mode'='retain' and (c->>'enabled')::boolean then
      for child in select student_id from assignment_question_results union select student_id from session_learning_check_results union select student_id from learning_mistake_classroom_resets loop
        perform mathin_internal.capture_learning_mistakes(child);
      end loop;
    end if;
    saved:=public.read_learning_mistake_rules();
  elsif p_key ~ '^draw:[0-9a-f-]{36}$' then
    saved:=public.save_learning_reward_draw_pool(substring(p_key from 6)::uuid,draft.base_version,c);
  else raise exception 'VALIDATION'; end if;
  delete from learning_policy_drafts where key=p_key;
  return public.read_learning_policy(p_key);
end $$;
revoke all on function mathin_internal.reward_rarity_rank(text),mathin_internal.validate_draw_mechanism(jsonb),mathin_internal.draw_forced_rank(jsonb,jsonb),
  mathin_internal.capture_learning_mistakes(uuid),mathin_internal.capture_mistake_mark(),mathin_internal.capture_mistake_session(),mathin_internal.learning_mistake_book(uuid) from public,anon,authenticated;
revoke all on function public.read_learning_policy(text),public.save_learning_policy_draft(text,integer,integer,jsonb),public.publish_learning_policy(text,integer) from public,anon,authenticated;
grant execute on function public.read_learning_policy(text),public.save_learning_policy_draft(text,integer,integer,jsonb),public.publish_learning_policy(text,integer) to authenticated;
notify pgrst,'reload schema';
