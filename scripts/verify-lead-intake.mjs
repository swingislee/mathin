// 固定开发账号只读检查线索页启动，视觉与分配体验由用户验收。
// Run: node --experimental-strip-types scripts/verify-lead-intake.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mathin-lead-intake-'));
openHistoryLocalTarget({ refresh: true, attestationPath: path.join(temporary, 'preflight.json'), errorFile: path.join(temporary, 'database-error.txt') });
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf('='); return [line.slice(0,index),line.slice(index+1).trim().replace(/^("|')(.*)\1$/, '$2')];
  }));
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:35421') throw new Error('ISOLATED_LOCAL_SUPABASE_REQUIRED');
const base = new URL(process.env.MATHIN_VERIFY_BASE_URL || 'http://localhost:3130');
const localHosts = new Set(['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address)]);
if (!localHosts.has(base.hostname) || base.port !== '3130' || base.protocol !== 'http:') throw new Error('LOCAL_APP_REQUIRED');
for (const role of ['principal','teacher']) {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_ACCOUNT_UNAVAILABLE');
  const cookies = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })), setAll: items => items.forEach(({ name,value }) => cookies.set(name,value)) },
  });
  const { error } = await client.auth.signInWithPassword(account);
  if (error) throw new Error('FIXED_ACCOUNT_LOGIN_FAILED: '+(error.code || 'unknown'));
  try {
    for (const locale of ['zh','en']) {
      const query = role === 'principal' ? '?scope=unassigned' : '?scope=mine';
      const response = await fetch(new URL('/'+locale+'/dashboard/followups/leads'+query,base), { redirect:'manual',signal:AbortSignal.timeout(45000),
        headers: { cookie:[...cookies].map(([name,value]) => name+'='+value).join('; ') } });
      const html = await response.text();
      if (response.status !== 200 || /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__|NEXT_HTTP_ERROR_FALLBACK/.test(html)
        || !html.includes('data-dashboard-command-panel')) throw new Error('LEAD_INTAKE_STARTUP_FAILED: '+role+'/'+locale+' HTTP '+response.status);
      console.log(JSON.stringify({role,locale,status:response.status,worksheet:html.includes('data-lead-intake-workbench'),businessWrites:false}));
    }
  } finally { await client.auth.signOut({scope:'local'}); }
}
