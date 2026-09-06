import fs from 'node:fs';
import path from 'node:path';
import { buildStudentBusinessHistory, HISTORY_BUSINESS_TABLES } from './lib/student-business-history.mjs';
import { historyPayloadHash } from './lib/history-import-trial.mjs';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => { const split = value.indexOf('='); return split < 0 ? [value.replace(/^--/,''),true] : [value.slice(2,split),value.slice(split+1)]; }));
if (['preflight','prepare','migrate','apply'].filter(mode => args[mode]).length !== 1) throw new Error('Use exactly one of --preflight, --prepare, --migrate, --apply');
const root = path.resolve('.tmp/student-business-history-trial');
fs.mkdirSync(root,{recursive:true});
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const {sql,docker,observed} = openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:!!args.preflight,errorFile:path.join(root,'database-error.txt')});
if (args.preflight) { console.log(JSON.stringify({mode:'preflight',...observed})); process.exit(0); }
if(sql("begin read only;select count(*) from public.schema_migrations where version='20260906002000_business_record_history_state';commit;")!=='0')throw new Error('HISTORY_FACTS_NOW_USE_CANONICAL_BUSINESS_TABLES');
const inputFile = typeof args.family === 'string' ? path.resolve(args.family) : read(path.join(root,'input.json')).familyFile;
const familyRoot = path.resolve('.tmp/history-import-trial');
if (!inputFile.startsWith(familyRoot+path.sep) || path.basename(inputFile)!=='plan.json') throw new Error('HISTORY_BUSINESS_LOCAL_FAMILY_PLAN_REQUIRED');
const family = read(inputFile);
if (family.payloadHash !== historyPayloadHash({manifest:family.manifest,records:family.records})) throw new Error('HISTORY_BUSINESS_FAMILY_CHANGED');
const payload = buildStudentBusinessHistory(family);
const planFile = path.join(root,'plan.json');
if (args.prepare) {
  if (fs.existsSync(planFile) && read(planFile).payloadHash!==payload.payloadHash) throw new Error('HISTORY_BUSINESS_EXISTING_PLAN_CHANGED');
  fs.writeFileSync(planFile,`${JSON.stringify(payload,null,2)}\n`,'utf8');
  fs.writeFileSync(path.join(root,'input.json'),JSON.stringify({familyFile:inputFile}),'utf8');
  console.log(JSON.stringify({mode:'prepared',counts:payload.manifest.counts,retainedForReview:payload.manifest.retainedForReview.length,payloadHash:payload.payloadHash}));
  process.exit(0);
}
if (read(planFile).payloadHash!==payload.payloadHash) throw new Error('HISTORY_BUSINESS_PLAN_CHANGED');
const migration='20260906001000_student_business_history';
const migrationFile=`supabase/migrations/${migration}.sql`;
const protectedTables=['students','leads','families','contacts','family_contacts','family_students','student_contacts','lead_identity_conversions','student_grade_history',
  'lead_communications','student_follow_ups','activity_followup_contacts','lead_next_actions','lead_invitation_threads','lead_invitation_events','communication_worklists','communication_worklist_items',
  'assessment_results','activities','activity_registrations','course_opportunities','course_opportunity_events','course_enrollments','course_enrollment_assignments','course_enrollment_events',
  'renewal_cycles','renewal_cycle_entries','renewal_registration_records','class_support_tasks','class_support_task_recipients','classrooms','class_sessions','enrollments','session_attendance',
  'notifications','notification_deliveries','work_items','work_item_assignments','work_item_user_state','history_import_records'];
const available=new Set(sql("begin read only; select tablename from pg_tables where schemaname='public'; commit;").split('\n'));
const covered=protectedTables.filter(table=>available.has(table));
const fingerprint=covered.map(table=>`select '${table}'::text as name,count(*)::integer as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from public.${table} t`).join('\nunion all\n');
const tag='$business_history$';
if(JSON.stringify(payload).includes(tag))throw new Error('HISTORY_BUSINESS_DELIMITER');
const insertRows=HISTORY_BUSINESS_TABLES.map(table=>{
  const rows=payload.rows[table];
  if(!rows.length)return '';
  const columns=Object.keys(rows[0]);
  if(!columns.every(column=>/^[a-z][a-z0-9_]*$/.test(column)))throw new Error('HISTORY_BUSINESS_COLUMN');
  return `do $guard$ begin if exists(select 1 from jsonb_populate_recordset(null::public.${table},(select payload->'rows'->'${table}' from business_input)) r join public.${table} h on h.id=r.id where h.payload_sha256<>r.payload_sha256) then raise exception 'HISTORY_BUSINESS_RECORD_CHANGED'; end if; end $guard$;
insert into public.${table}(${columns.join(',')},import_batch_id)
select ${columns.map(column=>`r.${column}`).join(',')},b.id from business_input i join public.history_import_batches b on b.batch_key=i.payload->>'batchKey'
cross join lateral jsonb_populate_recordset(null::public.${table},i.payload->'rows'->'${table}') r on conflict(id) do nothing;
do $guard$ begin if exists(select 1 from jsonb_populate_recordset(null::public.${table},(select payload->'rows'->'${table}' from business_input)) r left join public.${table} h on h.id=r.id where h.id is null or ${columns.map(column=>`h.${column} is distinct from r.${column}`).join(' or ')}) then raise exception 'HISTORY_BUSINESS_DATA_MISMATCH'; end if; end $guard$;`;
}).join('\n');
const countQuery=HISTORY_BUSINESS_TABLES.map(table=>`select '${table}' as name,count(*)::integer as rows from public.${table}`).join(' union all ');
const sourceChecks=family.records.filter(record=>payload.manifest.sourceRecordIds.includes(record.id)).map(record=>({id:record.id,studentId:record.student_id,hash:record.payload_sha256}));
const sourceTag='$history_sources$';
const body=`set local lock_timeout='5s'; set local statement_timeout='45s';
do $guard$ begin if (select system_identifier::text from pg_control_system())<>'${observed.systemIdentifier}' then raise exception 'HISTORY_LOCAL_DATABASE_CHANGED'; end if; end $guard$;
select pg_advisory_xact_lock(hashtextextended('student-business-history',0));
create temp table business_input(payload jsonb) on commit drop;
insert into business_input values(${tag}${JSON.stringify(payload)}${tag}::jsonb);
create temp table business_before on commit drop as ${fingerprint};
create temp table history_before on commit drop as ${countQuery};
do $guard$ begin
  if exists(select 1 from jsonb_array_elements(${sourceTag}${JSON.stringify(sourceChecks)}${sourceTag}::jsonb) r left join public.history_import_records h on h.id=r->>'id' where h.id is null or h.student_id::text is distinct from r->>'studentId' or h.payload_sha256<>r->>'hash') then raise exception 'HISTORY_BUSINESS_SOURCE_CHANGED'; end if;
  if exists(select 1 from public.history_import_batches b,business_input i where b.batch_key=i.payload->>'batchKey' and b.payload_sha256<>i.payload->>'payloadHash') then raise exception 'HISTORY_BUSINESS_BATCH_CHANGED'; end if;
end $guard$;
insert into public.history_import_batches(batch_key,payload_sha256,manifest) select payload->>'batchKey',payload->>'payloadHash',payload->'manifest' from business_input on conflict(batch_key) do nothing;
insert into public.history_import_batch_records(batch_id,record_id,case_key) select b.id,r#>>'{}',i.payload->'manifest'->'subject'->>'key' from business_input i join public.history_import_batches b on b.batch_key=i.payload->>'batchKey' cross join lateral jsonb_array_elements(i.payload->'manifest'->'sourceRecordIds') r on conflict(batch_id,record_id) do nothing;
${insertRows}
create temp table business_after on commit drop as ${fingerprint};
create temp table history_after on commit drop as ${countQuery};
do $guard$ begin if exists((select * from business_before except select * from business_after) union all (select * from business_after except select * from business_before)) then raise exception 'HISTORY_BUSINESS_CURRENT_DATA_CHANGED'; end if; end $guard$;
update public.history_import_batches b set verification=jsonb_build_object('attempts',coalesce((verification->>'attempts')::integer,0)+1,'lastVerifiedAt',clock_timestamp(),'currentWorkUnchanged',true,'originalsUnchanged',true,'protectedTables',${covered.length},'insertedRecords',(select sum(a.rows-z.rows) from history_after a join history_before z using(name)),'before',(select jsonb_object_agg(name,rows) from business_before),'after',(select jsonb_object_agg(name,rows) from business_after),'fingerprintsBefore',(select jsonb_object_agg(name,digest) from business_before),'fingerprintsAfter',(select jsonb_object_agg(name,digest) from business_after)) from business_input i where b.batch_key=i.payload->>'batchKey';
`;
if(args.migrate){
  if(sql(`begin read only; select count(*) from public.schema_migrations where version='${migration}'; commit;`)!=='0')throw new Error('HISTORY_BUSINESS_MIGRATION_ALREADY_APPLIED');
  const schema=fs.readFileSync(migrationFile,'utf8');
  fs.writeFileSync(path.join(root,'schema-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner']),'utf8');
  const assertions=fs.readFileSync('scripts/sql/student-business-history-assertions.sql','utf8');
  sql(`begin isolation level repeatable read; ${schema}\n${body}\n${assertions}\nrollback;`);
  if(sql(`select count(*) from pg_tables where schemaname='public' and tablename in (${HISTORY_BUSINESS_TABLES.map(table=>`'${table}'`).join(',')});`)!=='0')throw new Error('HISTORY_BUSINESS_SCHEMA_ROLLBACK_FAILED');
  sql(`begin; set local lock_timeout='5s'; ${schema}\ninsert into public.schema_migrations(version,checksum)values('${migration}','${textFileSha256(migrationFile)}');notify pgrst,'reload schema';commit;`);
  fs.writeFileSync(path.join(root,'migration-verification.json'),JSON.stringify({migration,rls:'PASS',rollback:'PASS',mappingTransaction:'PASS',localApplied:true}),'utf8');
  console.log(JSON.stringify({mode:'migrated',rls:'PASS',rollback:'PASS'}));
}else{
  const reportLine=sql(`begin isolation level repeatable read; ${body}\nselect jsonb_build_object('batchId',b.id,'verification',b.verification,'counts',b.manifest->'counts') from public.history_import_batches b,business_input i where b.batch_key=i.payload->>'batchKey';commit;`).split('\n').findLast(line=>line.startsWith('{'));
  if(!reportLine)throw new Error('HISTORY_BUSINESS_REPORT_MISSING');
  const report=JSON.parse(reportLine);
  fs.writeFileSync(path.join(root,`attempt-${report.verification.attempts}.json`),`${JSON.stringify(report,null,2)}\n`,'utf8');
  console.log(JSON.stringify({mode:'imported',counts:report.counts,insertedRecords:report.verification.insertedRecords,currentWorkUnchanged:report.verification.currentWorkUnchanged,originalsUnchanged:report.verification.originalsUnchanged,protectedTables:covered.length}));
}
