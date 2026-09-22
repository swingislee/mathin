// 本机隔离库验证共享候选汇总：完整事实、角色、期间、复用计划及事务回退。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';
const root='.tmp/overview-summary-20260922';fs.mkdirSync(root,{recursive:true});
const version='20260922002000_overview_summary_shared_candidates',file=`supabase/migrations/${version}.sql`;
const mode=process.argv[2];assert.ok(['--check','--apply'].includes(mode),'Use --check or --apply');
const {observed}=openHistoryLocalTarget({attestationPath:`${root}/target.json`,refresh:true,errorFile:`${root}/error.private.txt`});
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=body=>{const r=spawnSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});if(r.status!==0){fs.writeFileSync(`${root}/error.private.txt`,r.stderr);throw Error('SUMMARY_SQL_FAILED');}return r.stdout.trim();};
const footprint=()=>sql(`begin read only;select jsonb_build_object(
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'views',(select md5(string_agg(pg_get_viewdef(oid,true)||relowner||coalesce(relacl::text,'')||coalesce(reloptions::text,''),'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind='v'),
 'policies',(select md5(jsonb_agg(to_jsonb(p) order by oid)::text) from pg_policy p),
 'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m),
 'business',jsonb_build_object(${['profiles','students','leads','history_import_records','activities','activity_registrations','lead_communications','assessment_results'].map(name=>`${q(name)},(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id)) from public.${name} t)`).join(',')}));commit;`);
const checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8'),before=footprint();
// 本地候选修订在同一事务内复用迁移前定义；精确核对已登记的候选校验和。
const installed=sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
const definitionsPath=`${root}/definitions.private.json`;
if(!installed&&!fs.existsSync(definitionsPath))fs.writeFileSync(definitionsPath,sql(`begin read only;select jsonb_object_agg(proname,jsonb_build_object('def',pg_get_functiondef(oid))) from pg_proc where oid in('public.staff_overview_acquisition_contact_facts_v2(text,text)'::regprocedure,'public.get_staff_overview_acquisition_contacts_v2(jsonb)'::regprocedure);commit;`));
let restore='';
if(installed){
 assert.equal(JSON.parse(fs.readFileSync(`${root}/local-applied.json`,'utf8')).checksum,installed,'LOCAL_CANDIDATE_CHECKSUM_CHANGED');
 restore=Object.values(JSON.parse(fs.readFileSync(definitionsPath,'utf8'))).map(value=>`${value.def};`).join('\n');
}
if(mode==='--apply'){
 const check=JSON.parse(fs.readFileSync(`${root}/check.json`,'utf8'));assert.equal(check.checksum,checksum);assert.equal(check.before,before);assert.equal(check.rollbackUnchanged,true);
 sql(`begin;set local lock_timeout='3s';set local statement_timeout='60s';${restore}${migration}
 ${installed?`update public.schema_migrations set checksum=${q(checksum)} where version=${q(version)} and checksum=${q(installed)};`:`insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});`}
 notify pgrst,'reload schema';commit;`);
 fs.writeFileSync(`${root}/local-applied.json`,JSON.stringify({version,checksum,at:new Date().toISOString()},null,2));console.log(JSON.stringify({applied:true,version}));
}else{
 const roles=['admin','principal','research','teacher','student','parent'];
 const claims=role=>`reset role;select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where lower(email)=lower(${q(loadFixedAccount(role).email)})),'role','authenticated')::text,true) is not null;set local role authenticated;`;
 const periods=[
  {grain:'month',cs:'2026-08-31T16:00:00Z',ce:'2026-09-30T16:00:00Z',cc:'2026-09-22T04:12:00Z',ps:'2026-07-31T16:00:00Z',pc:'2026-08-31T16:00:00Z'},
  {grain:'month',cs:'2026-07-31T16:00:00Z',ce:'2026-08-31T16:00:00Z',cc:'2026-08-31T16:00:00Z',ps:'2026-06-30T16:00:00Z',pc:'2026-07-31T16:00:00Z'},
  {grain:'week',cs:'2026-09-20T16:00:00Z',ce:'2026-09-27T16:00:00Z',cc:'2026-09-22T04:12:00Z',ps:'2026-09-13T16:00:00Z',pc:'2026-09-15T04:12:00Z'},
  {grain:'week',cs:'2026-08-16T16:00:00Z',ce:'2026-08-23T16:00:00Z',cc:'2026-08-23T16:00:00Z',ps:'2026-08-09T16:00:00Z',pc:'2026-08-16T16:00:00Z'},
 ];
 const window=p=>q(JSON.stringify({grain:p.grain,timeZone:'Asia/Shanghai',currentStart:p.cs,currentEnd:p.ce,currentCutoff:p.cc,previousStart:p.ps,previousEnd:p.cs,previousCutoff:p.pc}));
 const queries=[...['month','week'].map(grain=>({name:`facts-${grain}`,query:`select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''))) from public.staff_overview_acquisition_contact_facts_v2(${q(grain)},'Asia/Shanghai') r`})),
 ...periods.map((period,i)=>({name:`summary-${i}`,query:`select public.get_staff_overview_acquisition_contacts_v2(${window(period)}::jsonb)-'sourceStaffIds'-'leadPersonIds'`}))];
 const take=phase=>roles.map(role=>`${claims(role)}${queries.map(({name,query})=>`select pg_temp.check_result(${q(phase)},${q(role)},${q(name)},${q(query)});`).join('\n')}`).join('\n');
 const sample=phase=>`${claims('admin')}do $sample$ declare t timestamptz;v jsonb;begin for i in 1..3 loop t:=clock_timestamp();v:=public.get_staff_overview_acquisition_contacts_v2(${window(periods[0])}::jsonb);
 insert into samples values(${q(phase)},extract(epoch from clock_timestamp()-t)*1000,octet_length(v::text));end loop;end;$sample$;reset role;`;
 const out=sql(`begin;set local statement_timeout='120s';set local lock_timeout='3s';
 create temp table expected(role_name text,name text,result jsonb,primary key(role_name,name));grant all on expected to authenticated;
 create temp table samples(phase text,ms numeric,bytes integer);grant all on samples to authenticated;
 create function pg_temp.check_result(phase text,who text,label text,query text) returns void language plpgsql security invoker as $fn$
 declare result jsonb;old_result jsonb;begin begin execute query into result;exception when others then result:=jsonb_build_object('error',sqlstate);end;
 if phase='before' then insert into expected values(who,label,result);else select e.result into old_result from expected e where role_name=who and name=label;
 if result is distinct from old_result then raise exception 'SUMMARY_RESULT_CHANGED: % %',who,label;end if;end if;end;$fn$;
 ${restore}${take('before')}reset role;${sample('before')}${migration}${take('after')}reset role;${sample('after')}
 ${claims('admin')}prepare actor_summary as select public.get_staff_overview_acquisition_contacts_v2(${window(periods[0])}::jsonb)-'sourceStaffIds'-'leadPersonIds';reset role;
 ${['admin','teacher','admin'].map(role=>`${claims(role)}select pg_temp.check_result('after',${q(role)},'summary-0','execute actor_summary');`).join('\n')}reset role;deallocate actor_summary;
 do $security$ declare signature text;begin foreach signature in array array['public.staff_overview_acquisition_contact_facts_v2(text,text)','public.get_staff_overview_acquisition_contacts_v2(jsonb)'] loop
 if exists(select 1 from pg_proc where oid=signature::regprocedure and (prosecdef or provolatile<>'s')) or has_function_privilege('anon',signature,'execute')
 or has_function_privilege('service_role',signature,'execute') or not has_function_privilege('authenticated',signature,'execute') then raise exception 'SUMMARY_ACCESS_CHANGED';end if;end loop;end;$security$;
 select jsonb_build_object('compared',count(*),'roles',count(distinct role_name),'denied',count(*) filter(where result?'error')) from expected;
 select jsonb_build_object('sample',phase,'ms',ms,'bytes',bytes) from samples;rollback;`);
 assert.equal(footprint(),before,'ROLLBACK_FOOTPRINT_CHANGED');
 const values=out.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 const report={checksum,before,rollbackUnchanged:true,comparisons:values.find(v=>v.compared),samples:values.filter(v=>v.sample),at:new Date().toISOString(),host:observed.host};
 assert.equal(report.comparisons.compared,36);assert.equal(report.comparisons.denied,8);
 fs.writeFileSync(`${root}/check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,before:undefined}));
}
