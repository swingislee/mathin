import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/student-record-access');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head })); process.exit(0);
}
const version = '20260908140000_student_record_unassigned_access';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const migration = fs.readFileSync(file, 'utf8');
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
const checkPath = path.join(root, 'check.json');
if (mode === '--apply') {
  const check = fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['students','leads','lead_communications','lead_next_actions','student_follow_ups','lead_invitation_threads',
  'lead_invitation_events','lead_identity_conversions','student_stage_entry_receipts','history_workflow_scopes','history_import_records','profiles'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t)`).join(',')});commit;`);
const signatures = [...new Set([...migration.matchAll(/'(public\.[a-z0-9_]+\([^']*\))'/g)].map(match => match[1]))];
const definitions = () => sql(`begin read only;select jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(signature::regprocedure),'acl',p.proacl) order by signature) from unnest(array[${signatures.map(signature => `'${signature}'`).join(',')}]) signature join pg_proc p on p.oid=signature::regprocedure;commit;`);
const before = snapshot(), beforeDefinitions = definitions();
if (!applied) fs.writeFileSync(path.join(root, 'prechange-functions.json'), beforeDefinitions, 'utf8');
// 沿用已核对的同一本机目标，由既有维护角色保留混合所有权更新函数。
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('student-record-access',0));
  ${applied ? '' : migration}
  ${fs.readFileSync('scripts/sql/student-record-access-assertions.sql', 'utf8')}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('STUDENT_RECORD_ACCESS_DATABASE_ERROR: inspect private error file');
}
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
const afterDefinitions = definitions();
if (mode === '--check' && afterDefinitions !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
if (JSON.stringify(JSON.parse(beforeDefinitions).map(row => row.acl)) !== JSON.stringify(JSON.parse(afterDefinitions).map(row => row.acl))) throw new Error('FUNCTION_ACL_CHANGED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, functionAclsUnchanged: true,
  rollbackVerified: mode === '--check' };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
