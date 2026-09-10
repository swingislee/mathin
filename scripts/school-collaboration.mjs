import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/school-collaboration');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  const identities = sql("begin read only;select jsonb_agg(jsonb_build_object('email',u.email,'role',p.role)) from auth.users u join public.profiles p on p.id=u.id where u.email like 'test-%@mathin.local';commit;");
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head, identities: JSON.parse(identities) })); process.exit(0);
}
const versions = ['20260910001000_school_subject_collaboration', '20260910001100_school_collaboration_workspaces', '20260910001200_school_collaboration_projection'];
const migrations = versions.map(version => {
  const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
  const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
  if (applied && applied !== checksum) throw new Error(`MIGRATION_CHECKSUM_CHANGED: ${version}`);
  return { version, checksum, applied: Boolean(applied), source: fs.readFileSync(file, 'utf8') };
});
const checksum = migrations.map(m => m.checksum).join(':');
if (mode === '--apply' && migrations.every(m => m.applied)) { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(path.join(root, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['students','leads','lead_communications','lead_next_actions','student_follow_ups','lead_invitation_threads',
  'lead_invitation_events','lead_identity_conversions','student_stage_entry_receipts','history_workflow_scopes','history_import_records','profiles',
  'staff_role_members','role_permissions','business_record_revisions','communication_record_revisions','classroom_staff_assignments','enrollments'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t)`).join(',')});commit;`);
const definitions = () => sql(`begin read only;select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';commit;`);
const before = snapshot(), beforeDefinitions = definitions();
if (!migrations.some(m => m.applied)) fs.writeFileSync(path.join(root, 'prechange-functions.json'), beforeDefinitions, 'utf8');
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='120s';
  select pg_advisory_xact_lock(hashtextextended('school-collaboration',0));
  ${migrations.filter(m => !m.applied).map(m => m.source).join('\n')}
  ${fs.readFileSync('scripts/sql/school-collaboration-assertions.sql', 'utf8')}
  ${mode === '--check' ? 'rollback;' : `${migrations.filter(m => !m.applied).map(m => `insert into public.schema_migrations(version,checksum) values('${m.version}','${m.checksum}');`).join('\n')}notify pgrst,'reload schema';commit;`}`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('COLLABORATION_DATABASE_ERROR: inspect private error file');
}
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
if (mode === '--check' && definitions() !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, rollbackVerified: mode === '--check' };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
