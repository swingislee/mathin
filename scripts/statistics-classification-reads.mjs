// 本机隔离库中的完整结果、分类变化、角色范围与回退检查；不创建账号。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';
const root='.tmp/overview-repair-20260922';fs.mkdirSync(root,{recursive:true});
const version='20260922001000_statistics_classifier_plan_reuse',file=`supabase/migrations/${version}.sql`;
const mode=process.argv[2];assert.ok(['--check','--apply'].includes(mode),'Use --check or --apply');
const {observed}=openHistoryLocalTarget({attestationPath:`${root}/target.json`,refresh:true,errorFile:`${root}/error.private.txt`});
console.log(JSON.stringify({target:observed,ssh:false}));
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=body=>{const r=spawnSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8',windowsHide:true,maxBuffer:24*1024*1024});if(r.status!==0){fs.writeFileSync(`${root}/error.private.txt`,r.stderr);throw Error('CLASSIFICATION_SQL_FAILED');}return r.stdout.trim();};
const footprint=()=>sql(`begin read only;select jsonb_build_object(
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'views',(select md5(string_agg(pg_get_viewdef(oid,true)||relowner||coalesce(relacl::text,'')||coalesce(reloptions::text,''),'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind='v'),
 'policies',(select md5(jsonb_agg(to_jsonb(p) order by oid)::text) from pg_policy p),
 'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m),
 'business',jsonb_build_object(
   'profiles',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id)) from public.profiles t),
   'students',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id)) from public.students t),
   'leads',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id)) from public.leads t),
   'history',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id)) from public.history_import_records t)));rollback;`);
const checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8'),before=footprint();
if(mode==='--apply'){
 const check=JSON.parse(fs.readFileSync(`${root}/check.json`,'utf8'));assert.equal(check.checksum,checksum);assert.equal(check.before,before);assert.equal(check.rollbackUnchanged,true);
 sql(`begin;set local lock_timeout='3s';set local statement_timeout='60s';${migration}insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});notify pgrst,'reload schema';commit;`);
 fs.writeFileSync(`${root}/local-applied.json`,JSON.stringify({version,checksum,at:new Date().toISOString()},null,2));console.log(JSON.stringify({applied:true,version}));
}else{
 const views=JSON.parse(sql(`begin read only;select jsonb_agg(relname order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='v' and relname like 'statistics_%';rollback;`));
 const queries=views.map(name=>({name,query:`select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),''))) from public.${name} r`}));
 queries.push({name:'acquisition-full',query:`select public.list_current_staff_overview_acquisition_sources(null,10000)`});
 const roles=['admin','principal','research','teacher','student','parent'].map(role=>({role,email:loadFixedAccount(role)?.email}));assert.ok(roles.every(r=>r.email));
 const take=(phase)=>roles.map(({role,email})=>`reset role;select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where lower(email)=lower(${q(email)})),'role','authenticated','aal','aal2')::text,true) is not null;set local role authenticated;
 ${queries.map(({name,query})=>`select pg_temp.check_result(${q(phase)},${q(role)},${q(name)},${q(query)});`).join('\n')}`).join('\n');
 const body=`begin;set local statement_timeout='180s';set local lock_timeout='3s';
 create temp table expected_results(role_name text,name text,result jsonb,primary key(role_name,name));grant all on expected_results to authenticated;
 create function pg_temp.check_result(phase text,who text,label text,query text) returns text language plpgsql security invoker as $fn$
 declare result jsonb;old_result jsonb;begin
   begin execute query into result;exception when others then result:=jsonb_build_object('error',sqlstate);end;
   if phase='before' then insert into expected_results values(who,label,result);
   else select e.result into old_result from expected_results e where role_name=who and name=label;
     if result is distinct from old_result then raise exception 'STATISTICS_RESULT_CHANGED: % %',who,label;end if;
   end if;return phase||':'||who||':'||label;end;$fn$;
 ${take('before')}reset role;${migration}${take('after')}reset role;
 ${fs.readFileSync('scripts/sql/production-statistics-identity-assertions.sql','utf8')}
 ${fs.readFileSync('scripts/sql/statistics-batch-classification-assertions.sql','utf8')}
 select jsonb_build_object('compared',count(*),'roles',count(distinct role_name),'emptyResults',count(*) filter(where result->>'count'='0'),'denied',count(*) filter(where result?'error')) from expected_results;
 rollback;`;
 const out=sql(body);const after=footprint();assert.equal(after,before,'ROLLBACK_FOOTPRINT_CHANGED');
 const comparison=JSON.parse(out.split(/\r?\n/).find(l=>l.startsWith('{"roles"')||l.startsWith('{"denied"')||l.startsWith('{"compared"')||l.startsWith('{"emptyResults"')));
 const report={checksum,before,rollbackUnchanged:true,comparison,at:new Date().toISOString()};fs.writeFileSync(`${root}/check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
