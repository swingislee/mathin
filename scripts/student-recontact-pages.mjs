import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';import {textFileSha256} from './lib/text-hash.mjs';
const mode=process.argv[2];if(!['--check','--apply'].includes(mode))throw Error('Use --check or --apply');
const root='.tmp/student-recontact-pages';fs.mkdirSync(root,{recursive:true});
const {observed}=openHistoryLocalTarget({attestationPath:`${root}/target.json`,refresh:true,errorFile:`${root}/error.txt`});console.log(JSON.stringify({localTargetVerified:true,...observed}));
const sql=q=>{try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
catch(e){fs.writeFileSync(`${root}/error.txt`,String(e.stderr??e.message));fs.writeFileSync(`${root}/partial.jsonl`,String(e.stdout??''));throw Error('RECONTACT_PAGE_CHECK_FAILED');}};
const version='20260915002000_student_recontact_pages',file=`supabase/migrations/${version}.sql`,migration=fs.readFileSync(file,'utf8'),checksum=textFileSha256(file);
const changed="'student_list_base_facts','student_list_field'",added="'student_list_query_facts','list_student_recontact_page'";
const metadata=ignore=>`jsonb_build_object('functions',(select md5(string_agg((${ignore?`case when proname in(${changed}) then to_jsonb(p)-'prosrc' else to_jsonb(p) end`:'to_jsonb(p)'})::text,'' order by oid)) from pg_proc p where pronamespace in('public'::regnamespace,'mathin_internal'::regnamespace) ${ignore?`and proname not in(${added})`:''}),
'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_policy p),'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind in('r','v','m')))`;
const tables=['profiles','students','leads','lead_communications','student_follow_ups','course_enrollments','enrollments','school_subject_participants','school_subject_groups','school_business_group_members','history_workflow_scopes','history_workflow_decisions','communication_worklists','communication_worklist_items'];
const business=`jsonb_build_object(${tables.map(t=>`'${t}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${t} t)`).join(',')})`;
const snapshot=()=>JSON.parse(sql(`begin read only;select jsonb_build_object('metadata',${metadata(false)},'business',${business},'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const before=snapshot();if(sql(`begin read only;select 1 from public.schema_migrations where version='${version}';commit;`))throw Error('ALREADY_APPLIED');
assert.equal(sql("begin read only;select checksum from public.schema_migrations where version='20260915001000_student_list_batch_reads';commit;"),textFileSha256('supabase/migrations/20260915001000_student_list_batch_reads.sql'),'BATCH_MIGRATION_REQUIRED');
const setup=`create temp table page_guard as select ${metadata(true)} metadata,${business} business;`;
const guards=`do $$begin if (select metadata from page_guard) is distinct from ${metadata(true)} or (select business from page_guard) is distinct from ${business} then raise exception 'UNEXPECTED_SCHEMA_OR_BUSINESS_CHANGE';end if;
if has_function_privilege('authenticated','public.student_list_query_facts(text,text,text,text,jsonb)','execute') or has_function_privilege('anon','public.student_list_query_facts(text,text,text,text,jsonb)','execute')
or has_function_privilege('service_role','public.student_list_query_facts(text,text,text,text,jsonb)','execute') or has_function_privilege('anon','public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb)','execute')
or not has_function_privilege('authenticated','public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb)','execute') then raise exception 'PAGE_ACL_CHANGED';end if;end $$;`;
if(mode==='--apply'){
 const check=JSON.parse(fs.readFileSync(`${root}/check.json`,'utf8'));assert.equal(check.checksum,checksum);assert(check.zeroResidual);assert.deepEqual(check.before,before);
 const fields=JSON.parse(fs.readFileSync(`${root}/field-contract.json`,'utf8'));assert.equal(fields.checksum,checksum);assert(fields.passed);
 sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${setup}${migration}${guards}insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
 const after=snapshot();assert.deepEqual(after.business,before.business);fs.writeFileSync(`${root}/apply.json`,JSON.stringify({checksum,before,after},null,2)+'\n');console.log(JSON.stringify({applied:true,version,checksum}));process.exit(0);
}
const cases=[];for(const role of ['admin','teacher'])for(const reason of ['unreachable','assessed','former','dormant'])cases.push({role,scope:'all',reason});
for(const scope of ['mine','group','unassigned'])cases.push({role:'admin',scope,reason:'unreachable'});
const normalize=`create function pg_temp.normalized_page_rows(rows jsonb) returns jsonb language sql immutable as $$
select coalesce(jsonb_agg(case when r.value ? 'inferredSourceIds' then jsonb_set(r.value,'{inferredSourceIds}',coalesce((select jsonb_agg(x order by x) from jsonb_array_elements(r.value->'inferredSourceIds') x),'[]'::jsonb)) else r.value end order by r.ordinal),'[]'::jsonb)
from jsonb_array_elements(rows) with ordinality r(value,ordinal);$$;`;
const factCases=['work','records'].flatMap(population=>['awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal'].map(stage=>({role:'admin',population,stage})));
for(const stage of ['awaiting_first_contact','awaiting_enrollment'])factCases.push({role:'teacher',population:'records',stage});
const captureFacts=phase=>factCases.map((c,i)=>`do $$declare v jsonb;begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-${c.role}@mathin.local'),'role','authenticated','aal','aal2')::text,true);
 select jsonb_build_object('count',count(*),'digest',md5(string_agg(pg_temp.normalized_page_rows(jsonb_build_array(row_data))::text||':'||index_stage,'' order by row_data->>'key',index_stage))) into v
   from public.student_list_base_facts('all','','${c.population}','${c.stage}');
 insert into fact_results values('${phase}',${i},v);end $$;`).join('\n');
const checkCases=cases.map((c,i)=>`do $check$ declare expected jsonb;actual jsonb;requested integer;size integer;pages integer;page integer;n integer;expected_rows jsonb;started timestamptz;calls_before bigint;calls_after bigint;begin
perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-${c.role}@mathin.local'),'role','authenticated','aal','aal2')::text,true);
execute 'set local role authenticated';expected:=public.list_student_recontact_summaries('${c.scope}','','${c.reason}');execute 'reset role';
n:=jsonb_array_length(expected->'rows');
foreach requested in array array[1,999] loop
 size:=case when requested=1 then 20 else 50 end;pages:=greatest(1,ceil(n::numeric/size)::integer);page:=least(requested,pages);
 select coalesce(jsonb_agg(r.value order by r.ordinal),'[]'::jsonb) into expected_rows from jsonb_array_elements(expected->'rows') with ordinality r(value,ordinal) where r.ordinal between (page-1)*size+1 and page*size;
 select coalesce(sum(calls),0) into calls_before from pg_stat_xact_user_functions where funcname='read_student_record_with_enrollments';
 execute 'set local role authenticated';started:=clock_timestamp();actual:=public.list_student_recontact_page('${c.scope}','','${c.reason}',requested,size,'{"version":2,"filters":{},"sort":null}','zh','{}');execute 'reset role';
 insert into timings values(${i},requested,round(extract(epoch from clock_timestamp()-started)*1000,1),jsonb_array_length(actual->'rows'),octet_length(actual::text));
 select coalesce(sum(calls),0) into calls_after from pg_stat_xact_user_functions where funcname='read_student_record_with_enrollments';
 if calls_after-calls_before>jsonb_array_length(actual->'rows') then raise exception 'DETAIL_READ_BEFORE_PAGINATION';end if;
 if actual->>'count'<>n::text or actual->>'page'<>page::text or actual->>'totalPages'<>pages::text or actual->'reasonCounts' is distinct from expected->'reasonCounts'
   or pg_temp.normalized_page_rows(actual->'rows') is distinct from pg_temp.normalized_page_rows(expected_rows) then raise exception 'PAGE_DTO_MISMATCH: ${i}, %',requested;end if;
end loop;end $check$;
select jsonb_build_object('case',${i},'passed',true);`).join('\n');
console.log(JSON.stringify({checking:true,realDataCases:cases.length*2}));
const output=sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';set local track_functions='all';${setup}${normalize}
create temp table fact_results(phase text,i integer,value jsonb);${captureFacts('before')}${migration}${captureFacts('after')}
do $$begin if exists(select 1 from fact_results a join fact_results b using(i) where a.phase='before' and b.phase='after' and a.value is distinct from b.value) then raise exception 'REGULAR_FACTS_CHANGED';end if;end $$;
create temp table timings(i integer,page integer,ms numeric,rows integer,bytes integer);
${checkCases}
do $$declare actor uuid;bad jsonb;begin
for actor in select id from auth.users where email in('test-parent@mathin.local','test-student@mathin.local') loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
 begin perform public.list_student_recontact_page('all','','dormant',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');raise exception 'NONSTAFF_PAGE_ALLOWED';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end loop;
select id into strict actor from auth.users where email='test-admin@mathin.local';
perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
foreach bad in array array['{}'::jsonb,'{"version":2,"filters":{"unknown":{"kind":"presence","value":"present"}},"sort":null}',
'{"version":2,"filters":{"lastContactAt":{"kind":"date","from":"2026-02-30","to":"2026-03-01"}},"sort":null}',
'{"version":2,"filters":{},"sort":{"field":"scope","direction":"asc"}}'] loop
 begin perform public.list_student_recontact_page('all','','dormant',1,20,bad,'zh','{}');raise exception 'INVALID_PAGE_QUERY_ALLOWED';exception when raise_exception then if sqlerrm<>'VALIDATION' then raise;end if;end;
end loop;
begin
 perform set_config('request.jwt.claims','{}',true);update public.profiles set is_active=false where id=actor;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
 perform public.list_student_recontact_page('all','','dormant',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');raise exception 'INACTIVE_PAGE_ALLOWED';
exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
begin
 perform set_config('request.jwt.claims','{}',true);update public.profiles set password_change_required=true,initial_password_set_at=coalesce(initial_password_set_at,now()),password_changed_at=null where id=actor;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
 perform public.list_student_recontact_page('all','','dormant',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');raise exception 'PASSWORD_RECOVERY_PAGE_ALLOWED';
exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
perform set_config('request.jwt.claims','{}',true);execute 'set local role anon';
begin perform public.list_student_recontact_page('all','','dormant',1,20,'{"version":2,"filters":{},"sort":null}','zh','{}');raise exception 'ANON_PAGE_ALLOWED';exception when insufficient_privilege then null;end;execute 'reset role';end $$;
${guards}
select jsonb_build_object('realDataPages',${cases.length*2},'regularFactCases',${factCases.length},'detailsBoundedToPage',true,'permissions',true,'timing',(select jsonb_agg(to_jsonb(t) order by i,page) from timings t));rollback;`);
const result=JSON.parse(output.split('\n').filter(l=>l.startsWith('{')).at(-1));assert.deepEqual(snapshot(),before);
fs.writeFileSync(`${root}/check.json`,JSON.stringify({version,checksum,before,cases,result,zeroResidual:true},null,2)+'\n');console.log(JSON.stringify({checksum,zeroResidual:true,...result}));
