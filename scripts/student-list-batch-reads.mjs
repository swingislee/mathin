import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--check','--apply'].includes(mode)) throw new Error('Use --check or --apply');
const root='.tmp/student-list-batch-reads'; fs.mkdirSync(root,{recursive:true});
const {observed}=openHistoryLocalTarget({attestationPath:`${root}/target.json`,refresh:true,errorFile:`${root}/error.txt`});
console.log(JSON.stringify({localTargetVerified:true,...observed}));
const sql=statement=>{
  try { return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
    {input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}).trim(); }
  catch(error) {fs.writeFileSync(`${root}/error.txt`,String(error.stderr??error.message));fs.writeFileSync(`${root}/partial.jsonl`,String(error.stdout??''));throw new Error('BATCH_READ_CHECK_FAILED: inspect private error.txt');}
};
const version='20260915001000_student_list_batch_reads';
const file=`supabase/migrations/${version}.sql`,migration=fs.readFileSync(file,'utf8'),checksum=textFileSha256(file);
const changed="'student_list_base_facts','student_record_index_with_enrollments','student_record_list_rows','student_list_row_permissions','list_student_recontact_summaries'";
const added="'school_list_scope_keys','school_list_collaboration','school_list_apply_collaboration'";
const metadata=ignore=>`jsonb_build_object(
  'functions',(select md5(string_agg((${ignore?`case when proname in(${changed}) then to_jsonb(p)-'prosrc' else to_jsonb(p) end`:'to_jsonb(p)'})::text,'' order by oid))
    from pg_proc p where pronamespace in('public'::regnamespace,'mathin_internal'::regnamespace) ${ignore?`and proname not in(${added})`:''}),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_policy p),
  'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace and relkind in('r','v','m')),
  'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'))`;
const tables=['profiles','students','leads','lead_communications','student_follow_ups','course_enrollments','enrollments','school_subject_participants','school_subject_groups','school_business_group_members','history_workflow_scopes','history_workflow_decisions','communication_worklists','communication_worklist_items'];
const business=`jsonb_build_object(${tables.map(t=>`'${t}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${t} t)`).join(',')})`;
const snapshot=()=>JSON.parse(sql(`begin read only;select jsonb_build_object('metadata',${metadata(false)},'business',${business},'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const before=snapshot();
if(sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`))throw new Error('ALREADY_APPLIED');
const setup=`create temp table batch_guard as select ${metadata(true)} metadata,${business} business;`;
const guards=`do $guard$ begin
  if (select metadata from batch_guard) is distinct from ${metadata(true)} or (select business from batch_guard) is distinct from ${business} then raise exception 'UNEXPECTED_METADATA_OR_BUSINESS_CHANGE';end if;
  if exists(select 1 from pg_proc p where pronamespace='public'::regnamespace and proname in(${added}) and (
    has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
    or not proconfig @> array['search_path=public, pg_temp'])) then raise exception 'PRIVATE_HELPER_EXPOSED';end if;
end $guard$;`;
if(mode==='--apply'){
  const check=JSON.parse(fs.readFileSync(`${root}/check.json`,'utf8'));
  assert.equal(check.checksum,checksum);assert(check.zeroResidual);assert.deepEqual(check.before,before);
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${setup}${migration}${guards}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
  const after=snapshot();assert.deepEqual(after.business,before.business);
  fs.writeFileSync(`${root}/apply.json`,JSON.stringify({version,checksum,before,after},null,2)+'\n');
  console.log(JSON.stringify({version,checksum,applied:true}));process.exit(0);
}
const cases=[];
for(const role of ['admin','teacher']){
  for(const reason of ['unreachable','assessed','former','dormant'])cases.push({role,kind:'recontact',scope:'all',reason});
  for(const scope of ['mine','group','unassigned'])cases.push({role,kind:'recontact',scope,reason:'unreachable'});
  for(const population of ['work','records'])for(const stage of ['awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal'])cases.push({role,kind:'page',scope:'all',population,stage});
  for(const scope of ['mine','group','unassigned'])cases.push({role,kind:'page',scope,population:'records',stage:'awaiting_assessment'});
}
const capture=phase=>cases.map((sample,index)=>`do $capture$ declare c record;v jsonb;started timestamptz;jit_setting text:=current_setting('jit');loop_setting text:=current_setting('enable_nestloop');begin
 for c in select sample.*,u.id as actor from batch_cases sample join auth.users u on u.email='test-'||sample.role||'@mathin.local' where ordinal=${index+1} loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c.actor,'role','authenticated','aal','aal2')::text,true);
  execute 'set local role authenticated';started:=clock_timestamp();
  ${phase==='before'&&sample.kind==='page'&&sample.scope==='unassigned'?"perform set_config('jit','off',true);perform set_config('enable_nestloop','off',true);":''}
  if c.kind='recontact' then v:=public.list_student_recontact_summaries(c.scope,'',c.reason);
  else v:=public.list_student_records_page(c.stage,c.scope,'',c.population,2,20,'{"version":2,"filters":{},"sort":null}','zh','{}');end if;
  -- 来源编号是 UI 只使用数量的集合；连接计划可以改变其排列，成员和重复次数仍须一致。
  v:=jsonb_set(v,'{rows}',coalesce((select jsonb_agg(case when r.value ? 'inferredSourceIds' then
    jsonb_set(r.value,'{inferredSourceIds}',coalesce((select jsonb_agg(x order by x) from jsonb_array_elements(r.value->'inferredSourceIds') x),'[]'::jsonb))
    else r.value end order by r.ordinal) from jsonb_array_elements(v->'rows') with ordinality r(value,ordinal)),'[]'::jsonb));
  execute 'reset role';insert into batch_results values('${phase}',c.ordinal,v,round(extract(epoch from clock_timestamp()-started)*1000,1));
  perform set_config('jit',jit_setting,true);perform set_config('enable_nestloop',loop_setting,true);
 end loop;
end $capture$;
select jsonb_build_object('phase','${phase}','ordinal',${index+1},'ms',ms) from batch_results where phase='${phase}' and ordinal=${index+1};`).join('\n');
console.log(JSON.stringify({checking:true,cases:cases.length}));
const output=sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';${setup}
 create temp table batch_cases as select ordinal::integer,c.* from jsonb_array_elements('${JSON.stringify(cases)}'::jsonb) with ordinality e(value,ordinal)
   cross join lateral jsonb_to_record(e.value) c(role text,kind text,scope text,reason text,population text,stage text);
 do $$begin if (select count(*) from auth.users where email in('test-admin@mathin.local','test-teacher@mathin.local','test-parent@mathin.local','test-student@mathin.local'))<>4 then raise exception 'FIXED_IDENTITIES_REQUIRED';end if;end $$;
 -- 旧入口错误必须确实复现；对照基准只修复范围校验，仍执行原始查询与权限。
 do $$declare d text;begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated','aal','aal2')::text,true);
 begin perform public.list_student_recontact_summaries('group','','unreachable');raise exception 'EXPECTED_GROUP_VALIDATION';
 exception when raise_exception then if sqlerrm<>'VALIDATION' then raise;end if;end;
 select pg_get_functiondef('public.list_student_recontact_summaries(text,text,text)'::regprocedure) into d;
 execute replace(d,'(''mine'',''all'',''unassigned'')','(''mine'',''all'',''unassigned'',''group'')');end $$;
 create temp table batch_results(phase text,ordinal integer,value jsonb,ms numeric);
 ${capture('before')}
 do $$declare d text;begin select pg_get_functiondef('public.list_student_recontact_summaries(text,text,text)'::regprocedure) into d;
 execute replace(d,'(''mine'',''all'',''unassigned'',''group'')','(''mine'',''all'',''unassigned'')');end $$;
 ${migration}${capture('after')}${guards}
 do $$begin if exists(select 1 from batch_results a join batch_results b using(ordinal) where a.phase='before' and b.phase='after' and a.value is distinct from b.value)
   then raise exception 'BATCH_DTO_MISMATCH: %',(select string_agg(a.ordinal::text,',') from batch_results a join batch_results b using(ordinal) where a.phase='before' and b.phase='after' and a.value is distinct from b.value);end if;end $$;
 -- 集合范围与原函数逐个身份核对；投影同时核对全部当前存在的学生、未建档线索。
 set local statement_timeout='240s';
 create temp table batch_subjects as select 'student:'||id as key,id as student_id,null::uuid as lead_id from public.students
   union all select 'lead:'||id,null,id from public.leads where student_id is null;
 do $$declare actor uuid;scope text;begin
 for actor in select id from auth.users where email in('test-admin@mathin.local','test-teacher@mathin.local') loop
  foreach scope in array array['mine','group'] loop
   if exists(select 1 from batch_subjects s where exists(select 1 from public.school_list_scope_keys(actor,scope) k where k.key=s.key)
     is distinct from case when scope='mine' then public.school_subject_is_participant(s.student_id,s.lead_id,actor) else public.school_subject_in_my_groups(s.student_id,s.lead_id,actor) end) then raise exception 'SCOPE_SET_MISMATCH';end if;
  end loop;
  if exists(select 1 from public.school_list_collaboration((select jsonb_agg(to_jsonb(s)) from batch_subjects s),actor) c join batch_subjects s using(key)
    where c.projection is distinct from public.school_collaboration_projection(s.student_id,s.lead_id,actor)) then raise exception 'COLLABORATION_PROJECTION_MISMATCH';end if;
 end loop;
end $$;
 do $$declare actor uuid;bad_scope text;begin
 for actor in select id from auth.users where email in('test-parent@mathin.local','test-student@mathin.local') loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  begin perform public.list_student_recontact_summaries('all','','dormant');raise exception 'NONSTAFF_ALLOWED';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated','aal','aal2')::text,true);
 foreach bad_scope in array array['other','',null] loop
  begin perform public.list_student_recontact_summaries(bad_scope,'','dormant');raise exception 'INVALID_SCOPE_ALLOWED';exception when raise_exception then if sqlerrm<>'VALIDATION' then raise;end if;end;
 end loop;
 perform set_config('request.jwt.claims','{}',true);execute 'set local role anon';
 begin perform public.list_student_recontact_summaries('all','','dormant');raise exception 'ANON_ALLOWED';exception when insufficient_privilege then null;end;execute 'reset role';
end $$;
 -- 仅在本机回滚子事务中，用固定教师身份覆盖有成员的组及撤回；不新增身份。
 do $$declare teacher uuid;admin uuid;subject jsonb;sample_group uuid;v jsonb;begin
 select id into strict teacher from auth.users where email='test-teacher@mathin.local';
 select id into strict admin from auth.users where email='test-admin@mathin.local';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
 select r into subject from jsonb_array_elements(public.list_student_recontact_summaries('all','','unreachable')->'rows') r
   where r->>'studentId' is not null and not public.can_access_student((r->>'studentId')::uuid,teacher) limit 1;
 if subject is null then raise exception 'GROUP_READONLY_SAMPLE_REQUIRED';end if;
 begin
  perform set_config('request.jwt.claims','{}',true);
  insert into public.school_business_groups(name) values('local-batch-check-'||gen_random_uuid()) returning id into sample_group;
  insert into public.school_business_group_members(group_id,user_id) values(sample_group,teacher);
  insert into public.school_subject_groups(student_id,group_id,source_key) values((subject->>'studentId')::uuid,sample_group,'local-transaction-check');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated','aal','aal2')::text,true);
  execute 'set local role authenticated';v:=public.list_student_recontact_summaries('group','','unreachable');execute 'reset role';
  if not exists(select 1 from jsonb_array_elements(v->'rows') r where r->>'key'=subject->>'key' and r->>'inMyGroups'='true'
    and r->>'canWrite'='false' and r->>'canContact'='false') then raise exception 'GROUP_READ_OR_WRITE_BOUNDARY_CHANGED';end if;
  perform set_config('request.jwt.claims','{}',true);
  update public.school_business_group_members set removed_at=now() where group_id=sample_group and user_id=teacher;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated','aal','aal2')::text,true);
  if exists(select 1 from jsonb_array_elements(public.list_student_recontact_summaries('group','','unreachable')->'rows') r where r->>'key'=subject->>'key') then raise exception 'GROUP_REVOCATION_FAILED';end if;
  raise exception 'ROLLBACK_GROUP_CHECK';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_GROUP_CHECK' then raise;end if;end;
 end $$;
 ${guards}
 select jsonb_build_object('equalCases',(select count(*) from batch_results where phase='after'),'groupPositive',true,'scopeAndProjectionSubjects',(select count(*) from batch_subjects),
   'timing',(select jsonb_agg(jsonb_build_object('case',to_jsonb(c)-'ordinal','beforeMs',a.ms,'afterMs',b.ms) order by c.ordinal)
     from batch_cases c join batch_results a using(ordinal) join batch_results b using(ordinal) where a.phase='before' and b.phase='after'));rollback;`);
const result=JSON.parse(output.split('\n').filter(line=>line.startsWith('{')).at(-1));
assert.deepEqual(snapshot(),before);
fs.writeFileSync(`${root}/check.json`,JSON.stringify({version,checksum,before,result,zeroResidual:true},null,2)+'\n');
console.log(JSON.stringify({checksum,zeroResidual:true,...result}));
