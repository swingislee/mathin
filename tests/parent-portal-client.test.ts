import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {describe, expect, it, vi} from "vitest";
import type {Session, Media} from "../contracts/parent-api/portal";

type Pending = {url:string; success:(result:{statusCode:number;data:unknown})=>void};
function runtime(initial:Session) {
  let stored:Session|null=initial;
  const requests:Pending[]=[], uploads:Pending[]=[];
  const wx={
    getStorageSync:()=>stored,
    setStorageSync:(_key:string,value:Session)=>{stored=value;},
    removeStorageSync:()=>{stored=null;},
    request:(options:Pending)=>{requests.push(options);},
    uploadFile:(options:Pending)=>{uploads.push(options);return {onProgressUpdate:vi.fn()};},
  };
  const source=readFileSync("apps/parent-wechat/miniprogram/lib/api.ts","utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}});
  const exports:Record<string,unknown>={};
  vm.runInNewContext(compiled.outputText,{exports,wx,console,require:(name:string)=>{
    if(name!=="../config.local")throw new Error("Unexpected import: "+name);
    return {config:{apiOrigin:"http://development.invalid"}};
  }});
  const api=exports as {
    get:<T>(resource:string)=>Promise<T>;
    saveSession:(session:Session)=>void;
    clearSession:()=>void;
    upload:(path:string,assignment:string,participant:string,progress:()=>void)=>Promise<Media>;
  };
  return {api,requests,uploads,stored:()=>stored};
}
const active=(label:string):Session=>({accessToken:label,refreshToken:label+"-refresh",expiresAt:Math.floor(Date.now()/1000)+3600});

describe("小程序会话与异步返回",()=>{
  it("并发读取共用一次刷新，并以刷新后的令牌继续",async()=>{
    const run=runtime({...active("old"),expiresAt:0});
    const first=run.api.get("account"), second=run.api.get("practices");
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].url).toContain("/auth");
    run.requests[0].success({statusCode:200,data:active("fresh")});
    await vi.waitFor(()=>expect(run.requests).toHaveLength(3));
    run.requests[1].success({statusCode:200,data:{id:"account"}});
    run.requests[2].success({statusCode:200,data:[]});
    await expect(Promise.all([first,second])).resolves.toEqual([{id:"account"},[]]);
    expect(run.stored()?.accessToken).toBe("fresh");
  });

  it("退出后丢弃仍在路上的个人数据",async()=>{
    const run=runtime(active("old"));
    const request=run.api.get("reports");
    const rejected=expect(request).rejects.toMatchObject({code:"UNAUTHENTICATED"});
    await vi.waitFor(()=>expect(run.requests).toHaveLength(1));
    run.api.clearSession();
    run.requests[0].success({statusCode:200,data:[{summary:"previous account"}]});
    await rejected;
  });

  it("旧刷新和上传响应不能覆盖新账号或交付旧账号附件",async()=>{
    const refreshRun=runtime({...active("old"),expiresAt:0});
    const request=refreshRun.api.get("account");
    const rejected=expect(request).rejects.toMatchObject({code:"UNAUTHENTICATED"});
    refreshRun.api.saveSession(active("other"));
    refreshRun.requests[0].success({statusCode:200,data:active("old-renewed")});
    await rejected;
    expect(refreshRun.stored()?.accessToken).toBe("other");

    const uploadRun=runtime(active("old"));
    const upload=uploadRun.api.upload("temporary.png","assignment","participant",()=>{});
    const uploadRejected=expect(upload).rejects.toMatchObject({code:"UNAUTHENTICATED"});
    await vi.waitFor(()=>expect(uploadRun.uploads).toHaveLength(1));
    uploadRun.api.saveSession(active("other"));
    uploadRun.uploads[0].success({statusCode:201,data:JSON.stringify({id:"old-file",kind:"image",name:"photo",bytes:12})});
    await uploadRejected;
  });
});
