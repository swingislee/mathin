import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

// 固定开发身份、同一预备语句和真实 RLS；检查事务完整回滚后再允许本机应用。
const mode=process.argv[2];
if(!['--check','--apply'].includes(mode))throw new Error('Use --check or --apply');
const root=path.resolve('.tmp/dashboard-lead-read-guards');fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});
const version='20260920130000_dashboard_lead_read_guards';
const file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8');
const names=['leads_select_pool_scope','leads_select_assigned_invitation_assessor','leads_select_assessment_assessor'];
const quote=value=>`'${value.replaceAll("'","''")}'`;
const policyList=names.map(quote).join(',');
const tables=['leads','operational_leads','business_lead_communications','lead_source_records','course_opportunities'];
const facts=['profiles','staff_role_members','role_permissions','leads','lead_communications','lead_source_records',
  'lead_invitation_threads','activities','school_subject_participants','school_business_group_members'];
const digest=table=>`(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${table} t)`;
const structure=`jsonb_build_object(
 'functions',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_proc p where pronamespace='public'::regnamespace),
 'otherPolicies',(select md5(string_agg((case when polrelid='public.leads'::regclass and polname in (${policyList}) then to_jsonb(p)-'polqual' else to_jsonb(p) end)::text,'' order by p.oid)) from pg_policy p),
 'relations',(select md5(string_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v')))`;
const snapshot=()=>JSON.parse(sql(`begin isolation level repeatable read read only;set local search_path=public,pg_temp;
 select jsonb_build_object('facts',jsonb_build_object(${facts.map(t=>`${quote(t)},${digest(t)}`).join(',')}),'structure',${structure},
 'policies',(select jsonb_object_agg(polname,pg_get_expr(polqual,polrelid)) from pg_policy where polrelid='public.leads'::regclass and polname in (${policyList})),
 'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const existing=sql(`begin read only;select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if(existing){assert.equal(existing,checksum);console.log(JSON.stringify({alreadyApplied:true,version}));process.exit(0);}
const before=snapshot();

if(mode==='--apply'){
 const checked=JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));
 assert.equal(checked.checksum,checksum);assert.equal(checked.zeroResidual,true);assert.deepEqual(checked.before,before);
 fs.writeFileSync(path.join(root,'prechange-policies.sql'),Object.entries(before.policies).map(([name,qual])=>`alter policy ${name} on public.leads using (${qual});`).join('\n')+'\n');
 sql(`begin;set local lock_timeout='3s';set local statement_timeout='30s';${migration}
 insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});commit;`);
 const after=snapshot();assert.deepEqual(after.facts,before.facts);assert.deepEqual(after.structure,before.structure);
 assert.deepEqual(Object.keys(after.policies).sort(),names.toSorted());
 for(const name of names)assert.notEqual(after.policies[name],before.policies[name]);
 fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({version,checksum,observed,before,after,businessUnchanged:true},null,2)+'\n');
 console.log(JSON.stringify({localTargetVerified:true,version,businessUnchanged:true,changedPolicies:names.length}));
 process.exit(0);
}

const emails=[...new Set(fs.readFileSync('.claude/test-accounts.local.md','utf8').match(/[a-zA-Z0-9._+-]+@mathin\.local/g)??[])];
assert.equal(emails.length,11,'Expected the current fixed development account manifest');
const restore=table=>`do $restore$ declare p record;begin
 for p in select * from ${table} loop execute format('alter policy %I on public.leads using (%s)',p.name,p.qual);end loop;
end $restore$;`;
const capture=(phase,scenario,selectedOnly=false)=>`do $capture$
declare actor record; relation text; value jsonb; started timestamptz;
begin
 for actor in select * from guard_actors ${selectedOnly?'where id=(select id from guard_fixture)':''} order by label loop
  perform set_config('request.jwt.claims',case when actor.id is null then '{}' else jsonb_build_object('sub',actor.id,'role','authenticated','aal','aal1')::text end,true);
  execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
  foreach relation in array array[${tables.map(quote).join(',')}] loop
   started:=clock_timestamp();
   begin execute format('execute guard_probe_%s',relation) into value;
   exception when insufficient_privilege then value:=jsonb_build_object('error',sqlstate);end;
   execute 'reset role';
   insert into guard_results values(${quote(scenario)},${quote(phase)},actor.label,relation,value,extract(epoch from clock_timestamp()-started)*1000);
   execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
  end loop;
  execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims','{}',true);
end $capture$;`;
const report=scenario=>`do $compare$ begin
 if exists(select 1 from guard_results a full join guard_results b
   on a.scenario=b.scenario and a.actor=b.actor and a.relation=b.relation and b.phase='after'
   where a.scenario=${quote(scenario)} and a.phase='before' and a.value is distinct from b.value) then raise exception 'LEAD_READ_SCOPE_CHANGED';end if;
end $compare$;
select jsonb_build_object('scenario',${quote(scenario)},'comparisons',(select count(*) from guard_results where scenario=${quote(scenario)} and phase='after'),
 'timing',(select jsonb_agg(jsonb_build_object('actor',a.actor,'relation',a.relation,'beforeMs',round(a.ms,3),'afterMs',round(b.ms,3),'result',b.value) order by a.actor,a.relation)
 from guard_results a join guard_results b using(scenario,actor,relation) where a.scenario=${quote(scenario)} and a.phase='before' and b.phase='after'));`;
const states=[
 ['without_permissions',`delete from public.staff_role_members where user_id=(select id from guard_fixture);`],
 ['inactive',`update public.profiles set is_active=false where id=(select id from guard_fixture);`],
 ['password_change_required',`update public.profiles set password_change_required=true,initial_password_set_at=coalesce(initial_password_set_at,now()),password_changed_at=null where id=(select id from guard_fixture);`],
];
const stateChecks=states.map(([name,update])=>`savepoint guard_fixture_state;
 ${update}${restore('guard_original')}${capture('before',name,true)}${restore('guard_optimized')}${capture('after',name,true)}${report(name)}
 rollback to savepoint guard_fixture_state;`).join('\n');
const result=sql(`begin;set local lock_timeout='3s';set local statement_timeout='240s';set local search_path=public,pg_temp;set local plan_cache_mode=force_generic_plan;
 create temp table guard_actors as select p.id,p.role,p.role||':'||row_number() over(order by p.role,p.id) as label
 from public.profiles p join auth.users u on u.id=p.id where u.email in (${emails.map(quote).join(',')});
 do $$begin if (select count(*) from guard_actors)<>${emails.length} then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED';end if;end$$;
 create temp table guard_fixture as select id from guard_actors where role='staff' order by public.has_perm(id,'review.write') desc,label limit 1;
 do $$begin if (select count(*) from guard_fixture)<>1 then raise exception 'FIXED_STAFF_REQUIRED';end if;end$$;
 insert into guard_actors values(null,'anonymous','anonymous');
 create temp table guard_results(scenario text,phase text,actor text,relation text,value jsonb,ms numeric);
 create temp table guard_original as select polname as name,pg_get_expr(polqual,polrelid) as qual from pg_policy
 where polrelid='public.leads'::regclass and polname in (${policyList});
 ${tables.map(table=>`prepare guard_probe_${table} as select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(id::text,',' order by id),''))) from public.${table};`).join('\n')}
 ${capture('before','fixed_accounts')}
 ${migration}
 create temp table guard_optimized as select polname as name,pg_get_expr(polqual,polrelid) as qual from pg_policy
 where polrelid='public.leads'::regclass and polname in (${policyList});
 ${capture('after','fixed_accounts')}${report('fixed_accounts')}
 ${stateChecks}
 ${restore('guard_original')}${capture('after','restored')}
 do $$begin if exists(select 1 from guard_results a join guard_results b using(actor,relation)
 where a.scenario='fixed_accounts' and a.phase='before' and b.scenario='restored' and a.value is distinct from b.value)
 then raise exception 'POLICY_ROLLBACK_SCOPE_CHANGED';end if;end$$;
 select jsonb_build_object('scenario','rollback','comparisons',(select count(*) from guard_results where scenario='restored'),'equal',true);
 rollback;`).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
assert.deepEqual(snapshot(),before);
assert.deepEqual(result.map(row=>row.comparisons),[60,5,5,5,60]);
fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({version,checksum,before,result,zeroResidual:true,checkedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({localTargetVerified:true,version,checksum,zeroResidual:true,
 scenarios:result.map(({scenario,comparisons})=>({scenario,comparisons})),
 restrictedTiming:result.find(row=>row.scenario==='without_permissions').timing.map(({relation,beforeMs,afterMs})=>({relation,beforeMs,afterMs}))}));
