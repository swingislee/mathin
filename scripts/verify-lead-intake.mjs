// 固定开发账号只读检查线索页启动；--followup-filters 检查五表，--assessment-fields 检查测评，--followup-completion 检查首联/测评/分班。
// Run: node --experimental-strip-types scripts/verify-lead-intake.mjs [--followup-filters | --assessment-fields | --followup-completion]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mathin-lead-intake-'));
const followupFilters = process.argv.includes('--followup-filters');
const assessmentFields = process.argv.includes('--assessment-fields');
const followupCompletion = process.argv.includes('--followup-completion');
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
      const routes = followupCompletion ? ['communication?view=all&scope=mine', 'assessments', ...(role === 'principal' ? ['enrollments'] : [])] : assessmentFields ? ['assessments'] : followupFilters ? [
        'leads?scope='+ (role === 'principal' ? 'unassigned' : 'mine'),
        'leads?scope='+ (role === 'principal' ? 'all' : 'mine') +'&assignment=assigned',
        'communication?view=all&scope=mine', 'assessments', 'renewals',
        ...(role === 'principal' ? ['enrollments'] : []),
      ] : ['leads?scope='+ (role === 'principal' ? 'unassigned' : 'mine')];
      for (const route of routes) {
        const response = await fetch(new URL('/'+locale+'/dashboard/followups/'+route,base), { redirect:'manual',signal:AbortSignal.timeout(45000),
          headers: { cookie:[...cookies].map(([name,value]) => name+'='+value).join('; ') } });
        const html = await response.text();
        if (response.status !== 200 || /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__|NEXT_HTTP_ERROR_FALLBACK/.test(html)
          || !html.includes('data-dashboard-command-panel') || ((followupFilters || assessmentFields || followupCompletion) && !html.includes('data-followup-primary-filter'))
          || (assessmentFields && !html.includes(locale === 'zh' ? '记录时间' : 'Record date'))
          || (followupFilters && !/data-followup-pagination="(?:true)?"[^>]*data-page-size="50"/.test(html))) {
          console.error(JSON.stringify({ status: response.status, marker: /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__|NEXT_HTTP_ERROR_FALLBACK/.exec(html)?.[0],
            commandPanel: html.includes('data-dashboard-command-panel'), primaryFilter: html.includes('data-followup-primary-filter'),
            pagination: html.match(/<div[^>]*data-followup-pagination[^>]*>/)?.[0] }));
          const stream = [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)].flatMap(match => {
            try { const chunk = JSON.parse(match[1]); return typeof chunk[1] === 'string' ? [chunk[1]] : []; } catch { return []; }
          }).join('');
          for (const line of stream.split('\n')) if (/^[\da-f]+:E\{/.test(line)) {
            const error = JSON.parse(line.slice(line.indexOf(':E') + 2));
            console.error(JSON.stringify({ message: error.message, stack: error.stack }));
          }
          const errorScript = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
          if (errorScript) {
            const error = JSON.parse(errorScript).err;
            if (error) console.error(JSON.stringify({ message: error.message, stack: error.stack }));
          }
          throw new Error('FOLLOWUP_STARTUP_FAILED: '+role+'/'+locale+'/'+route+' HTTP '+response.status);
        }
        console.log(JSON.stringify({role,locale,route,status:response.status,worksheet:html.includes('data-lead-intake-workbench'),
          primaryFilter:html.includes('data-followup-primary-filter'),defaultPageSize:followupFilters ? 50 : undefined,businessWrites:false}));
      }
    }
  } finally { await client.auth.signOut({scope:'local'}); }
}
