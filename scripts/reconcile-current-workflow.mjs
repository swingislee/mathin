// 本机本期工作范围整理：只更新可追溯的范围元数据，完整保留业务原表。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const {values}=parseArgs({options:{plan:{type:'string'}}});
if(!values.plan)throw new Error('PRIVATE_REVIEW_PLAN_REQUIRED');
const planPath=path.resolve(values.plan),root=path.dirname(planPath);
if(!planPath.startsWith(path.resolve('.tmp')+path.sep))throw new Error('PRIVATE_WORKSPACE_PLAN_REQUIRED');
if(fs.existsSync(path.join(root,'review-applied.json')))throw new Error('REVIEW_ALREADY_APPLIED');
const plan=JSON.parse(fs.readFileSync(planPath,'utf8'));
const q=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i,sourceId=/^(source|feishu)-record:[a-f\d]{64}$/;
const factRelations=['activities','activity_registrations','assessment_results','course_enrollments','course_opportunities','student_follow_ups','lead_communications'];
if(plan.version!==2||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(plan.currentPeriod))throw new Error('REVIEW_VERSION_OR_PERIOD_INVALID');
if(!Number.isSafeInteger(plan.summary?.currentSubjects)||plan.summary.currentSubjects<0)throw new Error('CURRENT_SUBJECT_COUNT_REQUIRED');
if(!/^[a-f\d]{32}$/.test(plan.scopeFingerprint??''))throw new Error('PREPARED_SCOPE_FINGERPRINT_REQUIRED');
for(const row of plan.scopeRows)if([row.studentId,row.leadId,row.recordId].filter(Boolean).length!==1
  ||[row.studentId,row.leadId].filter(Boolean).some(id=>!uuid.test(id))
  ||[row.recordId,...row.sourceIds].filter(Boolean).some(id=>!sourceId.test(id))
  ||!['history_review_required','reference_only'].includes(row.reason))throw new Error('INVALID_SCOPE_PLAN');
for(const row of plan.factScopes)if(!factRelations.includes(row.relation)||!uuid.test(row.id)||!sourceId.test(row.sourceRecordId)
  ||row.reason!=='history_review_required')throw new Error('INVALID_FACT_PLAN');
if(plan.currentSourceIds.some(id=>!sourceId.test(id)))throw new Error('INVALID_CURRENT_SOURCE');
const sourcePath=path.resolve('docs/test_material',plan.authoritativeFilename);
if(path.dirname(sourcePath)!==path.resolve('docs/test_material'))throw new Error('SOURCE_PATH_INVALID');
if(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')!==plan.sourceSha256)throw new Error('AUTHORITATIVE_SOURCE_CHANGED');
const target=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const version='20260908006000_current_business_workflow_boundary',migration=`supabase/migrations/${version}.sql`,checksum=textFileSha256(migration);
if(target.sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`))throw new Error('MIGRATION_ALREADY_APPLIED');
const tables=['students','leads','lead_source_records','lead_communications','communication_record_revisions','lead_next_actions',
  'lead_invitation_threads','activities','activity_registrations','assessment_results','course_enrollments','course_opportunities',
  'course_enrollment_assignments','enrollments','student_follow_ups','history_import_records','history_import_associations',
  'data_import_batches','data_import_rows','profiles','classrooms','class_sessions','session_attendance','session_roster_entries',
  'student_guardians','auth.users'];
if(JSON.stringify([...tables].sort())!==JSON.stringify(Object.keys(plan.databaseFingerprint??{}).sort()))throw new Error('PREPARED_FINGERPRINT_REQUIRED');
const relation=table=>table.includes('.')?table:`public.${table}`;
const fingerprint=`select jsonb_build_object(${tables.map(table=>`${q(table)},(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),''))) from ${relation(table)} r)`).join(',')})`;
const personRows=plan.scopeRows.filter(row=>!row.recordId);
const scopeRows=plan.scopeRows.map(row=>({student_id:row.studentId,lead_id:row.leadId,record_id:row.recordId,reason:row.reason,latest_period:row.latestPeriod,source_ids:row.sourceIds}));
const factRows=plan.factScopes.map(row=>({relation:row.relation,record_id:row.id,source_record_id:row.sourceRecordId,reason:row.reason}));
const sql=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='90s';
select pg_advisory_xact_lock(hashtextextended('base-workflow-scope',0));
lock table ${tables.map(relation).join(',')},public.history_workflow_scopes in share mode;
do $before$ begin
  if (${fingerprint}) is distinct from ${q(JSON.stringify(plan.databaseFingerprint))}::jsonb then raise exception 'PREPARED_DATA_CHANGED';end if;
  if (select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by scope_key),'')) from public.history_workflow_scopes s)<>${q(plan.scopeFingerprint)} then raise exception 'PREPARED_SCOPE_CHANGED';end if;
end $before$;
${fs.readFileSync(migration,'utf8')}
insert into public.history_workflow_scopes(student_id,lead_id,record_id,reason,latest_period,source_ids,current_period,source_filename,source_sha256)
select r.*,${q(plan.currentPeriod)},${q(plan.authoritativeFilename)},${q(plan.sourceSha256)} from jsonb_to_recordset(${q(JSON.stringify(scopeRows))}::jsonb)
as r(student_id uuid,lead_id uuid,record_id text,reason text,latest_period text,source_ids text[])
on conflict(scope_key) do update set reason=excluded.reason,latest_period=excluded.latest_period,source_ids=excluded.source_ids,
current_period=excluded.current_period,source_filename=excluded.source_filename,source_sha256=excluded.source_sha256,reviewed_at=now();
update public.history_workflow_scopes set resumed_at=clock_timestamp()
where record_id=any(array(select jsonb_array_elements_text(${q(JSON.stringify(plan.currentSourceIds))}::jsonb))) and resumed_at is null;
insert into public.history_business_workflow_scopes(relation,record_id,source_record_id,reason)
select * from jsonb_to_recordset(${q(JSON.stringify(factRows))}::jsonb) as r(relation text,record_id uuid,source_record_id text,reason text);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated')::text,true) is not null;
do $after$ begin
  if (${fingerprint}) is distinct from ${q(JSON.stringify(plan.databaseFingerprint))}::jsonb then raise exception 'PRESERVED_BUSINESS_DATA_CHANGED';end if;
  if (select count(*) from public.student_stage_workspace_index('all',''))<>${plan.summary.currentSubjects} then raise exception 'CURRENT_SUBJECT_COUNT_MISMATCH';end if;
  if exists(select 1 from jsonb_to_recordset(${q(JSON.stringify(personRows))}::jsonb) as r("studentId" uuid,"leadId" uuid)
    where public.business_subject_is_current(r."studentId",r."leadId")) then raise exception 'HISTORY_SUBJECT_IN_CURRENT_QUEUE';end if;
  if (select count(*) from public.history_business_workflow_scopes)<>${factRows.length} then raise exception 'FACT_SCOPE_COUNT_MISMATCH';end if;
  if has_table_privilege('authenticated','public.history_business_workflow_scopes','select') or has_table_privilege('anon','public.history_business_workflow_scopes','select') then raise exception 'PRIVATE_SCOPE_ACCESS';end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and (c.relname like 'business_%' or c.relname in ('operational_leads','operational_students')) and c.relkind='v'
    and not coalesce(c.reloptions,'{}') @> array['security_invoker=true']) then raise exception 'VIEW_RLS_REQUIRED';end if;
end $after$;
select jsonb_build_object('currentSubjects',(select count(*) from public.student_stage_workspace_index('all','')),
  'stages',(select jsonb_object_agg(stage,n) from (select stage,count(*) n from public.student_stage_workspace_index('all','') group by stage) s),
  'currentFacts',jsonb_build_object(${factRelations.filter(table=>table!=='lead_communications').map(table=>`${q(table)},(select count(*) from public.business_${table} where record_state='current')`).join(',')}),
  'originalBusinessTablesPreserved',${tables.length},'additionalHistoricalSubjects',${personRows.length});
insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});
commit;`;
fs.writeFileSync(path.join(root,'review-apply.sql'),sql);
let output;
try{output=execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']});}
catch(error){fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr??error.message));throw new Error('REVIEW_APPLY_FAILED_INSPECT_PRIVATE_ERROR');}
const result=JSON.parse(output.split(/\r?\n/).findLast(line=>line.startsWith('{')));
fs.writeFileSync(path.join(root,'review-applied.json'),JSON.stringify({...result,checksum,planChecksum:textFileSha256(planPath),appliedAt:new Date().toISOString(),target:target.observed}));
console.log(JSON.stringify(result));
