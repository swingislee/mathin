import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/teaching-records');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = '20260915003000_teaching_session_records';
const file = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('TEACHING_RECORDS_CHECKSUM_MISMATCH');
const migration = recorded ? '' : fs.readFileSync(file, 'utf8');
const fingerprint = () => sql("begin read only; select coalesce(md5(pg_get_functiondef(to_regprocedure('public.get_teaching_session_records(uuid,integer)'))),'missing'); commit;");
if (mode === '--check') {
  const before = fingerprint();
  const identities = sql(`begin read only; select jsonb_object_agg(case email
    when 'test-admin@mathin.local' then 'admin' when 'test-teacher@mathin.local' then 'teacher'
    when 'test-principal@mathin.local' then 'supervisor' when 'test-student@mathin.local' then 'outsider' end, id)
    from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local','test-principal@mathin.local','test-student@mathin.local'); commit;`);
  const accounts = JSON.parse(identities);
  if (!['admin','teacher','supervisor','outsider'].every(key => /^[0-9a-f-]{36}$/.test(accounts[key]))) throw new Error('FIXED_ACCOUNTS_REQUIRED');
  const settings = Object.entries(accounts).map(([key, id]) => `select set_config('teaching.test.${key}', '${id}', true);`).join('\n');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${migration}
    ${settings}
    ${fs.readFileSync('scripts/sql/teaching-records-assertions.sql', 'utf8')}
    rollback;`);
  if (fingerprint() !== before) throw new Error('TEACHING_RECORDS_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host }), 'utf8');
  console.log('Teaching record scope, saved learning without starting, contact permissions, pagination and rollback: PASS');
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
