// 已核对本机导入批次的工作范围整理；控制台仅输出匿名计数。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const {values}=parseArgs({options:{mode:{type:'string'},plan:{type:'string'}}});
if(!['apply','verify'].includes(values.mode)||!values.plan)throw new Error('USE_MODE_APPLY_OR_VERIFY_WITH_PRIVATE_PLAN');
const planPath=path.resolve(values.plan),root=path.dirname(planPath),privateRoot=path.resolve('.tmp')+path.sep;
if(!planPath.startsWith(privateRoot))throw new Error('PRIVATE_WORKSPACE_PLAN_REQUIRED');
const plan=JSON.parse(fs.readFileSync(planPath,'utf8'));
const q=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
for(const row of plan.scopeRows) {
  if([row.studentId,row.leadId,row.recordId].filter(Boolean).length!==1
    ||[row.studentId,row.leadId].filter(Boolean).some(id=>!uuid.test(id))
    ||[row.recordId,...row.sourceIds].filter(Boolean).some(id=>!/^(source|feishu)-record:[a-f\d]{64}$/.test(id))
    ||!['reference_only','processed_prior_period'].includes(row.reason))throw new Error('INVALID_SCOPE_PLAN');
}
if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(plan.currentPeriod)||!plan.databaseFingerprint)throw new Error('PREPARED_DATABASE_FINGERPRINT_REQUIRED');
const sourcePath=path.resolve('docs/test_material',plan.authoritativeFilename);
if(path.dirname(sourcePath)!==path.resolve('docs/test_material'))throw new Error('SOURCE_PATH_INVALID');
const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
if(sourceHash!==plan.sourceSha256)throw new Error('AUTHORITATIVE_SOURCE_CHANGED');
const target=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'database-error.txt')});
const version='20260908005000_base_business_workflow_scope',file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file);
const migrations=[version,'20260908005010_base_enrollment_subject_index','20260908005020_base_workflow_class_membership'].map(version=>({version,
  file:`supabase/migrations/${version}.sql`,checksum:textFileSha256(`supabase/migrations/${version}.sql`)}));
const tables=['students','leads','lead_source_records','lead_communications','communication_record_revisions','lead_next_actions',
  'lead_invitation_threads','activities','activity_registrations','assessment_results','course_enrollments','course_opportunities',
  'course_enrollment_assignments','enrollments','student_follow_ups','history_import_records','history_import_associations',
  'data_import_batches','data_import_rows','profiles','classrooms','class_sessions','session_attendance','session_roster_entries',
  'student_guardians','auth.users'];
if(JSON.stringify([...tables].sort())!==JSON.stringify(Object.keys(plan.databaseFingerprint).sort()))throw new Error('FINGERPRINT_TABLES_CHANGED');
const relation=table=>table.includes('.')?table:`public.${table}`;
const fingerprint=`select jsonb_build_object(${tables.map(table=>`${q(table)},(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),''))) from ${relation(table)} r)`).join(',')})`;
const claims="select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated')::text,true) is not null;";
const summary=`select jsonb_build_object('scopeRows',(select count(*) from public.history_workflow_scopes),
  'currentSubjects',(select count(*) from public.student_stage_workspace_index('all','')),
  'stages',(select jsonb_object_agg(stage,n) from (select stage,count(*) n from public.student_stage_workspace_index('all','') group by stage) s),
  'currentLeads',(select count(*) from public.operational_leads),
  'currentAssessmentActivities',(select count(*) from public.business_activities where record_state='current' and deleted_at is null),
  'historicalAssessmentActivities',(select count(*) from public.business_activities where record_state='historical' and deleted_at is null),
  'referenceEnrollmentsExcluded',(select count(*) from public.course_enrollments where not public.business_source_is_authoritative(source_record_id)));`;
const assertions=`
  if (${fingerprint}) is distinct from ${q(JSON.stringify(plan.databaseFingerprint))}::jsonb then raise exception 'PRESERVED_BUSINESS_DATA_CHANGED';end if;
  if exists(select 1 from public.history_workflow_scopes where resumed_at is null and
    ((student_id is not null and public.business_subject_is_current(student_id,null))
      or (lead_id is not null and public.business_subject_is_current(null,lead_id)))) then raise exception 'SCOPED_SUBJECT_IN_CURRENT_QUEUE';end if;
  if exists(select 1 from public.business_course_enrollments e join public.history_import_records r on r.id=e.source_record_id
    where r.source_data->>'format'<>'feishu-base') then raise exception 'REFERENCE_BUSINESS_FACT_LEAK';end if;
  if (select count(*) from public.history_workflow_scopes)<>${plan.scopeRows.length} then raise exception 'SCOPE_COUNT_MISMATCH';end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and (c.relname like 'business_%' or c.relname in ('operational_leads','operational_students')) and c.relkind='v'
    and not coalesce(c.reloptions,'{}') @> array['security_invoker=true']) then raise exception 'VIEW_RLS_REQUIRED';end if;
  if has_table_privilege('authenticated','public.history_workflow_scopes','select') or has_table_privilege('anon','public.history_workflow_scopes','select') then raise exception 'PRIVATE_SCOPE_ACCESS';end if;
`;
if(values.mode==='verify') {
  const output=target.sql(`begin read only;set local statement_timeout='90s';${claims}do $verify$ begin ${assertions} end $verify$;${summary}commit;`);
  const result=JSON.parse(output.split(/\r?\n/).findLast(line=>line.startsWith('{')));
  fs.writeFileSync(path.join(root,'postflight.json'),JSON.stringify({...result,verifiedAt:new Date().toISOString(),sourceOriginalsUnchanged:true}));
  console.log(JSON.stringify(result));process.exit(0);
}
if(fs.existsSync(path.join(root,'workflow-applied.json')))throw new Error('ALREADY_APPLIED_USE_VERIFY');
const existing=target.sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if(existing)throw new Error('MIGRATION_ALREADY_APPLIED');
const rows=plan.scopeRows.map(row=>({student_id:row.studentId,lead_id:row.leadId,record_id:row.recordId,
  reason:row.reason,latest_period:row.latestPeriod,source_ids:row.sourceIds}));
const sql=`begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('base-workflow-scope',0));
  lock table ${tables.map(relation).join(',')} in share mode;
  do $before$ begin if (${fingerprint}) is distinct from ${q(JSON.stringify(plan.databaseFingerprint))}::jsonb then raise exception 'PREPARED_DATA_CHANGED';end if;end $before$;
  ${migrations.map(migration=>fs.readFileSync(migration.file,'utf8')).join('\n')}
  insert into public.history_workflow_scopes(student_id,lead_id,record_id,reason,latest_period,source_ids,current_period,source_filename,source_sha256)
    select r.*,${q(plan.currentPeriod)},${q(plan.authoritativeFilename)},${q(plan.sourceSha256)}
    from jsonb_to_recordset(${q(JSON.stringify(rows))}::jsonb) as r(student_id uuid,lead_id uuid,record_id text,reason text,latest_period text,source_ids text[]);
  ${claims}
  do $verify$ begin ${assertions} end $verify$;
  ${summary}
  ${migrations.map(migration=>`insert into public.schema_migrations(version,checksum) values(${q(migration.version)},${q(migration.checksum)});`).join('\n')}
  commit;`;
fs.writeFileSync(path.join(root,'workflow-apply.sql'),sql,'utf8');
// 既有生命周期函数归 supabase_admin；在已核对的同一本机连接中执行 schema 迁移。
let output;
try {
  output=execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']});
} catch(error) {
  fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr??error.message));
  throw new Error('WORKFLOW_APPLY_FAILED_INSPECT_PRIVATE_ERROR');
}
const result=JSON.parse(output.split(/\r?\n/).findLast(line=>line.startsWith('{')));
fs.writeFileSync(path.join(root,'workflow-applied.json'),JSON.stringify({...result,checksum,planChecksum:textFileSha256(planPath),appliedAt:new Date().toISOString(),target:target.observed}));
console.log(JSON.stringify(result));
