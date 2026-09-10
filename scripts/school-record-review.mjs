import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/school-record-review');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head })); process.exit(0);
}
const version = '20260910002000_school_source_record_review';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (mode === '--apply' && applied) { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(path.join(root, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['students','leads','lead_communications','lead_identity_conversions','student_follow_ups','profiles',
  'history_import_records','history_import_associations','history_import_association_events','history_import_identity_candidates',
  'course_enrollments','course_enrollment_assignments','course_opportunities','assessment_results','activity_registrations',
  'school_subject_participants','school_subject_groups'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t)`).join(',')});commit;`);
const definitions = () => sql(`begin read only;select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
  'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public'));
  commit;`);
const before = snapshot(), beforeDefinitions = definitions();
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='120s';
  select pg_advisory_xact_lock(hashtextextended('school-record-review',0));
  ${applied ? '' : fs.readFileSync(file, 'utf8')}
  ${fs.readFileSync('scripts/sql/school-record-review-assertions.sql', 'utf8')}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('RECORD_REVIEW_DATABASE_ERROR: inspect private error file');
}
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
if (mode === '--check' && definitions() !== beforeDefinitions) throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true, rollbackVerified: mode === '--check' };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
