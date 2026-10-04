import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { mergeGeneratedDatabaseTypes } from './lib/scoped-database-types.mjs';
import { DIGEST_PREFIX, migrationsDigest } from './lib/migrations-digest.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply', '--types'].includes(mode)) throw new Error('Use --preflight, --check, --apply or --types');
const output = path.resolve('.tmp/session-communication-autosave');
fs.mkdirSync(output, { recursive: true });
const { sql, docker, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = '20260925003000_session_communication_autosave';
const file = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
if (mode === '--types') {
  if (!recorded) throw new Error('MIGRATION_REQUIRED');
  const generated = docker(['exec', 'supabase-meta', 'node', '--input-type=module', '-e',
    'const r=await fetch("http://127.0.0.1:8080/generators/typescript?included_schemas=public"); if(!r.ok) process.exit(1); process.stdout.write(await r.text());']);
  fs.writeFileSync(path.join(output, 'generated-types.ts'), generated, 'utf8');
  const target = 'src/lib/database.types.ts';
  const types = mergeGeneratedDatabaseTypes(fs.readFileSync(target, 'utf8'), generated, {
    Tables: ['student_follow_ups', 'session_class_communications'], Functions: ['save_session_communication'],
  }).replace(new RegExp(`^${DIGEST_PREFIX}.*$`, 'm'), DIGEST_PREFIX + migrationsDigest());
  fs.writeFileSync(target, types, 'utf8');
  console.log('Merged database-generated communication revisions and autosave RPC; other definitions retained.');
  process.exit(0);
}
const migration = recorded ? '' : fs.readFileSync(file, 'utf8');
const fingerprint = () => sql(`begin read only; select jsonb_build_object(
  'functions',(select md5(string_agg(pg_get_functiondef(oid),'|' order by oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'),
  'contacts',(select count(*) from public.student_follow_ups),'groups',(select count(*) from public.session_class_communications),
  'tasks',(select count(*) from public.session_completion_tasks),'ledger',(select count(*) from public.schema_migrations)); commit;`);
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
    ${migration}\n${settings}\n${setup}\n${fs.readFileSync('scripts/sql/session-communication-autosave-assertions.sql', 'utf8')}\nrollback;`);
  if (fingerprint() !== before) throw new Error('ROLLBACK_MISMATCH');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host }), 'utf8');
  console.log('Autosave revisions, retries, completion/reopening, history preservation, permissions and rollback: PASS');
} else {
  if (recorded) throw new Error('ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host) throw new Error('MATCHING_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); notify pgrst,'reload schema'; commit;`);
  console.log('Local session communication autosave migration applied.');
}
