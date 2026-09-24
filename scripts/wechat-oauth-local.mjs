import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check'].includes(mode)) throw new Error('Use --preflight or --check');
const root = path.resolve('.tmp/wechat-oauth-local');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({
  attestationPath: path.join(root, 'preflight.json'), refresh: mode === '--preflight',
  errorFile: path.join(root, 'database-error.txt'),
});
if (mode === '--preflight') {
  console.log(JSON.stringify({ target: 'isolated-local', checkedAt: observed.checkedAt, databaseVerified: true }));
  process.exit(0);
}
const candidate = 'supabase/pending/20260924000100_wechat_oauth_tickets.sql';
const assertions = 'supabase/tests/wechat_oauth_assertions.sql';
const fingerprint = () => sql(`begin isolation level repeatable read read only;
  select jsonb_build_object(
    'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), '|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth') and p.prokind='f'),
    'relations',(select md5(string_agg(c.oid::text||c.relname||c.relrowsecurity::text||coalesce(c.relacl::text,''), '|' order by c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth')),
    'users',(select count(*) from auth.users),'identities',(select count(*) from auth.identities),'profiles',(select count(*) from public.profiles),
    'wechat_identities',(select count(*) from auth.identities where provider='custom:wechat'));
  rollback;`);
const before = fingerprint();
const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8').split(/\r?\n/)
  .map(line => line.split('|').slice(1, -1).map(cell => cell.replace(/[*_`]/g, '').trim()));
const identities = Object.entries({ owner: /^教师\s+staff\/teacher(?:\s|$)/, other: /^学生\s+student(?:\s|$)/ })
  .map(([role, pattern]) => {
    const cells = manifest.find(row => pattern.test(row[0] ?? ''));
    if (!cells || !/^[^@'\s]+@[^@'\s]+$/.test(cells[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
    return `select set_config('mathin.wechat_test.${role}',coalesce((select id::text from auth.users where email='${cells[1]}'),''),true);`;
  }).join('\n');
try {
  // auth.identities 由 Auth 管理；隔离事务用现有 schema 管理角色执行 DDL。
  // 不给应用、postgres 或 service_role 追加 auth schema 的所有权。
  execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: `begin; set local lock_timeout='5s'; set local statement_timeout='45s';
    select pg_advisory_xact_lock(hashtextextended('wechat-oauth-local',0));
    ${fs.readFileSync(candidate, 'utf8')}
    ${identities}
    ${fs.readFileSync(assertions, 'utf8')}
    rollback;`, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('WECHAT_DATABASE_CHECK_FAILED: inspect private database-error.txt');
} finally {
  if (fingerprint() !== before) throw new Error('WECHAT_ROLLBACK_INVARIANT_CHANGED');
}
const result = {
  checkedAt: new Date().toISOString(), candidateHash: textFileSha256(candidate), assertionsHash: textFileSha256(assertions),
  target: 'isolated-local', databaseAssertions: 'PASS', rollback: 'PASS', existingAccountsPreserved: true,
};
fs.writeFileSync(path.join(root, 'check.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result));
