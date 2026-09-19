// 固定开发身份的只读 HTTP 检查；保存与下一位由 jsdom 合同验证。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const output = path.join(os.tmpdir(), 'mathin-student-directory');
const { observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), errorFile: path.join(output, 'database-error.txt') });
const origin = process.env.PLAYWRIGHT_BASE_URL;
const localHosts = new Set(['localhost', '127.0.0.1', os.hostname().toLowerCase(), ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address)]);
if (!origin || new URL(origin).protocol !== 'http:' || new URL(origin).port !== '3130' || !localHosts.has(new URL(origin).hostname)) throw new Error('LOCAL_APP_ORIGIN_REQUIRED');
const localEnv = fs.readFileSync('.env.local', 'utf8');
const publicKey = localEnv.match(/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
if (!publicKey) throw new Error('LOCAL_PUBLIC_KEY_REQUIRED');
const anonymous = await fetch(`${origin}/zh/dashboard/students`, { redirect: 'manual', signal: AbortSignal.timeout(45000) });
if (![302,303,307,308].includes(anonymous.status) || !anonymous.headers.get('location')?.includes('/zh/login')) throw new Error('DIRECTORY_ANONYMOUS_GUARD');
for (const role of ['principal', 'teacher', 'student']) {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies = new Map();
  const client = createServerClient(observed.supabaseOrigin, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })), setAll: items => items.forEach(({name,value}) => cookies.set(name,value)) },
  });
  if ((await client.auth.signInWithPassword(account)).error) throw new Error(`FIXED_LOGIN_FAILED:${role}`);
  try {
    const scope = role === 'teacher' ? 'mine' : 'all';
    const data = await client.rpc('list_student_directory', { p_scope: scope, p_page_size: 20 });
    if (role === 'student') {
      if (data.error?.message !== 'FORBIDDEN') throw new Error('DIRECTORY_STUDENT_ACCESS');
      console.log('student: directory denied PASS'); continue;
    }
    if (data.error || !data.data?.rows?.length) throw new Error(`DIRECTORY_RPC:${role}:${data.error?.code ?? 'EMPTY_FIXED_DATA'}`);
    const selectedIds = data.data.rows.filter(row => row.canWrite).slice(0,2).map(row => row.studentId);
    if (!selectedIds.length) throw new Error(`DIRECTORY_SELECTABLE_FIXED_DATA_REQUIRED:${role}`);
    const chosen = new URLSearchParams({ students: selectedIds.join(','), returnTo: '/dashboard/students?groupBy=grade&scope=mine' });
    const pages = [
      ['directory-zh', '/zh/dashboard/students', 'data-student-directory'],
      ['directory-en', '/en/dashboard/students?groupBy=grade', 'data-student-directory'],
      ['selected-zh', `/zh/dashboard/communication?${chosen}`, '选定学生'],
      ['selected-en', `/en/dashboard/communication?${chosen}`, 'Selected students'],
      ['communication', '/zh/dashboard/communication?pageSize=20', 'data-followup-workbench'],
      ['invalid-selection', '/zh/dashboard/communication?students=invalid', '选定名单无效'],
    ];
    for (const [label, route, marker] of pages) {
      if (process.argv.includes('--directory-only') && !label.startsWith('directory-')) continue;
      const started = performance.now();
      const response = await fetch(`${origin}${route}`, { headers: { cookie: [...cookies].map(([name,value]) => `${name}=${value}`).join('; ') }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
      const html = await response.text();
      if (response.status !== 200 || !html.includes(marker) || /__next_error__|MISSING_MESSAGE|ZodError|canceling statement|statement timeout|schema cache/.test(html)) {
        fs.writeFileSync(path.join(output, 'last-page.html'), html, 'utf8');
        throw new Error(`DIRECTORY_PAGE:${role}:${label}:${response.status}`);
      }
      if (label === 'directory-zh' && !html.replaceAll('\\"','"').includes(`"scope":"${scope}"`)) throw new Error(`DIRECTORY_DEFAULT_SCOPE:${role}`);
      if (label.startsWith('selected-') && (html.includes('data-followup-pagination') || !html.includes('data-student-stage-row'))) throw new Error(`DIRECTORY_SELECTION_MODE:${role}`);
      console.log(`${role} ${label}: PASS (${Math.round(performance.now()-started)} ms)`);
    }
  } finally { await client.auth.signOut({ scope: 'local' }); }
}
