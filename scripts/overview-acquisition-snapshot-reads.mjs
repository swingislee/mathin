import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
const root = '.tmp/overview-acquisition-snapshot-reads'; fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/error.private.txt` });
console.log(JSON.stringify({ host: observed.host, supabaseOrigin: observed.supabaseOrigin, listeners: observed.listeners, ssh: false }));
const version = '20260921005000_overview_acquisition_snapshot_budget';
const migration = `supabase/migrations/${version}.sql`, body = fs.readFileSync(migration, 'utf8'), checksum = textFileSha256(migration);
const fixture = 'scripts/sql/current-overview-acquisition-fixtures.sql', fixtureChecksum = textFileSha256(fixture);
const signature = 'public.list_current_staff_overview_acquisition_sources(text,integer)';
const q = v => `'${String(v).replaceAll("'", "''")}'`;
const applied = sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if (applied && applied !== checksum) throw Error('MIGRATION_CHECKSUM_CHANGED');
const footprint = () => sql(`begin read only;select jsonb_build_object('records',(select count(*) from public.history_import_records),
  'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m),
  'function',(select md5(pg_get_functiondef(oid)||coalesce(proacl::text,'')||proowner::text) from pg_proc where oid=${q(signature)}::regprocedure));commit;`);
const claims = role => {
  const account = loadFixedAccount(role); if (!account) throw Error('FIXED_ACCOUNT_REQUIRED');
  return `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${q(account.email)}),'role','authenticated')::text,true) is not null;set local role authenticated;`;
};
const roles = ['admin', 'teacher', 'research', 'student'];
const summary = (phase, snapshot) => roles.map(role => `${claims(role)}with recursive pages(n,response) as (
    select 1,public.list_current_staff_overview_acquisition_sources(null,${snapshot ? 10000 : 1000})
    union all select n+1,public.list_current_staff_overview_acquisition_sources(response->'records'->-1->>'id',1000)
    from pages where (response->>'hasMore')::boolean and n<${snapshot ? 1 : 10}
  ), records as (select n,r.value,r.ordinality from pages cross join lateral jsonb_array_elements(response->'records') with ordinality r)
  select jsonb_build_object('phase',${q(phase)},'role',${q(role)},'rows',(select count(*) from records),
    'digest',(select md5(coalesce(jsonb_agg(value order by n,ordinality),'[]'::jsonb)::text) from records),
    'hasMore',(select (response->>'hasMore')::boolean from pages order by n desc limit 1),
    'revisions',(select jsonb_agg(distinct response->>'revision') from pages));reset role;`).join('\n');
const acl = `do $$ begin if has_function_privilege('anon',${q(signature)},'execute') or has_function_privilege('service_role',${q(signature)},'execute')
  or not has_function_privilege('authenticated',${q(signature)},'execute') or exists(select 1 from pg_proc where oid=${q(signature)}::regprocedure and (prosecdef or provolatile<>'s'))
  then raise exception 'FUNCTION_ACCESS_CHANGED';end if;end;$$;`;
if (mode === '--apply') {
  if (applied) { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
  const check = JSON.parse(fs.readFileSync(`${root}/check.json`, 'utf8'));
  assert.equal(check.checksum, checksum); assert.equal(check.fixtureChecksum, fixtureChecksum); assert.equal(check.before, footprint());
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='60s';${body}${acl}
    insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});notify pgrst,'reload schema';commit;`);
  console.log(JSON.stringify({ applied: true, checksum })); process.exit(0);
}
if (applied) throw Error('Reuse the recorded check for the applied migration');
const before = footprint(), original = sql(`begin read only;select pg_get_functiondef(${q(signature)}::regprocedure);commit;`);
fs.writeFileSync(`${root}/prechange-function.sql`, original + ';\n');
// 超过一万条的隔离夹具验证快照上限与原十页截断语义；全部回滚。
const fixtures = fs.readFileSync(fixture, 'utf8').replace('generate_series(1,1001)', 'generate_series(1,10001)')
  .replace("lpad(n::text,4,'0')", "lpad(n::text,5,'0')");
const output = sql(`begin;set local lock_timeout='3s';set local statement_timeout='60s';${fixtures}
  ${summary('before', false)}${body}${acl}${summary('snapshot', true)}${claims('admin')}
  do $$ begin
    if jsonb_array_length(public.list_current_staff_overview_acquisition_sources()->'records')<>1000 then raise exception 'DEFAULT_PAGE_CHANGED';end if;
    if jsonb_array_length(public.list_current_staff_overview_acquisition_sources(null,999999)->'records')<>10000 then raise exception 'SNAPSHOT_BUDGET_CHANGED';end if;
  end;$$;reset role;${original};${summary('restored', false)}rollback;`);
const results = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
assert.equal(results.length, roles.length * 3);
for (const role of roles) {
  const rows = results.filter(row => row.role === role).map(row => ({ role: row.role, rows: row.rows, digest: row.digest, hasMore: row.hasMore, revisions: row.revisions }));
  assert.deepEqual(rows[1], rows[0]); assert.deepEqual(rows[2], rows[0]);
}
assert(results.filter(row => row.role === 'admin').every(row => row.rows === 10000 && row.hasMore));
assert.equal(footprint(), before, 'ROLLBACK_CHANGED_DATABASE');
const report = { checkedAt: new Date().toISOString(), checksum, fixtureChecksum, before, results, permissionsUnchanged: true, rollbackUnchanged: true };
fs.writeFileSync(`${root}/check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checksum, cases: results.map(row => ({ phase: row.phase, role: row.role, rows: row.rows, hasMore: row.hasMore })), rollbackUnchanged: true }));
