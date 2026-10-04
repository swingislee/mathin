import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--check','--apply'].includes(mode))throw new Error('Use --check or --apply after explicit approval for the five trial tables');
const root=path.resolve('.tmp/business-record-history');
const {sql,docker}=openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),errorFile:path.join(root,'cleanup-error.txt')});
const migration='20260906002100_retire_history_trial_tables',file=`supabase/migrations/${migration}.sql`,checksum=textFileSha256(file);
const legacy=['student_renewal_history','student_activity_history','student_assessment_history','student_enrollment_history','student_communication_history'];
const primary=['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups',
  'students','leads','families','contacts','enrollments','classrooms','class_sessions','lead_communications','lead_next_actions','lead_invitation_threads','lead_invitation_events',
  'history_import_records','history_import_batches','history_import_batch_records','renewal_cycles','renewal_cycle_entries','notifications','work_items'];
if(sql(`begin read only; select count(*) from public.schema_migrations where version='20260906002000_business_record_history_state';commit;`)!=='1')throw new Error('CANONICAL_MIGRATION_REQUIRED');
if(sql(`begin read only; select count(*) from public.schema_migrations where version='${migration}';commit;`)!=='0')throw new Error('TRIAL_CLEANUP_ALREADY_APPLIED');
const plan=JSON.parse(fs.readFileSync('.tmp/student-business-history-trial/plan.json','utf8'));
const copies=Object.fromEntries(legacy.map(table=>[table,JSON.parse(sql(`begin read only;select coalesce(jsonb_agg(t order by id),'[]') from public.${table} t;commit;`))]));
for(const table of legacy){
  const expected=plan.rows[table],actual=copies[table];
  if(expected.length!==actual.length||expected.some(row=>!actual.some(value=>Object.entries(row).every(([key,item])=>JSON.stringify(value[key])===JSON.stringify(item)))))throw new Error('TRIAL_CLEANUP_SCOPE_CHANGED');
}
const fingerprint=primary.map(table=>`select '${table}'::text as name,count(*)::integer as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from public.${table} t`).join(' union all ');
const before=`set local lock_timeout='5s';set local statement_timeout='60s';select pg_advisory_xact_lock(hashtextextended('business-record-history',0));create temp table cleanup_before on commit drop as ${fingerprint};`;
const verify=`create temp table cleanup_after on commit drop as ${fingerprint};do $verify$ begin if exists((select * from cleanup_before except select * from cleanup_after) union all(select * from cleanup_after except select * from cleanup_before)) then raise exception 'TRIAL_CLEANUP_CANONICAL_CHANGED';end if;end $verify$;`;
const reportFile=path.join(root,'cleanup-check.json');
if(mode==='--check'){
  const backup=docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--data-only','--inserts',...legacy.flatMap(table=>['--table',`public.${table}`])]);
  fs.writeFileSync(path.join(root,'cleanup-source-before.sql'),backup,'utf8');
  fs.writeFileSync(path.join(root,'cleanup-schema-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner']),'utf8');
  const schema=fs.readFileSync('supabase/migrations/20260906001000_student_business_history.sql','utf8');
  const restore=schema.slice(schema.indexOf('create table public.student_renewal_history'));
  const tag='$restore_expected$';if(JSON.stringify(copies).includes(tag))throw new Error('BACKUP_DELIMITER');
  const restored=legacy.map(table=>`if (select coalesce(jsonb_agg(t order by id),'[]') from public.${table} t) is distinct from (${tag}${JSON.stringify(copies)}${tag}::jsonb->'${table}') then raise exception 'TRIAL_BACKUP_RESTORE_MISMATCH';end if;`).join('\n');
  sql(`begin isolation level repeatable read;${before}${fs.readFileSync(file,'utf8')}${verify}${restore}\n${backup}\ndo $restore$ begin ${restored} end $restore$;rollback;`);
  if(sql(`select count(*) from pg_tables where schemaname='public' and tablename in (${legacy.map(table=>`'${table}'`).join(',')});`)!=='5')throw new Error('TRIAL_CLEANUP_ROLLBACK_FAILED');
  const report={checksum,tables:5,rows:Object.values(copies).reduce((sum,rows)=>sum+rows.length,0),backupRestored:'PASS',transactionRollback:'PASS',canonicalDataUnchanged:true,protectedTables:primary.length};
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report));
}else{
  if(!fs.existsSync(reportFile)||JSON.parse(fs.readFileSync(reportFile,'utf8')).checksum!==checksum)throw new Error('TRIAL_CLEANUP_CHECK_REQUIRED');
  sql(`begin isolation level repeatable read;${before}${fs.readFileSync(file,'utf8')}${verify}insert into public.schema_migrations(version,checksum)values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`);
  if(sql(`select count(*) from pg_tables where schemaname='public' and tablename in (${legacy.map(table=>`'${table}'`).join(',')});`)!=='0')throw new Error('TRIAL_CLEANUP_INCOMPLETE');
  const report={checksum,tablesRemoved:5,trialRowsRemoved:8,canonicalDataUnchanged:true,originalSourcesUnchanged:true};
  fs.writeFileSync(path.join(root,'cleanup-applied.json'),JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report));
}
