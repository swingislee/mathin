// 固定开发账号的 RPC 与页面启动检查；产品交互和视觉由负责人验收。
// node --experimental-strip-types scripts/verify-school-support-manual-entry.mjs <local-dev-url>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const base=new URL(process.argv[2]);
const localHosts=new Set(['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flatMap(items=>(items??[]).map(item=>item.address))]);
if(base.protocol!=='http:'||base.port!=='3130'||!localHosts.has(base.hostname))throw new Error('LOCAL_DEV_URL_REQUIRED');
const root=path.resolve('.tmp/school-support-manual-entry');fs.mkdirSync(root,{recursive:true});
openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{
  const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^(["'])(.*)\1$/,'$2')];
}));
const results=[];
for(const role of ['admin','teacher','student']) {
  const account=loadFixedAccount(role);if(!account)throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies=new Map();
  const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))},
  });
  const {error:loginError}=await client.auth.signInWithPassword(account);if(loginError)throw new Error(`FIXED_LOGIN_FAILED:${role}`);
  try {
    const search=await client.rpc('search_school_support_subjects',{p_search:'6000000'});
    if(role==='student') {
      if(search.error?.message!=='FORBIDDEN')throw new Error('STUDENT_SEARCH_EXPOSED');
      results.push({role,scope:'PASS'});continue;
    }
    if(search.error||!Array.isArray(search.data))throw new Error(`SUBJECT_SEARCH_FAILED:${role}`);
    for(const workspace of ['leads','communication','assessments','enrollments','renewals']) {
      const result=await client.rpc('list_school_support_work_items',{p_workspace:workspace});
      if(result.error||!Array.isArray(result.data))throw new Error(`WORK_LIST_FAILED:${role}:${workspace}`);
    }
    const routes=role==='admin'?['followups/leads','followups/communication','followups/assessments','followups/enrollments','followups/renewals','students']:['followups/communication','students'];
    for(const route of routes)for(const locale of role==='admin'?['zh','en']:['zh']) {
      const started=performance.now();
      const response=await fetch(new URL(`/${locale}/dashboard/${route}`,base),{headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(60000)});
      const html=await response.text();
      if(response.status!==200||/__next_error__|schema cache|MISSING_MESSAGE/.test(html)||!html.includes(locale==='zh'?'补入学生':'Add student'))
        throw new Error(`PAGE_STARTUP_FAILED:${role}:${locale}:${route}:${response.status}`);
      const result={role,locale,route,startup:'PASS',elapsedMs:Math.round(performance.now()-started)};results.push(result);console.log(JSON.stringify(result));
    }
  }finally{await client.auth.signOut({scope:'local'});}
}
fs.writeFileSync(path.join(root,'startup.json'),JSON.stringify({checkedAt:new Date().toISOString(),localTargetVerified:true,results},null,2),'utf8');
console.log(JSON.stringify({startup:'PASS',checks:results.length}));
