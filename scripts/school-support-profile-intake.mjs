import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/school-support-profile-intake');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head })); process.exit(0);
}
const version = '20260909000300_school_support_profile_intake';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const assertionsFile = 'scripts/sql/school-support-profile-intake-assertions.sql';
const assertionsChecksum = textFileSha256(assertionsFile);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
const checkPath = path.join(root, 'check.json');
if (mode === '--apply') {
  const check = fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.head !== head || check?.assertionsChecksum !== assertionsChecksum) throw new Error('CHECK_REQUIRED');
}
const tables = ['students','leads','lead_communications','lead_next_actions','student_follow_ups','lead_invitation_threads',
  'activity_registrations','activities','course_opportunities','course_enrollments','communication_worklists','communication_worklist_items',
  'history_import_records','profiles','school_support_work_items','school_support_entry_receipts','school_support_change_log','enrollments','classroom_members','classrooms','orders','account_ledger'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5((to_jsonb(t)-'manual_profile')::text),'' order by (to_jsonb(t)-'manual_profile')::text),''))) from public.${table} t)`).join(',')});commit;`);
const definitions = () => sql(`begin read only;select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by p.proname)
  from pg_proc p where p.oid in ('public.add_school_support_work_item(uuid,jsonb)'::regprocedure,'public.read_school_support_profile(uuid,uuid)'::regprocedure,'public.update_school_support_profile(uuid,uuid,text,jsonb)'::regprocedure,'public.confirm_school_support_identity(uuid,text)'::regprocedure,'public.search_school_support_subjects(text)'::regprocedure);commit;`);
const before = snapshot(), beforeDefinitions = definitions();
if (!applied) fs.writeFileSync(path.join(root, 'prechange-functions.json'), beforeDefinitions, 'utf8');
const { loadFixedAccount } = await import('../e2e/support/fixed-accounts.ts');
const identities = ['admin','teacher','student'].map(role => {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_IDENTITIES_REQUIRED');
  const id = sql(`begin read only;select id from auth.users where email='${account.email.replaceAll("'","''")}';commit;`);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('FIXED_IDENTITIES_REQUIRED');
  return `select set_config('manual_entry_test.${role}','${id}',true);`;
}).join('\n');
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('school-support-profile-intake',0));
  ${applied ? '' : fs.readFileSync(file, 'utf8')}
  ${identities}
  ${fs.readFileSync(assertionsFile, 'utf8')}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('MANUAL_ENTRY_DATABASE_ERROR: inspect private error file');
}
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
const afterDefinitions = definitions();
if (mode === '--check' && afterDefinitions !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
if (JSON.stringify(JSON.parse(beforeDefinitions).map(row => row.acl)) !== JSON.stringify(JSON.parse(afterDefinitions).map(row => row.acl))) throw new Error('FUNCTION_ACL_CHANGED');
const result = { mode, checksum, assertionsChecksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, existingFunctionAclsUnchanged: true, rollbackVerified: mode === '--check' };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
