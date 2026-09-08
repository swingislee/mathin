import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const projection = process.argv.includes('--projection');
const entryContext = process.argv.includes('--entry-context');
const root = path.resolve(entryContext ? '.tmp/student-record-entry-context' : projection ? '.tmp/student-record-projection' : '.tmp/unified-student-records');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, head })); process.exit(0);
}
const version = entryContext ? '20260908008200_student_record_entry_context' : projection ? '20260908008100_student_record_list_projection' : '20260908008000_unified_student_records';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
const checkPath = path.join(root, 'check.json');
if (mode === '--apply') {
  const check = fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['students','leads','lead_communications','lead_next_actions','activity_registrations','assessment_results',
  'course_enrollments','enrollments','student_follow_ups','history_workflow_scopes','history_import_records','communication_worklists'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),''))) from public.${table} t)`).join(',')});commit;`);
const before = snapshot();
const signature = entryContext ? 'public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])' : projection ? 'public.list_student_record_summaries(text,text,text,text)' : 'public.list_student_record_workspace(text,text,text,integer,integer,text,text)';
const definition = () => sql(`begin read only;select md5(coalesce(pg_get_functiondef(to_regprocedure('${signature}')),''));commit;`);
const beforeDefinition = definition();
sql(`begin;set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('unified-student-records',0));
  ${applied ? '' : fs.readFileSync(file, 'utf8')}
  ${fs.readFileSync(entryContext ? 'scripts/sql/student-record-entry-context-assertions.sql' : projection ? 'scripts/sql/student-record-projection-assertions.sql' : 'scripts/sql/unified-student-records-assertions.sql', 'utf8')}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`);
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
if (mode === '--check' && definition() !== beforeDefinition) throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
