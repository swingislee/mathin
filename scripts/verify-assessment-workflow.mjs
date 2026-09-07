// 仅做只读 API/页面启动检查；交互和视觉仍由产品负责人验收。
// Run: node --experimental-strip-types scripts/verify-assessment-workflow.mjs
import fs from 'node:fs';
import os from 'node:os';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf('='); return [line.slice(0,index),line.slice(index+1).trim().replace(/^(["'])(.*)\1$/, '$2')];
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
    const states = await client.from('assessment_workflow_states').select('id,revision,report:assessment_reports!assessment_workflow_states_report_id_fkey(id,version),recorder:profiles!assessment_workflow_states_updated_by_fkey(display_name)').limit(1);
    const reports = await client.from('assessment_reports').select('id,registration_id').limit(1);
    if (states.error || reports.error) throw new Error('WORKFLOW_API_CONTRACT_FAILED');
    const report = reports.data?.[0];
    const paths = process.argv.includes('--reports-only') ? [] : ['/dashboard/followups/assessments'];
    if (report) paths.push('/dashboard/followups/assessments/'+report.registration_id+'/reports/'+report.id);
    for (const locale of ['zh','en']) {
      for (const path of paths) {
        const response = await fetch(new URL('/'+locale+path,base), { redirect: 'manual',signal: AbortSignal.timeout(45000),
          headers: { cookie: [...cookies].map(([name,value]) => name+'='+value).join('; ') } });
        const html = await response.text();
        if (response.status !== 200 || /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__/.test(html)) throw new Error('PAGE_STARTUP_FAILED: '+role+'/'+locale+' HTTP '+response.status);
        console.log(JSON.stringify({ role,locale,page:path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g,':id'),status:response.status,scope:'authenticated startup; manual acceptance pending' }));
      }
      if (!report) {
        const path = '/'+locale+'/dashboard/followups/assessments/00000000-0000-4000-8000-000000000100/reports/00000000-0000-4000-8000-000000000200';
        const response = await fetch(new URL(path,base), { redirect:'manual',signal:AbortSignal.timeout(45000),
          headers:{ cookie:[...cookies].map(([name,value]) => name+'='+value).join('; ') } });
        const html = await response.text();
        const notFound = response.status === 404 || response.status === 200 && html.includes('NEXT_HTTP_ERROR_FALLBACK;404');
        if (!notFound || /MISSING_MESSAGE|schema cache/.test(html)) throw new Error('REPORT_NOT_FOUND_CONTRACT_FAILED: '+role+'/'+locale+' HTTP '+response.status);
        console.log(JSON.stringify({ role,locale,reportRoute:'PASS',httpStatus:response.status,semanticStatus:'NOT_FOUND' }));
      }
    }
    console.log(JSON.stringify({ role,api:'PASS',reportPage:report ? 'EXISTING_REPORT_CHECKED' : 'NO_REPORT_FIXTURES_CREATED' }));
  } finally { await client.auth.signOut({ scope:'local' }); }
}
