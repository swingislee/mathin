import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
const root = '.tmp/overview-acquisition-alias-reads';
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/error.private.txt` });
console.log(JSON.stringify({ host: observed.host, supabaseOrigin: observed.supabaseOrigin, listeners: observed.listeners, ssh: false }));
const version = '20260921004000_overview_acquisition_alias_aggregation';
const migration = `supabase/migrations/${version}.sql`;
const body = fs.readFileSync(migration, 'utf8');
const checksum = textFileSha256(migration);
const fixture = 'scripts/sql/current-overview-acquisition-fixtures.sql';
const fixtureChecksum = textFileSha256(fixture);
const signature = 'public.list_current_staff_overview_acquisition_sources(text,integer)';
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const applied = sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if (applied && applied !== checksum) throw Error('MIGRATION_CHECKSUM_CHANGED');
const footprint = () => sql(`begin read only;select jsonb_build_object(
  'records',(select count(*) from public.history_import_records),
  'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m),
  'function',(select md5(pg_get_functiondef(oid)||coalesce(proacl::text,'')||proowner::text) from pg_proc where oid=${q(signature)}::regprocedure));commit;`);
const claims = role => {
  const account = loadFixedAccount(role);
  if (!account) throw Error('FIXED_ACCOUNT_REQUIRED');
  return `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${q(account.email)}),'role','authenticated')::text,true) is not null;set local role authenticated;`;
};
const cases = ['admin', 'teacher', 'research', 'student'];
// 比较完整分页 JSON 的摘要，包括顺序、最新来源、旧别名、revision 和 hasMore。
const summaries = phase => cases.map(role => `${claims(role)}
  with recursive pages(n,response) as (
    select 1,public.list_current_staff_overview_acquisition_sources(null,1000)
    union all select n+1,public.list_current_staff_overview_acquisition_sources(response->'records'->-1->>'id',1000)
    from pages where (response->>'hasMore')::boolean and n<15
  ) select jsonb_build_object('phase',${q(phase)},'role',${q(role)},'pages',count(*),
      'rows',sum(jsonb_array_length(response->'records')),'digest',md5(string_agg(response::text,'' order by n))) from pages;
  reset role;`).join('\n');
const aclCheck = `do $$ begin
  if has_function_privilege('anon',${q(signature)},'execute')
    or has_function_privilege('service_role',${q(signature)},'execute')
    or not has_function_privilege('authenticated',${q(signature)},'execute')
    or exists(select 1 from pg_proc where oid=${q(signature)}::regprocedure and (prosecdef or provolatile<>'s'))
  then raise exception 'FUNCTION_ACCESS_CHANGED';end if;
end;$$;`;

if (mode === '--apply') {
  if (applied) { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
  const check = JSON.parse(fs.readFileSync(`${root}/check.json`, 'utf8'));
  assert.equal(check.checksum, checksum);
  assert.equal(check.fixtureChecksum, fixtureChecksum);
  assert.equal(check.before, footprint(), 'LOCAL_DATABASE_CHANGED_SINCE_CHECK');
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='45s';${body}${aclCheck}
    insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});notify pgrst,'reload schema';commit;`);
  console.log(JSON.stringify({ applied: true, checksum }));
  process.exit(0);
}
if (applied) throw Error('Use recorded check for an already applied migration');
const before = footprint();
const original = sql(`begin read only;select pg_get_functiondef(${q(signature)}::regprocedure);commit;`);
fs.writeFileSync(`${root}/prechange-function.sql`, original + ';\n');
const output = sql(`begin;set local lock_timeout='3s';set local statement_timeout='45s';
  ${fs.readFileSync(fixture, 'utf8')}
  ${summaries('before')}${body}${aclCheck}${summaries('after')}${original};${summaries('restored')}rollback;`);
const results = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
assert.equal(results.length, cases.length * 3);
for (const role of cases) {
  const rows = results.filter(row => row.role === role).map(row => ({ role: row.role, pages: row.pages, rows: row.rows, digest: row.digest }));
  assert.deepEqual(rows[1], rows[0], `${role} result changed`);
  assert.deepEqual(rows[2], rows[0], `${role} rollback result changed`);
}
assert.equal(footprint(), before, 'ROLLBACK_CHANGED_DATABASE');
// 对真实执行计划设回退检查，防止逐条扫描版本集合的查询再次被写回。
const query = body.match(/as \$\$([\s\S]+?)\$\$;/)[1].replace(/\bp_after\b/g, 'null::text').replace(/\bp_limit\b/g, '1000');
const plan = JSON.parse(sql(`begin read only;${claims('admin')}explain(analyze,format json) ${query}rollback;`).replace(/^t\r?\n/, ''))[0];
const versionScans = [];
function inspect(node) {
  if (node['CTE Name'] === 'versions') versionScans.push({ loops: node['Actual Loops'], rows: node['Actual Rows'] });
  (node.Plans ?? []).forEach(inspect);
}
inspect(plan.Plan);
assert(versionScans.length > 0);
assert(versionScans.every(scan => scan.loops <= 1), 'PER_ROW_VERSION_RESCAN');
const report = { checkedAt: new Date().toISOString(), checksum, fixtureChecksum, before, results, versionScans,
  permissionsUnchanged: true, rollbackUnchanged: true };
fs.writeFileSync(`${root}/check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, before: undefined, results: results.map(row => ({ phase: row.phase, role: row.role, pages: row.pages, rows: row.rows })) }));
