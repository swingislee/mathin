create function pg_temp.draw_expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
declare actor uuid; parent_id uuid; sid uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); common uuid:=gen_random_uuid(); rare uuid:=gen_random_uuid();
  pool uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); second uuid:=gen_random_uuid(); config jsonb; prize_config jsonb; result jsonb; original jsonb;
begin
  select p.id into actor from profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.purpose='test';
  select p.id into parent_id from profiles p join auth.users u on u.id=p.id where u.email='test-parent@mathin.local' and p.purpose='test';
  if actor is null or parent_id is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into students(id,name,bind_code,purpose,created_by) values(sid,'Draw transaction child',sid::text,'test',actor),(other_id,'Other draw child',other_id::text,'test',actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(sid,parent_id,'监护人',array['grades'],true);
  perform grant_learning_points(gen_random_uuid(),sid,100,'Draw fixture');
  prize_config:=jsonb_build_object('title',jsonb_build_object('zh','Common','en','Common'),'description',jsonb_build_object('zh','','en',''),
    'pickup_instructions',jsonb_build_object('zh','','en',''),'kind','digital','image','','points_cost',20,'stock',null,'enabled',true,'redeem_enabled',false);
  perform save_learning_reward_prize(common,0,prize_config);
  perform save_learning_reward_prize(rare,0,prize_config||jsonb_build_object('title',jsonb_build_object('zh','Rare','en','Rare')));
  config:=jsonb_build_object('title',jsonb_build_object('zh','Pool','en','Pool'),'description',jsonb_build_object('zh','','en',''),
    'enabled',true,'points_cost',10,'daily_limit',2,'total_limit',3,'pity_after',3,'entries',jsonb_build_array(
      jsonb_build_object('prize_id',common,'weight',999999,'tier',jsonb_build_object('zh','Common','en','Common'),'is_pity',false),
      jsonb_build_object('prize_id',rare,'weight',1,'tier',jsonb_build_object('zh','Rare','en','Rare'),'is_pity',true)));
  perform save_learning_reward_draw_pool(pool,0,config);
  -- Persistent progress represents two unsuccessful prior draws on earlier days; avoid a probabilistic assertion.
  insert into learning_reward_draw_state(student_id,pool_id,total_draws,since_pity) values(sid,pool,2,2);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  execute 'set local role authenticated';
  if not (read_learning_reward_draws(sid,pool)->'items'->0->>'guaranteed')::boolean then raise exception 'PITY_VIEW'; end if;
  original:=draw_learning_reward(intent,sid,pool,1,2);
  result:=draw_learning_reward(intent,sid,pool,1,2);
  if result<>original or (result->>'prize_id')::uuid<>rare or not (result->'metadata'->>'guaranteed')::boolean then raise exception 'PITY_OR_RETRY'; end if;
  if (read_learning_points(sid)->>'balance')::int<>90 then raise exception 'DRAW_DOUBLE_CHARGE'; end if;
  perform pg_temp.draw_expect_error(format('select draw_learning_reward(%L,%L,%L,1,3)',gen_random_uuid(),sid,pool),'DRAW_LIMIT');
  perform pg_temp.draw_expect_error(format('select draw_learning_reward(%L,%L,%L,1,2)',gen_random_uuid(),sid,pool),'FORM_CHANGED');
  perform pg_temp.draw_expect_error(format('select draw_learning_reward(%L,%L,%L,1,0)',gen_random_uuid(),other_id,pool),'FORBIDDEN');
  perform pg_temp.draw_expect_error(format('select read_learning_reward_draws(%L,%L)',other_id,pool),'FORBIDDEN');
  perform pg_temp.draw_expect_error(format('select save_learning_reward_draw_pool(%L,1,%L::jsonb)',pool,config),'FORBIDDEN');
  perform pg_temp.draw_expect_error(format('update learning_reward_draw_state set since_pity=0 where student_id=%L',sid),'permission denied');
  execute 'reset role';
  if (select since_pity from learning_reward_draw_state where student_id=sid and pool_id=pool)<>0 then raise exception 'PITY_RESET'; end if;
  perform pg_temp.draw_expect_error(format('update learning_reward_draws set guaranteed=false where id=%L',intent),'SECURITY_LEDGER_APPEND_ONLY');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform save_learning_reward_draw_pool(pool,1,config||jsonb_build_object('total_limit',0,'pity_after',1));
  if (select total_draws from learning_reward_draw_state where student_id=sid and pool_id=pool)<>3 then raise exception 'RULE_EDIT_RESET_PROGRESS'; end if;
  perform save_learning_reward_prize(common,1,prize_config||jsonb_build_object('stock',0));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  perform pg_temp.draw_expect_error(format('select draw_learning_reward(%L,%L,%L,1,3)',gen_random_uuid(),sid,pool),'FORM_CHANGED');
  perform pg_temp.draw_expect_error(format('select draw_learning_reward(%L,%L,%L,2,3)',second,sid,pool),'POOL_UNAVAILABLE');
  if (read_learning_points(sid)->>'balance')::int<>90 then raise exception 'FAILED_DRAW_CHARGED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform save_learning_reward_prize(common,2,prize_config);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  result:=draw_learning_reward(second,sid,pool,2,3);
  if (result->>'prize_id')::uuid<>rare then raise exception 'NEW_GUARANTEE_NOT_APPLIED'; end if;
  perform pg_temp.draw_expect_error(format('select draw_learning_reward(%L,%L,%L,2,4)',gen_random_uuid(),sid,pool),'DRAW_LIMIT');
  if draw_learning_reward(intent,sid,pool,1,2)<>original then raise exception 'OLD_RULE_RETRY_CHANGED'; end if;
  if (select balance from learning_reward_accounts where student_id=sid)<>(select sum(amount) from learning_reward_ledger where student_id=sid) then raise exception 'DRAW_LEDGER_MISMATCH'; end if;
  if (select count(*) from learning_reward_draws where student_id=sid)<>2 then raise exception 'DRAW_RECEIPT_COUNT'; end if;
end $check$;
select 'PASS: draw permissions, stable retry, stale view rejection, cumulative guarantee/reset, limits, unavailable pool no-charge and immutable receipts';
