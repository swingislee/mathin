import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--check-history', '--apply'].includes(mode)) throw new Error('Use --preflight, --check, --check-history or --apply');
const checking = mode === '--check' || mode === '--check-history';
const root = path.resolve('.tmp/assessment-quick-entry');
fs.mkdirSync(root, { recursive: true });
const { sql, docker, observed } = openHistoryLocalTarget({
  attestationPath: path.join(root, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt'),
});
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const migration = '20260907000100_assessment_optional_question_entry';
const migrationFile = `supabase/migrations/${migration}.sql`, checksum = textFileSha256(migrationFile);
if (sql(`begin read only;select count(*) from public.schema_migrations where version='${migration}';commit;`) !== '0') throw new Error('ALREADY_APPLIED');
const checkFile = path.join(root, 'check.json');
if (mode === '--apply' && (!fs.existsSync(checkFile) || JSON.parse(fs.readFileSync(checkFile, 'utf8')).checksum !== checksum)) throw new Error('CHECK_REQUIRED');
const historyCheckFile = path.join(root, 'history-check.json');
if (mode === '--apply' && (!fs.existsSync(historyCheckFile) || JSON.parse(fs.readFileSync(historyCheckFile, 'utf8')).checksum !== checksum)) throw new Error('HISTORY_GUARD_CHECK_REQUIRED');
const tables = ['activities', 'activity_registrations', 'assessment_results', 'assessment_question_results', 'assessment_papers', 'assessment_paper_versions',
  'activity_routes', 'activity_followup_contacts', 'student_follow_ups', 'students', 'profiles', 'staff_role_members', 'leads', 'lead_communications',
  'lead_invitation_threads', 'lead_invitation_events', 'course_enrollments', 'course_opportunities', 'classrooms', 'class_sessions', 'session_attendance'];
const columns = JSON.parse(sql(`begin read only;select jsonb_object_agg(table_name,names) from
  (select table_name,jsonb_agg(column_name order by ordinal_position) names from information_schema.columns where table_schema='public' group by table_name)c;commit;`));
const fingerprint = tables.map(table => {
  if (!columns[table]) throw new Error(`MISSING_TABLE_${table}`);
  const row = `jsonb_build_object(${columns[table].map(column => `'${column}',t.${column}`).join(',')})`;
  return `select '${table}'::text name,count(*)::integer rows,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) digest from public.${table} t`;
}).join('\nunion all\n');
if (mode === '--check') fs.writeFileSync(path.join(root, 'schema-before.sql'), docker(['exec', 'supabase-db', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner']), 'utf8');
const body = `set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('assessment-quick-entry',0));
  create temp table assessment_data_before on commit drop as ${fingerprint};
  ${fs.readFileSync(migrationFile, 'utf8')}
  ${checking ? `savepoint before_behavior;${fs.readFileSync(mode === '--check' ? 'scripts/sql/assessment-quick-entry-assertions.sql' : 'scripts/sql/business-record-revision-assertions.sql', 'utf8')}rollback to before_behavior;` : ''}
  create temp table assessment_data_after on commit drop as ${fingerprint};
  do $check$ begin if exists((select * from assessment_data_before except select * from assessment_data_after)
    union all(select * from assessment_data_after except select * from assessment_data_before)) then raise exception 'ASSESSMENT_EXISTING_DATA_CHANGED';end if;end $check$;
`;
sql(`begin isolation level repeatable read;${body}${checking ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`}`);
if (checking && sql("begin read only;select to_regclass('public.assessment_quick_entries') is null;commit;") !== 't') throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, checkedAt: new Date().toISOString(), host: observed.host, protectedTables: tables.length, businessDataUnchanged: true };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : mode === '--check-history' ? 'history-check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
