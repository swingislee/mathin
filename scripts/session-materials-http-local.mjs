import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const output = path.resolve('.tmp/session-materials');
fs.mkdirSync(output, { recursive: true });
openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), errorFile: path.join(output, 'database-error.txt') });
loadEnvFile('.env.local');
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:35421') throw new Error('LOCAL_ORIGIN_REQUIRED');
async function signIn(role) {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_ACCOUNT_REQUIRED');
  const jar = new Map();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => { for (const { name, value } of values) jar.set(name, value); } },
  });
  if ((await client.auth.signInWithPassword(account)).error) throw new Error('FIXED_ACCOUNT_SIGNIN_FAILED');
  return { client, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
}
const teacher = await signIn('teacher');
const classes = await teacher.client.rpc('list_classrooms_for_scope', { p_scope: 'teaching', p_filters: { purpose: 'test' }, p_page: 1 });
if (classes.error || !classes.data?.length) throw new Error('FIXED_TEACHER_CLASSROOM_REQUIRED');
const sessions = await teacher.client.from('class_sessions').select('id,classroom_id').in('classroom_id', classes.data.map(row => row.id)).is('deleted_at', null).is('voided_at', null).is('cancelled_by', null).limit(1);
if (sessions.error || !sessions.data?.length) throw new Error('FIXED_TEACHER_SESSION_REQUIRED');
const input = { sessionId: sessions.data[0].id, classroomId: sessions.data[0].classroom_id };
const results = [];
async function check(role, account, locale, kind, expected = 200) {
  const response = await fetch(`http://127.0.0.1:3130/${locale}/dashboard/classes/session-materials`, {
    method: 'POST', headers: { cookie: account.cookie(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, kind }), redirect: 'manual', signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json();
  const valid = response.status === expected && response.headers.get('cache-control') === 'private, no-store' && (expected === 200 ? payload.kind === kind : payload.code === 'FORBIDDEN');
  const result = { role, locale, kind, status: response.status, valid };
  results.push(result); console.log(JSON.stringify(result));
  if (!valid) throw new Error('LOCAL_MATERIAL_HTTP_CONTRACT_FAILED');
}
const supervisor = await signIn('principal');
for (const locale of ['zh', 'en']) {
  for (const kind of ['summary', 'lesson_plan', 'solution', 'rehearsal_video', 'courseware']) await check('supervisor', supervisor, locale, kind);
  const response = await fetch(`http://127.0.0.1:3130/${locale}/dashboard/classes?scope=all&purpose=test`, { headers: { cookie: supervisor.cookie() }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  const rendered = (await response.text()).includes('data-class-roster');
  results.push({ role: 'supervisor', locale, page: 'classes', status: response.status, rendered });
  console.log(JSON.stringify(results.at(-1)));
  if (response.status !== 200 || !rendered) throw new Error('LOCAL_CLASS_PAGE_CONTRACT_FAILED');
}
await check('teacher', teacher, 'zh', 'lesson_plan');
await check('student', await signIn('student'), 'zh', 'lesson_plan', 403);
fs.writeFileSync(path.join(output, 'http-check.json'), JSON.stringify(results, null, 2), 'utf8');
