// 固定账号 API 与页面启动检查；交互和视觉由产品负责人验收。
// node --experimental-strip-types scripts/verify-student-stage-workspace.mjs <local-dev-base-url>
import fs from 'node:fs';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const base = new URL(process.argv[2]);
if (base.protocol !== 'http:' || base.port !== '3130' || !['192.168.5.213', '127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('LOCAL_DEV_URL_REQUIRED');
const root = path.resolve('.tmp/student-stage-workspace');
fs.mkdirSync(root, { recursive: true });
openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
}));
const stages = ['awaiting_first_contact', 'awaiting_assessment', 'awaiting_enrollment', 'awaiting_renewal', 'former_student'];
const interfaceOnly = process.argv.includes('--interface');
const args = stage => ({ p_stage: stage, p_scope: 'all', p_search: '', p_page: 1, p_page_size: 100, p_detail: '' });
const counts = [];
for (const role of ['principal', 'teacher', 'student']) {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_DEVELOPMENT_ACCOUNT_REQUIRED');
  const cookies = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: items => items.forEach(({ name, value }) => cookies.set(name, value)) },
  });
  const { error } = await client.auth.signInWithPassword(account);
  if (error) throw new Error(`FIXED_LOGIN_FAILED:${role}:${error.code}`);
  try {
    if (role === 'student') {
      const result = await client.rpc('list_student_stage_workspace', args(stages[0]));
      if (!result.error || result.error.message !== 'FORBIDDEN') throw new Error('STUDENT_SCOPE_EXPOSED');
      if (interfaceOnly) {
        const assignment = await client.rpc('assign_student_stage_subjects', { p_subjects: [], p_staff_user_id: null });
        if (assignment.error?.message !== 'FORBIDDEN') throw new Error('STUDENT_ASSIGNMENT_EXPOSED');
      }
      console.log(JSON.stringify({ role, forbidden: 'PASS' })); continue;
    }
    const seen = new Set();
    for (const stage of interfaceOnly ? [] : role === 'principal' ? stages : [stages[0]]) {
      const started = performance.now();
      const { data, error } = await client.rpc('list_student_stage_workspace', args(stage));
      if (error) throw new Error(`STAGE_RPC_FAILED:${role}:${error.message}`);
      if (!Array.isArray(data.rows) || data.count !== (data.counts[stage] ?? 0)) throw new Error('STAGE_COUNT_MISMATCH');
      for (const row of data.rows) {
        if (row.stage !== stage || seen.has(row.key)) throw new Error('STAGE_IDENTITY_DUPLICATED');
        seen.add(row.key);
      }
      if (role === 'principal') counts.push({ stage, count: data.count, elapsedMs: Math.round(performance.now() - started) });
    }
    for (const locale of role === 'principal' ? ['zh', 'en'] : ['zh']) {
      for (const stage of role === 'principal' ? stages : [stages[0]]) {
        const route = `/${locale}/dashboard/students?stage=${stage}&scope=all`;
        const started = performance.now();
        const response = await fetch(new URL(route, base), { headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
          redirect: 'manual', signal: AbortSignal.timeout(45000) });
        const html = await response.text();
        if (response.status !== 200 || /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__/.test(html)
          || !(locale === 'zh' ? html.includes('历史学员') : html.includes('Former students'))) throw new Error(`PAGE_STARTUP_FAILED:${role}:${route}:${response.status}`);
        if (interfaceOnly) {
          const table = html.match(/<table\b[\s\S]*?<\/table>/)?.[0] ?? '';
          const head = table.match(/<thead\b[\s\S]*?<\/thead>/)?.[0] ?? '';
          if (/下次联系|Next contact/.test(head)) throw new Error('NEXT_CONTACT_COLUMN_RETURNED');
          if (['awaiting_first_contact','awaiting_assessment'].includes(stage) && /测评／学习|Assessment \/ learning/.test(head)) throw new Error('BACKGROUND_COLUMN_RETURNED');
          const expectedHeaders = ['awaiting_first_contact', 'awaiting_assessment'].includes(stage) ? 5 : 6;
          if ((head.match(/data-dashboard-table-menu/g) ?? []).length !== expectedHeaders || !html.includes('data-dashboard-search')
            || table.includes('data-student-stage-row') && !table.includes('data-followup-person')) throw new Error('SHARED_LIST_COMPONENT_MISSING');
          if (role === 'principal' && (!table.includes(locale === 'zh' ? '勾选本页' : 'Select this page')
            || table.includes('data-student-stage-row') && (!table.includes('data-followup-row-key') || !table.includes(locale === 'zh' ? 'aria-label="分配 · ' : 'aria-label="Assign · ')))) throw new Error('INLINE_ASSIGNMENT_MISSING');
        }
        console.log(JSON.stringify({ role, locale, stage, startup: 'PASS', elapsedMs: Math.round(performance.now() - started) }));
      }
    }
    if (interfaceOnly && role === 'principal') {
      const later = await client.rpc('list_student_stage_workspace', { ...args(stages[0]), p_page: 2 });
      if (later.error) throw new Error('LATER_PAGE_READ_FAILED');
      const sample = later.data.rows.find(row => row.name && row.phone);
      if (!sample) throw new Error('LATER_PAGE_SAMPLE_REQUIRED');
      const query = new URLSearchParams({ stage: stages[0], scope: 'all', fields: JSON.stringify({ version: 2,
        filters: { name: { kind: 'text', query: sample.name }, phone: { kind: 'text', query: sample.phone } }, sort: { field: 'name', direction: 'asc' } }) });
      const started = performance.now();
      const response = await fetch(new URL(`/zh/dashboard/students?${query}`, base), { headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
        redirect: 'manual', signal: AbortSignal.timeout(45000) });
      const html = await response.text();
      const table = html.match(/<table\b[\s\S]*?<\/table>/)?.[0] ?? '';
      if (response.status !== 200 || !table.includes(`data-student-stage-row="${sample.key}"`)) throw new Error('FULL_SCOPE_FIELD_FILTER_FAILED');
      console.log(JSON.stringify({ role, fullScopeFieldFilter: 'PASS', elapsedMs: Math.round(performance.now() - started) }));
    }
  } finally { await client.auth.signOut({ scope: 'local' }); }
}
fs.writeFileSync(path.join(root, interfaceOnly ? 'interface-http-check.json' : 'http-check.json'), JSON.stringify({ checkedAt: new Date().toISOString(), counts,
  startup: 'PASS', interfaceOnly, visualAcceptance: 'PENDING' }, null, 2), 'utf8');
console.log(JSON.stringify({ startup: 'PASS', ...(interfaceOnly ? { interface: 'PASS' } : { api: 'PASS', counts }), visualAcceptance: 'PENDING' }));
