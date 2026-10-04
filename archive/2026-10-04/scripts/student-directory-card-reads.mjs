import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';

const root='.tmp/student-directory-upgrade-20260921';
const versions=['20260921180000_student_directory_batch_visibility','20260921190000_student_directory_card_reads'];
const migrations=versions.map(version=>({version,file:`supabase/migrations/${version}.sql`})).map(m=>({...m,checksum:textFileSha256(m.file),body:fs.readFileSync(m.file,'utf8')}));
const mode=process.argv[2];if(!['--check','--apply'].includes(mode))throw Error('Use --check or --apply');
fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:`${root}/target.json`,refresh:true,errorFile:`${root}/error.private.txt`});
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const fingerprint=()=>sql(`begin read only;select jsonb_build_object(
  'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
  'policies',(select md5(jsonb_agg(to_jsonb(p) order by oid)::text) from pg_policy p),
  'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'),
  'objects',jsonb_build_object('students',(select count(*) from public.students),'leads',(select count(*) from public.leads),'enrollments',(select count(*) from public.enrollments),'history',(select count(*) from public.history_import_records)),
  'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m));commit;`);
const before=fingerprint();
const existing=JSON.parse(sql(`begin read only;select coalesce(jsonb_object_agg(version,checksum),'{}') from public.schema_migrations where version in (${versions.map(q).join(',')});commit;`));
if(Object.keys(existing).length){for(const m of migrations)assert.equal(existing[m.version],m.checksum,'PARTIAL_OR_CHANGED_MIGRATION');console.log(JSON.stringify({alreadyApplied:true}));process.exit(0);}
if(mode==='--apply'){
  const check=JSON.parse(fs.readFileSync(`${root}/check.json`,'utf8'));
  assert.equal(check.passed,true);assert.equal(check.before,before,'DATABASE_CHANGED_AFTER_CHECK');
  assert.deepEqual(check.migrations,migrations.map(({version,checksum})=>({version,checksum})));
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${migrations.map(m=>`${m.body}\ninsert into public.schema_migrations(version,checksum) values(${q(m.version)},${q(m.checksum)});`).join('\n')}notify pgrst,'reload schema';commit;`);
  fs.writeFileSync(`${root}/apply.json`,JSON.stringify({checkedAt:new Date().toISOString(),target:observed.systemIdentifier,migrations:check.migrations,applied:true},null,2));
  console.log(JSON.stringify({applied:true,versions}));process.exit(0);
}

const indexSignature='public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])';
const directorySignature='public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])';
const originals=[indexSignature,directorySignature].map(signature=>sql(`begin read only;select pg_get_functiondef(${q(signature)}::regprocedure);commit;`));
const restore=`${originals.join(';\n')};
drop function public.list_student_directory_cards(text,text,text,text,text,integer,integer);
drop function public.student_directory_page(text,text,text,text,text,integer,integer,uuid[],boolean);
drop function public.student_directory_card_rows(jsonb,public.business_course_enrollment_subjects[]);
drop function public.student_record_index_for_population(text,text,public.business_course_enrollment_subjects[],boolean);`;
fs.writeFileSync(`${root}/restore.sql`,`begin;set local lock_timeout='3s';\n${restore}\n${migrations.map(m=>`delete from public.schema_migrations where version=${q(m.version)} and checksum=${q(m.checksum)};`).join('\n')}\nnotify pgrst,'reload schema';commit;\n`);

// 与现有 TypeScript 卡片映射逐字段对照；仅摘要进入共享验证输出。
const projection=fs.readFileSync('scripts/sql/student-directory-card-projection.sql','utf8');
const params=(change={})=>({scope:'all',search:"''",stage:'all',groupBy:'classroom',group:"''",page:1,size:100,...change});
const cases=[['default',params()],['size20',params({size:20})],['page2',params({page:2,size:50})],['last-page',params({page:1000000,size:20})],
  ...['grade','owner','group','none'].map(groupBy=>[groupBy,params({groupBy})]),
  ...['mine','group','unassigned'].map(scope=>[`scope-${scope}`,params({scope})]),
  ...['awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student'].map(stage=>[stage,params({stage})]),
  ['no-match',params({search:"'__directory_card_no_match__'"})],
  ['name',params({search:'(select left(name,1) from public.students where deleted_at is null order by id limit 1)'})],
  ['phone',params({search:"(select right(regexp_replace(parent_phone||phone,'[^0-9]','','g'),4) from public.students where deleted_at is null and length(parent_phone||phone)>=4 order by id limit 1)"})],
  ['identity',params({search:'(select id::text from public.students where deleted_at is null order by id limit 1)'})],
  ['unassigned-group',params({group:"'unassigned'"})],
  ['real-group',params({group:'(select id::text from public.classrooms where archived_at is null and trashed_at is null order by id limit 1)'})],
  ['invalid',params({scope:'invalid'})],['null-search',params({search:'null'})],
  ['selected',params({groupBy:'none',selected:'array(select id from public.students where deleted_at is null order by id desc limit 3)'})]];
const roles=['admin','principal','teacher','research','student','parent'];
const forRole=role=>role==='admin'?cases:cases.filter(([label])=>['default','owner','scope-mine','scope-group','scope-unassigned','no-match','invalid'].includes(label));
const claims=Object.fromEntries(roles.map(role=>[role,JSON.stringify({sub:sql(`begin read only;select id from auth.users where email=${q(loadFixedAccount(role).email)};commit;`),role:'authenticated'})]));
const authorize=role=>`set local role postgres;set local request.jwt.claims=${q(claims[role])};set local role authenticated;`;
const call=(p,cards=false)=>`select public.${cards?'list_student_directory_cards':'list_student_directory'}(${q(p.scope)},${p.search},${q(p.stage)},${q(p.groupBy)},${p.group},${p.page},${p.size}${cards?'':','+(p.selected??'null')})`;
const capture=(phase,actor,label,query,kind='full')=>`do $capture$ declare p jsonb;t timestamptz:=clock_timestamp();err text;begin
 begin execute ${q(query)} into p;exception when others then err:=sqlstate||':'||sqlerrm;end;
 insert into directory_results values(${q(phase)},${q(actor)},${q(label)},${q(kind)},p,err,extract(epoch from clock_timestamp()-t)*1000);
 end;$capture$;`;
const sample=(phase,cards=false)=>roles.map(role=>`${authorize(role)}${forRole(role).filter(([,p])=>!cards||!p.selected).map(([label,p])=>capture(phase,role,label,call(p,cards),cards?'cards':'full')).join('\n')}reset role;`).join('\n');
const indexSample=phase=>['admin','teacher'].map(role=>`${authorize(role)}set local role postgres;${['all','mine','group','unassigned'].map(scope=>capture(phase,role,`index-${scope}`,`select coalesce(jsonb_agg(to_jsonb(s) order by s.key,s.lead_id,s.stage,s.detail),'[]'::jsonb) from public.student_record_index_with_enrollments(${q(scope)},'',array(select e from public.business_course_enrollment_subjects e)) s`,'index')).join('\n')}reset role;`).join('\n');
const pages=Number(sql('begin read only;select ceil(count(*)::numeric/100)::integer from public.students where deleted_at is null;commit;'));
const allPages=`${authorize('admin')}${Array.from({length:pages},(_,i)=>['full','cards'].map(kind=>capture('sweep','admin',`page-${i+1}`,call(params({page:i+1}),kind==='cards'),kind)).join('\n')).join('\n')}reset role;`;
const contracts=`do $contract$ begin
 if exists(select 1 from directory_contract c join pg_proc p using(oid) where
   to_jsonb(c) is distinct from (select to_jsonb(v) from(select p.oid,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.prorettype,p.proretset,p.proargtypes,p.proallargtypes,p.proargmodes,p.proconfig) v)) then raise exception 'EXISTING_FUNCTION_CONTRACT_CHANGED';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
   p.proname in ('student_directory_page','student_directory_card_rows','student_record_index_for_population') and
   (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))) then raise exception 'PRIVATE_READER_EXPOSED';end if;
 if has_function_privilege('anon','public.list_student_directory_cards(text,text,text,text,text,integer,integer)','execute') or
   has_function_privilege('service_role','public.list_student_directory_cards(text,text,text,text,text,integer,integer)','execute') or
   not has_function_privilege('authenticated','public.list_student_directory_cards(text,text,text,text,text,integer,integer)','execute') then raise exception 'CARDS_EXECUTE_ACL_CHANGED';end if;
end;$contract$;`;
const output=sql(`begin isolation level repeatable read;set local lock_timeout='3s';set local statement_timeout='180s';set local jit=off;
create temp table directory_results(phase text,actor text,label text,kind text,payload jsonb,error text,ms numeric);
create temp table directory_contract as select oid,proowner,proacl,prosecdef,provolatile,prorettype,proretset,proargtypes,proallargtypes,proargmodes,proconfig from pg_proc
  where oid in(${q(indexSignature)}::regprocedure,${q(directorySignature)}::regprocedure);
grant select,insert on directory_results to authenticated;${projection}
${sample('before')}${indexSample('before')}
${migrations.map(m=>m.body).join('\n')}${contracts}
${sample('after')}${sample('cards',true)}${indexSample('after')}${allPages}
set local directory.cards.admin=${q(JSON.parse(claims.admin).sub)};set local directory.cards.teacher=${q(JSON.parse(claims.teacher).sub)};
${fs.readFileSync('scripts/sql/student-directory-card-assertions.sql','utf8')}
prepare directory_card_read(text) as select public.list_student_directory_cards($1,'','all','classroom','',1,100);
${['admin','teacher','admin'].map((role,i)=>`${authorize(role)}${capture('prepared',role,`identity-${i}`,"execute directory_card_read('all')",'cards')}reset role;`).join('\n')}
${restore}
${['admin','teacher'].map(role=>`${authorize(role)}${capture('restored',role,'default',call(params()))}reset role;`).join('\n')}
select jsonb_build_object('samples',(select jsonb_agg(jsonb_build_object('phase',phase,'actor',actor,'label',label,'kind',kind,
 'digest',md5(payload::text),'cardDigest',case when kind='full' then md5(pg_temp.project_cards(payload)::text) else md5(payload::text) end,
 'rows',case when kind='index' then jsonb_array_length(payload) else jsonb_array_length(payload->'rows') end,'error',error,'ms',ms)) from directory_results),
 'differences',(select jsonb_agg(to_jsonb(d)) from(select old.actor,old.label,k.key as field,count(*) from directory_results old join directory_results new using(actor,label)
 cross join lateral jsonb_array_elements(pg_temp.project_cards(old.payload)->'rows') with ordinality x(v,i)
 join lateral jsonb_array_elements(new.payload->'rows') with ordinality y(v,i) on x.i=y.i
 cross join lateral jsonb_each(x.v) k where old.phase='before' and old.kind='full' and new.phase='cards' and k.value is distinct from y.v->k.key
 group by old.actor,old.label,k.key) d));rollback;`);
assert.equal(fingerprint(),before,'ROLLBACK_CHANGED_DATABASE');
const result=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{')));
const report={checkedAt:new Date().toISOString(),migrations:migrations.map(({version,checksum})=>({version,checksum})),before,...result,passed:false};
fs.writeFileSync(`${root}/check.json`,JSON.stringify(report,null,2));
for(const old of result.samples.filter(s=>s.phase==='before')){
  const after=result.samples.find(s=>s.phase==='after'&&s.actor===old.actor&&s.label===old.label);
  assert.deepEqual([after.digest,after.error],[old.digest,old.error],`FULL_RESULT_CHANGED:${old.actor}/${old.label}`);
  const cards=result.samples.find(s=>s.phase==='cards'&&s.actor===old.actor&&s.label===old.label);
  if(cards)assert.deepEqual([cards.digest,cards.error],[old.cardDigest,old.error],`CARD_RESULT_CHANGED:${old.actor}/${old.label}`);
  if(['admin','principal','teacher'].includes(old.actor)&&!['invalid','null-search'].includes(old.label))assert.equal(old.error,null,`UNEXPECTED_OLD_ERROR:${old.actor}/${old.label}`);
  if(['student','parent','research'].includes(old.actor))assert.ok(old.error?.includes('FORBIDDEN'));
}
for(const full of result.samples.filter(s=>s.phase==='sweep'&&s.kind==='full')){
  const card=result.samples.find(s=>s.phase==='sweep'&&s.kind==='cards'&&s.label===full.label);
  assert.equal(full.error,null);assert.equal(card.error,null);assert.equal(card.digest,full.cardDigest,`SWEEP_CHANGED:${full.label}`);
}
for(const s of result.samples.filter(s=>s.phase==='prepared'||s.phase==='restored')){
  const old=result.samples.find(x=>x.phase==='before'&&x.actor===s.actor&&x.label==='default');
  assert.equal(s.error,null);assert.equal(s.digest,s.phase==='prepared'?old.cardDigest:old.digest,`${s.phase}:${s.actor}`);
}
report.passed=true;fs.writeFileSync(`${root}/check.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,roles:roles.length,samples:result.samples.length,sweptPages:pages,rollbackUnchanged:true,
  defaultSamples:result.samples.filter(s=>['before','cards'].includes(s.phase)&&s.label==='default').map(({phase,actor,rows,ms,error})=>({phase,actor,rows,ms,error}))},null,2));
