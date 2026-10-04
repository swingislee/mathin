import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

// 只接受与 schema 检查相同的本机 attestation；固定账号仅在内存登录。
const output = path.resolve('.tmp/cube-account-drafts');
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), errorFile: path.join(output, 'database-error.txt') });
const localEnv = fs.readFileSync('.env.local', 'utf8');
const env = (key) => localEnv.match(new RegExp(`^${key}\\s*=\\s*["']?([^\\r\\n"']+)`, 'm'))?.[1]?.trim();
assert.equal(new URL(env('NEXT_PUBLIC_SUPABASE_URL')).origin, observed.supabaseOrigin);
const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
const password = manifest.match(/\*\*统一密码：`([^`]+)`\*\*/)?.[1];
assert.ok(password, 'Fixed-account password missing');
for (const email of ['test-teacher@mathin.local', 'test-sales@mathin.local']) assert.ok(manifest.includes(email), 'Fixed account missing from manifest');
const appOrigin = 'http://192.168.5.213:3130';
const endpoint = `${appOrigin}/api/tools/cube-structures/drafts`;
const clients = [];
async function login(email) {
  const jar = new Map();
  const client = createServerClient(observed.supabaseOrigin, env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { autoRefreshToken: false }, cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => { for (const item of items) jar.set(item.name, item.value); },
    },
  });
  clients.push(client);
  const result = await client.auth.signInWithPassword({ email, password });
  assert.equal(result.error, null, 'Fixed-account login failed');
  assert.match(result.data.user.id, /^[0-9a-f-]{36}$/);
  return { id: result.data.user.id, client, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
}
async function call(account, { id, body, expected = 200, accountHeader = account.id } = {}) {
  const response = await fetch(`${endpoint}${id ? `?id=${id}` : ''}`, {
    method: body ? 'POST' : 'GET', headers: { Cookie: account.cookie(), Origin: appOrigin, 'x-cube-account': accountHeader,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, expected, `Unexpected draft API HTTP status ${response.status}`);
  assert.match(response.headers.get('cache-control'), /no-store/);
  return response.json();
}
const draftId = randomUUID();
const name = `cube-draft-http-check-${draftId.slice(0, 8)}`;
const snapshot = { version: 'cube-structures-saved-draft-v1', identity: 0, session: { recording: 'off', preview: null, lesson: null,
  work: { version: 'cube-structures-draft-v3', cursor: 0, operations: [], initial: { cubes: [], groups: [], hiddenCubeIds: [], origin: null,
    axesVisible: true, view: 'angle', frame: { center: { x: 0, y: 0, z: 0 }, radius: 1 }, nextCubeId: 1, nextNumber: 1, hiddenEdgesVisible: true } } } };
let owner;
try {
  const accounts = await Promise.all([login('test-teacher@mathin.local'), login('test-teacher@mathin.local'), login('test-sales@mathin.local')]);
  owner = accounts[0]; const secondDevice = accounts[1]; const other = accounts[2];
  assert.equal(owner.id, secondDevice.id); assert.notEqual(owner.id, other.id);
  assert.equal(sql(`begin read only; select count(*) from public.cube_structure_drafts where id='${draftId}'; commit;`), '0');
  assert.equal((await call(owner)).accountId, owner.id);
  const first = await call(owner, { body: { id: draftId, name, snapshot, expectedRevision: 0 } });
  assert.equal(first.data.revision, 1);
  assert.ok((await call(secondDevice)).data.some(draft => draft.id === draftId));
  assert.deepEqual((await call(secondDevice, { id: draftId })).data.snapshot, snapshot);
  const nextSnapshot = { ...snapshot, identity: 7 };
  const update = await call(secondDevice, { body: { id: draftId, name, snapshot: nextSnapshot, expectedRevision: 1 } });
  assert.equal(update.data.revision, 2);
  if (process.argv.includes('--diagnose-conflict')) {
    const started = Date.now();
    const result = await owner.client.rpc('save_cube_structure_draft', { p_id: draftId, p_name: name, p_snapshot: snapshot, p_expected_revision: 1 }).abortSignal(AbortSignal.timeout(8000));
    console.log(JSON.stringify({ conflictDiagnostic: true, status: result.status, code: result.error?.code, milliseconds: Date.now() - started }));
    assert.equal(result.error?.message, 'CUBE_DRAFT_CONFLICT');
  }
  assert.equal((await call(owner, { body: { id: draftId, name, snapshot, expectedRevision: 1 }, expected: 409 })).code, 'conflict');
  assert.equal((await call(owner, { id: draftId })).data.snapshot.identity, 7);
  assert.equal((await call(other, { id: draftId, expected: 404 })).code, 'missing');
  assert.equal((await call(other, { body: { id: draftId, name, snapshot, expectedRevision: 2 }, expected: 404 })).code, 'missing');
  assert.equal((await call(other, { accountHeader: owner.id, expected: 409 })).code, 'account-changed');
  console.log('LAN HTTP: same-account independent-session save/list/reopen/update, stale-version retention, foreign-account denial and account-switch guard: PASS');
} finally {
  if (owner) {
    // 只清理本次随机 ID + 固定账号 + 精确名称共同确定的验证草稿。
    const removed = sql(`begin; delete from public.cube_structure_drafts where id='${draftId}' and owner_id='${owner.id}' and name='${name}' returning id; commit;`);
    assert.ok(removed === '' || removed === draftId, 'Unexpected cleanup target');
    assert.equal(sql(`begin read only; select count(*) from public.cube_structure_drafts where id='${draftId}'; commit;`), '0');
    console.log('Temporary verification draft removed; existing drafts and business data retained.');
  }
  await Promise.all(clients.map(client => client.auth.signOut({ scope: 'local' })));
}
