import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--check','--apply'].includes(mode))throw Error('Use --check or --apply');
const root=path.resolve('.tmp/communication-scope-reads');fs.mkdirSync(root,{recursive:true});
const {observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'preflight-error.txt')});
const sql=statement=>{
  try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
    {input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
  catch(error){fs.writeFileSync(path.join(root,'error.txt'),String(error.stderr??error.message));throw Error('LOCAL_READ_CHECK_FAILED: inspect private error file');}
};
const version='20260920220000_communication_scope_reads',file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8');
const quote=v=>`'${v.replaceAll("'","''")}'`;
const tables=['profiles','staff_role_members','role_permissions','school_subject_participants','school_subject_groups','school_business_group_members',
  'students','leads','lead_communications','activities','activity_registrations','assessment_results','course_enrollments','enrollments'];
const snapshot=()=>JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object(
  'facts',jsonb_build_object(${tables.map(t=>`${quote(t)},(select md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by to_jsonb(r)::text),'')) from public.${t} r)`).join(',')}),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_policy p),
  'functions',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_proc p where pronamespace='public'::regnamespace),
  'unchangedFunctions',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_proc p where pronamespace='public'::regnamespace and proname not in ('school_list_visibility','student_list_query_facts')),
  'functionMetadata',(select jsonb_build_array(proowner,proacl,prosecdef,provolatile,proconfig) from pg_proc where oid='public.student_list_query_facts(text,text,text,text,jsonb)'::regprocedure),
  'relations',(select md5(string_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace),
  'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const existing=sql(`begin read only;select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if(existing){assert.equal(existing,checksum);console.log(JSON.stringify({alreadyApplied:true,version}));process.exit(0);}
const before=snapshot();
const original=sql("begin read only;select pg_get_functiondef('public.student_list_query_facts(text,text,text,text,jsonb)'::regprocedure);commit;");
if(mode==='--apply'){
  const checked=JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));
  assert.equal(checked.checksum,checksum);assert.equal(checked.zeroResidual,true);assert.deepEqual(checked.before,before);
  fs.writeFileSync(path.join(root,'rollback.sql'),`${original};\ndrop function public.school_list_visibility(uuid);\ndelete from public.schema_migrations where version=${quote(version)};\n`);
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='30s';${migration}
    insert into public.schema_migrations(version,checksum)values(${quote(version)},${quote(checksum)});commit;`);
  const after=snapshot();for(const key of ['facts','policies','relations','functionMetadata','unchangedFunctions'])assert.deepEqual(after[key],before[key]);
  fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({version,checksum,observed,before,after,businessUnchanged:true},null,2));
  console.log(JSON.stringify({version,localOnly:true,businessUnchanged:true}));process.exit(0);
}
const emails=[...new Set(fs.readFileSync('.claude/test-accounts.local.md','utf8').match(/[a-zA-Z0-9._+-]+@mathin\.local/g)??[])];assert.equal(emails.length,11);
const probe=(phase,scenario,only=false)=>`do $probe$ declare actor record;scope text;value jsonb;started timestamptz;begin
  for actor in select * from actors ${only?'where id=(select id from fixture)':''} order by label loop
    perform set_config('request.jwt.claims',case when actor.id is null then '{}' else jsonb_build_object('sub',actor.id,'role','authenticated')::text end,true);
    foreach scope in array array['all','mine'] loop
      started:=clock_timestamp();
      begin
        execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
        select public.list_student_records_page('awaiting_first_contact',scope,'','records',1,50,'{"version":2,"filters":{},"sort":null}'::jsonb,'zh','{}'::jsonb) into value;
        reset role;
      exception when others then reset role;value:=jsonb_build_object('error',sqlstate,'message',sqlerrm);end;
      insert into results values(${quote(scenario)},${quote(phase)},actor.label,scope,md5(value::text),round(extract(epoch from clock_timestamp()-started)*1000),coalesce((value->>'count')::integer,0));
    end loop;
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end $probe$;`;
const parity=(only=false)=>`do $parity$ declare actor record;begin
  for actor in select * from actors ${only?'where id=(select id from fixture)':''} loop
    if exists(with expected as materialized (
      select 'student:'||s.id as key,public.can_access_student(s.id,actor.id) as access,public.can_view_school_student(s.id,actor.id) as visible from public.students s
      union all select 'lead:'||l.id,public.can_edit_school_lead(l.id,actor.id),public.can_view_school_lead(l.id,actor.id) from public.leads l
    ), actual as materialized (select * from public.school_list_visibility(actor.id))
    select 1 from expected e full join actual a using(key) where e.key is null or a.key is null or (e.access is true)<>(a.can_access is true) or (e.visible is true)<>(a.can_view is true)) then
      raise exception 'VISIBILITY_MISMATCH: %',actor.label;
    end if;
  end loop;
end $parity$;`;
const compare=scenario=>`do $$begin if exists(select 1 from results a join results b using(scenario,actor,scope)
  where a.phase='before' and b.phase='after' and a.scenario=${quote(scenario)} and a.digest<>b.digest) then raise exception 'PAGE_EQUIVALENCE_FAILED';end if;end$$;`;
const states=[['permissions_revoked',`delete from public.staff_role_members where user_id=(select id from fixture);`],
  ['collaboration_removed',`delete from public.school_subject_participants where user_id=(select id from fixture);update public.school_business_group_members set removed_at=now() where user_id=(select id from fixture);`],
  ['inactive',`update public.profiles set is_active=false where id=(select id from fixture);`],
  ['locked',`update public.profiles set account_status='locked' where id=(select id from fixture);`],
  ['password_change_required',`update public.profiles set password_change_required=true,initial_password_set_at=coalesce(initial_password_set_at,now()),password_changed_at=null where id=(select id from fixture);`]];
const output=sql(`begin;set local lock_timeout='3s';set local statement_timeout='240s';set local plan_cache_mode=force_generic_plan;
  create temp table actors as select p.id,p.role||':'||row_number()over(order by p.role,p.id) as label from public.profiles p join auth.users u on u.id=p.id where u.email in (${emails.map(quote).join(',')});
  create temp table fixture as select id from actors where label like 'staff:%' order by (select count(*) from public.school_subject_participants p where p.user_id=actors.id) desc limit 1;
  do $$begin if (select count(*) from fixture)<>1 then raise exception 'FIXED_STAFF_REQUIRED';end if;end$$;
  insert into actors values(null,'anonymous');
  create temp table results(scenario text,phase text,actor text,scope text,digest text,ms numeric,count integer);
  ${probe('before','fixed')}${migration}
  ${parity()}${probe('after','fixed')}${compare('fixed')}
  create temp table optimized as select pg_get_functiondef('public.student_list_query_facts(text,text,text,text,jsonb)'::regprocedure) as definition;
  ${states.map(([name,update])=>`savepoint actor_state;${update}${original};${probe('before',name,true)}
    do $$begin execute (select definition from optimized);end$$;${parity(true)}${probe('after',name,true)}${compare(name)}rollback to savepoint actor_state;`).join('\n')}
  do $$begin if has_function_privilege('authenticated','public.school_list_visibility(uuid)','execute') or has_function_privilege('anon','public.school_list_visibility(uuid)','execute') or has_function_privilege('service_role','public.school_list_visibility(uuid)','execute') then raise exception 'PRIVATE_HELPER_EXPOSED';end if;end$$;
  select jsonb_agg(jsonb_build_object('scenario',a.scenario,'actor',a.actor,'scope',a.scope,'count',a.count,'beforeMs',a.ms,'afterMs',b.ms) order by a.scenario,a.actor,a.scope)
    from results a join results b using(scenario,actor,scope) where a.phase='before' and b.phase='after';
  rollback;`);
assert.deepEqual(snapshot(),before);
const rows=JSON.parse(output);assert.equal(rows.length,24);
// 状态探针在各自 savepoint 内完成对照，回退同时移除它们的临时结果。
fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({version,checksum,before,observed,zeroResidual:true,fullVisibilityParity:true,stateComparisons:states.length*2,rows},null,2));
console.log(JSON.stringify({zeroResidual:true,fullVisibilityParity:true,comparisons:rows.length,stateComparisons:states.length*2,rows}));
