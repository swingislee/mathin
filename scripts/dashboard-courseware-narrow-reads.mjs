import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const root = '.tmp/dashboard-deep-20260921';
const version = '20260921009000_dashboard_courseware_narrow_reads';
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
  'objects',jsonb_build_object('bindings',(select count(*) from public.cw_page_asset_bindings),'pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),'releases',(select count(*) from public.cw_lecture_releases)),
  'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m));commit;`);
const before = fingerprint();
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(`${root}/courseware-check.json`, 'utf8'));
  assert.equal(check.checksum, checksum); assert.equal(check.before, before); assert.equal(check.passed, true);
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${body}
    insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});notify pgrst,'reload schema';commit;`);
  fs.writeFileSync(`${root}/courseware-apply.json`, JSON.stringify({ checkedAt:new Date().toISOString(), checksum, applied:true, target:observed.systemIdentifier }, null, 2));
  console.log(JSON.stringify({ applied: true, checksum })); process.exit(0);
}
const cases = [
  ['task-incomplete', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks('incomplete','',60) r"],
  ['task-recent', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks('recent','',60) r"],
  ['task-publish', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks('publish','',60) r"],
  ['task-search', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks('recent',(select left(title,2) from public.course_families order by id limit 1),5) r"],
  ['task-empty-search', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks('incomplete','__missing_deep_read__',60) r"],
  ['task-default-null', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks(null,null,null) r"],
  ['task-invalid', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_courseware_tasks('invalid','',60) r"],
  ['asset-native', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('',null,null,'native-16x9',0,11,0) r"],
  ['asset-page2', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('',null,null,'native-16x9',0,11,10) r"],
  ['asset-adapted', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('',null,null,'adapted-4x3',0,11,0) r"],
  ['asset-filter', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('','image',null,'native-16x9',10,11,0) r"],
  ['asset-empty-search', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('__missing_deep_read__',null,null,'native-16x9',0,11,0) r"],
  ['asset-null-track', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('',null,null,null,0,11,0) r"],
  ['asset-invalid', "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.list_cw_shared_assets('',null,null,'wrong',0,11,0) r"],
];
const roles = ['admin','research','teacher','principal','student','parent'];
const sample = phase => roles.map(role => {
  const selected = role === 'admin' ? cases : cases.filter(([key]) => ['task-incomplete','task-recent','asset-native'].includes(key));
  return `set local role postgres;set local request.jwt.claims='{}';
    select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${quote(loadFixedAccount(role).email)}),'role','authenticated')::text,true) is not null;
    set local role authenticated;
    ${selected.map(([label, query]) => `do $capture$
      declare payload jsonb; started timestamptz:=clock_timestamp(); error_code text;
      begin
        begin execute ${quote(query)} into payload;
        exception when others then error_code:=sqlstate||':'||sqlerrm; end;
        insert into deep_read_results values(${quote(phase)},${quote(role)},${quote(label)},md5(payload::text),jsonb_array_length(payload),error_code,extract(epoch from clock_timestamp()-started)*1000);
      end;$capture$;`).join('\n')}
    reset role;`;
}).join('\n');
const originals = sql(`begin read only;select string_agg(pg_get_functiondef(p.oid)||';', E'\n' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('list_courseware_tasks','list_cw_shared_assets');commit;`);
// 原查询的同值排序没有定义；对照保留旧算法，只补上与候选相同的最终 ID 排序。
const stabilizedOriginals = originals.replace('    task.track\n  limit bounded_limit;', '    task.track, task.course_id, task.lecture_id\n  limit bounded_limit;');
assert.notEqual(stabilizedOriginals, originals, 'REFERENCE_ORDER_CHANGED');
const indexes = ['cw_page_revisions_page_track_edited_idx','cw_page_asset_bindings_native_asset_page_idx','cw_page_asset_bindings_adapted_asset_page_idx','cw_page_docs_live_lecture_id_idx','cw_page_track_heads_draft_track_page_idx'];
fs.writeFileSync(`${root}/courseware-restore.sql`, `begin;set local lock_timeout='3s';\n${originals}\n${indexes.map(name => `drop index public.${name};`).join('\n')}\ndelete from public.schema_migrations where version=${quote(version)} and checksum=${quote(checksum)};\nnotify pgrst,'reload schema';commit;\n`);
const output = sql(`begin;set local lock_timeout='3s';set local statement_timeout='180s';
  create temp table deep_read_results(phase text,actor text,label text,digest text,rows integer,error text,ms numeric);
  create temp table deep_function_contract as select oid,proname,proowner,proacl,prosecdef,provolatile,prorettype,proretset,proargtypes,proallargtypes,proargmodes
    from pg_proc where oid in ('public.list_courseware_tasks(text,text,integer)'::regprocedure,'public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)'::regprocedure);
  grant select,insert on deep_read_results to authenticated;
  ${stabilizedOriginals}${sample('before')}${originals}${body}${sample('after')}
  do $contract$ begin if exists(select 1 from deep_function_contract c join pg_proc p using(oid)
    where to_jsonb(c) is distinct from (select to_jsonb(v) from(select p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.prorettype,p.proretset,p.proargtypes,p.proallargtypes,p.proargmodes) v))
    then raise exception 'FUNCTION_CONTRACT_CHANGED';end if;end;$contract$;
  select coalesce(jsonb_agg(to_jsonb(r) order by actor,label,phase),'[]') from deep_read_results r;
  rollback;`);
const rows = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('[{')));
assert.equal(fingerprint(),before,'ROLLBACK_CHANGED_DATABASE');
fs.writeFileSync(`${root}/courseware-check.json`,JSON.stringify({ checkedAt:new Date().toISOString(),checksum,before,rows,passed:false },null,2));
for (const role of roles) for (const [label] of (role === 'admin' ? cases : cases.filter(([key]) => ['task-incomplete','task-recent','asset-native'].includes(key)))) {
  const pair = rows.filter(r => r.actor === role && r.label === label);
  assert.equal(pair.length,2);
  assert.deepEqual(pair.map(r => [r.digest,r.rows,r.error])[0],pair.map(r => [r.digest,r.rows,r.error])[1],`${role}/${label}`);
  if (role === 'admin' && !label.endsWith('-invalid')) assert.equal(pair[1].error,null,`UNEXPECTED_ERROR:${label}`);
}
const forbidden = rows.filter(r => ['student','parent'].includes(r.actor));
assert.ok(forbidden.every(r => r.error?.includes('FORBIDDEN')));
fs.writeFileSync(`${root}/courseware-check.json`,JSON.stringify({ checkedAt:new Date().toISOString(),checksum,before,rows,passed:true },null,2));
console.log(JSON.stringify({ passed:true,cases:rows.length/2,roles:roles.length,rollbackUnchanged:true,samples:rows.filter(r=>r.actor==='admin').map(({phase,label,ms,rows})=>({phase,label,ms,rows})) },null,2));
