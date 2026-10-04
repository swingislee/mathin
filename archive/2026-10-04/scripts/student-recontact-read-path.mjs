import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';import {textFileSha256} from './lib/text-hash.mjs';
const mode=process.argv[2];if(!['--check','--apply'].includes(mode))throw new Error('Use --check or --apply');
const root=path.resolve('.tmp/student-recontact-read-path');fs.mkdirSync(root,{recursive:true});
const {observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});console.log(JSON.stringify({localTargetVerified:true,...observed}));
const sql=statement=>{try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(error){fs.writeFileSync(path.join(root,'error.txt'),String(error.stderr??error.message),'utf8');throw new Error('RECONTACT_LOCAL_CHECK_FAILED');}};
const version='20260914003000_student_recontact_read_path',file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8');
const changed="'student_record_index_with_enrollments','student_record_list_rows','student_recontact_candidates'",plans="'list_student_recontact_summaries'";
const metadata=ignore=>`jsonb_build_object('functions',(select md5(string_agg((${ignore?`case when proname in(${changed}) then to_jsonb(p)-'prosrc'-'proconfig' when proname in(${plans}) then to_jsonb(p)-'proconfig' else to_jsonb(p) end`:'to_jsonb(p)'})::text,'' order by oid)) from pg_proc p where pronamespace in('public'::regnamespace,'mathin_internal'::regnamespace)),
 'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_policy p),
 'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind in('r','v','m')),
 'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'))`;
const business=`jsonb_build_object(${['profiles','students','leads','school_subject_participants','school_subject_groups','school_business_group_members','history_workflow_scopes','history_workflow_decisions','communication_worklists','communication_worklist_items'].map(t=>`'${t}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${t} t)`).join(',')})`;
const snapshot=()=>JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object('metadata',${metadata(false)},'business',${business},'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const before=snapshot();fs.writeFileSync(path.join(root,'before.json'),JSON.stringify(before,null,2)+'\n','utf8');
const applied=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);if(applied){assert.equal(applied,checksum);console.log('ALREADY_APPLIED');process.exit(0);}
const guards=`do $$begin
 if (select metadata from recontact_guard) is distinct from ${metadata(true)} or (select business from recontact_guard) is distinct from ${business} then raise exception 'UNEXPECTED_METADATA_OR_BUSINESS_CHANGE';end if;
 if exists(select 1 from recontact_configs g join pg_proc p on p.oid=g.oid where p.proconfig is distinct from array_append(array(select c from unnest(g.proconfig) c where c not like 'plan_cache_mode=%'),'plan_cache_mode=force_custom_plan')) then raise exception 'UNEXPECTED_FUNCTION_CONFIG';end if;
 end $$;`;
const setup=`create temp table recontact_guard as select ${metadata(true)} metadata,${business} business;create temp table recontact_configs as select oid,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in(${changed},${plans});`;
if(mode==='--apply'){
 const check=JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));assert.equal(check.checksum,checksum);assert(check.zeroResidual);assert.deepEqual(check.before,before);
 sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${setup}${migration}${guards}insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
 const after=snapshot();assert.deepEqual(after.business,before.business);fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({checksum,before,after},null,2)+'\n','utf8');console.log(JSON.stringify({version,checksum,applied:true}));process.exit(0);
}
const cases=[];
for(const role of ['admin','teacher'])for(const reason of ['unreachable','assessed','former','dormant'])cases.push({role,reason,scope:'all'});
for(const role of ['admin','teacher'])for(const scope of ['mine','group','unassigned'])cases.push({role,scope,reason:'unreachable'});
for(const role of ['parent','student'])cases.push({role,scope:'all',reason:'dormant'});
const result=JSON.parse(sql(`begin;set local lock_timeout='5s';set local statement_timeout='240s';${setup}
 create temp table recontact_cases as select c.*,u.id actor from jsonb_to_recordset('${JSON.stringify(cases)}'::jsonb) c(role text,scope text,reason text) join auth.users u on u.email='test-'||c.role||'@mathin.local';
 do $$begin if (select count(*) from recontact_cases)<>${cases.length} then raise exception 'FIXED_IDENTITIES_REQUIRED';end if;end $$;
 create temp table recontact_results(phase text,label text,value jsonb,ms numeric);
 ${capture('before')}${migration}${capture('after')}${guards}
 do $$begin if exists(select 1 from recontact_results a join recontact_results b using(label) where a.phase='before' and b.phase='after' and a.value is distinct from b.value) then raise exception 'RECONTACT_RESULTS_CHANGED';end if;end $$;
 ${migration}${guards}
 select jsonb_build_object('comparisons',(select count(*) from recontact_results where phase='after'),'equal',true,'timing',(select jsonb_agg(jsonb_build_object('case',a.label,'beforeMs',round(a.ms,1),'afterMs',round(b.ms,1)) order by a.label) from recontact_results a join recontact_results b using(label) where a.phase='before' and b.phase='after'));rollback;`));
assert.deepEqual(snapshot(),before);fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({checksum,before,result,zeroResidual:true},null,2)+'\n','utf8');console.log(JSON.stringify({checksum,zeroResidual:true,...result}));
function capture(phase){return `do $$declare item record;value jsonb;started timestamptz;actor_id uuid;begin
 for item in select * from recontact_cases order by role,scope,reason loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',item.actor,'role','authenticated','aal','aal2')::text,true);execute 'set local role authenticated';started:=clock_timestamp();
 begin value:=public.list_student_recontact_summaries(item.scope,'',item.reason);exception when insufficient_privilege or raise_exception then value:=jsonb_build_object('error',sqlerrm);end;
 execute 'reset role';insert into recontact_results values('${phase}',item.role||':'||item.scope||':'||item.reason,value,extract(epoch from clock_timestamp()-started)*1000);
 end loop;
 select id into strict actor_id from auth.users where email='test-admin@mathin.local';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated','aal','aal2')::text,true);
 begin perform set_config('request.jwt.claims','{}',true);update public.profiles set is_active=false where id=actor_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated','aal','aal2')::text,true);perform public.list_student_recontact_summaries('all','','dormant');raise exception 'INACTIVE_READ_ALLOWED';
 exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform set_config('request.jwt.claims','{}',true);update public.profiles set password_change_required=true,initial_password_set_at=coalesce(initial_password_set_at,now()),password_changed_at=null where id=actor_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated','aal','aal2')::text,true);perform public.list_student_recontact_summaries('all','','dormant');raise exception 'PASSWORD_RECOVERY_READ_ALLOWED';
 exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 perform set_config('request.jwt.claims','{}',true);execute 'set local role anon';begin perform public.list_student_recontact_summaries('all','','dormant');raise exception 'ANONYMOUS_READ_ALLOWED';exception when insufficient_privilege then null;end;execute 'reset role';
 end $$;`;}
