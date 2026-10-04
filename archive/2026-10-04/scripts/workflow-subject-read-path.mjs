import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--check','--apply'].includes(mode))throw new Error('Use --check or --apply');
const root=path.resolve('.tmp/workflow-subject-read-path');fs.mkdirSync(root,{recursive:true});
const {observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});
const sql=statement=>{try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(error){fs.writeFileSync(path.join(root,'error.txt'),String(error.stderr??error.message),'utf8');throw new Error('WORKFLOW_LOCAL_CHECK_FAILED');}};
console.log(JSON.stringify({localTargetVerified:true,...observed}));
const version='20260914002000_workflow_subject_read_path',file=`supabase/migrations/${version}.sql`;
const checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8');
const metadata=ignore=>`jsonb_build_object('functions',(select md5(string_agg((${ignore?"case when p.oid='public.business_subject_is_current(uuid,uuid)'::regprocedure then to_jsonb(p)-'prosrc' else to_jsonb(p) end":"to_jsonb(p)"})::text,'' order by p.oid)) from pg_proc p where pronamespace in('public'::regnamespace,'mathin_internal'::regnamespace)),
 'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_policy p),
 'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind in('r','v','m')),
 'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'))`;
const business=`jsonb_build_object(${['students','leads','profiles','history_workflow_scopes','history_workflow_decisions','history_workflow_decision_events','school_subject_participants'].map(t=>`'${t}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${t} t)`).join(',')})`;
const snapshot=()=>JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object('metadata',${metadata(false)},'business',${business},'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const before=snapshot();
fs.writeFileSync(path.join(root,'before.json'),JSON.stringify(before,null,2)+'\n','utf8');
const applied=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if(applied){assert.equal(applied,checksum);console.log('ALREADY_APPLIED');process.exit(0);}
const guards=`do $$begin if (select metadata from workflow_guard) is distinct from ${metadata(true)} or (select business from workflow_guard) is distinct from ${business} then raise exception 'UNEXPECTED_METADATA_OR_BUSINESS_CHANGE';end if;end $$;`;
if(mode==='--apply'){
 const check=JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));assert.equal(check.checksum,checksum);assert(check.zeroResidual);assert.deepEqual(check.before,before);
 sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';create temp table workflow_guard as select ${metadata(true)} metadata,${business} business;${migration}${guards}insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
 const after=snapshot();assert.deepEqual(after.business,before.business);fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({checksum,before,after,businessUnchanged:true},null,2)+'\n','utf8');console.log(JSON.stringify({version,checksum,applied:true}));process.exit(0);
}
const assertions=fs.readFileSync('scripts/sql/workflow-subject-read-assertions.sql','utf8');
const result=JSON.parse(sql(`begin;set local lock_timeout='5s';set local statement_timeout='180s';
 create temp table workflow_guard as select ${metadata(true)} metadata,${business} business;
 do $$declare definition text;begin select pg_get_functiondef('public.business_subject_is_current(uuid,uuid)'::regprocedure) into definition;execute replace(definition,'public.business_subject_is_current(', 'pg_temp.workflow_original(');end $$;
 create temp table workflow_cases as
 select student_id,id lead_id from public.leads union select null,id from public.leads union select id,null from public.students
 union select s.id,l.id from(select id from public.students order by id limit 12) s cross join(select id from public.leads order by id limit 12) l
 union select null::uuid,null::uuid union select '00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid;
 create temp table workflow_read_results(phase text,label text,value jsonb,ms numeric);
 ${capture('before')}${migration}${capture('after')}
 do $$begin
 if exists(select 1 from workflow_cases c where pg_temp.workflow_original(c.student_id,c.lead_id) is distinct from public.business_subject_is_current(c.student_id,c.lead_id)) then raise exception 'CURRENT_SCOPE_CHANGED';end if;
 if exists(select 1 from workflow_read_results a join workflow_read_results b using(label) where a.phase='before' and b.phase='after' and a.value is distinct from b.value) then raise exception 'ROLE_SCOPE_CHANGED';end if;
 end $$;
 ${guards}
 savepoint edge_cases;
 ${assertions}
 rollback to edge_cases;
 ${guards}${migration}
 select jsonb_build_object('predicateCases',(select count(*) from workflow_cases),'roleCases',(select count(*) from workflow_read_results where phase='before'),'equal',true,
 'timing',(select jsonb_agg(jsonb_build_object('case',a.label,'beforeMs',round(a.ms,1),'afterMs',round(b.ms,1)) order by a.label) from workflow_read_results a join workflow_read_results b using(label) where a.phase='before' and b.phase='after'));
 rollback;`));
assert.deepEqual(snapshot(),before);fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({checksum,before,result,zeroResidual:true,edgeCases:'null/unrelated/linked/multiple leads × resumed/unresumed × no decision/archive/continue'},null,2)+'\n','utf8');console.log(JSON.stringify({checksum,zeroResidual:true,...result}));

function capture(phase){return `do $$declare actor record;relation text;started timestamptz;value jsonb;begin
 for actor in select u.id,split_part(split_part(email,'@',1),'-',2) label from auth.users u where email in('test-admin@mathin.local','test-teacher@mathin.local','test-parent@mathin.local','test-student@mathin.local') order by email loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated','aal','aal2')::text,true);
 foreach relation in array array['operational_leads','operational_students'] loop
 execute 'set local role authenticated';started:=clock_timestamp();
 begin execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(id::text,'','' order by id),''''))) from public.%I',relation) into value;
 exception when insufficient_privilege then value:=jsonb_build_object('error',sqlstate);end;
 execute 'reset role';insert into workflow_read_results values('${phase}',actor.label||':'||relation,value,extract(epoch from clock_timestamp()-started)*1000);
 end loop;end loop;perform set_config('request.jwt.claims','{}',true);end $$;`;}
