import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const root = path.resolve('.tmp/wechat-auth-compat/image');
const receipt = JSON.parse(fs.readFileSync(path.join(root,'receipt.json'),'utf8'));
const { sql, docker } = openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
if (docker(['image','inspect',receipt.tag,'--format','{{.Id}}']) !== receipt.imageId) throw new Error('CHECKED_AUTH_IMAGE_REQUIRED');
const auth = JSON.parse(docker(['inspect','supabase-auth']))[0];
const values = Object.fromEntries(auth.Config.Env.map(entry=>{const i=entry.indexOf('=');return [entry.slice(0,i),entry.slice(i+1)];}));
const target = new URL(values.GOTRUE_DB_DATABASE_URL);
if (!['db','supabase-db'].includes(target.hostname) || target.pathname!=='/postgres' || !auth.NetworkSettings.Networks['mathin-isolated-loopback']) throw new Error('LOCAL_AUTH_TARGET_REQUIRED');
// 额外的数据库连接级保护：临时镜像的所有连接都只读，连后台清理也不能写入。
target.searchParams.set('options',`${target.searchParams.get('options') ?? ''} -c default_transaction_read_only=on`.trim());
const state = () => sql("begin read only; select jsonb_build_object('users',(select count(*) from auth.users),'identities',(select count(*) from auth.identities),'providers',(select count(*) from auth.custom_oauth_providers),'migrations',(select count(*) from auth.schema_migrations),'ledger',(select count(*) from public.schema_migrations)); rollback;");
const before = state(), checks=[];
const request = origin => new Promise((resolve,reject)=>{
  const req=http.get(origin+'/health',response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch{reject(new Error('HEALTH_JSON_INVALID'));}});response.on('error',reject);});
  req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('HEALTH_TIMEOUT')));
});
for (const [label,image,version] of [
  ['patched',receipt.imageId,receipt.version],
  ['previous','supabase/gotrue@sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf','v2.189.0'],
]) {
  const name='mathin-wechat-image-smoke-'+crypto.randomUUID();
  const settings={GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:target.toString(),GOTRUE_JWT_SECRET:crypto.randomBytes(32).toString('hex'),
    GOTRUE_SITE_URL:'http://localhost',API_EXTERNAL_URL:'http://localhost',GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',GOTRUE_DISABLE_SIGNUP:'true'};
  const args=['--context','desktop-linux','run','--detach','--name',name,'--network','mathin-isolated-loopback','--publish','127.0.0.1::9999'];
  for(const key of Object.keys(settings)) args.push('-e',key);
  args.push(image,'auth','serve');
  let started=false;
  try {
    execFileSync('docker.exe',args,{env:{...process.env,...settings},encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});started=true;
    const binding=docker(['port',name,'9999/tcp']);
    if(!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('LOOPBACK_HEALTH_REQUIRED');
    let healthy=false;
    for(let attempt=0;attempt<50;attempt++) {
      try {const response=await request('http://'+binding); if(response.status===200 && response.body.version===version){healthy=true;break;}} catch { /* 等待镜像启动。 */ }
      if(docker(['inspect',name,'--format','{{.State.Running}}'])!=='true')break;
      await pause(200);
    }
    if(!healthy)throw new Error('AUTH_IMAGE_HEALTH_FAILED_'+label);
    checks.push({label,version,health:'PASS'});
  } finally {
    if(started) {try{fs.writeFileSync(path.join(root,label+'-health.log'),docker(['logs',name]),'utf8');}finally{docker(['rm','--force',name]);}}
  }
}
if(state()!==before)throw new Error('READONLY_IMAGE_STATE_CHANGED');
const result={checks,originalServiceUnchanged:docker(['inspect','supabase-auth','--format','{{.Id}}'])===auth.Id,checkedAt:new Date().toISOString()};
if(!result.originalServiceUnchanged)throw new Error('ORIGINAL_AUTH_SERVICE_CHANGED');
fs.writeFileSync(path.join(root,'smoke.json'),JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result));
