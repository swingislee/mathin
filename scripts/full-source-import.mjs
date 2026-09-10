import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { readCompleteSources, buildCompleteSourcePayload, bytesHash } from './lib/full-source-import.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { buildBaseBusinessPlan } from './lib/base-business-fields.mjs';

const mode = process.argv[2];
if (!['--preflight','--prepare','--check','--apply'].includes(mode)) throw new Error('Use --preflight, --prepare, --check or --apply');
const output = path.resolve('.tmp/full-source-import');
fs.mkdirSync(output, {recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(output,'target.json'), refresh:mode==='--preflight',errorFile:path.join(output,'database-error.txt')});
const version='20260907000700_complete_source_import';
const migration=`supabase/migrations/${version}.sql`;
const checksum=textFileSha256(migration);
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const identityTables=['students','leads','enrollments','data_import_rows','data_import_batches'];
function snapshot() {
  return Object.fromEntries(sql(`begin isolation level repeatable read read only;${identityTables.map(table=>`select jsonb_build_object('table','${table}','rows',coalesce(jsonb_agg(t order by to_jsonb(t)::text),'[]'::jsonb)) from public.${table} t;`).join('\n')}commit;`)
    .split('\n').filter(Boolean).map(line=>{const value=JSON.parse(line);return[value.table,value.rows];}));
}
const applied=sql(`begin read only;select coalesce((select checksum from public.schema_migrations where version=${quote(version)}),'');commit;`);
if(applied&&applied!==checksum)throw new Error('FULL_SOURCE_MIGRATION_CHANGED');
if(mode==='--preflight') {
  console.log(JSON.stringify({localTargetVerified:true,host:observed.host,origin:observed.supabaseOrigin,migrationApplied:Boolean(applied)}));process.exit(0);
}
const planPath=path.join(output,'plan.json');
const sourceRoot=path.resolve('.tmp/source-refresh/run-20260907-student-review');
if(mode==='--prepare') {
  const input=await readCompleteSources(sourceRoot,path.resolve('docs/test_material'));
  const tables=snapshot();
  const payload=buildCompleteSourcePayload({...input,tables});
  const baseFields=buildBaseBusinessPlan(payload.records);
  fs.writeFileSync(planPath,JSON.stringify(payload));
  fs.writeFileSync(path.join(output,'base-field-report.json'),JSON.stringify({summary:baseFields.summary,fields:baseFields.fields},null,2));
  fs.writeFileSync(path.join(output,'identity-snapshot.json'),JSON.stringify(tables));
  console.log(JSON.stringify({mode,files:payload.files.length,tables:payload.manifest.tableCount,rows:payload.records.length,
    contentRows:payload.manifest.summary.contentRecordCount,matched:payload.manifest.summary.matchedCount,
    deferred:payload.manifest.summary.reviewCount,withoutIdentity:payload.manifest.summary.unmatchedWithoutIdentityCount,sourceBytes:payload.manifest.sourceBytes}));
  process.exit(0);
}
const payload=read(planPath);
const baseFields=buildBaseBusinessPlan(payload.records);
if(baseFields.facts.length&&sql("begin read only;select exists(select 1 from public.schema_migrations where version='20260910006000_base_value_synonyms');commit;")!=='t')throw new Error('BASE_BUSINESS_FIELDS_MIGRATION_REQUIRED');
const fresh=buildCompleteSourcePayload({...await readCompleteSources(sourceRoot,path.resolve('docs/test_material')),tables:snapshot()});
if(fresh.payloadHash!==payload.payloadHash)throw new Error('FULL_SOURCE_CURRENT_INPUT_CHANGED_PREPARE_AGAIN');
const checkKey={checksum,payloadHash:payload.payloadHash,script:textFileSha256('scripts/full-source-import.mjs'),library:textFileSha256('scripts/lib/full-source-import.mjs'),baseFields:textFileSha256('scripts/lib/base-business-fields.mjs'),baseAliases:textFileSha256('scripts/lib/base-value-normalization.mjs'),grade:textFileSha256('src/lib/grade-format.mjs')};
const checkFile=path.join(output,'check.json');
if(mode==='--apply'&&(!fs.existsSync(checkFile)||JSON.stringify(read(checkFile).checkKey)!==JSON.stringify(checkKey)))throw new Error('FULL_SOURCE_CURRENT_CHECK_REQUIRED');
const protectedTables=['students','leads','enrollments','classrooms','class_sessions','session_attendance','contacts','families','student_follow_ups','activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','business_record_revisions','work_items','notifications'];
const available=new Set(sql("begin read only;select tablename from pg_tables where schemaname='public';commit;").split('\n'));
const covered=protectedTables.filter(table=>available.has(table));
const fingerprints=covered.map(table=>`select '${table}'::text as name,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from public.${table} t`).join('\nunion all\n');
const input=JSON.stringify(payload);
const tag='$complete_source_input$';
if(input.includes(tag))throw new Error('FULL_SOURCE_DELIMITER');
const statement=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='180s';
select pg_advisory_xact_lock(hashtextextended('complete-source-import',0));
create temp table source_before on commit drop as ${fingerprints};
create temp table existing_sources on commit drop as select id,md5(to_jsonb(h)::text) digest from public.history_import_records h;
${applied?'':fs.readFileSync(migration,'utf8')}
create temp table complete_input(payload jsonb) on commit drop;
insert into complete_input values(${tag}${input}${tag}::jsonb);
do $guard$ begin
 if exists(select 1 from public.history_import_batches where batch_key=${quote(payload.batchKey)} and payload_sha256<>${quote(payload.payloadHash)}) then raise exception 'FULL_SOURCE_BATCH_CHANGED';end if;
 if exists(select 1 from complete_input i cross join lateral jsonb_array_elements(i.payload->'records') r join public.history_import_records h on h.id=r->>'id' where h.payload_sha256<>r->>'payload_sha256') then raise exception 'FULL_SOURCE_RECORD_CHANGED';end if;
end $guard$;
insert into public.history_import_batches(batch_key,payload_sha256,manifest) values(${quote(payload.batchKey)},${quote(payload.payloadHash)},${quote(JSON.stringify(payload.manifest))}::jsonb) on conflict(batch_key) do nothing;
insert into public.history_import_files(sha256,bytes,content)
select distinct f->>'sha256',(f->>'bytes')::bigint,decode(f->>'contentBase64','base64') from complete_input i cross join lateral jsonb_array_elements(i.payload->'files') f on conflict(sha256) do nothing;
insert into public.history_import_batch_files(batch_id,source_path,file_sha256,metadata)
select b.id,f->>'path',f->>'sha256',f->'metadata' from complete_input i join public.history_import_batches b on b.batch_key=i.payload->>'batchKey' cross join lateral jsonb_array_elements(i.payload->'files') f on conflict(batch_id,source_path) do nothing;
insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,entity_data,candidate_data,student_id,lead_id,search_text)
select r->>'id',r->>'source_sha256',r->>'source_table_id',r->>'source_record_id',r->>'payload_sha256',r->'source_data',r->'record_data',r->>'match_status',r->'match_data',nullif(r->'entity_data','null'::jsonb),r->'candidate_data',(r->>'student_id')::uuid,(r->>'lead_id')::uuid,r->>'search_text' from complete_input i cross join lateral jsonb_array_elements(i.payload->'records') r on conflict(id) do nothing;
${baseFields.facts.length?`select public.store_base_business_fields(${quote(JSON.stringify(baseFields.facts))}::jsonb);`:''}
insert into public.history_import_batch_records(batch_id,record_id,case_key)
select b.id,r->>'id','complete_source' from complete_input i join public.history_import_batches b on b.batch_key=i.payload->>'batchKey' cross join lateral jsonb_array_elements(i.payload->'records') r on conflict(batch_id,record_id) do nothing;
create temp table source_after on commit drop as ${fingerprints};
do $verify$ begin
 if exists((select * from source_before except select * from source_after) union all (select * from source_after except select * from source_before)) then raise exception 'FULL_SOURCE_BUSINESS_CHANGED';end if;
 if exists(select 1 from existing_sources e left join public.history_import_records h on h.id=e.id where h.id is null or e.digest<>md5(to_jsonb(h)::text)) then raise exception 'FULL_SOURCE_PRIOR_RECORD_CHANGED';end if;
 if (select count(*) from public.history_import_batch_records where batch_id=(select id from public.history_import_batches where batch_key=${quote(payload.batchKey)}))<>${payload.records.length} then raise exception 'FULL_SOURCE_ROW_COVERAGE';end if;
 if (select count(*) from public.history_import_batch_files where batch_id=(select id from public.history_import_batches where batch_key=${quote(payload.batchKey)}))<>${payload.files.length} then raise exception 'FULL_SOURCE_FILE_COVERAGE';end if;
 if exists(select 1 from complete_input i cross join lateral jsonb_array_elements(i.payload->'records') r join public.history_import_records h on h.id=r->>'id' where h.record_data<>r->'record_data' or h.source_data<>r->'source_data' or h.candidate_data<>r->'candidate_data') then raise exception 'FULL_SOURCE_ORIGINAL_CHANGED';end if;
 if exists(select 1 from complete_input i cross join lateral jsonb_array_elements(i.payload->'files') f join public.history_import_files h on h.sha256=f->>'sha256' where h.content<>decode(f->>'contentBase64','base64') or h.bytes<>(f->>'bytes')::bigint) then raise exception 'FULL_SOURCE_BYTES_CHANGED';end if;
 if has_table_privilege('authenticated','public.history_import_files','INSERT') or has_column_privilege('authenticated','public.history_import_files','content','SELECT') or has_table_privilege('anon','public.history_import_batch_files','SELECT') then raise exception 'FULL_SOURCE_FILE_PRIVILEGE';end if;
end $verify$;
${mode==='--check'?'rollback;':`${applied?'':`insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});`}update public.history_import_batches set verification=jsonb_build_object('originalsEqual',true,'filesEqual',true,'businessUnchanged',true,'fullCoverage',true) where batch_key=${quote(payload.batchKey)};notify pgrst,'reload schema';commit;`}`;
sql(statement);
if(mode==='--check'&&!applied&&sql("begin read only;select (to_regclass('public.history_import_files') is null)::text;commit;")!=='true')throw new Error('FULL_SOURCE_ROLLBACK_FAILED');
const report={mode,checkKey,localTargetVerified:true,files:payload.files.length,tables:payload.manifest.tableCount,records:payload.records.length,
  baseFields:baseFields.summary,
  sourceBytes:payload.manifest.sourceBytes,originalsEqual:true,priorRecordsUnchanged:true,businessUnchanged:true,protectedTables:covered.length,
  payloadFileHash:bytesHash(fs.readFileSync(planPath)),batchKey:payload.batchKey};
fs.writeFileSync(path.join(output,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
