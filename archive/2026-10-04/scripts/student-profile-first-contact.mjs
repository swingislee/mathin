import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/student-profile-first-contact');
fs.mkdirSync(output, { recursive: true });
const { sql: readSql, observed } = openHistoryLocalTarget({
  attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight',
  errorFile: path.join(output, 'database-error.txt'),
});
// 沿用已核对的同一目标；既有 contact/reminder RPC 的 owner 为 supabase_admin。
const sql = statement => {
  try {
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db',
      'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(output, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('STUDENT_PROFILE_DATABASE_ERROR: inspect private error file');
  }
};
const version = '20260906002200_student_profile_after_first_contact';
const migrationPath = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(migrationPath);
const reportPath = path.join(output, 'check.json');
if (mode === '--preflight') {
  const counts = JSON.parse(readSql(`begin read only; select jsonb_build_object(
    'eligibleLeads', (select count(*) from public.leads l where l.student_id is null and l.owner_id is not null
      and l.status not in ('invalid','converted') and exists (select 1 from public.lead_communications c where c.lead_id=l.id and c.outcome in ('connected','declined'))),
    'applied', (select count(*) from public.schema_migrations where version='${version}'),
    'historicalSchemaReady', exists(select 1 from information_schema.columns where table_schema='public' and table_name='course_enrollments' and column_name='record_state'));
    commit;`));
  console.log(JSON.stringify({ host: observed.host, localTargetVerified: true, ...counts }));
  process.exit(0);
}
if (sql(`begin read only;select count(*) from public.schema_migrations where version='${version}';commit;`) !== '0') throw new Error('MIGRATION_ALREADY_APPLIED');
if (mode === '--apply' && (!fs.existsSync(reportPath) || JSON.parse(fs.readFileSync(reportPath, 'utf8')).checksum !== checksum)) throw new Error('CHECK_REQUIRED');
const backfill = `
  create temp table profile_backfill_result(result jsonb) on commit drop;
  do $backfill$ declare subject record; actor uuid; begin
    select u.id into actor from auth.users u join public.profiles p on p.id=u.id where u.email='test-admin@mathin.local' and p.role='admin';
    if actor is null then
      raise exception 'FIXED_LOCAL_ADMIN_REQUIRED';
    end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    for subject in select l.id from public.leads l
      where l.student_id is null and l.owner_id is not null and l.status not in ('invalid','converted')
        and exists(select 1 from public.lead_communications c where c.lead_id=l.id and c.outcome in ('connected','declined'))
      order by l.id for update
    loop
      insert into profile_backfill_result values(public.ensure_lead_student_profile(subject.id));
    end loop;
  end $backfill$;
  select set_config('request.jwt.claims','{}',true);
  select jsonb_build_object('created',count(*) filter(where result->>'studentProfileStatus'='created'),
    'needsReview',count(*) filter(where result->>'studentProfileStatus'='needs_review'),
    'pendingContact',count(*) filter(where result->>'studentProfileStatus'='pending_contact')) from profile_backfill_result;
`;
const body = fs.readFileSync(migrationPath, 'utf8');
const before = sql(`begin read only;select count(*) from public.students;commit;`);
const raw = sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
  select pg_advisory_xact_lock(hashtextextended('student-profile-first-contact',0));
  ${body}
  ${fs.readFileSync('scripts/sql/student-profile-first-contact-assertions.sql', 'utf8')}
  ${backfill}
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`);
const backfillResult = JSON.parse(raw.split('\n').findLast(line => line.startsWith('{') && line.includes('created')));
if (mode === '--check') {
  const remaining = sql(`begin read only;select (to_regprocedure('public.ensure_lead_student_profile(uuid)') is null)::text || ':' || count(*)::text from public.students;commit;`);
  if (remaining !== `true:${before}`) throw new Error('ROLLBACK_FAILED');
}
const report = { mode, checksum, localTargetVerified: true, databaseAssertions: 'PASS', rollback: mode === '--check' ? 'PASS' : 'previously verified', ...backfillResult };
fs.writeFileSync(path.join(output, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report));
