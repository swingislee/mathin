// 复用固定开发身份验证只读 RPC 和页面启动，视觉与业务由产品负责人验收。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { schoolRecordHintsSchema, schoolRecordContextSchema } from '../src/features/school/school-record-review-contract.ts';

const base = new URL(process.argv[2]);
const hosts = new Set(['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flatMap(items => (items ?? []).map(item => item.address))]);
if (base.protocol !== 'http:' || base.port !== '3130' || !hosts.has(base.hostname)) throw new Error('LOCAL_DEV_URL_REQUIRED');
const root = path.resolve('.tmp/school-record-review'); fs.mkdirSync(root,{recursive:true});
openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const at=line.indexOf('='); return [line.slice(0,at),line.slice(at+1).trim().replace(/^(["'])(.*)\1$/,'$2')];
}));
const results = [];
for (const role of ['admin','teacher','student']) {
  const account = loadFixedAccount(role); if (!account) throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))},
  });
  if ((await client.auth.signInWithPassword(account)).error) throw new Error(`FIXED_LOGIN_FAILED:${role}`);
  try {
    if (role === 'student') {
      const result = await client.rpc('read_school_record_hints',{p_subjects:[]});
      if (result.error?.message !== 'FORBIDDEN') throw new Error('NONSTAFF_SCOPE');
      results.push({role,nonstaffDenied:true}); continue;
    }
    const page = await client.rpc('list_student_records_page',{p_stage:'awaiting_first_contact',p_scope:role==='admin'?'all':'mine',
      p_search:'',p_population:'records',p_page:1,p_page_size:20,p_query:{version:2,filters:{}},p_locale:'zh',p_labels:{}});
    if (page.error || !Array.isArray(page.data?.rows)) throw new Error(`RECORD_PAGE_FAILED:${role}:${page.error?.message}`);
    const subjects = page.data.rows.map(row=>({studentId:row.studentId,leadId:row.leadId}));
    const started=Date.now();
    const hints = await client.rpc('read_school_record_hints',{p_subjects:subjects});
    if (hints.error) throw new Error(`HINT_RPC_FAILED:${role}:${hints.error.message}`);
    const parsed=schoolRecordHintsSchema.parse(hints.data);
    let sourceCount=0, sourceCells=0;
    for(const subject of subjects.slice(0,5)) {
      const context=await client.rpc('read_school_record_source_context',{p_student_id:subject.studentId,p_lead_id:subject.leadId,p_page:1});
      if(context.error) throw new Error(`SOURCE_RPC_FAILED:${role}:${context.error.message}`);
      const data=schoolRecordContextSchema.parse(context.data);sourceCount+=data.sourceCount;sourceCells+=data.sources.reduce((total,row)=>total+row.cells.length,0);
      if(sourceCount>0)break;
    }
    results.push({role,hints:parsed.length,sourceCount,sourceCells,rpcMs:Date.now()-started});
    console.log(JSON.stringify({role,readContracts:'PASS',sourceCount,sourceCells}));
    for (const locale of ['zh','en']) {
      for (const route of ['students?scope=mine','followups/leads?scope=mine','followups/communication?scope=mine']) {
        const response=await fetch(new URL(`/${locale}/dashboard/${route}`,base),{
          headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(60000),
        });
        const html=await response.text();
        if(response.status!==200||/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|"digest":"\d+"/.test(html))throw new Error(`PAGE_FAILED:${role}:${locale}:${route}:${response.status}`);
        results.push({role,locale,route,status:200});console.log(JSON.stringify({role,locale,route,status:200}));
      }
    }
  } finally { await client.auth.signOut({scope:'local'}); }
}
fs.writeFileSync(path.join(root,'startup.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks:results},null,2),'utf8');
console.log(JSON.stringify({readContracts:'PASS',bilingualPages:'PASS',checks:results.length}));
