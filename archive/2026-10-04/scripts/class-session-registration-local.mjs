import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.join(os.tmpdir(), 'mathin-class-session-registration');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = '20260920001000_session_review_roster_alignment';
const file = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
// 外层事务统一负责演练回滚或正式提交。
const migration = recorded ? '' : fs.readFileSync(file, 'utf8').replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '');
const fingerprint = () => sql(`begin read only; select jsonb_build_object(
  'function',md5(pg_get_functiondef('public.save_session_reviews_v2(uuid,jsonb)'::regprocedure)),
  'reviews',(select count(*) from public.session_reviews),'classes',(select count(*) from public.classrooms),
  'sessions',(select count(*) from public.class_sessions),'students',(select count(*) from public.students),
  'roster',(select count(*) from public.session_roster_entries),'ledger',(select count(*) from public.schema_migrations)); commit;`);
if (mode === '--check') {
  const before = fingerprint();
  const settings = Object.entries({ admin: 'admin', teacher: 'teacher', supervisor: 'principal', outsider: 'student' }).map(([key, role]) => {
    const account = loadFixedAccount(role);
    if (!account) throw new Error('FIXED_ACCOUNT_REQUIRED');
    const email = account.email.replaceAll("'", "''");
    const id = sql(`begin read only; select id from auth.users where email='${email}'; commit;`);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('FIXED_ACCOUNT_REQUIRED');
    return `select set_config('teaching.test.${key}','${id}',true);`;
  }).join('\n');
  const setup = fs.readFileSync('scripts/sql/teaching-records-assertions.sql', 'utf8').split('set local role authenticated;')[0];
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${migration}\n${settings}\n${setup}\n${fs.readFileSync('scripts/sql/class-session-registration-assertions.sql', 'utf8')}\nrollback;`);
  if (fingerprint() !== before) throw new Error('ROLLBACK_MISMATCH');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host }), 'utf8');
  console.log('Actual lesson roster, temporary enrollment, frozen history, write denial and rollback: PASS');
} else {
  if (recorded) throw new Error('ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host) throw new Error('MATCHING_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); notify pgrst,'reload schema'; commit;`);
  console.log('Local class session review alignment applied.');
}
