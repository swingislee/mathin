import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {buildSourceAssessmentRepair,SOURCE_REPAIR_TABLES} from './lib/source-assessment-repair.mjs';
import {historyPayloadHash} from './lib/history-import-trial.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
import {loadFixedAccount} from '../e2e/support/fixed-accounts.ts';

const mode=process.argv[2];
if(!['--preflight','--prepare','--check','--apply'].includes(mode))throw new Error('Use --preflight, --prepare, --check or --apply');
const root=path.resolve('.tmp/source-assessment-repair');fs.mkdirSync(root,{recursive:true});
const {sql,docker,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify({host:observed.host,origin:observed.supabaseOrigin,verified:true}));process.exit(0);}
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const read=query=>JSON.parse(sql(`begin read only;select coalesce(jsonb_agg(t),'[]'::jsonb) from (${query}) t;commit;`));
const account=loadFixedAccount('admin');if(!account)throw new Error('FIXED_ADMIN_REQUIRED');
const actor=read(`select p.id from public.profiles p join auth.users u on u.id=p.id where p.role='admin' and p.is_active and u.email=${q(account.email)}`)[0];
if(!actor)throw new Error('FIXED_ADMIN_REQUIRED');
const snapshot={history_import_records:read(`select h.id,h.student_id,h.lead_id,h.match_status,h.match_data,
  jsonb_build_object('names',h.record_data->'names','phones',h.record_data->'phones','tableName',h.record_data->>'tableName','cells',
    (select jsonb_agg(jsonb_build_object('fieldId',c->>'fieldId','fieldName',c->>'fieldName','kind',c->>'kind','text',c->>'text'))
      from jsonb_array_elements(h.record_data->'cells') c)) record_data
  from public.history_import_records h where h.source_data->>'format'='feishu-base'`)};
for(const table of [...SOURCE_REPAIR_TABLES,'activities','students','history_import_associations','history_import_identity_candidates','assessment_workflow_states','assessment_quick_entries'])
  snapshot[table]=read(`select * from public.${table}`);
snapshot.assessment_workflows=snapshot.assessment_workflow_states;
const decisions=fs.existsSync(path.join(root,'decisions.json'))?JSON.parse(fs.readFileSync(path.join(root,'decisions.json'),'utf8')):{};
const plan=buildSourceAssessmentRepair(snapshot,{...decisions,actorId:actor.id});
fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan));
if(mode==='--prepare'){console.log(JSON.stringify(plan.counts));process.exit(0);}
const version='20260907001700_source_enrollment_completion_facts';
const migrationPath=`supabase/migrations/${version}.sql`;
const checkKey={plan:historyPayloadHash(plan),migration:textFileSha256(migrationPath),runner:textFileSha256('scripts/source-assessment-repair.mjs'),builder:textFileSha256('scripts/lib/source-assessment-repair.mjs'),normalizer:textFileSha256('src/features/school/business-source-contract.ts')};
if(mode==='--apply'&&JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8')).checkKey)!==JSON.stringify(checkKey))throw new Error('REPAIR_CHECK_REQUIRED');
const applied=sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if(applied&&applied!==checkKey.migration)throw new Error('MIGRATION_CHECKSUM_CHANGED');
if(mode==='--check'){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(root,`before-${stamp}.sql`),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--no-owner',
    ...[...SOURCE_REPAIR_TABLES,'history_import_associations','history_import_association_events'].flatMap(table=>['--table',`public.${table}`])]),'utf8');
}
const associationSources=plan.associations.map(row=>row.recordId);
const trackedTables=[...SOURCE_REPAIR_TABLES,'course_opportunities'];
const baseline=trackedTables.map(table=>{
  const planned=plan.patches.filter(row=>row.table===table).map(row=>row.id);
  const excluded=[planned.length?`id in (${planned.map(q).join(',')})`:'false',associationSources.length?`source_record_id in (${associationSources.map(q).join(',')})`:'false'];
  return `select ${q(table)} relation,id,md5(to_jsonb(t)::text) digest from public.${table} t where not(${excluded.join(' or ')})`;
}).join(' union all ');
const protect=['students','profiles','families','contacts','classrooms','class_sessions','enrollments','session_attendance','student_follow_ups','lead_communications','assessment_reports','assessment_workflow_states','assessment_quick_entries'];
const fingerprint=protect.map(table=>`select ${q(table)} relation,count(*) count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id::text),'')) digest from public.${table} t`).join(' union all ')
  .replace("order by id::text),'')) digest from public.session_attendance","order by md5(to_jsonb(t)::text)),'')) digest from public.session_attendance")
  +" union all select 'history_import_records',count(*),md5(string_agg(id||payload_sha256,'' order by id)) from public.history_import_records";
const lockChecks=plan.patches.map(patch=>{
  const expected={...patch.before};
  if(['activity_registrations','course_enrollments'].includes(patch.table)&&!Object.hasOwn(expected,'source_enrollment_facts'))expected.source_enrollment_facts=null;
  return `select 1 from public.${patch.table} where id=${q(patch.id)} for update;
    do $check$ begin if (select to_jsonb(t) from public.${patch.table} t where id=${q(patch.id)}) is distinct from ${q(JSON.stringify(expected))}::jsonb then raise exception 'REPAIR_ROW_CHANGED';end if;end $check$;`;
}).join('\n');
const patches=plan.patches.map(patch=>`update public.${patch.table} t set ${Object.keys(patch.changes).map(column=>`${column}=r.${column}`).join(',')}${patch.table==='leads'?',identity_confirmed_at=clock_timestamp()':''}
  from jsonb_populate_record(null::public.${patch.table},${q(JSON.stringify(patch.changes))}::jsonb) r where t.id=${q(patch.id)};`).join('\n');
const inserts=plan.inserts.map(({table,row})=>`insert into public.${table}(${Object.keys(row).join(',')}) select ${Object.keys(row).join(',')} from jsonb_populate_record(null::public.${table},${q(JSON.stringify(row))}::jsonb);`).join('\n');
const assertions=plan.patches.map(patch=>`if not exists(select 1 from public.${patch.table} t where id=${q(patch.id)} and to_jsonb(t) @> ${q(JSON.stringify(patch.changes))}::jsonb) then raise exception 'REPAIR_VALUE_MISMATCH';end if;`).join('\n');
const checkLead=plan.patches.find(row=>row.table==='activity_registrations'&&row.changes.source_enrollment_facts?.confirmed&&row.before.lead_id);
const enrollmentCheck=checkLead?`if public.get_student_lifecycle(null,${q(checkLead.before.lead_id)})<>'awaiting_renewal' then raise exception 'ENROLLMENT_STAGE_MISSING';end if;`:'';
const statement=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('source-assessment-repair',0));
${applied?'':fs.readFileSync(migrationPath,'utf8')}
set local role postgres;
create temp table original_before on commit drop as ${baseline};
create temp table protected_before on commit drop as ${fingerprint};
${lockChecks}
select set_config('request.jwt.claims',jsonb_build_object('sub',${q(actor.id)},'role','authenticated')::text,true);
${plan.associations.map(row=>`select public.confirm_history_source(${q(row.recordId)},${q(row.studentId)},${row.expectedVersion},'assessment');`).join('\n')}
select set_config('request.jwt.claims','{}',true);
${patches}
${inserts}
create temp table original_after on commit drop as ${baseline};
create temp table protected_after on commit drop as ${fingerprint};
do $verify$ begin
if exists(select * from original_before except select * from original_after) then raise exception 'OTHER_BUSINESS_DATA_CHANGED';end if;
if exists((select * from protected_before except select * from protected_after) union all(select * from protected_after except select * from protected_before)) then raise exception 'PROTECTED_DATA_CHANGED';end if;
${assertions}
end $verify$;
select set_config('request.jwt.claims',jsonb_build_object('sub',${q(actor.id)},'role','authenticated')::text,true);
set local role authenticated;
do $verify$ begin ${enrollmentCheck} end $verify$;
reset role;
select set_config('request.jwt.claims','{}',true);
do $verify$ begin
begin perform public.get_student_lifecycle(null,null);raise exception 'ANONYMOUS_LIFECYCLE_ALLOWED';
exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise;end if;end;
end $verify$;
${mode==='--apply'&&!applied?`insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checkKey.migration)});`:''}
select jsonb_build_object('protectedDataUnchanged',true,'otherBusinessDataUnchanged',true,'lifecycleChecked',true);
${mode==='--apply'?"notify pgrst,'reload schema';commit;":'rollback;'}`;
fs.writeFileSync(path.join(root,'transaction.sql'),statement,'utf8');
let output;
try { output=execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
  {input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}); }
catch(error){fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr||error.message),'utf8');throw new Error('LOCAL_REPAIR_TRANSACTION_FAILED: inspect private error file');}
const report={mode,checkKey,counts:plan.counts,...JSON.parse(output.split('\n').findLast(line=>line.startsWith('{'))),localTargetVerified:true};
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
