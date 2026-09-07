// 固定开发身份读取集成；不登记联系、报名或测评事实。
import fs from 'node:fs';
import path from 'node:path';
import {createServerClient} from '@supabase/ssr';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
const root=path.resolve('.tmp/base-authority-cleanup-20260908');
openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{
  const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).trim().replace(/^(["'])(.*)\1$/,'$2')];
}));
const stages=['awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student'];
const result=[];
const remaining=process.argv.includes('--remaining');
for(const role of ['principal','teacher','student']) {
  const account=loadFixedAccount(role);if(!account)throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies=new Map();const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(item=>cookies.set(item.name,item.value))}});
  if((await client.auth.signInWithPassword(account)).error)throw new Error(`FIXED_LOGIN_FAILED:${role}`);
  try {
    const args=stage=>({p_stage:stage,p_scope:'all',p_search:'',p_page:1,p_page_size:20,p_detail:''});
    if(role==='student') {
      const denied=await client.rpc('list_student_stage_workspace',args(stages[0]));
      if(denied.error?.message!=='FORBIDDEN')throw new Error('STUDENT_STAGE_EXPOSED');
      const privateScope=await client.from('history_workflow_scopes').select('*').limit(1);
      if(!privateScope.error)throw new Error('PRIVATE_SCOPE_EXPOSED');
      const leads=await client.from('operational_leads').select('id').limit(1);
      if(!leads.error&&leads.data.length)throw new Error('STUDENT_LEAD_EXPOSED');
      result.push({role,permission:'PASS'});continue;
    }
    for(const stage of role==='principal'?(remaining?[]:stages):[stages[0]]) {
      const started=performance.now();const response=await client.rpc('list_student_stage_workspace',args(stage));
      if(response.error)throw new Error(`STAGE_READ:${role}:${response.error.code}:${response.error.message}`);
      if(response.data.count!==(response.data.counts[stage]??0)||response.data.rows.some(row=>row.stage!==stage))throw new Error('ROW_STAGE_COUNT_MISMATCH');
      result.push({role,stage,count:response.data.count,elapsedMs:Math.round(performance.now()-started)});
    }
    const queries=[['operational_leads','id,student_id'],['operational_students','id'],
      ['business_activities','id,record_state'],['business_activity_registrations','*,activities!inner(id,title,kind,occurred_on)'],
      ['business_assessment_results','*,activity_registrations!inner(activities!inner(deleted_at))'],
      ['business_course_enrollments','*,course_enrollment_assignments(*)'],['business_course_opportunities','*'],['business_student_follow_ups','*']];
    for(const [relation,columns] of role==='principal'&&remaining?[]:queries) {
      const response=await client.from(relation).select(columns).limit(1);
      if(response.error)throw new Error(`VIEW_READ:${role}:${relation}:${response.error.code}:${response.error.message}`);
    }
    for(const name of role==='principal'&&remaining?[]:['get_post_activity_followups','get_enrollment_placement_board']) {
      const response=await client.rpc(name);if(response.error&&!(role==='teacher'&&response.error.message==='FORBIDDEN'))throw new Error(`RPC_READ:${role}:${name}:${response.error.code}:${response.error.message}`);
    }
    if(role==='principal')for(const route of [...(remaining?[]:['/zh/dashboard/students?scope=all','/en/dashboard/students?scope=all',
      '/zh/dashboard/followups/leads']),'/zh/dashboard/followups/assessments','/zh/dashboard']) {
      const response=await fetch(`http://127.0.0.1:3130${route}`,{headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(45000)});
      const html=await response.text();fs.writeFileSync(path.join(root,'last-page.html'),html);
      if(response.status!==200||/Could not find|schema cache|MISSING_MESSAGE|__next_error__/.test(html))throw new Error(`PAGE_STARTUP:${route}:${response.status}`);
      result.push({route,status:'PASS'});console.log(JSON.stringify({route,status:'PASS'}));
    }
    result.push({role,viewsAndRpcs:'PASS'});
  } finally {await client.auth.signOut({scope:'local'});}
}
fs.writeFileSync(path.join(root,'api-postflight.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
