import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";

const context=vi.hoisted(()=>({client:null as unknown as ReturnType<typeof createClient>,legacy:false}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>context.client}));
vi.mock("@/features/school/assessment-workbench-read",async importOriginal=>{
  const current=await importOriginal<typeof import("@/features/school/assessment-workbench-read")>();
  type Query=Parameters<typeof current.readAllAssessmentRows>[0];
  async function legacyAll<T>(query:Query) {
    const data:T[]=[];
    for(let offset=0;;offset+=200) {
      const result=await query().order("id",{ascending:true}).range(offset,offset+199).returns<T[]>();
      if(result.error)return result;
      const page=result.data??[];data.push(...page);
      if(page.length<200)return{data,error:null};
    }
  }
  return {
    ...current,
    readAllAssessmentRows:<T>(query:Query)=>context.legacy?legacyAll<T>(query):current.readAllAssessmentRows<T>(query),
    readRelatedAssessmentRows:async<T>(...args:Parameters<typeof current.readRelatedAssessmentRows>)=>{
      if(!context.legacy)return current.readRelatedAssessmentRows<T>(...args);
      const [supabase,relation,columns,key,ids]=args,data:T[]=[],unique=[...new Set(ids)];
      for(let offset=0;offset<unique.length;offset+=80) {
        const result=await legacyAll<T>(()=>current.assessmentReadFrom(supabase)(relation).select(columns).in(key,unique.slice(offset,offset+80)));
        if(result.error)return result;
        data.push(...(result.data??[]));
      }
      return{data,error:null};
    },
  };
});

describe.skipIf(process.env.MATHIN_ASSESSMENT_READ_DB_TEST!=="1")("existing local assessment read equivalence",()=>{
  it("preserves complete authorized rows and order for the fixed administrator and teacher",async()=>{
    const root=path.resolve(".tmp/dashboard-latency-20260915");fs.mkdirSync(root,{recursive:true});
    const {observed}=openHistoryLocalTarget({attestationPath:path.join(root,"local-target.json"),refresh:true,errorFile:path.join(root,"target-error.txt")});
    expect(observed.supabaseOrigin).toBe("http://127.0.0.1:35421");
    const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,"")];}));
    const accountFile=[".claude/test-accounts.local.md","../../.claude/test-accounts.local.md"].find(f=>fs.existsSync(f));
    if(!accountFile)throw Error("LOCAL_ACCOUNT_DOCUMENT_REQUIRED");
    const password=fs.readFileSync(accountFile,"utf8").match(/统一密码[：:]\s*`([^`]+)`/)?.[1];
    if(!password)throw Error("LOCAL_ACCOUNT_PASSWORD_REQUIRED");
    const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const results=[];
    for(const role of ["admin","teacher"]) {
      let requests=0,delay=0;
      context.client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
        requests++;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
        return fetch(input,init);
      }}});
      const login=await context.client.auth.signInWithPassword({email:`test-${role}@mathin.local`,password});
      expect(login.error?.name??null).toBeNull();
      try {
        for(const simulatedDelayMs of [0,40]) {
          delay=simulatedDelayMs;context.legacy=true;requests=0;
          const beforeStart=performance.now(),before=await listAssessmentWorkbenchRows(),beforeMs=performance.now()-beforeStart,beforeRequests=requests;
          context.legacy=false;requests=0;
          const afterStart=performance.now(),after=await listAssessmentWorkbenchRows(),afterMs=performance.now()-afterStart;
          expect(digest(after)).toBe(digest(before));
          expect(requests).toBeLessThanOrEqual(beforeRequests);
          results.push({role,simulatedDelayMs,rows:after.length,equal:true,beforeMs:Math.round(beforeMs),afterMs:Math.round(afterMs),beforeRequests,afterRequests:requests});
        }
      }finally{delay=0;await context.client.auth.signOut({scope:"local"});}
    }
    fs.writeFileSync(path.join(root,"assessment-equivalence.json"),JSON.stringify({passed:true,results},null,2));
  },90000);
});
