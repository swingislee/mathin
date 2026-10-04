// 固定开发账号的只读 RPC 与页面启动检查，交互和视觉由产品负责人验收。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const base=new URL(process.argv[2]);
const hosts=new Set(['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flatMap(items=>(items??[]).map(item=>item.address))]);
if(base.protocol!=='http:'||base.port!=='3130'||!hosts.has(base.hostname))throw new Error('LOCAL_DEV_URL_REQUIRED');
const root=path.resolve('.tmp/teacher-enrollment-placement-startup');fs.mkdirSync(root,{recursive:true});
openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{
  const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^(["'])(.*)\1$/,'$2')];
}));
const results=[];
const roles=process.argv[3]?.split(',')??['admin','teacher','student'];
if(!roles.length||roles.some(role=>!['admin','teacher','student'].includes(role)))throw new Error('FIXED_ROLES_REQUIRED');
for(const role of roles){
  const account=loadFixedAccount(role);if(!account)throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies=new Map();
  const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
  const {error}=await client.auth.signInWithPassword(account);if(error)throw new Error('FIXED_LOGIN_FAILED');
  try{
    const transfers=await client.rpc('get_enrollment_session_transfers');
    if(role==='student'){
      if(transfers.error?.message!=='FORBIDDEN')throw new Error('STUDENT_PLACEMENT_SCOPE_FAILED');
      results.push({role,scope:'PASS'});continue;
    }
    if(role==='teacher'){
      const access=await client.rpc('can_access_enrollment_placement');
      if(access.error)throw new Error('TEACHER_ACCESS_RPC_FAILED');
      if(access.data===false){
        if(transfers.error?.message!=='FORBIDDEN')throw new Error('UNASSIGNED_TEACHER_SCOPE_FAILED');
        for(const locale of ['zh','en']){
          const response=await fetch(new URL(`/${locale}/dashboard/followups/enrollments`,base),{headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(60000)});
          const html=await response.text();
          if(!((response.status===307||response.status===308)&&response.headers.get('location')===`/${locale}/dashboard`)
            &&!html.includes(`NEXT_REDIRECT;replace;/${locale}/dashboard;307;`))throw new Error(`UNASSIGNED_TEACHER_PAGE_SCOPE_FAILED:${locale}:${response.status}`);
        }
        results.push({role,scope:'PASS',pageRedirect:'PASS',authorizedPage:'NO_ELIGIBLE_TEACHING_CLASS_IN_FIXED_ACCOUNT'});
        continue;
      }
    }
    if(transfers.error||!Array.isArray(transfers.data))throw new Error(`SESSION_TRANSFERS_RPC_FAILED:${role}:${transfers.error?.code}:${transfers.error?.message}`);
    const {data:board,error:boardError}=await client.rpc('get_enrollment_placement_board');
    if(boardError||!Array.isArray(board?.members))throw new Error('PLACEMENT_BOARD_RPC_FAILED');
    if(role==='teacher' && (board.access?.canManageEnrollments!==false || !board.access.teacherClassroomIds.length))throw new Error('TEACHER_PLACEMENT_ENTRY_REQUIRED');
    let previewChecked=false;
    for(const member of board.members.filter(m=>m.status==='active')){
      const origin=board.options.classrooms.find(c=>c.id===member.classroomId);
      const target=origin&&board.options.classrooms.find(c=>c.id!==origin.id&&(role==='admin'||board.access.teacherClassroomIds.includes(origin.id)||board.access.teacherClassroomIds.includes(c.id))&&c.courseId===origin.courseId&&c.termId===origin.termId&&(c.capacity===null||c.capacity>0));
      if(!target)continue;
      const preview=await client.rpc('preview_enrollment_session_transfer',{p_membership_id:member.membershipId,p_to_classroom_id:target.id,p_seat:1});
      if(preview.error||!Array.isArray(preview.data))throw new Error('TRANSFER_PREVIEW_RPC_FAILED');
      const confirmedPreview=await client.rpc('preview_enrollment_session_transfer',{p_membership_id:member.membershipId,p_to_classroom_id:target.id,p_seat:1,p_allow_mismatch:true});
      if(confirmedPreview.error||!Array.isArray(confirmedPreview.data))throw new Error('CONFIRMED_TRANSFER_PREVIEW_RPC_FAILED');
      previewChecked=true;break;
    }
    if(!previewChecked&&role==='admin')throw new Error('EXISTING_TRANSFER_PREVIEW_CONTEXT_REQUIRED');
    results.push({role,placementBoard:'PASS',temporaryTransfers:'PASS',lecturePreview:previewChecked?'PASS':'NO_MATCHING_EXISTING_FIXTURE',confirmedPreview:previewChecked?'PASS':'NO_MATCHING_EXISTING_FIXTURE'});
    for(const locale of ['zh','en']){
      const response=await fetch(new URL(`/${locale}/dashboard/followups/enrollments`,base),{headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual',signal:AbortSignal.timeout(60000)});
      const html=await response.text();
      if(response.status!==200||/__next_error__|schema cache|MISSING_MESSAGE/.test(html)||!html.includes('data-slot="table"'))throw new Error(`PAGE_STARTUP_FAILED:${locale}:${response.status}`);
      results.push({role,locale,startup:'PASS'});
    }
  }finally{await client.auth.signOut({scope:'local'});}
}
fs.writeFileSync(path.join(root,`startup-${roles.join('-')}.json`),JSON.stringify({checkedAt:new Date().toISOString(),localTargetVerified:true,results},null,2),'utf8');
console.log(JSON.stringify({startup:'PASS',results}));
