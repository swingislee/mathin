-- Run in a rollback transaction on the identified development target.
create function pg_temp.reward_expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
declare actor uuid; parent_id uuid; sid uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); sess uuid:=gen_random_uuid();
  award uuid:=gen_random_uuid(); undone uuid:=gen_random_uuid(); grant_id uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid(); q1 uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid();
  r learning_reward_rules; total bigint; visible int; result jsonb; legacy_award uuid:=gen_random_uuid();
begin
  select p.id into actor from profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.purpose='test';
  select p.id into parent_id from profiles p join auth.users u on u.id=p.id where u.email='test-parent@mathin.local' and p.purpose='test';
  if actor is null or parent_id is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into students(id,name,bind_code,purpose,created_by) values(sid,'Reward transaction child',sid::text,'test',actor),(other_id,'Other reward transaction child',other_id::text,'test',actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(sid,parent_id,'监护人',array['grades'],true);
  insert into classrooms(id,owner_id,name,invite_code,capacity,purpose,operational_status) values(cid,actor,'Reward transaction classroom',cid::text,20,'test','active');
  insert into class_sessions(id,classroom_id,title) values(sess,cid,'Reward transaction lesson');
  select * into r from learning_reward_rules where singleton;
  perform public.save_learning_reward_rules(r.version,true,2,true,10,array['explained','independent']);
  perform pg_temp.reward_expect_error(format('select save_learning_reward_rules(%s,true,2,true,10,array[''explained''])',r.version),'FORM_CHANGED');
  perform public.grant_learning_points(grant_id,sid,20,'Transaction reward');
  perform public.grant_learning_points(grant_id,sid,20,'Transaction reward');
  perform pg_temp.reward_expect_error(format('select grant_learning_points(%L,%L,21,''Transaction reward'')',grant_id,sid),'CONFLICT');
  perform pg_temp.reward_expect_error(format('select grant_learning_points(%L,%L,20,''Transaction reward'')',grant_id,other_id),'CONFLICT');
  insert into session_events(id,at,session_id,user_id,device_id,seq,type,payload) values
    (gen_random_uuid(),now(),sess,actor,'rewards-test',1,'star',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',award)),
    (gen_random_uuid(),now(),sess,actor,'rewards-test',2,'star',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',award));
  select balance into total from learning_reward_accounts where student_id=sid;
  if total<>22 then raise exception 'DUPLICATE_STAR_OR_GRANT_%',total; end if;
  select * into r from learning_reward_rules where singleton;
  perform public.save_learning_reward_rules(r.version,true,7,true,10,array['explained','independent']);
  insert into session_events(id,at,session_id,user_id,device_id,seq,type,payload) values
    (gen_random_uuid(),now(),sess,actor,'rewards-test',3,'star_undo',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',award)),
    (gen_random_uuid(),now(),sess,actor,'rewards-test',4,'star_undo',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',award)),
    (gen_random_uuid(),now(),sess,actor,'rewards-test',5,'star_undo',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',undone)),
    (gen_random_uuid(),now(),sess,actor,'rewards-test',6,'star',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',undone));
  select balance into total from learning_reward_accounts where student_id=sid;
  if total<>20 then raise exception 'REVERSAL_OR_REVERSE_ORDER_%',total; end if;
  -- An event that already existed before installation is never re-imported by duplicate delivery.
  alter table session_events disable trigger session_events_learning_rewards;
  insert into session_events(id,at,session_id,user_id,device_id,seq,type,payload,created_at) values(gen_random_uuid(),now(),sess,actor,'rewards-test',7,'star',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',legacy_award),now()-interval '1 year');
  alter table session_events enable trigger session_events_learning_rewards;
  insert into session_events(id,at,session_id,user_id,device_id,seq,type,payload) values(gen_random_uuid(),now(),sess,actor,'rewards-test',8,'star',jsonb_build_object('schemaVersion',2,'studentId',sid,'awardId',legacy_award));
  if (select balance from learning_reward_accounts where student_id=sid)<>20 then raise exception 'HISTORY_IMPORTED'; end if;
  insert into assignments(id,classroom_id,session_id,title,created_by) values(aid,cid,sess,'Transaction homework',actor);
  insert into assignment_questions(id,assignment_id,position,title,created_by) values(q1,aid,0,'Question 1',actor),(q2,aid,1,'Question 2',actor);
  insert into assignment_question_results(question_id,student_id,status,version,marked_by) values(q1,sid,'independent',1,actor);
  if (select balance from learning_reward_accounts where student_id=sid)<>20 then raise exception 'PARTIAL_HOMEWORK_REWARDED'; end if;
  insert into assignment_question_results(question_id,student_id,status,version,marked_by) values(q2,sid,'independent',1,actor);
  update assignment_question_results set status='prompted',version=2 where question_id=q2 and student_id=sid;
  update assignment_question_results set status='explained',version=3 where question_id=q2 and student_id=sid;
  if (select balance from learning_reward_accounts where student_id=sid)<>30 then raise exception 'HOMEWORK_REWARDED_TWICE'; end if;
  perform public.reverse_learning_points(grant_id,'Transaction reversal');
  perform public.reverse_learning_points(grant_id,'Transaction reversal');
  if (select balance from learning_reward_accounts where student_id=sid)<>10 then raise exception 'MANUAL_REVERSE_TWICE'; end if;
  if (select balance from learning_reward_accounts where student_id=sid)<>(select sum(amount) from learning_reward_ledger where student_id=sid) then raise exception 'LEDGER_BALANCE_MISMATCH'; end if;
  grant_id:=gen_random_uuid();
  perform public.grant_learning_points(grant_id,other_id,10,'Other child grant');
  perform mathin_internal.append_learning_reward(gen_random_uuid(),other_id,'redeem','fixture-spend',-7,'Transaction spend','{}',actor);
  perform public.reverse_learning_points(grant_id,'Spent reward reversal');
  result:=public.read_learning_points(other_id);
  if (result->>'balance')::integer<>-7 or (result->>'available')::integer<>0 then raise exception 'REVERSED_SPENT_BALANCE'; end if;
  perform pg_temp.reward_expect_error(format('update learning_reward_ledger set amount=999 where id=%L',grant_id),'');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  if not public.miniapp_can_participate(sid,'grades') then raise exception 'DEVELOPMENT_PARENT_CONSENT_REQUIRED'; end if;
  execute 'set local role authenticated';
  result:=public.read_learning_points(sid);
  if (result->>'balance')::integer<>10 then raise exception 'FAMILY_BALANCE'; end if;
  perform pg_temp.reward_expect_error(format('select read_learning_points(%L)',other_id),'FORBIDDEN');
  perform pg_temp.reward_expect_error(format('select grant_learning_points(%L,%L,100,''forged'')',gen_random_uuid(),sid),'FORBIDDEN');
  perform pg_temp.reward_expect_error(format('select reverse_learning_points(%L,''forged'')',grant_id),'FORBIDDEN');
  perform pg_temp.reward_expect_error('select save_learning_reward_rules(1,true,999,true,999,array[''independent''])','FORBIDDEN');
  perform pg_temp.reward_expect_error(format('update learning_reward_accounts set balance=999 where student_id=%L',sid),'permission denied');
  select count(*) into visible from learning_reward_ledger where student_id=other_id;
  if visible<>0 then raise exception 'OTHER_CHILD_LEDGER_VISIBLE'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  if public.can_read_learning_rewards(sid) then raise exception 'ANON_LEDGER_VISIBLE'; end if;
end $check$;
select 'PASS: reward source uniqueness, original-value reversals, history protection, rule version, child permissions and immutable ledger';
