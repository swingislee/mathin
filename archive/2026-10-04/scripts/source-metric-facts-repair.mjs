import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {buildSourceMetricFactsRepair,SOURCE_METRIC_TABLES} from './lib/source-metric-facts-repair.mjs';
import {historyPayloadHash} from './lib/history-import-trial.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';

const mode=process.argv[2];
if(!['--preflight','--prepare','--check','--apply'].includes(mode))throw new Error('Use --preflight, --prepare, --check or --apply');
const root=path.resolve('.tmp/source-metric-facts');fs.mkdirSync(root,{recursive:true});
const {sql,docker,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify({host:observed.host,origin:observed.supabaseOrigin,verified:true}));process.exit(0);}
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const read=query=>JSON.parse(sql(`begin read only;select coalesce(jsonb_agg(t),'[]'::jsonb) from (${query}) t;commit;`));
const account=loadFixedAccount('admin');if(!account)throw new Error('FIXED_ADMIN_REQUIRED');
const actor=read(`select p.id from public.profiles p join auth.users u on u.id=p.id where p.role='admin' and p.is_active and u.email=${q(account.email)}`)[0];
if(!actor)throw new Error('FIXED_ADMIN_REQUIRED');
const snapshot={history_import_records:read(`select h.id,h.student_id,h.lead_id,h.source_table_id,h.source_record_id,h.source_data,
  jsonb_build_object('names',h.record_data->'names','phones',h.record_data->'phones','tableName',h.record_data->>'tableName','cells',
    (select jsonb_agg(jsonb_build_object('fieldName',c->>'fieldName','text',c->>'text'))
      from jsonb_array_elements(h.record_data->'cells') c where c->>'fieldName' not in ('来源记录元数据','来源单元格元数据'))) record_data
  from public.history_import_records h where h.source_data->>'format'='feishu-base'`)};
for(const table of [...SOURCE_METRIC_TABLES,'leads','profiles'])snapshot[table]=read(`select * from public.${table}`);
const plan=buildSourceMetricFactsRepair(snapshot);
fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan));
if(mode==='--prepare'){console.log(JSON.stringify(plan.counts));process.exit(0);}
if(plan.unresolved.length)throw new Error('UNRESOLVED_SOURCE_CONTACTS: inspect private plan');
const version='20260908100000_source_metric_confirmation_facts',migrationPath=`supabase/migrations/${version}.sql`;
const checkKey={plan:historyPayloadHash(plan),migration:textFileSha256(migrationPath),runner:textFileSha256('scripts/source-metric-facts-repair.mjs'),
  builder:textFileSha256('scripts/lib/source-metric-facts-repair.mjs'),facts:textFileSha256('scripts/lib/source-metric-facts.mjs'),
  contact:textFileSha256('src/features/school/business-source-contract.ts'),dates:textFileSha256('scripts/lib/student-business-history.mjs')};
if(mode==='--apply'&&JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8')).checkKey)!==JSON.stringify(checkKey))throw new Error('SOURCE_METRIC_CHECK_REQUIRED');
const applied=sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if(applied&&applied!==checkKey.migration)throw new Error('MIGRATION_CHECKSUM_CHANGED');
if(mode==='--check'){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(root,`before-${stamp}.sql`),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--no-owner',
    ...SOURCE_METRIC_TABLES.flatMap(table=>['--table',`public.${table}`])]),'utf8');
}
const baseline=SOURCE_METRIC_TABLES.map(table=>{
  const planned=[...plan.patches.filter(p=>p.table===table).map(p=>p.id),...plan.inserts.filter(p=>p.table===table).map(p=>p.row.id)];
  return `select ${q(table)} relation,id,md5(to_jsonb(t)::text) digest from public.${table} t where ${planned.length?`id not in (${planned.map(q).join(',')})`:'true'}`;
}).join(' union all ');
const protect=['leads','students','profiles','families','contacts','classrooms','class_sessions','enrollments','session_attendance',
  'student_follow_ups','assessment_results','assessment_reports','assessment_workflow_states','assessment_quick_entries','course_opportunities'];
const fingerprint=protect.map(table=>`select ${q(table)} relation,count(*) count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public.${table} t`).join(' union all ')
  +" union all select 'history_import_records',count(*),md5(string_agg(id||payload_sha256,'' order by id)) from public.history_import_records";
const locks=plan.patches.map(p=>`select 1 from public.${p.table} where id=${q(p.id)} for update;
  do $guard$ begin if (select to_jsonb(t) from public.${p.table} t where id=${q(p.id)}) is distinct from ${q(JSON.stringify({...p.before,source_metric_facts:p.before.source_metric_facts??null}))}::jsonb
  then raise exception 'SOURCE_METRIC_ROW_CHANGED';end if;end $guard$;`).join('\n');
const patches=plan.patches.map(p=>`update public.${p.table} t set ${Object.keys(p.changes).map(column=>`${column}=r.${column}`).join(',')}
  from jsonb_populate_record(null::public.${p.table},${q(JSON.stringify(p.changes))}::jsonb) r where t.id=${q(p.id)};`).join('\n');
const inserts=plan.inserts.map(({table,row})=>`insert into public.${table}(${Object.keys(row).join(',')}) select ${Object.keys(row).join(',')} from jsonb_populate_record(null::public.${table},${q(JSON.stringify(row))}::jsonb);`).join('\n');
const assertions=plan.patches.map(p=>`if not exists(select 1 from public.${p.table} t where id=${q(p.id)} and to_jsonb(t) @> ${q(JSON.stringify(p.changes))}::jsonb) then raise exception 'SOURCE_METRIC_VALUE_MISMATCH';end if;`).join('\n');
const viewChecks=SOURCE_METRIC_TABLES.map(table=>`perform source_metric_facts from public.business_${table} limit 1;`).join('\n');
const editChecks=SOURCE_METRIC_TABLES.map(table=>{
  const row=plan.patches.find(p=>p.table===table);if(!row)return '';
  return `begin update public.${table} set source_metric_facts=null where id=${q(row.id)};raise exception 'SOURCE_METRIC_EDIT_ALLOWED';
    exception when insufficient_privilege then null;when raise_exception then if sqlerrm<>'SOURCE_FACTS_IMMUTABLE' then raise;end if;end;`;
}).join('\n');
const statement=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('source-metric-facts-repair',0));
${applied?'':fs.readFileSync(migrationPath,'utf8')}
set local role postgres;
create temp table original_before on commit drop as ${baseline};
create temp table protected_before on commit drop as ${fingerprint};
${locks}
${patches}
${inserts}
create temp table original_after on commit drop as ${baseline};
create temp table protected_after on commit drop as ${fingerprint};
do $verify$ begin
if exists((select * from original_before except select * from original_after) union all (select * from original_after except select * from original_before)) then raise exception 'OTHER_BUSINESS_DATA_CHANGED';end if;
if exists((select * from protected_before except select * from protected_after) union all (select * from protected_after except select * from protected_before)) then raise exception 'PROTECTED_DATA_CHANGED';end if;
${assertions}
end $verify$;
select set_config('request.jwt.claims',jsonb_build_object('sub',${q(actor.id)},'role','authenticated')::text,true);
set local role authenticated;
do $verify$ begin ${viewChecks} ${editChecks} end $verify$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $verify$ declare n bigint;begin
begin select count(*) into n from public.business_lead_communications; if n>0 then raise exception 'ANONYMOUS_SOURCE_FACTS_VISIBLE';end if;
exception when insufficient_privilege then null;end;
end $verify$;
reset role;
${mode==='--apply'&&!applied?`insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checkKey.migration)});`:''}
select jsonb_build_object('protectedDataUnchanged',true,'otherBusinessDataUnchanged',true,'sourceTagAccessChecked',true);
${mode==='--apply'?"notify pgrst,'reload schema';commit;":'rollback;'}`;
fs.writeFileSync(path.join(root,'transaction.sql'),statement,'utf8');
let output;
try { output=execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
  {input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}); }
catch(error){fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr||error.message),'utf8');throw new Error('SOURCE_METRIC_TRANSACTION_FAILED: inspect private error file');}
const report={mode,checkKey,counts:plan.counts,...JSON.parse(output.split('\n').findLast(line=>line.startsWith('{'))),localTargetVerified:true};
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
