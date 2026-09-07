import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/assessment-stage-workflow');
fs.mkdirSync(root, { recursive: true });
const { sql, docker, observed } = openHistoryLocalTarget({
  attestationPath: path.join(root, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt'),
});
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const migration = '20260907000200_assessment_stage_workflow';
const migrationFile = `supabase/migrations/${migration}.sql`, checksum = textFileSha256(migrationFile);
if (sql(`begin read only;select count(*) from public.schema_migrations where version='${migration}';commit;`) !== '0') throw new Error('ALREADY_APPLIED');
const checkFile = path.join(root, 'check.json');
if (mode === '--apply' && (!fs.existsSync(checkFile) || JSON.parse(fs.readFileSync(checkFile, 'utf8')).checksum !== checksum)) throw new Error('CHECK_REQUIRED');
const tables = ['activities', 'activity_registrations', 'assessment_results', 'assessment_question_results', 'assessment_papers', 'assessment_paper_versions',
  'assessment_quick_entries', 'assessment_entry_events', 'activity_routes', 'activity_followup_contacts', 'student_follow_ups', 'students', 'profiles',
  'staff_role_members', 'leads', 'lead_communications', 'lead_invitation_threads', 'lead_invitation_events', 'course_enrollments', 'course_opportunities',
  'classrooms', 'class_sessions', 'session_attendance', 'public_class_segments', 'public_class_participant_records'];
const fingerprint = tables.map(table => `select '${table}'::text name,count(*)::integer rows,
  md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public.${table} t`).join('\nunion all\n');
if (mode === '--check') fs.writeFileSync(path.join(root, 'schema-before.sql'), docker(['exec', 'supabase-db', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner']), 'utf8');
const checks = ['scripts/sql/assessment-stage-workflow-assertions.sql', 'scripts/sql/assessment-quick-entry-assertions.sql'];
// 本次断言身份从本机 manifest 解析；源码只维护角色，不复制开发账号或凭据。
let identities = '';
if (mode === '--check') {
  const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
  const roles = { admin: /^管理员\s+admin(?:\s|$)/, support: /^学辅\/前台\s+staff\/sales(?:\s|$)/,
    teacher: /^教师\s+staff\/teacher(?:\s|$)/, other: /^教研\s+staff\/research(?:\s|$)/ };
  for (const [role, pattern] of Object.entries(roles)) {
    const cells = manifest.split(/\r?\n/).map(line => line.split('|').slice(1,-1).map(cell => cell.replace(/[*_`]/g,'').trim()))
      .find(row => pattern.test(row[0] ?? ''));
    if (!cells || !/^[^@'\s]+@[^@'\s]+$/.test(cells[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
    identities += `select set_config('mathin.assertion.${role}',coalesce((select id::text from auth.users where email='${cells[1]}'),''),true);\n`;
  }
}
const body = `set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('assessment-stage-workflow',0));
  create temp table assessment_data_before on commit drop as ${fingerprint};
  ${fs.readFileSync(migrationFile, 'utf8')}
  ${identities}
  ${mode === '--check' ? checks.map(file => `savepoint before_behavior;${fs.readFileSync(file, 'utf8')}rollback to before_behavior;`).join('\n') : ''}
  create temp table assessment_data_after on commit drop as ${fingerprint};
  do $check$ begin if exists((select * from assessment_data_before except select * from assessment_data_after)
    union all(select * from assessment_data_after except select * from assessment_data_before)) then raise exception 'ASSESSMENT_EXISTING_DATA_CHANGED';end if;end $check$;
`;
sql(`begin isolation level repeatable read;${body}${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`}`);
if (mode === '--check' && sql("begin read only;select to_regclass('public.assessment_workflow_states') is null;commit;") !== 't') throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, checkedAt: new Date().toISOString(), host: observed.host, protectedTables: tables.length, businessDataUnchanged: true };
fs.writeFileSync(path.join(root, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
