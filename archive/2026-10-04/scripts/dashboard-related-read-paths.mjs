import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

// 只接受已核验的本机隔离库；真实 RLS 对照、账号状态撤销与完整回退后才应用。
const mode = process.argv[2];
if (!['--check','--apply'].includes(mode)) throw new Error('Use --check or --apply');
const root = path.resolve('.tmp/dashboard-related-read-paths');
fs.mkdirSync(root,{recursive:true});
const {sql,observed} = openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});
const version = '20260920150000_dashboard_related_read_paths';
const file = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(file);
const migration = fs.readFileSync(file,'utf8');
const quote = value => `'${value.replaceAll("'","''")}'`;
const policies = [
  ['students','students_select_staff_scope'], ['course_opportunities','course_opportunities_select_scope'],
  ...['classrooms','class_sessions'].flatMap(table => ['schedule_view_all','view_all','student_scope']
    .map(suffix => [table,`${table==='classrooms'?'classrooms':'sessions'}_select_${suffix}`])),
  ['activities','activities_staff_select'], ['activity_registrations','activity_registrations_staff_select'],
  ['assessment_results','assessment_results_staff_select'],
];
const policyWhere = policies.map(([table,name])=>`(polrelid='public.${table}'::regclass and polname=${quote(name)})`).join(' or ');
const tables = ['students','classrooms','class_sessions','course_opportunities','course_enrollments',
  'activities','activity_registrations','assessment_results','business_course_opportunities','business_activities',
  'business_activity_registrations','business_assessment_results','session_events','session_preparations'];
const facts = ['profiles','staff_role_members','role_permissions','school_subject_participants','school_subject_groups',
  'school_business_group_members','students','course_opportunities','classrooms','class_sessions','activities','activity_registrations','assessment_results'];
const digest = table => `(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${table} t)`;
const snapshot = () => JSON.parse(sql(`begin isolation level repeatable read read only;set local search_path=public,pg_temp;
 select jsonb_build_object('facts',jsonb_build_object(${facts.map(t=>`${quote(t)},${digest(t)}`).join(',')}),
 'functions',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_proc p where pronamespace='public'::regnamespace),
 'policyMetadata',(select md5(string_agg((case when ${policyWhere} then to_jsonb(p)-'polqual' else to_jsonb(p) end)::text,'' order by p.oid)) from pg_policy p),
 'relations',(select md5(string_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v')),
 'policies',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',p.polname,'qual',pg_get_expr(p.polqual,p.polrelid)) order by p.polrelid,p.polname)
   from pg_policy p join pg_class c on c.oid=p.polrelid where ${policyWhere}),
 'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const existing = sql(`begin read only;select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if (existing) { assert.equal(existing,checksum); console.log(JSON.stringify({alreadyApplied:true,version})); process.exit(0); }
const before = snapshot();
assert.equal(before.policies.length,policies.length);

if (mode==='--apply') {
  const checked = JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));
  assert.equal(checked.checksum,checksum); assert.equal(checked.zeroResidual,true); assert.deepEqual(checked.before,before);
  fs.writeFileSync(path.join(root,'prechange-policies.sql'),before.policies
    .map(p=>`alter policy ${p.name} on public.${p.table} using (${p.qual});`).join('\n')+'\n');
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='30s';${migration}
    insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});commit;`);
  const after = snapshot();
  for (const key of ['facts','functions','policyMetadata','relations']) assert.deepEqual(after[key],before[key]);
  assert.equal(after.policies.length,before.policies.length);
  for (let i=0;i<after.policies.length;i++) assert.notEqual(after.policies[i].qual,before.policies[i].qual);
  fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({version,checksum,observed,before,after,businessUnchanged:true},null,2)+'\n');
  console.log(JSON.stringify({localTargetVerified:true,version,businessUnchanged:true,changedPolicies:policies.length}));
  process.exit(0);
}

const emails = [...new Set(fs.readFileSync('.claude/test-accounts.local.md','utf8').match(/[a-zA-Z0-9._+-]+@mathin\.local/g)??[])];
assert.equal(emails.length,11,'Expected the current fixed development account manifest');
const restore = table => `do $restore$ declare p record;begin
  for p in select * from ${table} loop execute format('alter policy %I on public.%I using (%s)',p.name,p.relation,p.qual);end loop;
end $restore$;`;
const capture = (phase,scenario,selectedOnly=false) => `do $capture$
declare actor record;relation text;value jsonb;started timestamptz;
begin
  for actor in select * from read_actors ${selectedOnly?'where id=(select id from read_fixture)':''} order by label loop
    perform set_config('request.jwt.claims',case when actor.id is null then '{}' else jsonb_build_object('sub',actor.id,'role','authenticated','aal','aal1')::text end,true);
    execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
    foreach relation in array array[${tables.map(quote).join(',')}] loop
      started:=clock_timestamp();
      begin execute format('execute read_probe_%s',relation) into value;
      exception when insufficient_privilege then value:=jsonb_build_object('error',sqlstate);end;
      execute 'reset role';
      insert into read_results values(${quote(scenario)},${quote(phase)},actor.label,relation,value,extract(epoch from clock_timestamp()-started)*1000);
      execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
    end loop;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end $capture$;`;
const report = scenario => `do $compare$ begin
  if exists(select 1 from read_results a join read_results b using(scenario,actor,relation)
    where a.scenario=${quote(scenario)} and a.phase='before' and b.phase='after' and a.value is distinct from b.value)
    then raise exception 'DASHBOARD_READ_SCOPE_CHANGED';end if;
end $compare$;
select jsonb_build_object('scenario',${quote(scenario)},'comparisons',(select count(*) from read_results where scenario=${quote(scenario)} and phase='after'),
  'timing',(select jsonb_agg(jsonb_build_object('actor',a.actor,'relation',a.relation,'beforeMs',round(a.ms,3),'afterMs',round(b.ms,3),'result',b.value) order by a.actor,a.relation)
    from read_results a join read_results b using(scenario,actor,relation) where a.scenario=${quote(scenario)} and a.phase='before' and b.phase='after'));`;
const states = [
  ['without_permissions',`delete from public.staff_role_members where user_id=(select id from read_fixture);`],
  ['without_collaboration',`delete from public.school_subject_participants where user_id=(select id from read_fixture);
    update public.school_business_group_members set removed_at=now() where user_id=(select id from read_fixture) and removed_at is null;`],
  ['inactive',`update public.profiles set is_active=false where id=(select id from read_fixture);`],
  ['locked',`update public.profiles set account_status='locked' where id=(select id from read_fixture);`],
  ['password_change_required',`update public.profiles set password_change_required=true,initial_password_set_at=coalesce(initial_password_set_at,now()),password_changed_at=null where id=(select id from read_fixture);`],
];
const results = sql(`begin;set local lock_timeout='3s';set local statement_timeout='240s';set local search_path=public,pg_temp;set local plan_cache_mode=force_generic_plan;
  create temp table read_actors as select p.id,p.role,p.role||':'||row_number() over(order by p.role,p.id) as label
    from public.profiles p join auth.users u on u.id=p.id where u.email in (${emails.map(quote).join(',')});
  do $$begin if (select count(*) from read_actors)<>${emails.length} then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED';end if;end$$;
  create temp table read_fixture as select id from read_actors where role='staff'
    order by (select count(*) from public.school_subject_participants p where p.user_id=read_actors.id) desc,label limit 1;
  do $$begin if (select count(*) from read_fixture)<>1 then raise exception 'FIXED_STAFF_REQUIRED';end if;end$$;
  insert into read_actors values(null,'anonymous','anonymous');
  create temp table read_results(scenario text,phase text,actor text,relation text,value jsonb,ms numeric,primary key(scenario,phase,actor,relation));
  create temp table read_original as select c.relname as relation,p.polname as name,pg_get_expr(p.polqual,p.polrelid) as qual
    from pg_policy p join pg_class c on c.oid=p.polrelid where ${policyWhere};
  ${tables.map(t=>{const key=t==='session_preparations'?'md5(to_jsonb(r)::text)':'r.id::text';return `prepare read_probe_${t} as select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(${key},',' order by ${key}),''))) from public.${t} r;`;}).join('\n')}
  ${capture('before','fixed_accounts')}
  ${migration}
  create temp table read_optimized as select c.relname as relation,p.polname as name,pg_get_expr(p.polqual,p.polrelid) as qual
    from pg_policy p join pg_class c on c.oid=p.polrelid where ${policyWhere};
  ${capture('after','fixed_accounts')}${report('fixed_accounts')}
  ${states.map(([name,update])=>`savepoint read_fixture_state;${update}${restore('read_original')}${capture('before',name,true)}
    ${restore('read_optimized')}${capture('after',name,true)}${report(name)}rollback to savepoint read_fixture_state;`).join('\n')}
  ${restore('read_original')}${capture('after','restored')}
  do $$begin if exists(select 1 from read_results a join read_results b using(actor,relation)
    where a.scenario='fixed_accounts' and a.phase='before' and b.scenario='restored' and a.value is distinct from b.value)
    then raise exception 'POLICY_ROLLBACK_SCOPE_CHANGED';end if;end$$;
  select jsonb_build_object('scenario','rollback','comparisons',(select count(*) from read_results where scenario='restored'),'equal',true);
rollback;`).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
assert.deepEqual(snapshot(),before);
assert.deepEqual(results.map(row=>row.comparisons),[168,...states.map(()=>14),168]);
fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({version,checksum,before,results,zeroResidual:true,checkedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({localTargetVerified:true,version,checksum,zeroResidual:true,
  scenarios:results.map(({scenario,comparisons})=>({scenario,comparisons})),
  students:results[0].timing.filter(row=>row.relation==='students').map(({actor,beforeMs,afterMs,result})=>({actor,beforeMs,afterMs,rows:result.count}))}));
