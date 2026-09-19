import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.join(os.tmpdir(), 'mathin-student-directory');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const migrations = ['20260919001000_student_directory', '20260919002000_student_directory_group_order'].map(version => {
  const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
  const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
  if (recorded && recorded !== checksum) throw new Error('DIRECTORY_CHECKSUM_MISMATCH');
  return { version, checksum, recorded, text: recorded ? '' : fs.readFileSync(file, 'utf8') };
});
const checksum = migrations.map(item => item.checksum).join(':');
const migration = migrations.map(item => item.text).join('\n');
const signature = 'public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])';
const fingerprint = () => sql(`begin read only; select coalesce(md5(pg_get_functiondef(to_regprocedure('${signature}'))),'missing'); commit;`);
if (mode === '--check') {
  const before = fingerprint();
  const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8').split(/\r?\n/);
  const labels = { supervisor: '主管 staff/principal', teacher: '教师 staff/teacher', outsider: '学生 student' };
  const emails = Object.entries(labels).map(([role, label]) => {
    const line = manifest.find(line => line.split('|')[1]?.trim() === label);
    const email = line?.match(/[\w.+-]+@[\w.-]+/)?.[0];
    if (!email) throw new Error('FIXED_ACCOUNT_MANIFEST_REQUIRED');
    return `('${role}','${email}')`;
  }).join(',');
  const accounts = JSON.parse(sql(`begin read only; select jsonb_object_agg(v.role,u.id) from (values ${emails}) v(role,email) join auth.users u using(email); commit;`));
  if (!Object.keys(labels).every(role => /^[0-9a-f-]{36}$/.test(accounts?.[role]))) throw new Error('FIXED_ACCOUNTS_REQUIRED');
  const settings = Object.entries(accounts).map(([role, id]) => `select set_config('directory.test.${role}','${id}',true);`).join('\n');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='90s';
    ${migration}
    ${settings}
    ${fs.readFileSync('scripts/sql/student-directory-assertions.sql', 'utf8')}
    rollback;`);
  if (fingerprint() !== before) throw new Error('DIRECTORY_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host }), 'utf8');
  console.log('Student directory: profile scope, permissions, grouping, pagination, selection order and rollback PASS.');
} else {
  const pending = migrations.filter(item => !item.recorded);
  if (!pending.length) throw new Error('DIRECTORY_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host) throw new Error('DIRECTORY_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${migration}
    ${pending.map(item => `insert into public.schema_migrations(version,checksum) values('${item.version}','${item.checksum}');`).join('\n')}
    notify pgrst,'reload schema'; commit;`);
  console.log('Local student directory reader applied.');
}
