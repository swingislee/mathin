import fs from 'node:fs';
import path from 'node:path';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {historyPayloadHash} from './lib/history-import-trial.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
const mode=process.argv[2];
if(!['--preflight','--check','--apply'].includes(mode))throw new Error('Use --preflight, --check or --apply');
const root=path.resolve('.tmp/contextual-source-associations');fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
const version='20260907000800_contextual_source_associations',file=`supabase/migrations/${version}.sql`;
const checksum=textFileSha256(file),q=value=>`'${String(value).replaceAll("'","''")}'`;
const applied=sql(`begin read only;select coalesce((select checksum from public.schema_migrations where version=${q(version)}),'');commit;`);
if(applied&&applied!==checksum)throw new Error('SOURCE_ASSOCIATION_MIGRATION_CHANGED');
if(mode==='--preflight'){console.log(JSON.stringify({host:observed.host,origin:observed.supabaseOrigin,localTargetVerified:true,migrationApplied:Boolean(applied)}));process.exit(0);}
const source=JSON.parse(fs.readFileSync('.tmp/full-source-import/plan.json','utf8'));
const identities=new Map(source.identities.filter(entity=>entity.kind==='student').map(entity=>[entity.key,entity.localId]));
const candidates=source.records.filter(record=>record.match_status!=='matched').flatMap(record=>record.candidate_data.flatMap(candidate=>identities.has(candidate.key)?[{record_id:record.id,student_id:identities.get(candidate.key)}]:[]));
const checkKey={checksum,sourceHash:source.payloadHash,candidatesHash:historyPayloadHash(candidates),assertions:textFileSha256('scripts/sql/contextual-source-association-assertions.sql')};
const checkFile=path.join(root,'check.json');
if(mode==='--apply'&&(!fs.existsSync(checkFile)||JSON.stringify(JSON.parse(fs.readFileSync(checkFile,'utf8')).checkKey)!==JSON.stringify(checkKey)))throw new Error('SOURCE_ASSOCIATION_CHECK_REQUIRED');
const protectedTables=['students','leads','enrollments','classrooms','class_sessions','session_attendance','activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups','business_record_revisions','history_import_records'];
const fingerprint=protectedTables.map(table=>`select '${table}'::text as name,count(*) as rows,md5(coalesce(string_agg(md5((to_jsonb(t)-'context_source_record_id')::text),'' order by md5((to_jsonb(t)-'context_source_record_id')::text)),'')) digest from public.${table} t`).join(' union all ');
const result=sql(`begin;set local lock_timeout='5s';set local statement_timeout='90s';select pg_advisory_xact_lock(hashtextextended('contextual-source-associations',0));
create temp table context_before as ${fingerprint};
${applied?'':fs.readFileSync(file,'utf8')}
insert into public.history_import_identity_candidates(record_id,student_id) select c.record_id,c.student_id from jsonb_to_recordset(${q(JSON.stringify(candidates))}::jsonb) c(record_id text,student_id uuid) on conflict do nothing;
${mode==='--check'?fs.readFileSync('scripts/sql/contextual-source-association-assertions.sql','utf8'):''}
create temp table context_after as ${fingerprint};
do $verify$ begin if exists((select * from context_before except select * from context_after) union all(select * from context_after except select * from context_before)) then raise exception 'SOURCE_ASSOCIATION_BUSINESS_CHANGED';end if;end $verify$;
${mode==='--check'?'rollback;':`${applied?'':`insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});`}notify pgrst,'reload schema';commit;`}`);
if(mode==='--check'&&!applied&&sql("begin read only;select (to_regclass('public.history_import_associations') is null)::text;commit;")!=='true')throw new Error('SOURCE_ASSOCIATION_ROLLBACK');
const report={mode,checkKey,candidates:candidates.length,localTargetVerified:true,businessUnchanged:true,sourceOriginalsUnchanged:true,
  assertions:mode==='--check'?result.includes('SOURCE_ASSOCIATIONS_PASS')?'PASS':'MISSING':'reused'};
if(report.assertions==='MISSING')throw new Error('SOURCE_ASSOCIATION_ASSERTIONS_MISSING');
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
