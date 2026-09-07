import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/student-stage-workspace');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host,
    head: sql('begin read only;select max(version) from public.schema_migrations;commit;') }));
  process.exit(0);
}
const migrations = ['20260908000100_student_stage_workspace', '20260908000110_student_stage_workspace_index'].map(version => {
  const file = `supabase/migrations/${version}.sql`;
  const checksum = textFileSha256(file);
  const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
  if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
  return { version, file, checksum, applied: Boolean(applied) };
});
const pending = migrations.filter(migration => !migration.applied);
const checksum = migrations.map(migration => migration.checksum).join(':');
if (!pending.length && mode !== '--check') { console.log(JSON.stringify({ alreadyApplied: true, checksum })); process.exit(0); }
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const checkPath = path.join(root, 'check.json');
if (mode === '--apply') {
  const check = fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['students', 'leads', 'lead_communications', 'lead_invitation_threads', 'activity_registrations',
  'assessment_results', 'course_enrollments', 'enrollments', 'student_follow_ups'];
const snapshot = () => sql(`begin read only;select jsonb_build_object(${tables.map(table =>
  `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),''))) from public.${table} t)`).join(',')});commit;`);
const before = snapshot();
const definition = () => sql("begin read only;select md5(coalesce(pg_get_functiondef(to_regprocedure('public.list_student_stage_workspace(text,text,text,integer,integer,text)')),''));commit;");
const beforeDefinition = definition();
sql(`begin;set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('student-stage-workspace',0));
  ${pending.map(migration => fs.readFileSync(migration.file, 'utf8')).join('\n')}
  ${fs.readFileSync('scripts/sql/student-stage-workspace-assertions.sql', 'utf8')}
  ${mode === '--check' ? 'rollback;' : `${pending.map(migration => `insert into public.schema_migrations(version,checksum) values('${migration.version}','${migration.checksum}');`).join('\n')}notify pgrst,'reload schema';commit;`}`);
if (snapshot() !== before) throw new Error('BUSINESS_DATA_CHANGED');
if (mode === '--check' && definition() !== beforeDefinition) throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  databaseAssertions: 'PASS', businessDataUnchanged: true };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
