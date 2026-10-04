import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = '.tmp/student-assessment-stage';
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${root}/preflight.json`, refresh: true, errorFile: `${root}/database-error.txt` });
const migrationSql = statement => {
  try {
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db',
      'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    fs.writeFileSync(`${root}/database-error.txt`, String(error.stderr ?? error.message), 'utf8');
    throw new Error('ASSESSMENT_STAGE_CHECK_FAILED: inspect the private database error file');
  }
};
const version = '20260908120000_student_assessment_stage_facts';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') { console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head })); process.exit(0); }
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
const assertionsFile = 'scripts/sql/student-assessment-stage-assertions.sql';
const assertionsChecksum = textFileSha256(assertionsFile);
if (mode === '--apply') {
  const check = fs.existsSync(`${root}/check.json`) ? JSON.parse(fs.readFileSync(`${root}/check.json`, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.assertionsChecksum !== assertionsChecksum || check?.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['students', 'leads', 'lead_communications', 'activities', 'activity_registrations', 'assessment_results',
  'course_enrollments', 'enrollments', 'student_follow_ups', 'history_import_records', 'history_import_associations', 'assessment_workflow_states'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table => `'${table}',
  (select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t)`).join(',')});commit;`);
const functions = ['student_assessment_is_complete', 'student_stage_index_with_enrollments', 'read_student_stage_subject_with_enrollments',
  'student_record_index_with_enrollments', 'read_student_record_with_enrollments', 'student_stage_learning_background', 'student_list_facts', 'get_student_lifecycle'];
const definitions = () => sql(`begin read only;select jsonb_object_agg(p.oid::regprocedure::text,
  jsonb_build_object('hash',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'owner',p.proowner,'config',p.proconfig))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functions.map(name => `'${name}'`).join(',')});commit;`);
const before = snapshot(), beforeDefinitions = definitions();
const output = migrationSql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
  select pg_advisory_xact_lock(hashtextextended('student-assessment-stage',0));
  select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated')::text,true) is not null;
  create temporary table assessment_stage_before on commit drop as select * from public.student_record_index_with_enrollments('all','',
    array(select e from public.business_course_enrollment_subjects e));
  ${applied ? '' : fs.readFileSync(file, 'utf8')}
  ${fs.readFileSync(assertionsFile, 'utf8')}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');commit;`}`);
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
const afterDefinitions = definitions();
if (mode === '--check' && afterDefinitions !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
if (mode === '--apply') {
  const prior = JSON.parse(beforeDefinitions), after = JSON.parse(afterDefinitions);
  for (const [signature, value] of Object.entries(prior)) {
    if (JSON.stringify({ ...value, hash: null }) !== JSON.stringify({ ...after[signature], hash: null })) throw new Error('FUNCTION_ACCESS_CHANGED');
  }
}
const result = { mode, checksum, assertionsChecksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, results: output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)) };
fs.writeFileSync(`${root}/${mode === '--check' ? 'check' : 'applied'}.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result));
