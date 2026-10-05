import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { assertNonProductionWriteTarget } from './lib/r1-write-target-policy.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { fixedPreviewActors, previewIdentitySql } from './parent-assessment-fixtures-local.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply', '--check-lesson-identity', '--apply-lesson-identity'].includes(mode)) throw new Error('USE_PREFLIGHT_CHECK_OR_APPLY');
const lessonIdentity = mode.endsWith('-lesson-identity');
const checkMode = mode.startsWith('--check');
const output = path.resolve('.tmp/staff-calendar');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
assertNonProductionWriteTarget({ operation: 'staff-calendar-local', supabaseUrl: observed.supabaseOrigin,
  environment: { MATHIN_WRITE_TARGET_ENVIRONMENT: 'development', MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: observed.supabaseOrigin } });
if (mode === '--preflight') {
  console.log(JSON.stringify({ target: 'verified-windows-loopback', databaseWrites: false, host: observed.host, origin: observed.supabaseOrigin,
    listeners: observed.listeners.map(({ Address, Port, Process }) => ({ Address, Port, Process })),
    targetFingerprint: createHash('sha256').update(observed.systemIdentifier).digest('hex') }));
  process.exit(0);
}
const version = lessonIdentity ? '20261005000500_calendar_lesson_identity' : '20261005000400_staff_calendar';
const migrationFile = `supabase/migrations/${version}.sql`, testFile = lessonIdentity ? 'supabase/tests/calendar_lesson_identity.sql' : 'supabase/tests/staff_calendar.sql';
const digest = textFileSha256(migrationFile);
const recorded = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (recorded && recorded !== digest) throw new Error('STAFF_CALENDAR_LEDGER_MISMATCH');
const migration = recorded ? '' : fs.readFileSync(migrationFile, 'utf8');
const actors = fixedPreviewActors(fs.readFileSync('.claude/test-accounts.local.md', 'utf8'));
const identities = previewIdentitySql(actors);
const inputHash = createHash('sha256').update(digest).update(textFileSha256(testFile)).update(JSON.stringify(actors)).digest('hex');
const checkedPath = path.join(output, lessonIdentity ? 'lesson-identity-checked.json' : 'checked.json');
const args = ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const migrate = statement => {
  try { return execFileSync('docker.exe', args, { input: statement, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).trim(); }
  catch (error) { fs.writeFileSync(path.join(output, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8'); throw new Error('STAFF_CALENDAR_DATABASE_ERROR: inspect private error file'); }
};
const relations = ['auth.users', 'public.profiles', 'public.classrooms', 'public.classroom_staff_assignments', 'public.class_sessions',
  'public.leads', 'public.lead_invitation_threads', 'public.lead_invitation_events', 'public.domain_events', 'public.assessment_slots', 'public.campuses', 'public.role_permissions'];
if (recorded) relations.push('public.staff_calendar_events', 'public.staff_calendar_attendees');
const fingerprint = () => sql(`begin read only;select md5(string_agg(relation||':'||digest,'|' order by relation)) from (${relations.map(relation =>
  `select '${relation}' relation,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) digest from ${relation} r`).join(' union all ')}) rows;commit;`);
if (checkMode) {
  const before = fingerprint();
  if (lessonIdentity) {
    migrate(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${identities}\n${fs.readFileSync(testFile, 'utf8')}\nrollback;`);
  } else {
  const teacher = sql(`begin read only;${identities}select current_setting('test.parent_preview.teacher_user_id');commit;`);
  if (!/^[a-f0-9-]{36}$/.test(teacher)) throw new Error('FIXED_TEACHER_REQUIRED');
  await new Promise((resolve, reject) => {
    const child = spawn('docker.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', probed = false, failure;
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (!probed && stdout.includes('STAFF_CALENDAR_CHECK_READY')) {
        probed = true;
        try {
          // 第二连接无法抢到正在处理日历事件的教师锁；整个夹具事务仍回滚。
          if (migrate(`begin;select pg_try_advisory_xact_lock(hashtextextended('assessment-teacher:${teacher}',0));rollback;`) !== 'f') throw new Error('STAFF_CALENDAR_TEACHER_LOCK_NOT_HELD');
        } catch (error) { failure = error; }
        child.stdin.end('rollback;\n');
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => {
      if (code || !probed || failure) {
        fs.writeFileSync(path.join(output, 'database-error.txt'), stderr, 'utf8');
        reject(failure ?? new Error('STAFF_CALENDAR_DATABASE_ERROR: inspect private error file'));
      } else resolve();
    });
    child.stdin.write(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${identities}\n${fs.readFileSync(testFile, 'utf8')}\nselect 'STAFF_CALENDAR_CHECK_READY';\n`);
  });
  }
  if (fingerprint() !== before) throw new Error('STAFF_CALENDAR_ROLLBACK_CHANGED_DATA');
  fs.writeFileSync(checkedPath, JSON.stringify({ inputHash, target: observed.systemIdentifier, checkedAt: new Date().toISOString() }), 'utf8');
  console.log(JSON.stringify({ passed: true, transactionRolledBack: true, checked: lessonIdentity
    ? ['existing-schedule-scope', 'primary-assistant-identities', 'substitute-deduplication', 'owner-fallback', 'parent-and-anon-scope', 'campus-filter']
    : ['participant-rls', 'organizer-writes', 'invitation-response', 'individual-task-completion', 'parent-booking-busy', 'session-time-guard', 'teacher-lock-second-connection', 'optimistic-conflict'] }));
} else {
  if (recorded) { console.log(JSON.stringify({ alreadyInstalled: true })); process.exit(0); }
  const checked = JSON.parse(fs.readFileSync(checkedPath, 'utf8'));
  if (checked.inputHash !== inputHash || checked.target !== observed.systemIdentifier || Date.now() - Date.parse(checked.checkedAt) > 3_600_000) throw new Error('MATCHING_STAFF_CALENDAR_CHECK_REQUIRED');
  migrate(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${digest}');commit;`);
  console.log(JSON.stringify({ applied: true, versions: [version], target: 'verified-windows-loopback', businessRowsWritten: 0 }));
}
