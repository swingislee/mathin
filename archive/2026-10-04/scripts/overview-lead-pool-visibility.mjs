import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openOverviewAggregateLocal, aggregateRoot as root } from './lib/overview-aggregate-local.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode=process.argv[2];if(!['--check','--apply'].includes(mode))throw Error('Use --check or --apply');
const {sql,footprint}=openOverviewAggregateLocal();
const version='20260921008000_overview_lead_pool_visibility',file=`supabase/migrations/${version}.sql`;
const body=fs.readFileSync(file,'utf8'),checksum=textFileSha256(file),q=x=>`'${x.replaceAll("'","''")}'`;
const applied=sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if(applied){assert.equal(applied,checksum);console.log(JSON.stringify({alreadyApplied:true}));process.exit(0);}
const before=footprint();
if(mode==='--apply'){
  const check=JSON.parse(fs.readFileSync(`${root}/pool-check.json`,'utf8'));
  assert.equal(check.checksum,checksum);assert.equal(check.before,before);assert.equal(check.passed,true);
  sql(`begin;set local lock_timeout='3s';${body}insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});notify pgrst,'reload schema';commit;`);
  fs.writeFileSync(`${root}/pool-apply.json`,JSON.stringify({checkedAt:new Date().toISOString(),checksum,applied:true},null,2));
  console.log(JSON.stringify({applied:true,checksum}));process.exit(0);
}
const roles=['admin','principal','teacher','research','student','parent'];
const claims=role=>`select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${q(loadFixedAccount(role).email)}),'role','authenticated')::text,true) is not null;set local role authenticated;`;
const summary=phase=>roles.map(role=>`${claims(role)}select jsonb_build_object('phase',${q(phase)},'role',${q(role)},
  'leads',(select md5(string_agg(id::text,',' order by id)) from public.leads),
  'communications',(select md5(string_agg(id::text,',' order by id)) from public.lead_communications),
  'submissions',(select md5(string_agg(id::text,',' order by id)) from public.lead_source_records));reset role;`).join('\n');
const original=sql("begin read only;select pg_get_expr(polqual,polrelid) from pg_policy where polrelid='public.leads'::regclass and polname='leads_select_pool_scope';commit;");
const restore=`alter policy leads_select_pool_scope on public.leads using (${original});drop function public.current_lead_pool_ids_v2();`;
fs.writeFileSync(`${root}/pool-restore.sql`,restore+'\n');
const window=JSON.parse(fs.readFileSync(`${root}/comparison.private.json`,'utf8')).cases[0].window;
const prepared=`${claims('admin')}prepare pool_actor as select jsonb_build_object('kind','actor','digest',md5(coalesce(string_agg(id::text,',' order by id),''))) from public.leads;reset role;
  ${['admin','teacher','admin'].map(role=>`${claims(role)}execute pool_actor;reset role;`).join('\n')}deallocate pool_actor;`;
const output=sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${summary('before')}${body}${summary('after')}${prepared}
  ${claims('teacher')}explain(analyze,buffers,format json) select public.get_staff_overview_acquisition_contacts_v2(${q(JSON.stringify(window))}::jsonb);reset role;
  do $$begin if has_function_privilege('anon','public.current_lead_pool_ids_v2()','execute') or has_function_privilege('service_role','public.current_lead_pool_ids_v2()','execute') then raise exception 'POOL_ACCESS_CHANGED';end if;end;$$;
  ${restore}${summary('restored')}rollback;`);
const rows=output.split(/\r?\n/).filter(line=>line.startsWith('{')).map(JSON.parse);
for(const role of roles){const found=rows.filter(r=>r.role===role).map(row=>{const value={...row};delete value.phase;return value;});assert.equal(found.length,3);assert.deepEqual(found[1],found[0]);assert.deepEqual(found[2],found[0]);}
const actors=rows.filter(r=>r.kind==='actor');assert.equal(actors.length,3);assert.equal(actors[0].digest,actors[2].digest);assert.notEqual(actors[0].digest,actors[1].digest);
assert.equal(footprint(),before,'ROLLBACK_CHANGED_DATABASE');
const plan=JSON.parse(output.match(/^\[\r?\n[\s\S]+?^\]/m)[0])[0];
fs.writeFileSync(`${root}/pool-check.json`,JSON.stringify({checkedAt:new Date().toISOString(),checksum,before,rows,teacherSqlMs:plan['Execution Time'],passed:true},null,2));
console.log(JSON.stringify({roles:roles.length,readSets:3,restoreEqual:true,actorReuse:true,teacherSqlMs:plan['Execution Time'],rollbackUnchanged:true}));
