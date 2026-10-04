import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const closedOrder = process.argv.includes('--closed-order');
const root = path.resolve(closedOrder ? '.tmp/assessment-closed-order' : '.tmp/assessment-followup-status');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const migration = closedOrder ? '20260907002000_assessment_closed_appointment_order' : '20260907001800_assessment_followup_status';
const migrationFile = `supabase/migrations/${migration}.sql`, checksum = textFileSha256(migrationFile);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${migration}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log('ALREADY_APPLIED'); process.exit(0); }
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const viewBefore = sql("begin read only;select md5(pg_get_viewdef('public.assessment_workbench_read_order'::regclass,true));commit;");
const checkFile = path.join(root, 'check.json');
if (mode === '--apply') {
  const check = fs.existsSync(checkFile) ? JSON.parse(fs.readFileSync(checkFile, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.head !== head) throw new Error('CHECK_REQUIRED');
}
const tables = ['activities', 'activity_registrations', 'assessment_results', 'assessment_question_results', 'assessment_quick_entries',
  'assessment_entry_events', 'assessment_workflow_states', 'assessment_reports', 'assessment_workflow_events', 'activity_routes',
  'activity_followup_contacts', 'student_follow_ups', 'students', 'profiles', 'leads', 'lead_communications', 'lead_invitation_threads',
  'lead_invitation_events', 'course_enrollments', 'course_opportunities', 'classrooms', 'class_sessions', 'session_attendance',
  'public_class_segments', 'public_class_participant_records'];
const fingerprint = tables.map(table => {
  const value = table === 'assessment_workflow_states' ? "to_jsonb(t)-'trial_intent'-'contacted_at'"
    : ['activities', 'lead_invitation_threads'].includes(table) ? "to_jsonb(t)-'rescheduled_at'" : 'to_jsonb(t)';
  return `select '${table}'::text name,count(*)::bigint rows,md5(coalesce(string_agg(md5((${value})::text),'' order by md5((${value})::text)),'')) digest from public.${table} t`;
}).join('\nunion all\n');
let identities = '';
if (mode === '--check') {
  const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
  for (const [role, pattern] of Object.entries({ admin: /^管理员\s+admin(?:\s|$)/, support: /\bstaff\/sales(?:\s|$)/, teacher: /^教师\s+staff\/teacher(?:\s|$)/, other: /^教研\s+staff\/research(?:\s|$)/ })) {
    const cells = manifest.split(/\r?\n/).map(line => line.split('|').slice(1, -1).map(cell => cell.replace(/[*_`]/g, '').trim())).find(row => pattern.test(row[0] ?? ''));
    if (!cells || !/^[^@'\s]+@[^@'\s]+$/.test(cells[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
    identities += `select set_config('mathin.assertion.${role}',coalesce((select id::text from auth.users where email='${cells[1]}'),''),true);\n`;
  }
}
sql(`begin isolation level repeatable read;
  set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('assessment-followup-status',0));
  create temp table followup_before on commit drop as ${fingerprint};
  ${applied ? '' : fs.readFileSync(migrationFile, 'utf8')}
  ${identities}
  ${mode === '--check' ? `savepoint behavior;${fs.readFileSync(closedOrder ? 'scripts/sql/assessment-closed-order-assertions.sql' : 'scripts/sql/assessment-followup-status-assertions.sql', 'utf8')}rollback to behavior;` : ''}
  create temp table followup_after on commit drop as ${fingerprint};
  do $check$ begin if exists((select * from followup_before except select * from followup_after)
    union all(select * from followup_after except select * from followup_before)) then raise exception 'FOLLOWUP_EXISTING_DATA_CHANGED';end if;end $check$;
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`}`);
if (mode === '--check' && (sql("begin read only;select md5(pg_get_viewdef('public.assessment_workbench_read_order'::regclass,true));commit;") !== viewBefore
  || !closedOrder && !applied && sql("begin read only;select count(*) from information_schema.columns where table_schema='public' and table_name='assessment_workflow_states' and column_name='trial_intent';commit;") !== '0')) throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), protectedTables: tables.length, businessDataUnchanged: true };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
