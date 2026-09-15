import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
const mode=process.argv[2];if(!['--preflight','--check','--apply'].includes(mode))throw new Error('Use --preflight, --check or --apply');
const root='.tmp/teaching-period';fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:`${root}/preflight.json`,refresh:mode==='--preflight',errorFile:`${root}/sql-error.txt`});
if(mode==='--preflight'){console.log(JSON.stringify(observed));process.exit(0);}
// 既有函数由维护角色持有；在同一本机 Docker 目标更新并保留原所有权。
const maintenance=statement=>{try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(error){fs.writeFileSync(`${root}/sql-error.txt`,String(error.stderr??error.message),'utf8');throw new Error('LOCAL_PERIOD_MIGRATION_FAILED');}};
if(maintenance('begin read only;select system_identifier from pg_control_system();commit;')!==observed.systemIdentifier)throw new Error('MAINTENANCE_TARGET_MISMATCH');
const version='20260915006000_teaching_term_window';const file=`supabase/migrations/${version}.sql`;const checksum=textFileSha256(file);
const recorded=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if(recorded&&recorded!==checksum)throw new Error('CHECKSUM_MISMATCH');
const migration=recorded?'':fs.readFileSync(file,'utf8');
if(mode==='--check'){
 const accounts=JSON.parse(sql("begin read only;select jsonb_object_agg(case email when 'test-admin@mathin.local' then 'admin' when 'test-teacher@mathin.local' then 'teacher' when 'test-principal@mathin.local' then 'supervisor' when 'test-student@mathin.local' then 'student' end,id) from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local','test-principal@mathin.local','test-student@mathin.local');commit;"));
 if(!['admin','teacher','supervisor','student'].every(key=>/^[0-9a-f-]{36}$/.test(accounts[key])))throw new Error('FIXED_ACCOUNTS_REQUIRED');
 const settings=Object.entries(accounts).map(([key,id])=>`select set_config('teaching.test.${key}','${id}',true);`).join('\n');
 const setup=fs.readFileSync('scripts/sql/teaching-records-assertions.sql','utf8').split('set local role authenticated;')[0];
 maintenance(`begin;set local statement_timeout='30s';${migration}\n${settings}\n${setup}\n${fs.readFileSync('scripts/sql/teaching-period-assertions.sql','utf8')}\nrollback;`);
 fs.writeFileSync(`${root}/check.json`,JSON.stringify({checksum,host:observed.host}),'utf8');console.log('Term window, scope, exact overview and bounded dates: PASS');
}else{
 if(recorded)throw new Error('ALREADY_APPLIED');const check=JSON.parse(fs.readFileSync(`${root}/check.json`,'utf8'));if(check.checksum!==checksum||check.host!==observed.host)throw new Error('MATCHING_CHECK_REQUIRED');
 maintenance(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);console.log('Local teaching term window applied.');
}
