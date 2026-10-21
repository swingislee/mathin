-- Transaction-only fixtures; requires the identified local development identities.
create function pg_temp.redemption_expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
declare actor uuid; parent_id uuid; sid uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); physical uuid:=gen_random_uuid(); digital uuid:=gen_random_uuid();
  intent uuid:=gen_random_uuid(); digital_intent uuid:=gen_random_uuid(); config jsonb; result jsonb; original jsonb; visible integer;
begin
  select p.id into actor from profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.purpose='test';
  select p.id into parent_id from profiles p join auth.users u on u.id=p.id where u.email='test-parent@mathin.local' and p.purpose='test';
  if actor is null or parent_id is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into students(id,name,bind_code,purpose,created_by) values(sid,'Redemption transaction child',sid::text,'test',actor),(other_id,'Other redemption child',other_id::text,'test',actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(sid,parent_id,'监护人',array['grades'],true);
  perform public.grant_learning_points(gen_random_uuid(),sid,40,'Redemption fixture');
  config:=jsonb_build_object('title',jsonb_build_object('zh','Transaction physical','en','Physical'),'description',jsonb_build_object('zh','','en',''),
    'pickup_instructions',jsonb_build_object('zh','Transaction pickup','en','Pickup'),'kind','physical','image','','points_cost',30,'stock',1,'enabled',true,'redeem_enabled',true);
  perform public.save_learning_reward_prize(physical,0,config);
  perform public.save_learning_reward_prize(digital,0,config||jsonb_build_object('title',jsonb_build_object('zh','Transaction collectible','en','Collectible'),'kind','digital','points_cost',20,'stock',null));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  execute 'set local role authenticated';
  original:=public.redeem_learning_prize(intent,sid,physical,1);
  result:=public.redeem_learning_prize(intent,sid,physical,1);
  if original<>result or original->>'status'<>'pending' or length(original->>'pickup_code')<>12 then raise exception 'REDEMPTION_RETRY_CHANGED'; end if;
  if (public.read_learning_points(sid)->>'balance')::int<>10 then raise exception 'DOUBLE_CHARGE'; end if;
  perform pg_temp.redemption_expect_error(format('select redeem_learning_prize(%L,%L,%L,1)',gen_random_uuid(),other_id,physical),'FORBIDDEN');
  perform pg_temp.redemption_expect_error(format('select redeem_learning_prize(%L,%L,%L,1)',gen_random_uuid(),sid,digital),'INSUFFICIENT_POINTS');
  perform pg_temp.redemption_expect_error(format('select fulfil_learning_reward(%L,%L)',intent,original->>'pickup_code'),'FORBIDDEN');
  perform pg_temp.redemption_expect_error(format('update learning_reward_prizes set stock=999 where id=%L',physical),'permission denied');
  perform pg_temp.redemption_expect_error(format('select save_learning_reward_prize(%L,1,%L::jsonb)',physical,config),'FORBIDDEN');
  perform pg_temp.redemption_expect_error(format('select read_learning_reward_orders(%L)',other_id),'FORBIDDEN');
  execute 'reset role';
  if (select stock from learning_reward_prizes where id=physical)<>0 then raise exception 'STOCK_NOT_RESERVED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform public.grant_learning_points(gen_random_uuid(),sid,100,'Redemption fixture more points');
  perform pg_temp.redemption_expect_error(format('select save_learning_reward_prize(%L,1,%L::jsonb)',physical,config),'FORM_CHANGED');
  perform pg_temp.redemption_expect_error(format('select fulfil_learning_reward(%L,''wrong'')',intent),'VALIDATION');
  perform public.fulfil_learning_reward(intent,original->>'pickup_code');
  perform public.fulfil_learning_reward(intent,original->>'pickup_code');
  perform pg_temp.redemption_expect_error(format('update learning_reward_orders set points_spent=0 where id=%L',intent),'IMMUTABLE');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  perform pg_temp.redemption_expect_error(format('select redeem_learning_prize(%L,%L,%L,1)',gen_random_uuid(),sid,physical),'OUT_OF_STOCK');
  if (public.read_learning_points(sid)->>'balance')::int<>110 then raise exception 'FAILED_REDEMPTION_CHARGED'; end if;
  result:=public.redeem_learning_prize(digital_intent,sid,digital,1);
  perform public.redeem_learning_prize(digital_intent,sid,digital,1);
  if result->>'status'<>'collected' or result->>'pickup_code' is not null then raise exception 'DIGITAL_FULFILMENT'; end if;
  if jsonb_array_length(public.read_learning_reward_orders(sid,'digital')->'items')<>1 then raise exception 'DUPLICATE_COLLECTIBLE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  perform public.save_learning_reward_prize(physical,2,config||jsonb_build_object('title',jsonb_build_object('zh','New title','en','New'),'points_cost',35,'stock',2));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  perform pg_temp.redemption_expect_error(format('select redeem_learning_prize(%L,%L,%L,1)',gen_random_uuid(),sid,physical),'FORM_CHANGED');
  result:=public.redeem_learning_prize(intent,sid,physical,1);
  if result->'snapshot'<>original->'snapshot' or result->>'status'<>'received' then raise exception 'HISTORY_CHANGED'; end if;
  execute 'set local role authenticated';
  select count(*) into visible from learning_reward_orders where student_id=other_id;
  if visible<>0 then raise exception 'OTHER_ORDERS_VISIBLE'; end if;
  execute 'reset role';
  if (select balance from learning_reward_accounts where student_id=sid)<>(select sum(amount) from learning_reward_ledger where student_id=sid) then raise exception 'BALANCE_MISMATCH'; end if;
end $check$;
select 'PASS: atomic redemption, stable retries, stock/version/balance checks, digital collection, physical fulfilment and immutable snapshots';
