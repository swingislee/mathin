// 固定开发身份的只读 RPC 与 HTTP 启动检查；视觉和交互留待产品负责人验收。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { schoolCollaborationSchema } from '../src/features/school/school-collaboration-contract.ts';

const base=new URL(process.argv[2]);
const hosts=new Set(['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flatMap(items=>(items??[]).map(item=>item.address))]);
if(base.protocol!=='http:'||base.port!=='3130'||!hosts.has(base.hostname))throw new Error('LOCAL_DEV_URL_REQUIRED');
const root=path.resolve('.tmp/school-collaboration');fs.mkdirSync(root,{recursive:true});
openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{
  const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^(["'])(.*)\1$/,'$2')];
}));
const results=[];
for(const role of ['admin','teacher','student']){
  const account=loadFixedAccount(role);if(!account)throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies=new Map();
  const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))},
  });
  if((await client.auth.signInWithPassword(account)).error)throw new Error(`FIXED_LOGIN_FAILED:${role}`);
  try{
    const response=await client.rpc('read_school_collaboration_settings');
    if(role==='student'){
      if(response.error?.message!=='FORBIDDEN')throw new Error('STUDENT_SETTINGS_SCOPE');
      results.push({role,settingsScope:'PASS'});continue;
    }
    if(response.error)throw new Error(`SETTINGS_RPC_FAILED:${role}:${response.error.message}`);
    const settings=schoolCollaborationSchema.parse(response.data);
    if(settings.canManage!==(role==='admin')||role==='admin'&&settings.groups.length<3)throw new Error(`SETTINGS_CONTRACT:${role}`);
    for(const scope of ['mine','group']){
      const page=await client.rpc('list_student_records_page',{p_stage:'awaiting_first_contact',p_scope:scope,p_search:'',p_population:'records',p_page:1,p_page_size:20,p_query:{version:2,filters:{}},p_locale:'zh',p_labels:{}});
      if(page.error||!Array.isArray(page.data?.rows))throw new Error(`SCOPE_RPC_FAILED:${role}:${scope}:${page.error?.message}`);
      results.push({role,scope,rpc:'PASS'});
    }
    for(const locale of ['zh','en']){
      for(const route of ['students/groups','students?scope=group','followups/leads?scope=mine']){
        const response=await fetch(new URL(`/${locale}/dashboard/${route}`,base),{
          headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(60000),
        });
        const html=await response.text();
        if(response.status!==200||/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|"digest":"\d+"/.test(html))throw new Error(`PAGE_FAILED:${role}:${locale}:${route}:${response.status}`);
        if(route==='students/groups'&&!html.includes(locale==='zh'?'业务分组':'Business groups'))throw new Error(`GROUP_PAGE_CONTENT:${role}:${locale}`);
        results.push({role,locale,route,status:200});
      }
    }
  }finally{await client.auth.signOut({scope:'local'});}
}
fs.writeFileSync(path.join(root,'startup.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks:results},null,2),'utf8');
console.log(JSON.stringify({rpcScopes:'PASS',bilingualPages:'PASS',checks:results.length}));
