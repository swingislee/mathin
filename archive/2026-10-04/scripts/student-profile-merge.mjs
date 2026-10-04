import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/student-profile-merge');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head })); process.exit(0);
}
const version = '20260909000200_student_profile_merge_review';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const assertionsFile = 'scripts/sql/student-profile-merge-assertions.sql';
const assertionsChecksum = textFileSha256(assertionsFile);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
const checkPath = path.join(root, 'check.json');
if (mode === '--apply') {
  const check = fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.head !== head || check?.assertionsChecksum !== assertionsChecksum) throw new Error('CHECK_REQUIRED');
}
const tables = ["students","classrooms","class_sessions","session_roster_revisions","assessment_workflow_states","assessment_reports","account_ledger","activity_registrations","activity_routes","assessment_results","classroom_student_seat_order","class_support_task_recipients","class_support_tasks","consent_records","coupon_grants","course_enrollments","course_opportunities","enrollments","family_students","guardian_bind_invitations","guardian_consents","history_import_associations","history_import_identity_candidates","history_import_records","history_workflow_scopes","lead_identity_conversions","lead_import_row_reviews","leads","learning_result_heads","lesson_ledger","orders","sales_opportunities","scholarships","school_support_change_log","school_support_work_items","session_attendance","session_changes","session_learning_check_results","session_leave_requests","session_reviews","session_roster_entries","session_videos","student_accounts","student_contacts","student_follow_ups","student_grade_history","student_guardians","student_merges","student_referrals","student_school_year_grades","teacher_professional_signals","profiles","classroom_members","history_import_association_events"];
const snapshot = () => sql(`begin read only;select jsonb_object_agg(key,value) from (values ${tables.map(table =>
  `('${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t))`).join(',')}) facts(key,value);commit;`);
const definitions = () => sql(`begin read only;select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by p.proname)
  from pg_proc p where p.oid in ('public.merge_students(uuid,uuid)'::regprocedure,'public.session_attendance_set_marker()'::regprocedure,'public.guard_finalized_assessment_workflow()'::regprocedure,'public.bind_confirmed_source_business()'::regprocedure);commit;`);
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
  select pg_advisory_xact_lock(hashtextextended('student-profile-merge',0));
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
if (!applied && mode === '--check' && sql("begin read only;select to_regclass('public.student_merge_audits');commit;")) throw new Error('AUDIT_SCHEMA_ROLLBACK_FAILED');
if (!applied && mode === '--apply' && sql('begin read only;select count(*) from public.student_merge_audits;commit;') !== '0') throw new Error('TEST_AUDIT_REMAINED');
const afterDefinitions = definitions();
if (mode === '--check' && afterDefinitions !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
if (JSON.stringify(JSON.parse(beforeDefinitions).map(row => row.acl)) !== JSON.stringify(JSON.parse(afterDefinitions).map(row => row.acl))) throw new Error('FUNCTION_ACL_CHANGED');
const result = { mode, checksum, assertionsChecksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, existingFunctionAclsUnchanged: true, rollbackVerified: mode === '--check' };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
