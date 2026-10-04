import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { createWechatNextGateway, fixtureRequest, FixtureCookieJar, listenLoopback } from './lib/wechat-next-gateway.mjs';

const ensure = (value, label) => { if (!value) throw new Error(label); };
const repo = process.cwd(), root = path.resolve('.tmp/wechat-next'), project = path.join(root, 'app');
fs.mkdirSync(project, { recursive: true });
const { sql, docker } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const source = path.resolve('.tmp/wechat-auth-compat/auth-4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a');
ensure(textFileSha256(path.join(source, 'internal/api/identity.go')) === '4915e8774c69aac22372e541af06b07eaaf9ed2e57b19c70e0d7503e9e7c7c6f', 'VERIFIED_AUTH_PATCH_REQUIRED');
const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
const password = manifest.match(/统一密码[：:]\s*`([^`\r\n]+)`/)?.[1];
ensure(password, 'FIXED_PASSWORD_MANIFEST_REQUIRED');
const rows = manifest.split(/\r?\n/).map(line => line.split('|').slice(1, -1).map(cell => cell.replace(/[*_`]/g, '').trim()));
const accounts = [/^教师\s+staff\/teacher(?:\s|$)/, /^学生\s+student(?:\s|$)/].map(pattern => {
  const row = rows.find(row => pattern.test(row[0] ?? ''));
  ensure(row && /^[^@'\s]+@[^@'\s]+$/.test(row[1] ?? ''), 'FIXED_MANIFEST_REQUIRED');
  const id = sql(`begin read only; select id::text from auth.users where email='${row[1]}'; rollback;`);
  ensure(/^[0-9a-f-]{36}$/.test(id), 'FIXED_IDENTITY_REQUIRED');
  return { id, email: row[1] };
});
const auth = JSON.parse(docker(['inspect', 'supabase-auth']))[0];
const authEnv = Object.fromEntries(auth.Config.Env.map(entry => { const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)]; }));
const database = authEnv.GOTRUE_DB_DATABASE_URL, databaseUrl = new URL(database);
ensure(['db', 'supabase-db'].includes(databaseUrl.hostname) && databaseUrl.pathname === '/postgres' && auth.NetworkSettings.Networks['mathin-isolated-loopback'], 'LOCAL_AUTH_DATABASE_REQUIRED');
const fingerprint = () => sql(`begin isolation level repeatable read read only; select jsonb_build_object(
  'users',(select md5(string_agg(to_jsonb(u)::text,'|' order by id)) from auth.users u),
  'identities',(select md5(string_agg(to_jsonb(i)::text,'|' order by id)) from auth.identities i),
  'profiles',(select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from public.profiles p),
  'sessions',(select count(*) from auth.sessions),'refresh',(select count(*) from auth.refresh_tokens),
  'factors',(select count(*) from auth.mfa_factors),'flows',(select count(*) from auth.flow_state),
  'providers',(select count(*) from auth.custom_oauth_providers),'audits',(select count(*) from public.wechat_binding_audits)); rollback;`);
const before = fingerprint(), fixtureKey = crypto.randomBytes(32).toString('hex'), jwtSecret = crypto.randomBytes(32).toString('hex');
const jwt = role => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const value = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ role, iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 });
  return value + '.' + crypto.createHmac('sha256', jwtSecret).update(value).digest('base64url');
};
const certFile = path.join(root, 'cert.pem'), keyFile = path.join(root, 'key.pem');
execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'pipe', windowsHide: true });
const cert = fs.readFileSync(certFile);
const gateway = createWechatNextGateway({ key: fs.readFileSync(keyFile), cert, fixtureKey, ownerId: accounts[0].id, serviceKey: jwt('service_role') });
const gatewayPort = await listenLoopback(gateway.server);
const siteOrigin = `https://localhost:${gatewayPort}`, authOrigin = `https://127.0.0.1:${gatewayPort}`;
const reservation = net.createServer(), nextPort = await listenLoopback(reservation);
await new Promise(resolve => reservation.close(resolve));
gateway.connect(undefined, nextPort);
const files = [
  ...['broker', 'config', 'contract', 'provider', 'rate-limit', 'session', 'store'].map(name => `src/features/wechat/${name}.ts`),
  ...['server', 'config', 'server-transport', 'admin'].map(name => `src/lib/supabase/${name}.ts`),
  'src/lib/auth-return-origin.ts', 'src/lib/safe-redirect.ts', 'src/lib/database.types.ts',
  ...['authorize', 'callback', 'token', 'userinfo'].map(name => `src/app/[locale]/auth/wechat/${name}/route.ts`),
  'src/app/[locale]/auth/callback/route.ts',
];
for (const file of files) {
  const destination = path.join(project, file); fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}
fs.mkdirSync(path.join(project, 'src/app/fixture'), { recursive: true });
fs.copyFileSync('scripts/fixtures/wechat-next/route.ts', path.join(project, 'src/app/fixture/route.ts'));
fs.writeFileSync(path.join(project, 'src/app/layout.tsx'), 'export default function Layout({children}:{children:React.ReactNode}) { return <html><body>{children}</body></html>; }\n');
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'mathin-private-next-fixture', private: true }));
fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'esnext'], module: 'esnext', moduleResolution: 'bundler', esModuleInterop: true, skipLibCheck: true, jsx: 'react-jsx', paths: { '@/*': ['./src/*'] } }, include: ['src/**/*.ts', 'src/**/*.tsx'] }));
fs.writeFileSync(path.join(project, 'next.config.mjs'), 'export default { logging: { incomingRequests: { ignore: [/./] } }, experimental: { reactDebugChannel: false } };\n');
const preload = pathToFileURL(path.resolve('scripts/fixtures/wechat-next/preload.mjs')).href;
const nextEnv = {
  ...process.env, NODE_ENV: 'development', NODE_OPTIONS: `--import="${preload}"`, NODE_EXTRA_CA_CERTS: certFile,
  NEXT_PUBLIC_SUPABASE_URL: authOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon'), SUPABASE_SECRET_KEY: jwt('service_role'), SUPABASE_SERVER_URL: '',
  NEXT_PUBLIC_SITE_URL: siteOrigin, WECHAT_SITE_ORIGIN: siteOrigin, WECHAT_SUPABASE_PUBLIC_ORIGIN: authOrigin,
  WECHAT_OAUTH_ENABLED: 'true', WECHAT_AUTH_COMPATIBILITY_VERIFIED: 'true', WECHAT_PHONE_LINKING_VERIFIED: 'true',
  WECHAT_OPEN_PLATFORM_NAMESPACE: 'fixture', WECHAT_WEB_APP_ID: 'touristappid', WECHAT_WEB_APP_SECRET: fixtureKey, WECHAT_BROKER_CLIENT_SECRET: fixtureKey,
  MATHIN_NEXT_FIXTURE: '1', MATHIN_FIXTURE_GATEWAY: authOrigin, MATHIN_FIXTURE_CA: certFile, MATHIN_FIXTURE_KEY: fixtureKey,
  NEXT_TELEMETRY_DISABLED: '1',
};
const name = 'mathin-wechat-next-' + crypto.randomUUID(), log = fs.openSync(path.join(root, 'next.log'), 'w');
let child, started = false, passed = false, nativeOrigin;
const checks = [];
const request = async (url, jar, options = {}) => {
  url = new URL(url);
  ensure([siteOrigin, authOrigin].includes(url.origin), 'NEXT_FIXTURE_ORIGIN_MISMATCH');
  const response = await fixtureRequest(url, { ...options, ca: cert, headers: { ...options.headers, cookie: jar.header(url) } });
  jar.receive(url, response.headers['set-cookie']);
  return response;
};
const action = async (jar, input, origin = siteOrigin) => {
  const response = await request(siteOrigin + '/fixture', jar, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mathin-fixture': fixtureKey, origin }, body: JSON.stringify(input) });
  return { ...response, data: JSON.parse(response.body) };
};
const control = async command => {
  const response = await fixtureRequest(new URL('/fixture/' + command, nativeOrigin), { method: 'POST', headers: { 'x-mathin-fixture': fixtureKey }, rejectUnauthorized: false });
  ensure(response.status === 200, 'NATIVE_FIXTURE_CONTROL_FAILED');
  return JSON.parse(response.body);
};
function secureCookie(response, name) {
  const line = response.headers['set-cookie']?.find(line => line.startsWith(name + '='));
  ensure(line && /; secure/i.test(line) && /; httponly/i.test(line) && /; samesite=lax/i.test(line), 'NEXT_SECURE_COOKIE_MISSING');
}
async function follow(jar, destination, { stopAtCallback = false } = {}) {
  let scans = 0;
  for (let hop = 0; hop < 9; hop++) {
    const url = new URL(destination);
    if (url.origin === 'https://open.weixin.qq.com') {
      ensure(url.pathname === '/connect/qrconnect' && url.searchParams.get('redirect_uri') === siteOrigin + '/zh/auth/wechat/callback' && url.searchParams.get('scope') === 'snsapi_login', 'WECHAT_REQUEST_CONTRACT_FAILED');
      destination = siteOrigin + '/zh/auth/wechat/callback?' + new URLSearchParams({ state: url.searchParams.get('state'), code: gateway.code() });
      scans++;
      // 同一个微信 state 在另一个浏览器中不得被消费。
      const foreign = await request(destination, new FixtureCookieJar());
      ensure(foreign.headers.location?.includes('wechatError=expired'), 'FOREIGN_BROWSER_CALLBACK_ACCEPTED');
    } else if (/\/(?:zh|en)\/auth\/callback$/.test(url.pathname) && stopAtCallback) return { destination, scans };
    const response = await request(destination, jar);
    ensure(response.status === 303 || response.status === 302 || response.status === 307, 'NEXT_OAUTH_REDIRECT_FAILED');
    const location = response.headers.location;
    ensure(location, 'NEXT_OAUTH_LOCATION_MISSING');
    if (new URL(destination).origin === siteOrigin) {
      ensure(response.headers['cache-control']?.includes('no-store') && response.headers['referrer-policy'] === 'no-referrer', 'NEXT_PRIVATE_HEADERS_MISSING');
    }
    destination = new URL(location, destination).toString();
    const path = new URL(destination).pathname;
    if (path.endsWith('/guest') || path.includes('/dashboard') || path.endsWith('/login')) return { destination, response, scans };
  }
  throw new Error('NEXT_OAUTH_REDIRECT_LOOP');
}
try {
  child = spawn(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'dev', project, '--webpack', '--hostname', '127.0.0.1', '--port', String(nextPort)], { cwd: project, env: nextEnv, windowsHide: true, stdio: ['ignore', log, log] });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await request(siteOrigin + '/fixture', new FixtureCookieJar()); if (response.status === 200) { ready = true; break; } } catch { /* 等待隔离 Next 启动。 */ }
    if (child.exitCode !== null) break;
    await pause(500);
  }
  ensure(ready, 'NEXT_FIXTURE_NOT_READY');
  fs.copyFileSync('supabase/auth-compat/mathin_sdk_http_test.go', path.join(source, 'internal/api/mathin_sdk_http_test.go'));
  const fixtureEnv = {
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: database, GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_SITE_URL: siteOrigin, API_EXTERNAL_URL: authOrigin + '/auth/v1', GOTRUE_URI_ALLOW_LIST: siteOrigin + '/**',
    GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_SECURITY_MANUAL_LINKING_ENABLED: 'true', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_EXTERNAL_PHONE_ENABLED: 'true',
    MATHIN_LOCAL_AUTH_TX: '1', MATHIN_LOCAL_FIXED_USER_ID: accounts[0].id, MATHIN_FIXTURE_KEY: fixtureKey, MATHIN_NEXT_SITE_ORIGIN: siteOrigin,
  };
  const args = ['--context', 'desktop-linux', 'run', '--detach', '--name', name, '--network', 'mathin-isolated-loopback', '--publish', '127.0.0.1::9091',
    '--mount', `type=bind,source=${source},target=/source`, '--mount', `type=bind,source=${path.resolve('.tmp/wechat-auth-compat/go-mod')},target=/go/pkg/mod`,
    '--mount', `type=bind,source=${path.resolve('.tmp/wechat-auth-compat/go-build')},target=/root/.cache/go-build`, '--mount', `type=bind,source=${certFile},target=/next-fixture-ca.pem,readonly`, '--workdir', '/source'];
  for (const key of Object.keys(fixtureEnv)) args.push('-e', key);
  args.push('golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa', 'go', 'test', './internal/api', '-run', '^TestMathinWechatSDKRollback$', '-count=1', '-p=2', '-v', '-timeout=180s');
  execFileSync('docker.exe', args, { env: { ...process.env, ...fixtureEnv }, stdio: 'pipe', windowsHide: true }); started = true;
  const binding = docker(['port', name, '9091/tcp']); ensure(/^127\.0\.0\.1:\d+$/.test(binding), 'LOOPBACK_NATIVE_REQUIRED'); nativeOrigin = 'https://' + binding;
  gateway.connect(nativeOrigin, nextPort);
  ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await control('ready'); ready = true; break; } catch { /* 等待原生 Auth 编译。 */ }
    if (docker(['inspect', name, '--format', '{{.State.Running}}']) !== 'true') break;
    await pause(500);
  }
  ensure(ready, 'NATIVE_NEXT_FIXTURE_NOT_READY');
  for (const [kind, locale] of [['email', 'zh'], ['phone', 'en']]) {
    await control('start?kind=' + kind); gateway.reset();
    const beforeCase = await control('state'), guest = new FixtureCookieJar();
    const flow = { action: 'start', mode: 'login', locale, next: `/${locale}/dashboard` };
    const wrongOrigin = await action(guest, flow, 'https://foreign.example.invalid');
    ensure(wrongOrigin.status === 400 && gateway.tickets.size === 0, 'NEXT_CROSS_ORIGIN_START_ACCEPTED');
    const start = await action(guest, flow); ensure(start.status === 200 && start.data.url, 'NEXT_GUEST_START_FAILED'); secureCookie(start, 'mathin_wechat_flow');
    const anonymous = await follow(guest, start.data.url);
    ensure(anonymous.destination === siteOrigin + `/${locale}/auth/wechat/guest`, 'UNKNOWN_WECHAT_NOT_GUEST'); secureCookie(anonymous.response, 'mathin_wechat_guest');
    ensure((await action(guest, { action: 'guest' })).data.guest === true && (await action(guest, { action: 'context' })).data.id === null, 'GUEST_ACQUIRED_ACCOUNT_SESSION');
    ensure((await control('state')).users === beforeCase.users, 'NEXT_GUEST_CREATED_ACCOUNT');
    const credentials = { ...(kind === 'email' ? { email: accounts[0].email } : { phone: '+8613800000000' }), password };
    ensure((await action(guest, { action: 'password', credentials })).data.id === accounts[0].id, 'NEXT_PASSWORD_SESSION_FAILED');
    const scanned = gateway.observations.wechatRequests;
    const link = await action(guest, { ...flow, mode: 'link', identifier: kind === 'email' ? { email: accounts[0].email } : { phone: '+8613800000000' }, password });
    ensure(link.status === 200 && link.data.url, 'NEXT_LINK_START_FAILED');
    const linked = await follow(guest, link.data.url);
    ensure(linked.destination === siteOrigin + `/${locale}/dashboard/account-security?section=identities&wechatResult=linked`, 'NEXT_LINK_CALLBACK_FAILED');
    ensure(gateway.observations.wechatRequests === scanned, 'GUEST_PROOF_NOT_REUSED');
    ensure(gateway.snapshots.get(accounts[0].id)?.nickname === 'Synthetic WeChat', 'NEXT_SNAPSHOT_NOT_SAVED');
    ensure(!guest.header(new URL(siteOrigin)).includes('mathin_wechat_'), 'NEXT_TEMPORARY_COOKIES_NOT_CLEARED');
    ensure((await action(guest, { action: 'context' })).data.id === accounts[0].id, 'NEXT_LINK_CHANGED_ACCOUNT');

    const login = new FixtureCookieJar(), loginStart = await action(login, flow);
    const pending = await follow(login, loginStart.data.url, { stopAtCallback: true });
    const completed = await follow(login, pending.destination);
    ensure(completed.destination === siteOrigin + `/${locale}/dashboard` && (await action(login, { action: 'context' })).data.id === accounts[0].id, 'NEXT_EXISTING_WECHAT_LOGIN_FAILED');
    const exchanges = gateway.observations.exchanges;
    const replay = await request(pending.destination, login);
    ensure(replay.headers.location?.includes('wechatError=failed') && gateway.observations.exchanges === exchanges, 'NEXT_COMPLETION_REPLAY_EXCHANGED');
    const switched = new FixtureCookieJar(), switchedStart = await action(switched, flow);
    const stale = await follow(switched, switchedStart.data.url, { stopAtCallback: true });
    await action(switched, { action: 'password', credentials: { email: accounts[1].email, password } });
    const priorExchanges = gateway.observations.exchanges, denied = await request(stale.destination, switched);
    ensure(denied.headers.location?.includes('wechatError=failed') && gateway.observations.exchanges === priorExchanges, 'NEXT_SWITCHED_SESSION_ACCEPTED');
    await control('end');
    checks.push(kind + '_' + locale + '_guest_bind_login_cookie_pkce_replay_session');
    console.log(kind + ' Next HTTPS + native Auth: PASS');
  }
  await control('finish'); ensure(docker(['wait', name]) === '0', 'NEXT_NATIVE_ROLLBACK_FAILED');
  passed = true;
} finally {
  if (child?.pid && child.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true });
  fs.closeSync(log);
  gateway.server.closeAllConnections(); await new Promise(resolve => gateway.server.close(resolve));
  if (started) {
    try { fs.writeFileSync(path.join(root, 'native.log'), docker(['logs', name]), 'utf8'); }
    finally { docker(['rm', '--force', name]); }
  }
  ensure(fingerprint() === before, 'NEXT_AUTH_ROLLBACK_CHANGED');
  const receipt = { result: passed ? 'PASS' : 'FAIL', checks, rollback: 'PASS', next: 'actual-runtime-https', auth: 'native-rollback-transaction', rest: 'in-memory-fixture-sql-tested-separately', wechat: 'protocol-fixture', files: Object.fromEntries(files.map(file => [file, textFileSha256(file)])), checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ result: receipt.result, checks, rollback: receipt.rollback }));
}
