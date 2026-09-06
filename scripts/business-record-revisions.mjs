import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode=process.argv[2];
const validation=process.argv.includes('--validation');
if(!['--preflight','--check','--apply'].includes(mode))throw new Error('Use --preflight, --check or --apply');
const base=path.resolve('.tmp/business-record-revisions'),root=validation?path.join(base,'validation'):base;fs.mkdirSync(root,{recursive:true});
const {sql,docker,observed}=openHistoryLocalTarget({attestationPath:path.join(base,'preflight.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify(observed));process.exit(0);}
const migration=validation?'20260906002400_business_record_revision_validation':'20260906002300_business_record_revisions',file=`supabase/migrations/${migration}.sql`,checksum=textFileSha256(file);
if(sql(`begin read only;select count(*) from public.schema_migrations where version='${migration}';commit;`)!=='0')throw new Error('REVISION_MIGRATION_ALREADY_APPLIED');
const checkFile=path.join(root,'check.json');
if(mode==='--apply'&&(!fs.existsSync(checkFile)||JSON.parse(fs.readFileSync(checkFile,'utf8')).checksum!==checksum))throw new Error('REVISION_CHECK_REQUIRED');
const canonical=['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'];
const protectedTables=[...canonical,'history_import_records','history_import_batches','students','profiles','leads','families','family_students','classrooms','class_sessions','enrollments','session_attendance','course_opportunity_events','course_enrollment_events','notifications','notification_deliveries','work_items','lead_communications','lead_invitation_events'];
const columns=JSON.parse(sql(`begin read only;select jsonb_object_agg(table_name,names) from (select table_name,jsonb_agg(column_name order by ordinal_position) names from information_schema.columns where table_schema='public' group by table_name)c;commit;`));
const covered=protectedTables.filter(table=>columns[table]);
const fingerprint=covered.map(table=>{
  const row=`jsonb_build_object(${columns[table].map(column=>`'${column}',t.${column}`).join(',')})`;
  return `select '${table}'::text name,count(*)::integer rows,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) digest from public.${table} t`;
}).join('\nunion all\n');
if(mode==='--check'){
  fs.writeFileSync(path.join(root,'schema-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner']),'utf8');
  fs.writeFileSync(path.join(root,'business-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--data-only','--inserts',...canonical.flatMap(table=>['--table',`public.${table}`])]),'utf8');
}
const body=`set local lock_timeout='5s';set local statement_timeout='90s';
select pg_advisory_xact_lock(hashtextextended('business-record-revisions',0));
create temp table revision_data_before on commit drop as ${fingerprint};
${fs.readFileSync(file,'utf8')}
${mode==='--check'?`savepoint before_behavior;${fs.readFileSync('scripts/sql/business-record-revision-assertions.sql','utf8')}rollback to before_behavior;`:''}
${mode==='--check'&&validation?`savepoint before_validation;${fs.readFileSync('scripts/sql/business-record-revision-validation-assertions.sql','utf8')}rollback to before_validation;`:''}
create temp table revision_data_after on commit drop as ${fingerprint};
do $check$ begin if exists((select * from revision_data_before except select * from revision_data_after) union all(select * from revision_data_after except select * from revision_data_before)) then raise exception 'REVISION_BUSINESS_DATA_CHANGED';end if;end $check$;
`;
sql(`begin isolation level repeatable read;${body}${mode==='--check'?'rollback;':`insert into public.schema_migrations(version,checksum) values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`}`);
if(mode==='--check'&&sql(validation?"begin read only;select count(*) from pg_proc where oid=to_regprocedure('public.validate_business_record_revision_values(jsonb)');commit;":"begin read only;select count(*) from information_schema.columns where table_schema='public' and column_name='history_revision';commit;")!=='0')throw new Error('REVISION_ROLLBACK_FAILED');
const result={mode,checksum,checkedAt:new Date().toISOString(),host:observed.host,protectedTables:covered.length,businessDataUnchanged:true,checks:mode==='--check'?'all five domains, source preservation, admin/non-admin, conflict, forbidden fields, immutable audit, rollback':'verified migration applied; no business edits'};
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(result,null,2),'utf8');
console.log(JSON.stringify(result));
