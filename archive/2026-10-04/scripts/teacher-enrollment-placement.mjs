import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/teacher-enrollment-placement');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, observed, head })); process.exit(0);
}
const version = '20260910000100_teacher_enrollment_placement';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const assertionsFile = 'scripts/sql/teacher-enrollment-placement-assertions.sql';
const baselineAssertionsFile='scripts/sql/enrollment-session-transfers-assertions.sql';
const assertionsChecksum=textFileSha256(assertionsFile)+':'+textFileSha256(baselineAssertionsFile);
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
  'history_import_records','profiles','school_support_work_items','school_support_entry_receipts','school_support_change_log','enrollments','classroom_members','classrooms','orders','account_ledger','families','family_students','family_contacts','student_contacts','contacts','student_guardians','domain_events','class_sessions','course_enrollment_assignments','course_enrollment_events','course_opportunity_events','session_attendance','session_roster_entries','session_roster_revisions','session_events','session_changes'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t)`).join(',')});commit;`);
const definitions = () => sql(`begin read only;select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname in ('public','mathin_internal') and p.proname in ('assign_course_enrollment','transfer_course_enrollment','move_enrollment_placement','move_enrollment_to_seat','preview_enrollment_session_transfer','change_enrollment_placement','confirm_course_enrollment','can_access_enrollment_placement','can_transfer_enrollment','enrollment_placement_access','get_teacher_enrollment_placement_board','get_enrollment_placement_board','get_enrollment_session_transfers');commit;`);
const before = snapshot(), beforeDefinitions = definitions();
if (!applied) fs.writeFileSync(path.join(root, 'prechange-functions.json'), beforeDefinitions, 'utf8');
const { loadFixedAccount } = await import('../e2e/support/fixed-accounts.ts');
const identities = ['admin','teacher','student','research','principal'].map(role => {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_IDENTITIES_REQUIRED');
  const id = sql(`begin read only;select id from auth.users where email='${account.email.replaceAll("'","''")}';commit;`);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('FIXED_IDENTITIES_REQUIRED');
  return `select set_config('manual_entry_test.${role}','${id}',true);`;
}).join('\n');
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('teacher-enrollment-placement',0));
  ${applied ? '' : fs.readFileSync(file, 'utf8')}
  ${identities}
  ${fs.readFileSync(baselineAssertionsFile, 'utf8')}
  ${fs.readFileSync(assertionsFile, 'utf8')}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('PLACEMENT_DATABASE_ERROR: inspect private error file');
}
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
const afterDefinitions = definitions();
if (mode === '--check' && afterDefinitions !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
for(const previous of JSON.parse(beforeDefinitions)){
  const current=JSON.parse(afterDefinitions).find(row=>row.signature===previous.signature);
  if(JSON.stringify(current?.acl)!==JSON.stringify(previous.acl))throw new Error('FUNCTION_ACL_CHANGED');
}
const result = { mode, checksum, assertionsChecksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, existingFunctionAclsUnchanged: true, rollbackVerified: mode === '--check' };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
