import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { textFileSha256 } from './lib/text-hash.mjs';

const root = path.resolve('.tmp/wechat-auth-compat');
const output = path.join(root,'image');
const source = path.join(output,'source/auth-4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a');
fs.mkdirSync(output,{recursive:true});
const docker = args => execFileSync('docker.exe',['--context','desktop-linux',...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,timeout:600_000});
if (process.platform !== 'win32' || process.env.DOCKER_HOST || process.env.SSH_CONNECTION
  || !docker(['context','inspect','desktop-linux','--format','{{.Endpoints.docker.Host}}']).trim().startsWith('npipe://')) throw new Error('LOCAL_DOCKER_BUILD_REQUIRED');
if (!fs.existsSync(source)) {
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:MATHIN_SOURCE_ARCHIVE -DestinationPath $env:MATHIN_SOURCE_DESTINATION'],{
    env:{...process.env,MATHIN_SOURCE_ARCHIVE:path.join(root,'source.zip'),MATHIN_SOURCE_DESTINATION:path.join(output,'source')},
    windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
}
const identity = path.join(source,'internal/api/identity.go');
if (textFileSha256(identity) === '651a202d5a9713637d1d0344eabb1a1ee9c637a57cc1f4fddbf7df8c7f9153ff') {
  execFileSync('git',['apply','--unidiff-zero','--directory='+path.relative(process.cwd(),source).replaceAll('\\','/'),'supabase/auth-compat/v2.189.0-phone-only.patch'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
}
if (textFileSha256(identity) !== '4915e8774c69aac22372e541af06b07eaaf9ed2e57b19c70e0d7503e9e7c7c6f') throw new Error('AUTH_PATCH_HASH_MISMATCH');
const name = 'mathin-wechat-build-'+crypto.randomUUID();
const version = 'v2.189.0-mathin.wechat.1', tag = 'mathin/gotrue:v2.189.0-wechat.1';
console.log('Building pinned Auth compatibility image locally.');
try {
  // 下载 go.mod/go.sum 固定的公开依赖，后续编译和镜像组装均关闭网络。
  fs.writeFileSync(path.join(output,'dependencies.log'),docker(['run','--rm','--name',name,'--network','bridge',
    '--mount',`type=bind,source=${source},target=/source,readonly`, '--mount',`type=bind,source=${path.join(root,'go-mod')},target=/go/pkg/mod`,
    '--workdir','/source','golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa','go','mod','download']),'utf8');
  const logs = docker(['run','--rm','--name',name,'--network','none','--mount',`type=bind,source=${source},target=/source,readonly`,
    '--mount',`type=bind,source=${output},target=/output`, '--mount',`type=bind,source=${path.join(root,'go-mod')},target=/go/pkg/mod`,
    '--mount',`type=bind,source=${path.join(root,'go-build')},target=/root/.cache/go-build`, '--workdir','/source',
    '-e','CGO_ENABLED=0','-e','GOTOOLCHAIN=local','golang@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa',
    'go','build','-p=2','-trimpath','-buildvcs=false','-ldflags',`-X github.com/supabase/auth/internal/utilities.Version=${version}`,'-o','/output/auth','.']);
  fs.writeFileSync(path.join(output,'compile.log'),logs,'utf8');
  fs.copyFileSync('supabase/auth-compat/Dockerfile',path.join(output,'Dockerfile'));
  fs.writeFileSync(path.join(output,'.dockerignore'),'*\n!auth\n!Dockerfile\n','utf8');
  fs.writeFileSync(path.join(output,'build.log'),docker(['build','--network','none','--tag',tag,output]),'utf8');
  if (docker(['run','--rm','--network','none',tag,'auth','version']).trim() !== version) throw new Error('AUTH_IMAGE_VERSION_MISMATCH');
  const imageId = docker(['image','inspect',tag,'--format','{{.Id}}']).trim();
  const result = { tag,imageId,version,patchHash:textFileSha256('supabase/auth-compat/v2.189.0-phone-only.patch'),binaryHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(output,'auth'))).digest('hex'),builtAt:new Date().toISOString() };
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify(result));
} catch (error) {
  fs.writeFileSync(path.join(output,'error.log'),String(error.stderr ?? error.message),'utf8');
  try { docker(['rm','--force',name]); } catch { /* --rm 已退出的容器无需再次清理。 */ }
  throw new Error('AUTH_IMAGE_BUILD_FAILED: inspect the private build log');
}
