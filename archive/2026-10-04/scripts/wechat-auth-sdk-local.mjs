import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const root = path.resolve('.tmp/wechat-auth-compat');
const source = path.join(root, 'auth-4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a');
if (textFileSha256(path.join(source,'internal/api/identity.go')) !== '4915e8774c69aac22372e541af06b07eaaf9ed2e57b19c70e0d7503e9e7c7c6f') throw new Error('VERIFIED_AUTH_PATCH_REQUIRED');
const { sql, docker } = openHistoryLocalTarget({ attestationPath: path.join(root,'preflight.json'), refresh: true, errorFile: path.join(root,'database-error.txt') });
if (sql("begin read only; select to_regclass('public.wechat_binding_audits') is not null; rollback;") !== 't') throw new Error('WECHAT_MIGRATION_REQUIRED');
const manifest = fs.readFileSync('.claude/test-accounts.local.md','utf8');
const fixedPassword = manifest.match(/统一密码[：:]\s*`([^`\r\n]+)`/)?.[1];
if (!fixedPassword) throw new Error('FIXED_PASSWORD_MANIFEST_REQUIRED');
const rows = manifest.split(/\r?\n/).map(line => line.split('|').slice(1,-1).map(cell => cell.replace(/[*_`]/g,'').trim()));
const accounts = [/^教师\s+staff\/teacher(?:\s|$)/,/^学生\s+student(?:\s|$)/].map(pattern => {
  const row = rows.find(row => pattern.test(row[0] ?? ''));
  if (!row || !/^[^@'\s]+@[^@'\s]+$/.test(row[1] ?? '') || !row[2]) throw new Error('FIXED_MANIFEST_REQUIRED');
  const id = sql(`begin read only; select id::text from auth.users where email='${row[1]}'; rollback;`);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('FIXED_IDENTITY_REQUIRED');
  return { id, email: row[1], password: fixedPassword };
});
const auth = JSON.parse(docker(['inspect','supabase-auth']))[0];
const authEnv = Object.fromEntries(auth.Config.Env.map(entry => { const i=entry.indexOf('='); return [entry.slice(0,i),entry.slice(i+1)]; }));
const database = authEnv.GOTRUE_DB_DATABASE_URL, target = new URL(database);
if (!['db','supabase-db'].includes(target.hostname) || target.pathname !== '/postgres' || !auth.NetworkSettings.Networks['mathin-isolated-loopback']) throw new Error('LOCAL_AUTH_DATABASE_REQUIRED');
const fingerprint = () => sql(`begin isolation level repeatable read read only; select jsonb_build_object(
  'users',(select md5(string_agg(to_jsonb(u)::text,'|' order by id)) from auth.users u),
  'identities',(select md5(string_agg(to_jsonb(i)::text,'|' order by id)) from auth.identities i),
  'profiles',(select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from public.profiles p),
  'sessions',(select count(*) from auth.sessions),'refresh',(select count(*) from auth.refresh_tokens),
  'factors',(select count(*) from auth.mfa_factors),'flows',(select count(*) from auth.flow_state),
  'providers',(select count(*) from auth.custom_oauth_providers),'audits',(select count(*) from public.wechat_binding_audits)); rollback;`);
const before = fingerprint(), fixtureKey = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(root,'sdk-before.json'),before+'\n','utf8');
fs.copyFileSync('supabase/auth-compat/mathin_sdk_http_test.go',path.join(source,'internal/api/mathin_sdk_http_test.go'));
const fixtureEnv = {
  GOTRUE_DB_DRIVER:'postgres', GOTRUE_DB_DATABASE_URL:database, GOTRUE_JWT_SECRET:crypto.randomBytes(32).toString('hex'),
  GOTRUE_JWT_AUD:'authenticated', GOTRUE_SITE_URL:'https://127.0.0.1:9091', API_EXTERNAL_URL:'https://127.0.0.1:9091/auth/v1',
  GOTRUE_URI_ALLOW_LIST:'https://127.0.0.1:9091/**', GOTRUE_DISABLE_SIGNUP:'true', GOTRUE_SECURITY_MANUAL_LINKING_ENABLED:'true',
  GOTRUE_EXTERNAL_EMAIL_ENABLED:'true', GOTRUE_EXTERNAL_PHONE_ENABLED:'true',
  MATHIN_LOCAL_AUTH_TX:'1', MATHIN_LOCAL_FIXED_USER_ID:accounts[0].id, MATHIN_FIXTURE_KEY:fixtureKey,
};
const env = { ...process.env, ...fixtureEnv };
const name = 'mathin-wechat-sdk-' + crypto.randomUUID();
const args = ['--context','desktop-linux','run','--detach','--name',name,'--network','mathin-isolated-loopback','--publish','127.0.0.1::9091',
  '--mount',`type=bind,source=${source},target=/source`, '--mount',`type=bind,source=${path.join(root,'go-mod')},target=/go/pkg/mod`,
  '--mount',`type=bind,source=${path.join(root,'go-build')},target=/root/.cache/go-build`, '--workdir','/source'];
for (const key of Object.keys(fixtureEnv)) args.push('-e',key);
args.push('golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa',
  'go','test','./internal/api','-run','^TestMathinWechatSDKRollback$','-count=1','-p=2','-v','-timeout=180s');
let origin, started = false, passed = false;
const checks = [];
const ensure = (value, label) => { if (!value) throw new Error(label); };
const transport = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
  if (url.origin === 'https://127.0.0.1:9091') url.host = new URL(origin).host;
  ensure(url.origin === origin,'FIXTURE_HTTP_ORIGIN_MISMATCH');
  // 自签名证书仅用于已核对的 loopback fixture；不影响应用或 SDK 的全局 TLS 设置。
  return new Promise((resolve,reject) => {
    const request = https.request(url,{method:init?.method ?? 'GET',headers:Object.fromEntries(new Headers(init?.headers).entries()),rejectUnauthorized:false},response => {
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,Array.isArray(value)?value.join(','):value]))})));
      response.on('error',reject);
    });
    request.on('error',reject);
    request.setTimeout(20_000,()=>request.destroy(new Error('FIXTURE_REQUEST_TIMEOUT')));
    request.end(init?.body);
  });
};
const control = async path => {
  const response = await transport(`${origin}/fixture/${path}`, { method:'POST', headers:{'X-Mathin-Fixture':fixtureKey} });
  ensure(response.ok, 'FIXTURE_CONTROL_FAILED_' + path.split('?')[0]);
  return response.json();
};
const client = () => {
  const values = new Map();
  return createClient(origin,'local-fixture-anon-key',{
    global:{fetch:transport}, auth:{flowType:'pkce',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'sdk-'+crypto.randomUUID(),
      storage:{getItem:key=>values.get(key) ?? null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);}}},
  });
};
const options = { redirectTo:'https://127.0.0.1:9091/complete',skipBrowserRedirect:true,queryParams:{mathin_flow:crypto.randomBytes(32).toString('hex')} };
function totp(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits=[...secret.replace(/=/g,'').toUpperCase()].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  const digest=crypto.createHmac('sha1',Buffer.from(bytes)).update(counter).digest();
  return ((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1_000_000).toString().padStart(6,'0');
}
async function flow(authClient, mode, expectFailure = false) {
  const start = mode === 'link' ? await authClient.auth.linkIdentity({provider:'custom:wechat',options}) : await authClient.auth.signInWithOAuth({provider:'custom:wechat',options});
  ensure(!start.error && start.data?.url,'SDK_OAUTH_START_FAILED');
  let destination = start.data.url, callback;
  for (let hop=0;hop<6;hop++) {
    const url = new URL(destination);
    if (url.pathname === '/complete') {
      const error = url.searchParams.get('error') || new URLSearchParams(url.hash.slice(1)).get('error');
      if (expectFailure) { ensure(error,'OAUTH_EXPECTED_REJECTION_MISSING'); return; }
      ensure(!error && url.searchParams.get('code'),'OAUTH_CALLBACK_FAILED');
      const code = url.searchParams.get('code');
      // 使用错误 verifier 请求真实 token endpoint，确认浏览器到 Auth 的 PKCE 也生效。
      const bad = await transport(`${origin}/auth/v1/token?grant_type=pkce`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:'x'.repeat(64)})});
      ensure(!bad.ok,'AUTH_PKCE_BYPASS');
      const result = await authClient.auth.exchangeCodeForSession(code);
      ensure(!result.error && result.data.user?.id === accounts[0].id,'SDK_ORIGINAL_ACCOUNT_EXCHANGE_FAILED');
      ensure(result.data.session?.access_token && result.data.session?.refresh_token,'SDK_SESSION_MISSING');
      const replay = await transport(callback,{redirect:'manual'});
      ensure(replay.status >= 300 && replay.status < 400 && !new URL(replay.headers.get('location')).searchParams.has('code'),'AUTH_CALLBACK_REPLAY_ACCEPTED');
      return result.data.user;
    }
    if (url.pathname === '/auth/v1/callback') callback = destination;
    const response = await transport(destination,{redirect:'manual'});
    ensure(response.status >= 300 && response.status < 400 && response.headers.get('location'),'OAUTH_REDIRECT_FAILED');
    destination = new URL(response.headers.get('location'),destination).toString();
  }
  throw new Error('OAUTH_REDIRECT_LOOP');
}
try {
  execFileSync('docker.exe',args,{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}); started = true;
  const binding = docker(['port',name,'9091/tcp']);
  ensure(/^127\.0\.0\.1:\d+$/.test(binding),'LOOPBACK_FIXTURE_REQUIRED'); origin = `https://${binding}`;
  let ready = false;
  for (let attempt=0;attempt<120;attempt++) {
    try { await control('ready'); ready=true; break; } catch { /* 等待一次编译和 fixture 启动。 */ }
    if (docker(['inspect',name,'--format','{{.State.Running}}']) !== 'true') break;
    await pause(500);
  }
  ensure(ready,'NATIVE_SDK_FIXTURE_NOT_READY');
  for (const kind of ['email','phone']) {
    await control('start?kind='+kind);
    const initial = await control('state'), account = accounts[0], owner = client();
    const credentials = { ...(kind === 'email' ? {email:account.email} : {phone:'+8613800000000'}),password:account.password };
    const password = await owner.auth.signInWithPassword(credentials);
    ensure(!password.error && password.data.user?.id === account.id,'SDK_PASSWORD_LOGIN_FAILED');
    const linked = await flow(owner,'link');
    ensure(linked.identities.some(identity=>identity.provider==='custom:wechat'),'SDK_LINK_IDENTITY_MISSING');
    ensure(kind !== 'phone' || !linked.email,'PHONE_ACCOUNT_ACQUIRED_EMAIL');
    const stranger = client(), other = await stranger.auth.signInWithPassword({email:accounts[1].email,password:accounts[1].password});
    ensure(!other.error && other.data.user?.id===accounts[1].id,'SDK_SECOND_FIXED_ACCOUNT_FAILED');
    await flow(stranger,'link',true);
    const login = client(); await flow(login,'login');
    const found = await login.auth.getUser(); ensure(!found.error && found.data.user?.id===account.id,'SDK_WECHAT_LOGIN_CHANGED_ACCOUNT');
    await control('ban'); await flow(client(),'login',true); await control('unban');
    const identity = found.data.user.identities.find(identity=>identity.provider==='custom:wechat');
    const unlink = await login.auth.unlinkIdentity(identity); ensure(!unlink.error,'SDK_UNLINK_FAILED');
    const afterPassword = await client().auth.signInWithPassword(credentials);
    ensure(!afterPassword.error && afterPassword.data.user?.id===account.id,'SDK_PASSWORD_AFTER_UNLINK_FAILED');
    if (kind==='email') {
      const mfa=client(); await mfa.auth.signInWithPassword(credentials);
      const enrolled=await mfa.auth.mfa.enroll({factorType:'totp',friendlyName:'transaction-only'});
      ensure(!enrolled.error && enrolled.data?.totp?.secret,'SDK_MFA_ENROLL_FAILED');
      const verified=await mfa.auth.mfa.challengeAndVerify({factorId:enrolled.data.id,code:totp(enrolled.data.totp.secret)});
      ensure(!verified.error,'SDK_MFA_VERIFY_FAILED');
      ensure((await mfa.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel==='aal2','SDK_MFA_AAL2_MISSING');
      await flow(mfa,'link');
      ensure((await mfa.auth.mfa.getAuthenticatorAssuranceLevel()).data?.nextLevel==='aal2','SDK_LINK_REMOVED_MFA_REQUIREMENT');
      const factors=await mfa.auth.mfa.listFactors();
      ensure(factors.data?.totp.some(factor=>factor.id===enrolled.data.id && factor.status==='verified'),'SDK_LINK_REMOVED_MFA_FACTOR');
      checks.push('mfa_verified_before_link_and_retained_after_oauth');
      // 此场景随后回滚；先结束以免 MFA 场景残留影响无身份注册断言。
      await control('end'); await control('start?kind=email');
    }
    await control('unknown'); await flow(client(),'login',true);
    const final = await control('state'); ensure(final.users===initial.users && final.identities===initial.identities,'SDK_CREATED_OR_LEFT_IDENTITY');
    await control('end');
    checks.push(kind+'_password_link_oauth_conflict_ban_unlink_unknown');
    console.log(kind + ' native Auth + Supabase SDK round trip: PASS');
  }
  await control('finish');
  const exitCode = docker(['wait',name]); ensure(exitCode==='0','NATIVE_HTTP_ROLLBACK_FAILED');
  passed = true;
} finally {
  if (started) {
    try { fs.writeFileSync(path.join(root,'sdk-http.log'),docker(['logs',name]),'utf8'); }
    finally { docker(['rm','--force',name]); }
  }
  ensure(fingerprint()===before,'SDK_DATABASE_ROLLBACK_CHANGED');
  const result = { result:passed?'PASS':'FAIL',checks,rollback:'PASS',goTestHash:textFileSha256('supabase/auth-compat/mathin_sdk_http_test.go'),runnerHash:textFileSha256('scripts/wechat-auth-sdk-local.mjs'),checkedAt:new Date().toISOString() };
  fs.writeFileSync(path.join(root,'sdk-http.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify(result));
}
