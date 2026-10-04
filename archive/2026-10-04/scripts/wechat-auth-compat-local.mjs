import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { normalizeNewlines, textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--baseline', '--patched'].includes(mode)) throw new Error('Use --baseline or --patched');
const commit = '4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a';
const root = path.resolve('.tmp/wechat-auth-compat');
const source = path.join(root, 'auth-' + commit);
if (!fs.existsSync(path.join(source, 'go.mod'))) throw new Error('PINNED_AUTH_SOURCE_REQUIRED: see auth-compat README');
const { sql, docker } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const rows = fs.readFileSync('.claude/test-accounts.local.md', 'utf8').split(/\r?\n/)
  .map(line => line.split('|').slice(1,-1).map(cell => cell.replace(/[*_`]/g,'').trim()));
const fixed = rows.find(row => /^教师\s+staff\/teacher(?:\s|$)/.test(row[0] ?? ''));
if (!fixed || !/^[^@'\s]+@[^@'\s]+$/.test(fixed[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
const userId = sql(`begin read only; select id::text from auth.users where email='${fixed[1]}'; rollback;`);
if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) throw new Error('FIXED_PASSWORD_ACCOUNT_REQUIRED');
const auth = JSON.parse(docker(['inspect', 'supabase-auth']))[0];
const authEnv = Object.fromEntries(auth.Config.Env.map(entry => { const i = entry.indexOf('='); return [entry.slice(0,i),entry.slice(i+1)]; }));
const database = authEnv.GOTRUE_DB_DATABASE_URL;
const target = new URL(database);
if (!['db','supabase-db'].includes(target.hostname) || target.pathname !== '/postgres' || !auth.NetworkSettings.Networks['mathin-isolated-loopback']) throw new Error('LOCAL_AUTH_TARGET_REQUIRED');
const fingerprint = () => sql(`begin read only; select jsonb_build_object('user',(select md5(to_jsonb(u)::text) from auth.users u where id='${userId}'), 'identities',(select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by id),'')) from auth.identities i where user_id='${userId}'), 'profile',(select md5(to_jsonb(p)::text) from public.profiles p where id='${userId}')); rollback;`);
const identityFile = path.join(source, 'internal/api/identity.go');
const originalFile = path.join(root, 'identity.original.go.txt');
if (!fs.existsSync(originalFile)) fs.copyFileSync(identityFile, originalFile);
const original = normalizeNewlines(fs.readFileSync(originalFile,'utf8'));
if (textFileSha256(originalFile) !== '651a202d5a9713637d1d0344eabb1a1ee9c637a57cc1f4fddbf7df8c7f9153ff') throw new Error('PINNED_IDENTITY_SOURCE_CHANGED');
const start = original.indexOf('\t\tif !userData.Metadata.EmailVerified {', original.indexOf('func (a *API) linkIdentityToUser'));
const end = original.indexOf('\n\n\t\tif targetUser.IsAnonymous', start);
if (start < 0 || end < start) throw new Error('PINNED_IDENTITY_BLOCK_CHANGED');
const replacement = '\t\tif targetUser.GetEmail() != "" {\n' + original.slice(start,end).split('\n').map(line => '\t'+line).join('\n') + '\n\t\t}';
const patched = original.slice(0,start) + replacement + original.slice(end);
fs.writeFileSync(identityFile, mode === '--patched' ? patched : original, 'utf8');
fs.copyFileSync('supabase/auth-compat/mathin_phone_link_test.go', path.join(source,'internal/api/mathin_phone_link_test.go'));
for (const dir of ['go-mod','go-build']) fs.mkdirSync(path.join(root,dir), { recursive: true });
const env = { ...process.env, GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: database, GOTRUE_JWT_SECRET: crypto.randomBytes(32).toString('hex'), GOTRUE_SITE_URL: 'http://localhost', API_EXTERNAL_URL: 'http://localhost', MATHIN_LOCAL_AUTH_TX: '1', MATHIN_LOCAL_FIXED_USER_ID: userId };
const containerName = 'mathin-wechat-auth-check-' + crypto.randomUUID();
const args = ['--context','desktop-linux','run','--rm','--name',containerName,'--network','mathin-isolated-loopback',
  '--mount',`type=bind,source=${source},target=/source`, '--mount',`type=bind,source=${path.join(root,'go-mod')},target=/go/pkg/mod`,
  '--mount',`type=bind,source=${path.join(root,'go-build')},target=/root/.cache/go-build`, '--workdir','/source'];
for (const key of ['GOTRUE_DB_DRIVER','GOTRUE_DB_DATABASE_URL','GOTRUE_JWT_SECRET','GOTRUE_SITE_URL','API_EXTERNAL_URL','MATHIN_LOCAL_AUTH_TX','MATHIN_LOCAL_FIXED_USER_ID']) args.push('-e',key);
args.push('golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa',
  'go','test','./internal/api','-run','^TestMathinPhoneOnlyIdentityLinkRollback$','-count=1','-p=2','-v','-timeout=90s');
const before = fingerprint();
console.log('Pinned Auth native regression: compiling; all database cases roll back.');
const result = spawnSync('docker.exe',args,{env,encoding:'utf8',windowsHide:true,timeout:600_000,maxBuffer:16*1024*1024});
const output = (result.stdout ?? '')+'\n'+(result.stderr ?? '');
fs.writeFileSync(path.join(root,mode.slice(2)+'.log'), output,'utf8');
// Docker 客户端超时不代表容器已退出；先停止本次唯一命名的 helper，让事务连接关闭。
if (result.error) {
  try { docker(['rm','--force',containerName]); }
  catch { throw new Error('AUTH_HELPER_CLEANUP_REQUIRED: inspect the private run log'); }
}
if (fingerprint() !== before) throw new Error('AUTH_FIXED_ACCOUNT_ROLLBACK_CHANGED');
const cases = Object.fromEntries([...output.matchAll(/--- (PASS|FAIL): TestMathinPhoneOnlyIdentityLinkRollback\/([a-z_]+) /g)].map(([,status,name]) => [name,status]));
const expected = {
  phone_without_email: mode === '--baseline' ? 'FAIL' : 'PASS',
  phone_without_email_verified_claim: mode === '--baseline' ? 'FAIL' : 'PASS',
  provider_verified_email: 'PASS', provider_unverified_email: 'PASS', existing_email_account: 'PASS',
};
const matched = !result.error && result.status === (mode === '--baseline' ? 1 : 0)
  && Object.keys(cases).length === Object.keys(expected).length
  && Object.entries(expected).every(([name,status]) => cases[name] === status);
const summary = { mode, upstream: 'v2.189.0', commit, exitCode: result.status, expectedResult: matched ? 'PASS' : 'FAIL', cases, rollback: 'PASS', originalHash: textFileSha256(originalFile), patchedHash: crypto.createHash('sha256').update(patched).digest('hex'), testHash: textFileSha256('supabase/auth-compat/mathin_phone_link_test.go') };
fs.writeFileSync(path.join(root,mode.slice(2)+'.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify(summary));
if (!matched) process.exit(1);
if (mode === '--patched') {
  let diff;
  try { diff = execFileSync('git',['diff','--no-index','--unified=0','--',originalFile,identityFile],{encoding:'utf8',stdio:['ignore','pipe','pipe']}); }
  catch (error) { if (error.status !== 1) throw new Error('PATCH_GENERATION_FAILED'); diff = String(error.stdout); }
  diff = diff.replace(/^diff --git .*\n/m,'diff --git a/internal/api/identity.go b/internal/api/identity.go\n')
    .replace(/^--- .*$/m,'--- a/internal/api/identity.go').replace(/^\+\+\+ .*$/m,'+++ b/internal/api/identity.go');
  fs.writeFileSync('supabase/auth-compat/v2.189.0-phone-only.patch',normalizeNewlines(diff),'utf8');
}
