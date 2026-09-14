import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

// 只连接已核对的隔离开发目标；模拟协作迁移后策略被覆盖的上线顺序。
const mode=process.argv[2];
if(!['--check','--apply'].includes(mode))throw new Error('Use --check or --apply');
const root=path.resolve('.tmp/dashboard-collaboration-read-path');fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});
const version='20260914001000_dashboard_collaboration_read_path';
const file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file),migration=fs.readFileSync(file,'utf8');
const digest=t=>`(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${t} t)`;
const facts=`jsonb_build_object(${['profiles','students','leads','lead_communications','lead_source_records','school_subject_participants','school_business_group_members'].map(t=>`'${t}',${digest(t)}`).join(',')})`;
const structure=`jsonb_build_object(
 'functions',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_proc p where pronamespace='public'::regnamespace),
 'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_policy p),
 'ledger',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from public.schema_migrations m))`;
const snapshot=()=>JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object('facts',${facts},'structure',${structure},'head',(select max(version) from public.schema_migrations));commit;`));
const before=snapshot();
fs.writeFileSync(path.join(root,'before.json'),JSON.stringify(before,null,2)+'\n','utf8');
const fixedEmails=[...new Set(fs.readFileSync('.claude/test-accounts.local.md','utf8').match(/[a-zA-Z0-9._+-]+@mathin\.local/g)??[])];
assert(fixedEmails.length>=7);
const existing=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if(existing){assert.equal(existing,checksum);console.log('ALREADY_APPLIED');process.exit(0);}
const readTables=['leads','business_lead_communications','lead_source_records','operational_leads'];
const capture=phase=>`do $capture$ declare actor record; relation text; started timestamptz; value jsonb;
begin
 for actor in select * from dashboard_actors order by label loop
  perform set_config('request.jwt.claims',case when actor.id is null then '{}' else jsonb_build_object('sub',actor.id,'role','authenticated','aal','aal2')::text end,true);
  execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
  foreach relation in array array[${readTables.map(t=>`'${t}'`).join(',')}] loop
   started:=clock_timestamp();
   begin execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(id::text,'','' order by id),''''))) from public.%I t',relation) into value;
   exception when insufficient_privilege then value:=jsonb_build_object('error',sqlstate);end;
   execute 'reset role';insert into dashboard_results values('${phase}',actor.label,relation,value,extract(epoch from clock_timestamp()-started)*1000);
   execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
  end loop;
  execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims','{}',true);
end $capture$;`;
if(mode==='--check'){
 const result=JSON.parse(sql(`begin;set local lock_timeout='5s';set local statement_timeout='240s';
 create temp table dashboard_actors as select p.id,p.role||':'||row_number() over(order by p.role,p.id) as label from public.profiles p join auth.users u on u.id=p.id where u.email in (${fixedEmails.map(e=>`'${e}'`).join(',')});
 do $$ begin if (select count(*) from dashboard_actors)<>${fixedEmails.length} then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED';end if;end $$;
 insert into dashboard_actors values(null,'anonymous');
 create temp table dashboard_results(phase text,actor text,relation text,value jsonb,ms numeric);
 -- 复现生产协作功能后补时覆盖早先策略优化的顺序。
 alter policy leads_select_pool_scope on public.leads using(public.can_view_school_lead(id,(select auth.uid())));
 create temp table dashboard_policy_before as select polname as name,pg_get_expr(polqual,polrelid) as qual from pg_policy
 where (polrelid='public.leads'::regclass and polname='leads_select_pool_scope') or (polrelid='public.course_enrollments'::regclass and polname='course_enrollments_select_scope');
 create temp table dashboard_read_students as select id student_id from public.students union all select null;
 ${capture('before')}
 ${migration}
 ${capture('after')}
 do $$ begin if exists(select 1 from dashboard_results a join dashboard_results b using(actor,relation) where a.phase='before' and b.phase='after' and a.value is distinct from b.value) then raise exception 'READ_SCOPE_CHANGED';end if;end $$;
 ${fs.readFileSync('scripts/sql/dashboard-read-account-state-assertions.sql','utf8')}
 -- 已有优化的数据库也可应用；再次执行保持同一表达式。
 create temp table optimized_before as select pg_get_expr(polqual,polrelid) qual from pg_policy where polrelid='public.leads'::regclass and polname='leads_select_pool_scope';
 ${migration}
 do $$ begin if (select qual from optimized_before) is distinct from (select pg_get_expr(polqual,polrelid) from pg_policy where polrelid='public.leads'::regclass and polname='leads_select_pool_scope') then raise exception 'REAPPLY_CHANGED_POLICY';end if;end $$;
 select jsonb_build_object('actors',(select count(*) from dashboard_actors),'comparisons',(select count(*) from dashboard_results where phase='after'),'equal',true,
 'timing',(select jsonb_agg(jsonb_build_object('actor',a.actor,'relation',a.relation,'beforeMs',round(a.ms,1),'afterMs',round(b.ms,1)) order by a.actor,a.relation) from dashboard_results a join dashboard_results b using(actor,relation) where a.phase='before' and b.phase='after'));
 rollback;`));
 assert.deepEqual(snapshot(),before);
 fs.writeFileSync(path.join(root,'check.json'),JSON.stringify({checksum,before,result,zeroResidual:true,checkedAt:new Date().toISOString()},null,2)+'\n','utf8');
 console.log(JSON.stringify({localTargetVerified:true,checksum,zeroResidual:true,...result}));
}else{
 const checked=JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8'));assert.equal(checked.checksum,checksum);assert.deepEqual(checked.before,before);assert.equal(checked.zeroResidual,true);
 sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${migration}
 insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
 const after=snapshot();assert.deepEqual(after.facts,before.facts);
 fs.writeFileSync(path.join(root,'apply.json'),JSON.stringify({checksum,before,after,observed,businessUnchanged:true},null,2)+'\n','utf8');
 console.log(JSON.stringify({localTargetVerified:true,version,checksum,businessUnchanged:true}));
}
