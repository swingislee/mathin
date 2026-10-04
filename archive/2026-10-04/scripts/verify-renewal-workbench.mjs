// 固定开发账号只读检查续报 API 和 zh/en 页面启动；产品视觉由人工验收。
// Run: node --experimental-strip-types scripts/verify-renewal-workbench.mjs
import fs from 'node:fs';
import os from 'node:os';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

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
    const results = await Promise.all([
      client.from('renewal_workbench_details').select('opportunity_id,revision,contact_method,seasons,paid_on,payment_method,updated_at').limit(1),
      client.from('teacher_professional_signals').select('student_id,source_class_membership_id,recommendation,occurred_at').limit(1),
      client.from('classroom_staff_assignments').select('classroom_id,profiles!classroom_staff_assignments_user_id_fkey(display_name)').eq('responsibility','primary_teacher').limit(1),
    ]);
    if (results.some(result => result.error)) throw new Error('RENEWAL_API_CONTRACT_FAILED');
    for (const locale of ['zh','en']) {
      const response = await fetch(new URL('/'+locale+'/dashboard/followups/renewals',base), { redirect:'manual',signal:AbortSignal.timeout(45000),
        headers: { cookie:[...cookies].map(([name,value]) => name+'='+value).join('; ') } });
      const html = await response.text();
      if (response.status !== 200 || /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__|NEXT_HTTP_ERROR_FALLBACK/.test(html)
        || !html.includes('data-renewal-workbench')) throw new Error('RENEWAL_PAGE_STARTUP_FAILED: '+role+'/'+locale+' HTTP '+response.status);
      console.log(JSON.stringify({role,locale,status:response.status,scope:'authenticated renewal startup; manual acceptance pending'}));
    }
    console.log(JSON.stringify({role,api:'PASS',businessWrites:false}));
  } finally { await client.auth.signOut({scope:'local'}); }
}
