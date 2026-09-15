import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {describe, expect, it, vi} from 'vitest';
import {loadStudentBusinessHistory} from '@/features/school/student-business-history-data';
import {businessSubjectKey} from '@/features/school/student-business-history-contract';
import {openHistoryLocalTarget} from '../scripts/lib/history-local-target.mjs';

const context=vi.hoisted(()=>({client:null as unknown as ReturnType<typeof createClient>}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireDashboardEnvironment:async()=>({})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>context.client}));
const enabled=process.env.MATHIN_HISTORY_READ_DB_TEST==='1';
describe.skipIf(!enabled)('local business workbench projection on existing data',()=>{
 it('preserves all enrollment and renewal rows with their display identities',async()=>{
  const root=path.resolve('.tmp/student-history-workbench-read');fs.mkdirSync(root,{recursive:true});
  const {observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});
  expect(observed.supabaseOrigin).toBe('http://127.0.0.1:35421');
  const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
  const accountFile=['.claude/test-accounts.local.md','../../.claude/test-accounts.local.md'].find(f=>fs.existsSync(f));
  if(!accountFile)throw Error('FIXED_LOCAL_ACCOUNT_DOCUMENT_REQUIRED');
  const password=fs.readFileSync(accountFile,'utf8').match(/统一密码[：:]\s*`([^`]+)`/)?.[1];
  if(!password)throw Error('FIXED_LOCAL_ACCOUNT_PASSWORD_REQUIRED');
  context.client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const login=await context.client.auth.signInWithPassword({email:'test-admin@mathin.local',password});
  expect(login.error?.name??null).toBeNull();
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const results=[];
  try {
   for(const kind of ['enrollment','renewal'] as const){
    const started=performance.now(),full=await loadStudentBusinessHistory('zh',{kind}),fullMs=performance.now()-started;
    const compactStarted=performance.now(),compact=await loadStudentBusinessHistory('zh',{kind,projection:'workbench'}),compactMs=performance.now()-compactStarted;
    if(!full||!compact)throw Error('FIXED_LOCAL_ADMIN_HISTORY_UNAVAILABLE');
    const key=kind==='enrollment'?'enrollments':'renewals';
    expect(digest(compact[key])).toBe(digest(full[key]));
    const identities=compact[key].map(row=>businessSubjectKey(row));
    const labels=(data:typeof full)=>identities.map(id=>[id,data.students[id],data.subjects[id]]);
    expect(digest(labels(compact))).toBe(digest(labels(full)));
    expect(compact.sources).toEqual({});expect(compact.communications).toEqual([]);
    results.push({kind,rows:compact[key].length,fullMs:Math.round(fullMs),compactMs:Math.round(compactMs),fullBytes:Buffer.byteLength(JSON.stringify(full)),compactBytes:Buffer.byteLength(JSON.stringify(compact)),rowsAndLabelsEqual:true});
   }
   fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({passed:true,results},null,2));
  }finally {await context.client.auth.signOut({scope:'local'});}
 },60000);
});
