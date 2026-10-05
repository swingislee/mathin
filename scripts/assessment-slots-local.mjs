import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { assertNonProductionWriteTarget } from './lib/r1-write-target-policy.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { fixedPreviewActors, previewIdentitySql } from './parent-assessment-fixtures-local.mjs';

const mode = process.argv[2];
if (!['--preflight','--check','--apply','--seed-preview'].includes(mode)) throw new Error('USE_PREFLIGHT_CHECK_APPLY_OR_SEED_PREVIEW');
const output = path.resolve('.tmp/assessment-slots');
fs.mkdirSync(output,{recursive:true});
const {sql,observed} = openHistoryLocalTarget({attestationPath:path.join(output,'target.json'),refresh:mode==='--preflight',errorFile:path.join(output,'database-error.txt')});
assertNonProductionWriteTarget({operation:'assessment-slots-local',supabaseUrl:observed.supabaseOrigin,
  environment:{MATHIN_WRITE_TARGET_ENVIRONMENT:'development',MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN:observed.supabaseOrigin}});
// 旧邀约函数属于 supabase_admin；迁移以现有对象所有者运行，连接仍是刚核对的同一容器。
const migrationSql = statement => {
  try { return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
    {input:statement,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024}).trim(); }
  catch(error) { fs.writeFileSync(path.join(output,'database-error.txt'),String(error.stderr??error.message),'utf8');throw new Error('ASSESSMENT_SLOT_DATABASE_ERROR: inspect private error file'); }
};
if (mode==='--preflight') {
  console.log(JSON.stringify({target:'verified-windows-loopback',databaseWrites:false,host:observed.host,origin:observed.supabaseOrigin}));
  process.exit(0);
}
const migrations=['20261005000100_assessment_published_slots','20261005000200_assessment_slot_closure','20261005000300_assessment_slot_booking_status'].map(version=>{
  const file=`supabase/migrations/${version}.sql`,digest=textFileSha256(file);
  const recorded=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
  if(recorded&&recorded!==digest)throw new Error('ASSESSMENT_SLOT_LEDGER_MISMATCH');
  return {version,digest,recorded,source:fs.readFileSync(file,'utf8')};
});
const pending=migrations.filter(entry=>!entry.recorded),migration=pending.map(entry=>entry.source).join('\n');
const actors=fixedPreviewActors(fs.readFileSync('.claude/test-accounts.local.md','utf8'));
const identity=previewIdentitySql(actors);
const testFile='supabase/tests/assessment_published_slots.sql';
const inputHash=createHash('sha256').update(migrations.map(entry=>entry.digest).join(':')).update(textFileSha256(testFile)).update(JSON.stringify(actors)).digest('hex');
const checkedPath=path.join(output,'checked.json');
const before=()=>sql(`begin read only;select jsonb_build_object(
 'identities',(select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from auth.users r),
 'profiles',(select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from public.profiles r),
 'leads',(select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from public.leads r),
 'invitations',(select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from public.lead_invitation_threads r),
 'campuses',(select md5(string_agg(md5(to_jsonb(r)::text),'' order by id)) from public.campuses r),
 'rolePermissions',(select md5(string_agg(md5(to_jsonb(r)::text),'' order by role_id,perm_key)) from public.role_permissions r)
);commit;`);
if(mode==='--check'){
  const snapshot=before();
  migrationSql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${identity}\n${fs.readFileSync(testFile,'utf8')}\nrollback;`);
  if(before()!==snapshot)throw new Error('ASSESSMENT_SLOT_ROLLBACK_CHANGED_DATA');
  fs.writeFileSync(checkedPath,JSON.stringify({inputHash,target:observed.systemIdentifier,checkedAt:new Date().toISOString()}),'utf8');
  console.log(JSON.stringify({passed:true,transactionRolledBack:true,checked:['staff-scope','parent-scope','published-teacher','overlap','idempotency','booking-immutability','cancellation','rls']}));
} else if(mode==='--apply'){
  if(!pending.length){console.log(JSON.stringify({alreadyInstalled:true}));process.exit(0);}
  const check=JSON.parse(fs.readFileSync(checkedPath,'utf8'));
  if(check.inputHash!==inputHash||check.target!==observed.systemIdentifier||Date.now()-Date.parse(check.checkedAt)>3600000)throw new Error('MATCHING_ASSESSMENT_SLOT_CHECK_REQUIRED');
  migrationSql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${migration}\n${pending.map(entry=>`insert into public.schema_migrations(version,checksum) values('${entry.version}','${entry.digest}');`).join('\n')}commit;`);
  console.log(JSON.stringify({applied:true,versions:pending.map(entry=>entry.version),target:'verified-windows-loopback',businessRowsWritten:0}));
} else {
  if(pending.length)throw new Error('ASSESSMENT_SLOT_MIGRATION_REQUIRED');
  const seed=fs.readFileSync('supabase/fixtures/assessment-slots-local.sql','utf8');
  const result=sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${identity}\n${seed}\ncommit;`);
  fs.writeFileSync(path.join(output,'preview-receipt.json'),result,'utf8');
  console.log(result);
}
