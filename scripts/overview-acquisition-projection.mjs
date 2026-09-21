import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
const root = '.tmp/overview-acquisition-projection'; fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/error.private.txt` });
console.log(JSON.stringify({ host: observed.host, origin: observed.supabaseOrigin, listeners: observed.listeners, ssh: false }));
const version = '20260921006000_overview_acquisition_projection';
const migration = `supabase/migrations/${version}.sql`, body = fs.readFileSync(migration, 'utf8');
const fixture = 'scripts/sql/current-overview-acquisition-fixtures.sql';
const assertions = 'scripts/sql/overview-acquisition-projection-assertions.sql';
const checksums = { migration: textFileSha256(migration), fixture: textFileSha256(fixture), assertions: textFileSha256(assertions) };
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const signature = 'public.list_current_staff_overview_acquisition_sources(text,integer)';
const applied = sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if (applied && applied !== checksums.migration) throw Error('MIGRATION_CHECKSUM_CHANGED');
const footprint = () => sql(`begin read only;select jsonb_build_object(
  'records',(select md5(string_agg(md5((to_jsonb(h)-'overview_acquisition_cells')::text),'' order by id)) from public.history_import_records h),
  'table',(select md5(relacl::text||relowner::text||relrowsecurity::text) from pg_class where oid='public.history_import_records'::regclass),
  'columns',(select md5(jsonb_agg(to_jsonb(a) order by attnum)::text) from pg_attribute a where attrelid='public.history_import_records'::regclass and attnum>0 and not attisdropped),
  'policies',(select md5(jsonb_agg(to_jsonb(p) order by polname)::text) from pg_policy p where polrelid='public.history_import_records'::regclass),
  'indexes',(select md5(jsonb_agg(indexdef order by indexname)::text) from pg_indexes where schemaname='public' and tablename='history_import_records'),
  'function',(select md5(pg_get_functiondef(oid)||coalesce(proacl::text,'')||proowner::text) from pg_proc where oid=${q(signature)}::regprocedure),
  'helper',to_regprocedure('public.project_staff_overview_acquisition_cells(jsonb)')::text,
  'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m));commit;`);
if (mode === '--apply') {
  if (applied) { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
  const check = JSON.parse(fs.readFileSync(`${root}/check.json`, 'utf8'));
  assert.deepEqual(check.checksums, checksums); assert.equal(check.before, footprint());
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${body}
    insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksums.migration)});notify pgrst,'reload schema';commit;`);
  console.log(JSON.stringify({ applied: true, checksum: checksums.migration })); process.exit(0);
}
if (applied) throw Error('Reuse the recorded check for the applied migration');
const roles = ['admin', 'principal', 'teacher', 'research', 'student', 'parent'];
const claims = role => {
  const account = loadFixedAccount(role); if (!account) throw Error('FIXED_ACCOUNT_REQUIRED');
  return `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${q(account.email)}),'role','authenticated')::text,true) is not null;set local role authenticated;`;
};
const summaries = phase => roles.map(role => `${claims(role)}select jsonb_build_object('kind','summary','phase',${q(phase)},'role',${q(role)},
  'rows',jsonb_array_length(r->'records'),'digest',md5(r::text),
  'visibleIds',(select md5(string_agg(id,',' order by id)) from public.history_import_records))
  from (select public.list_current_staff_overview_acquisition_sources(null,10000) r) x;reset role;`).join('\n');
const before = footprint();
const original = sql(`begin read only;select pg_get_functiondef(${q(signature)}::regprocedure);commit;`);
const oldPolicy = sql("begin read only;select pg_get_expr(polqual,polrelid) from pg_policy where polrelid='public.history_import_records'::regclass and polname='history_import_records_admin_read';commit;");
const restore = `${original};\nalter policy history_import_records_admin_read on public.history_import_records using (${oldPolicy});
alter table public.history_import_records drop column overview_acquisition_cells;
drop function public.project_staff_overview_acquisition_cells(jsonb);`;
fs.writeFileSync(`${root}/restore.sql`, restore + '\n');
const preparedActors = ['admin', 'teacher'].map(role => `select set_config('mathin.check_${role}',(select id::text from auth.users where email=${q(loadFixedAccount(role).email)}),true) is not null;`).join('\n');
const prepared = `${preparedActors}set local role authenticated;
  prepare overview_projection_actor as select jsonb_build_object('kind','actor-cache','rows',jsonb_array_length(r->'records'),'digest',md5(r::text)) from (select public.list_current_staff_overview_acquisition_sources(null,10000) r) x;
  ${['admin', 'teacher', 'admin'].map(role => `select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mathin.check_${role}'),'role','authenticated')::text,true) is not null;execute overview_projection_actor;`).join('\n')}
  deallocate overview_projection_actor;reset role;`;
const query = body.match(/as \$\$([\s\S]+?)\$\$;/)[1].replaceAll('p_after', 'null::text').replaceAll('p_limit', '10000');
const output = sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${fs.readFileSync(fixture,'utf8')}
  ${summaries('before')}${body}${summaries('after')}${prepared}
  savepoint mutation_checks;${fs.readFileSync(assertions,'utf8')}rollback to savepoint mutation_checks;
  ${claims('admin')}explain(analyze,verbose,buffers,format json) ${query}reset role;
  ${restore}${summaries('restored')}rollback;`);
const results = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
for (const role of roles) {
  const rows = results.filter(row => row.kind === 'summary' && row.role === role).map(row => { const comparable = { ...row }; delete comparable.phase; return comparable; });
  assert.equal(rows.length, 3); assert.deepEqual(rows[1], rows[0]); assert.deepEqual(rows[2], rows[0]);
}
const identities = results.filter(row => row.kind === 'actor-cache');
assert.equal(identities.length, 3); assert(identities[0].rows > 0); assert.equal(identities[1].rows, 0); assert.deepEqual(identities[2], identities[0]);
const plan = JSON.parse(output.match(/^\[\r?\n[\s\S]+?^\]/m)[0])[0];
fs.writeFileSync(`${root}/plan.json`, JSON.stringify(plan,null,2)+'\n');
const nodes = []; const inspect = node => { nodes.push(node); (node.Plans ?? []).forEach(inspect); }; inspect(plan.Plan);
const permissionPlans = nodes.filter(node => node['Parent Relationship'] === 'InitPlan' && node.Output?.some(value => value.includes('is_admin(')));
assert.equal(permissionPlans.length, 1, 'PERMISSION_INITPLAN_MISSING');
const calls = permissionPlans[0]['Actual Loops'];
assert.equal(calls, 1, 'PER_ROW_PERMISSION_CHECK_RETURNED');
assert(!nodes.some(node => node.Filter?.includes('is_admin(')), 'PER_ROW_PERMISSION_FILTER_RETURNED');
assert.equal(nodes.filter(node => node['Relation Name'] === 'history_import_records').length, 1, 'REPEATED_ARCHIVE_LOOKUP');
assert(!nodes.some(node => node['Node Type'] === 'Function Scan'), 'READ_TIME_CELL_EXPANSION_RETURNED');
assert.equal(footprint(), before, 'ROLLBACK_CHANGED_DATABASE');
const report = { checkedAt: new Date().toISOString(), checksums, before, results, planMs: plan['Execution Time'],
  adminChecks: calls, archiveScans: 1, readTimeCellExpansions: 0, rollbackUnchanged: true };
fs.writeFileSync(`${root}/check.json`, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ ...report, before: undefined, results: results.map(row=>({ kind: row.kind, phase: row.phase, role: row.role, rows: row.rows })) }));
