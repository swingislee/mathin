import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--check','--apply','--preflight'].includes(mode))throw new Error('Use --preflight, --check or --apply');
const root=path.resolve('.tmp/business-record-history');fs.mkdirSync(root,{recursive:true});
const {sql,docker,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify(observed));process.exit(0);}
const migration='20260906002000_business_record_history_state';
const file=`supabase/migrations/${migration}.sql`,checksum=textFileSha256(file);
const legacy=['student_renewal_history','student_activity_history','student_assessment_history','student_enrollment_history','student_communication_history'];
const canonical=['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'];
const protectedTables=['students','leads','families','contacts','family_contacts','family_students','student_contacts','lead_identity_conversions','student_grade_history',
  'lead_communications','student_follow_ups','activity_followup_contacts','lead_next_actions','lead_invitation_threads','lead_invitation_events','communication_worklists','communication_worklist_items',
  'assessment_results','activities','activity_registrations','course_opportunities','course_opportunity_events','course_enrollments','course_enrollment_assignments','course_enrollment_events',
  'renewal_cycles','renewal_cycle_entries','renewal_registration_records','class_support_tasks','class_support_task_recipients','classrooms','class_sessions','enrollments','session_attendance',
  'notifications','notification_deliveries','work_items','work_item_assignments','work_item_user_state','history_import_records','history_import_batches','history_import_batch_records',...legacy];
if(sql(`begin read only;select count(*) from public.schema_migrations where version='${migration}';commit;`)!=='0')throw new Error('BUSINESS_RECORD_MIGRATION_ALREADY_APPLIED');
const columns=JSON.parse(sql(`begin read only; select jsonb_object_agg(table_name,names) from (select table_name,jsonb_agg(column_name order by ordinal_position) names from information_schema.columns where table_schema='public' group by table_name) c;commit;`));
const covered=protectedTables.filter(table=>columns[table]);
const fingerprint=covered.map(table=>{
  const row=`jsonb_build_object(${columns[table].map(column=>`'${column}',t.${column}`).join(',')})`;
  return `select '${table}'::text as name,count(*)::integer as rows,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) as digest from public.${table} t ${canonical.includes(table)?"where coalesce(to_jsonb(t)->>'record_state','current')='current'":''}`;
}).join('\nunion all\n');
const checkFile=path.join(root,'check.json');
if(mode==='--apply'&&(!fs.existsSync(checkFile)||JSON.parse(fs.readFileSync(checkFile,'utf8')).checksum!==checksum))throw new Error('BUSINESS_RECORD_CHECK_REQUIRED');
const original=Object.fromEntries(legacy.map(table=>[table,JSON.parse(sql(`begin read only;select coalesce(jsonb_agg(t order by id),'[]') from public.${table} t;commit;`))]));
const approvedPlan=JSON.parse(fs.readFileSync('.tmp/student-business-history-trial/plan.json','utf8'));
for(const table of legacy){
  const actual=original[table],expected=approvedPlan.rows[table];
  if(actual.length!==expected.length||expected.some(row=>!actual.some(value=>Object.entries(row).every(([key,item])=>JSON.stringify(value[key])===JSON.stringify(item)))))throw new Error('BUSINESS_RECORD_SOURCE_PLAN_CHANGED');
}
if(mode==='--check'){
  fs.writeFileSync(path.join(root,'source-before.json'),JSON.stringify(original,null,2),'utf8');
  fs.writeFileSync(path.join(root,'schema-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner']),'utf8');
  fs.writeFileSync(path.join(root,'source-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--data-only','--inserts',...legacy.flatMap(table=>['--table',`public.${table}`])]),'utf8');
}
const body=`set local lock_timeout='5s';set local statement_timeout='90s';
select pg_advisory_xact_lock(hashtextextended('business-record-history',0));
create temp table canonical_before on commit drop as ${fingerprint};
${fs.readFileSync(file,'utf8')}
${fs.readFileSync('scripts/sql/business-record-history-assertions.sql','utf8')}
create temp table canonical_after on commit drop as ${fingerprint};
do $verify$ begin if exists((select * from canonical_before except select * from canonical_after) union all(select * from canonical_after except select * from canonical_before)) then raise exception 'BUSINESS_RECORD_CURRENT_DATA_CHANGED';end if;end $verify$;
select jsonb_build_object('currentDataUnchanged',true,'protectedTables',${covered.length},'canonicalCounts',(select jsonb_object_agg(name,rows) from (${canonical.map(table=>`select '${table}' as name,count(*) as rows from public.${table} where record_state='historical'`).join(' union all ')}) counts));
`;
const result=sql(`begin isolation level repeatable read;${body}${mode==='--check'?'rollback;':`insert into public.schema_migrations(version,checksum) values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`}`);
const report={...JSON.parse(result.split('\n').findLast(line=>line.startsWith('{'))),checksum,checkedAt:new Date().toISOString(),host:observed.host,rls:'PASS',currentConstraints:'PASS',historicalRpcGuards:'PASS',sourceFields:'PASS',legacyTablesRetained:true};
if(mode==='--check'){
  const remaining=Number(sql(`begin read only;select count(*) from information_schema.columns where table_schema='public' and table_name='course_opportunities' and column_name='record_state';commit;`));
  const restored=Number(sql(`begin read only;select count(*) from pg_tables where schemaname='public' and tablename in (${legacy.map(table=>`'${table}'`).join(',')});commit;`));
  if(remaining!==0||restored!==legacy.length)throw new Error('BUSINESS_RECORD_ROLLBACK_FAILED');
  report.rollback='PASS';
}
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify({mode,...report}));
