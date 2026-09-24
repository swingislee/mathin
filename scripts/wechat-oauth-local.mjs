import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/wechat-oauth-local');
fs.mkdirSync(root, { recursive: true });
const { sql, docker, observed } = openHistoryLocalTarget({
  attestationPath: path.join(root, 'preflight.json'), refresh: mode === '--preflight',
  errorFile: path.join(root, 'database-error.txt'),
});
if (mode === '--preflight') {
  console.log(JSON.stringify({ target: 'isolated-local', checkedAt: observed.checkedAt, databaseVerified: true }));
  process.exit(0);
}
const version = '20260925001000_wechat_oauth_tickets';
const candidate = `supabase/migrations/${version}.sql`;
const assertions = 'supabase/tests/wechat_oauth_assertions.sql';
const checksum = textFileSha256(candidate);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; rollback;`);
if (recorded && recorded !== checksum) throw new Error('WECHAT_MIGRATION_CHECKSUM_MISMATCH');
const adminSql = statement => {
  try {
    // auth.identities 由 Auth 管理；使用现有 schema 管理角色，不追加所有权。
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: statement, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('WECHAT_DATABASE_COMMAND_FAILED: inspect private database-error.txt');
  }
};
const fingerprint = () => sql(`begin isolation level repeatable read read only;
  select jsonb_build_object(
    'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), '|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth') and p.prokind='f'),
    'relations',(select md5(string_agg(c.oid::text||c.relname||c.relrowsecurity::text||coalesce(c.relacl::text,''), '|' order by c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth')),
    'users',(select count(*) from auth.users),'identities',(select count(*) from auth.identities),'profiles',(select count(*) from public.profiles),
    'wechat_identities',(select count(*) from auth.identities where provider='custom:wechat'));
  rollback;`);
const before = fingerprint();
if (mode === '--apply') {
  if (recorded) throw new Error('WECHAT_MIGRATION_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(root, 'check.json'), 'utf8'));
  if (check.candidateHash !== checksum || check.assertionsHash !== textFileSha256(assertions)
    || check.systemIdentifier !== observed.systemIdentifier || check.host !== observed.host
    || check.rollback !== 'PASS' || Date.now() - Date.parse(check.checkedAt) > 3_600_000) throw new Error('WECHAT_MATCHING_CHECK_REQUIRED');
  fs.writeFileSync(path.join(root, 'schema-before.sql'), docker(['exec','supabase-db','pg_dump','-U','supabase_admin','-d','postgres','--schema-only']), 'utf8');
  adminSql(`begin; set local lock_timeout='5s'; set local statement_timeout='45s';
    select pg_advisory_xact_lock(hashtextextended('wechat-oauth-local',0));
    ${fs.readFileSync(candidate, 'utf8')}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');
    notify pgrst, 'reload schema'; commit;`);
  const prior = JSON.parse(before), after = JSON.parse(fingerprint());
  if (['users','identities','profiles','wechat_identities'].some(key => prior[key] !== after[key])) throw new Error('WECHAT_EXISTING_ACCOUNT_COUNTS_CHANGED');
  const empty = sql(`begin read only; select (select count(*) from public.wechat_oauth_tickets)
    +(select count(*) from public.wechat_oauth_rate_limits)+(select count(*) from public.wechat_profile_snapshots)
    +(select count(*) from public.wechat_binding_audits); rollback;`);
  if (empty !== '0') throw new Error('WECHAT_NEW_TABLES_NOT_EMPTY');
  const result = { version, checksum, target: 'isolated-local', applied: 'PASS', existingAccountsPreserved: true, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'applied.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result));
  process.exit(0);
}
const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8').split(/\r?\n/)
  .map(line => line.split('|').slice(1, -1).map(cell => cell.replace(/[*_`]/g, '').trim()));
const identities = Object.entries({ owner: /^教师\s+staff\/teacher(?:\s|$)/, other: /^学生\s+student(?:\s|$)/ })
  .map(([role, pattern]) => {
    const cells = manifest.find(row => pattern.test(row[0] ?? ''));
    if (!cells || !/^[^@'\s]+@[^@'\s]+$/.test(cells[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
    return `select set_config('mathin.wechat_test.${role}',coalesce((select id::text from auth.users where email='${cells[1]}'),''),true);`;
  }).join('\n');
try {
  adminSql(`begin; set local lock_timeout='5s'; set local statement_timeout='45s';
    select pg_advisory_xact_lock(hashtextextended('wechat-oauth-local',0));
    ${recorded ? '' : fs.readFileSync(candidate, 'utf8')}
    ${identities}
    ${fs.readFileSync(assertions, 'utf8')}
    rollback;`);
} finally {
  if (fingerprint() !== before) throw new Error('WECHAT_ROLLBACK_INVARIANT_CHANGED');
}
const result = {
  checkedAt: new Date().toISOString(), candidateHash: textFileSha256(candidate), assertionsHash: textFileSha256(assertions),
  target: 'isolated-local', databaseAssertions: 'PASS', rollback: 'PASS', existingAccountsPreserved: true,
  host: observed.host, systemIdentifier: observed.systemIdentifier,
};
fs.writeFileSync(path.join(root, 'check.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ...result, host: undefined, systemIdentifier: undefined }));
