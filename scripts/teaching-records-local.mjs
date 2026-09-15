import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
const overview = process.argv.includes('--overview');
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve(overview ? '.tmp/teaching-class-overview' : '.tmp/teaching-records');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = overview ? '20260915004000_teaching_class_overview' : '20260915003000_teaching_session_records';
const file = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('TEACHING_RECORDS_CHECKSUM_MISMATCH');
const migration = recorded ? '' : fs.readFileSync(file, 'utf8');
const signature = overview ? 'public.get_teaching_class_overview(timestamptz,timestamptz,text)' : 'public.get_teaching_session_records(uuid,integer)';
const fingerprint = () => sql(`begin read only; select coalesce(md5(pg_get_functiondef(to_regprocedure('${signature}'))),'missing'); commit;`);
if (mode === '--check') {
  const before = fingerprint();
  const identities = sql(`begin read only; select jsonb_object_agg(case email
    when 'test-admin@mathin.local' then 'admin' when 'test-teacher@mathin.local' then 'teacher'
    when 'test-principal@mathin.local' then 'supervisor' when 'test-student@mathin.local' then 'outsider' end, id)
    from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local','test-principal@mathin.local','test-student@mathin.local'); commit;`);
  const accounts = JSON.parse(identities);
  if (!['admin','teacher','supervisor','outsider'].every(key => /^[0-9a-f-]{36}$/.test(accounts[key]))) throw new Error('FIXED_ACCOUNTS_REQUIRED');
  const settings = Object.entries(accounts).map(([key, id]) => `select set_config('teaching.test.${key}', '${id}', true);`).join('\n');
  const recordChecks = fs.readFileSync('scripts/sql/teaching-records-assertions.sql', 'utf8');
  // 概览复用同一组回滚样例，只运行本次新增聚合合同。
  const checks = overview ? recordChecks.split('set local role authenticated;')[0]
    + fs.readFileSync('scripts/sql/teaching-class-overview-assertions.sql', 'utf8') : recordChecks;
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${migration}
    ${settings}
    ${checks}
    rollback;`);
  if (fingerprint() !== before) throw new Error('TEACHING_RECORDS_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host }), 'utf8');
  console.log(overview ? 'Class overview metrics, student/contact deduplication, period and permission scope, rollback: PASS'
    : 'Teaching record scope, saved learning without starting, contact permissions, pagination and rollback: PASS');
} else {
  if (recorded) throw new Error('TEACHING_RECORDS_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host) throw new Error('TEACHING_RECORDS_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${migration}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');
    notify pgrst, 'reload schema'; commit;`);
  console.log('Local teaching record reader applied.');
}
