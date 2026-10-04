import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const root = '.tmp/dashboard-deep-20260921';
const version = '20260921010000_student_directory_group_reads';
const file = `supabase/migrations/${version}.sql`;
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/database-error.private.txt` });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const checksum = textFileSha256(file), body = fs.readFileSync(file, 'utf8');
const applied = sql(`begin read only; select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if (applied) { assert.equal(applied, checksum); console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
const fingerprint = () => sql(`begin read only;select jsonb_build_object(
  'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
  'policies',(select md5(jsonb_agg(to_jsonb(p) order by oid)::text) from pg_policy p),
  'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'),
  'objects',jsonb_build_object('students',(select count(*) from public.students),'leads',(select count(*) from public.leads),'enrollments',(select count(*) from public.enrollments),'history',(select count(*) from public.history_import_records)),
  'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m));commit;`);
const before = fingerprint();
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(`${root}/directory-check.json`, 'utf8'));
  assert.equal(check.checksum, checksum); assert.equal(check.before, before); assert.equal(check.passed, true);
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${body}
    insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});notify pgrst,'reload schema';commit;`);
  fs.writeFileSync(`${root}/directory-apply.json`, JSON.stringify({ checkedAt:new Date().toISOString(), checksum, applied:true, target:observed.systemIdentifier }, null, 2));
  console.log(JSON.stringify({ applied: true, checksum })); process.exit(0);
}
const call = (scope='all', search="''", stage='all', group='classroom', page=1, size=100, selected='null', groupId="''") =>
  `select public.list_student_directory(${quote(scope)},${search},${quote(stage)},${quote(group)},${groupId},${page},${size},${selected})`;
const cases = [
  ['classroom',call()], ['grade',call('all',"''",'all','grade')],
  ['owner',call('all',"''",'all','owner')], ['group',call('all',"''",'all','group')], ['none',call('all',"''",'all','none')],
  ['page2',call('all',"''",'all','classroom',2,50)], ['last-page',call('all',"''",'all','classroom',1000000,20)],
  ['empty-search',call('all',"'__missing_deep_read__'")],
  ['name-search',call('all',"(select left(name,1) from public.students where deleted_at is null order by id limit 1)")],
  ['selected',call('all',"''",'all','none',1,100,"array(select id from public.students where deleted_at is null order by id desc limit 3)")],
  ['unassigned-class',call('all',"''",'all','classroom',1,100,'null',"'unassigned'")],
  ...['mine','group','unassigned'].map(scope => [`scope-${scope}`,call(scope)]),
  ...['awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student'].map(stage => [`stage-${stage}`,call('all',"''",stage)]),
  ['invalid',call('wrong')],
];
const roles = ['admin','research','teacher','principal','student','parent'];
const selectedCases = role => role === 'admin' ? cases : cases.filter(([label]) => ['classroom','owner','group','scope-mine','empty-search'].includes(label));
const sample = phase => roles.map(role => `set local role postgres;set local request.jwt.claims='{}';
  select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${quote(loadFixedAccount(role).email)}),'role','authenticated')::text,true) is not null;
  set local role authenticated;
  ${selectedCases(role).map(([label, query]) => `do $capture$
    declare payload jsonb; started timestamptz:=clock_timestamp(); error_code text;
    begin
      begin execute ${quote(query)} into payload;
      exception when others then error_code:=sqlstate||':'||sqlerrm; end;
      insert into deep_directory_results values(${quote(phase)},${quote(role)},${quote(label)},md5(payload::text),jsonb_array_length(payload->'rows'),error_code,extract(epoch from clock_timestamp()-started)*1000);
    end;$capture$;`).join('\n')}
  reset role;`).join('\n');
const original = sql(`begin read only;select pg_get_functiondef('public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])'::regprocedure);commit;`);
fs.writeFileSync(`${root}/directory-restore.sql`, `begin;set local lock_timeout='3s';\n${original};\ndelete from public.schema_migrations where version=${quote(version)} and checksum=${quote(checksum)};\nnotify pgrst,'reload schema';commit;\n`);
const output = sql(`begin;set local lock_timeout='3s';set local statement_timeout='180s';
  create temp table deep_directory_results(phase text,actor text,label text,digest text,rows integer,error text,ms numeric);
  create temp table deep_directory_contract as select oid,proname,proowner,proacl,prosecdef,provolatile,prorettype,proretset,proargtypes,proallargtypes,proargmodes
    from pg_proc where oid='public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])'::regprocedure;
  grant select,insert on deep_directory_results to authenticated;
  ${sample('before')}${body}${sample('after')}
  do $contract$ begin if exists(select 1 from deep_directory_contract c join pg_proc p using(oid)
    where to_jsonb(c) is distinct from (select to_jsonb(v) from(select p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.prorettype,p.proretset,p.proargtypes,p.proallargtypes,p.proargmodes) v))
    then raise exception 'FUNCTION_CONTRACT_CHANGED';end if;end;$contract$;
  select coalesce(jsonb_agg(to_jsonb(r) order by actor,label,phase),'[]') from deep_directory_results r;
  rollback;`);
const rows = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('[{')));
assert.equal(fingerprint(),before,'ROLLBACK_CHANGED_DATABASE');
fs.writeFileSync(`${root}/directory-check.json`,JSON.stringify({ checkedAt:new Date().toISOString(),checksum,before,rows,passed:false },null,2));
for (const role of roles) for (const [label] of selectedCases(role)) {
  const pair = rows.filter(r => r.actor === role && r.label === label);
  assert.equal(pair.length,2);
  assert.deepEqual(pair.map(r => [r.digest,r.rows,r.error])[0],pair.map(r => [r.digest,r.rows,r.error])[1],`${role}/${label}`);
  if (role === 'admin' && label !== 'invalid') assert.equal(pair[1].error,null,`UNEXPECTED_ERROR:${label}`);
}
assert.ok(rows.filter(r => ['student','parent'].includes(r.actor)).every(r => r.error?.includes('FORBIDDEN')));
fs.writeFileSync(`${root}/directory-check.json`,JSON.stringify({ checkedAt:new Date().toISOString(),checksum,before,rows,passed:true },null,2));
console.log(JSON.stringify({ passed:true,cases:rows.length/2,roles:roles.length,rollbackUnchanged:true,samples:rows.filter(r=>r.actor==='admin').map(({phase,label,ms,rows})=>({phase,label,ms,rows})) },null,2));
