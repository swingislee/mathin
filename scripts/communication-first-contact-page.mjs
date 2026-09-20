import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--check','--apply'].includes(mode))throw Error('Use --check or --apply');
const root=path.resolve('.tmp/communication-first-contact-page');fs.mkdirSync(root,{recursive:true});
const {observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'preflight-error.txt')});
const sql=statement=>{
  try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
    {input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
  catch(error){fs.writeFileSync(path.join(root,'error.txt'),String(error.stderr??error.message));throw Error('LOCAL_PAGE_CHECK_FAILED: inspect private error file');}
};
const version='20260920224000_communication_first_contact_page',file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8');
const quote=value=>`'${value.replaceAll("'","''")}'`;
const signature='public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)';
const tables=['profiles','staff_role_members','role_permissions','school_subject_participants','school_subject_groups','school_business_group_members',
  'students','leads','lead_communications','activities','activity_registrations','assessment_results','course_enrollments','enrollments'];
const snapshot=()=>JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object(
  'facts',jsonb_build_object(${tables.map(table=>`${quote(table)},(select md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by to_jsonb(r)::text),'')) from public.${table} r)`).join(',')}),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_policy p),
  'functions',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_proc p where pronamespace='public'::regnamespace),
  'unchangedFunctions',(select md5(string_agg(to_jsonb(p)::text,'' order by oid)) from pg_proc p where pronamespace='public'::regnamespace and oid<>${quote(signature)}::regprocedure),
  'functionMetadata',(select jsonb_build_array(proowner,proacl,prosecdef,provolatile,proconfig) from pg_proc where oid=${quote(signature)}::regprocedure),
  'relations',(select md5(string_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity)::text,'' order by oid)) from pg_class where relnamespace='public'::regnamespace),
  'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m));commit;`));
const existing=sql(`begin read only;select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if(existing){assert.equal(existing,checksum);console.log(JSON.stringify({alreadyApplied:true,version}));process.exit(0);}
const before=snapshot();
const original=sql(`begin read only;select pg_get_functiondef(${quote(signature)}::regprocedure);commit;`);
if(mode==='--apply'){
  const checked=JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));
  assert.equal(checked.checksum,checksum);assert.equal(checked.zeroResidual,true);assert.deepEqual(checked.before,before);
  fs.writeFileSync(path.join(root,'rollback.sql'),`${original};\ndelete from public.schema_migrations where version=${quote(version)};\n`);
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='30s';${migration}
    insert into public.schema_migrations(version,checksum)values(${quote(version)},${quote(checksum)});commit;`);
  const after=snapshot();for(const key of ['facts','policies','relations','functionMetadata','unchangedFunctions'])assert.deepEqual(after[key],before[key]);
  fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({version,checksum,observed,before,after,businessUnchanged:true},null,2));
  console.log(JSON.stringify({version,localOnly:true,businessUnchanged:true}));process.exit(0);
}
const emails=[...new Set(fs.readFileSync('.claude/test-accounts.local.md','utf8').match(/[a-zA-Z0-9._+-]+@mathin\.local/g)??[])];assert.equal(emails.length,11);
const base={stage:'awaiting_first_contact',scope:'all',search:'',population:'records',page:1,pageSize:50,locale:'zh',query:{version:2,filters:{},sort:null,includeFacets:false},fast:true};
const cases=[
  ...['all','mine','group','unassigned'].map(scope=>({...base,name:`scope_${scope}`,scope,allActors:true,
    query:{...base.query,filters:scope==='all'?{}:{scope:{kind:'enum',values:[scope]}}}})),
  ...[20,100].map(pageSize=>({...base,name:`page_size_${pageSize}`,pageSize,page:2})),
  {...base,name:'last_page',page:1000000},
  {...base,name:'english',locale:'en'},
  {...base,name:'explicit_all',query:{...base.query,filters:{scope:{kind:'enum',values:['all']}}}},
  {...base,name:'omitted_sort',query:{version:2,filters:{},includeFacets:false}},
  {...base,name:'sort_fallback',query:{...base.query,sort:{field:'name',direction:'desc'}},fast:false},
  {...base,name:'filter_fallback',query:{...base.query,filters:{phone:{kind:'presence',value:'missing'}}},fast:false},
  {...base,name:'mismatched_scope_fallback',query:{...base.query,filters:{scope:{kind:'enum',values:['mine']}}},fast:false},
  {...base,name:'search_empty_result',search:'__communication_absent_search__',fast:false},
  {...base,name:'work_fallback',population:'work',fast:false},
  {...base,name:'assessment_fallback',stage:'awaiting_assessment',fast:false},
  {...base,name:'default_facets',query:{version:2,filters:{},sort:null},fast:false},
  {...base,name:'invalid_page',page:0,fast:false},
  {...base,name:'invalid_query',query:{...base.query,version:1},fast:false},
];
const probe=phase=>`do $probe$ declare actor record;spec record;value jsonb;started timestamptz;begin
  for spec in select * from cases order by name loop
    for actor in select * from actors where spec.all_actors or id=(select id from fixture) order by label loop
      perform set_config('request.jwt.claims',case when actor.id is null then '{}' else jsonb_build_object('sub',actor.id,'role','authenticated')::text end,true);
      started:=clock_timestamp();
      begin
        execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
        select public.list_student_records_page(spec.stage,spec.scope,spec.search,spec.population,spec.page,spec.page_size,spec.query,spec.locale,'{}'::jsonb) into value;
        reset role;
      exception when others then reset role;value:=jsonb_build_object('error',sqlstate,'message',sqlerrm);end;
      if value ? 'error' and value->>'message' not in ('FORBIDDEN','UNAUTHENTICATED','VALIDATION','permission denied for function list_student_records_page') then
        raise exception 'UNEXPECTED_PAGE_ERROR: %, %, %',spec.name,actor.label,value->>'message';
      end if;
      if ${quote(phase)}='after' and spec.fast and not value ? 'error' and value->'facets'<>'{}'::jsonb then raise exception 'FAST_BRANCH_NOT_USED: %',spec.name;end if;
      insert into results values(spec.name,${quote(phase)},actor.label,md5((case when spec.fast then value-'facets' else value end)::text),
        round(extract(epoch from clock_timestamp()-started)*1000),coalesce((value->>'count')::integer,0),value->>'error');
    end loop;
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end $probe$;`;
const output=sql(`begin;set local lock_timeout='3s';set local statement_timeout='180s';
  create temp table actors as select p.id,p.role||':'||row_number()over(order by p.role,p.id) as label from public.profiles p join auth.users u on u.id=p.id where u.email in (${emails.map(quote).join(',')});
  create temp table fixture as select id from actors where public.is_staff(id) and public.has_perm(id,'student.view.all') order by label limit 1;
  do $$begin if (select count(*) from fixture)<>1 then raise exception 'FIXED_BROAD_VIEW_REQUIRED';end if;end$$;
  insert into actors values(null,'anonymous');
  create temp table cases(name text,all_actors boolean,stage text,scope text,search text,population text,page integer,page_size integer,query jsonb,locale text,fast boolean);
  insert into cases values ${cases.map(c=>`(${quote(c.name)},${!!c.allActors},${quote(c.stage)},${quote(c.scope)},${quote(c.search)},${quote(c.population)},${c.page},${c.pageSize},${quote(JSON.stringify(c.query))}::jsonb,${quote(c.locale)},${c.fast})`).join(',')};
  create temp table results(name text,phase text,actor text,digest text,ms numeric,count integer,error text);
  ${probe('before')}${migration}${probe('after')}
  do $$begin if exists(select 1 from results a join results b using(name,actor) where a.phase='before' and b.phase='after' and a.digest<>b.digest) then raise exception 'PAGE_EQUIVALENCE_FAILED';end if;end$$;
  select jsonb_agg(jsonb_build_object('case',a.name,'actor',a.actor,'count',a.count,'error',a.error,'beforeMs',a.ms,'afterMs',b.ms) order by a.name,a.actor)
    from results a join results b using(name,actor) where a.phase='before' and b.phase='after';
  rollback;`);
assert.deepEqual(snapshot(),before);
const rows=JSON.parse(output);assert.equal(rows.length,63);assert(rows.some(row=>row.count>0));
fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({version,checksum,before,observed,zeroResidual:true,pageEquivalence:true,rows},null,2));
console.log(JSON.stringify({zeroResidual:true,pageEquivalence:true,comparisons:rows.length,timings:rows.filter(row=>row.actor.startsWith('admin:')&&!row.error)}));
