import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2],subjectLinks=process.argv.includes('--subject-links'),root=path.resolve(subjectLinks?'.tmp/source-business-subject-links':'.tmp/source-business-continuation');
if(!['--preflight','--check','--apply'].includes(mode))throw new Error('Use --preflight, --check or --apply');
fs.mkdirSync(root,{recursive:true});
const {sql,docker,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify({host:observed.host,origin:observed.supabaseOrigin,localTargetVerified:true}));process.exit(0);}
const migration=subjectLinks?'20260907001100_source_business_subject_links':'20260907001000_source_business_continuation',file=`supabase/migrations/${migration}.sql`;
const assertions=subjectLinks?'scripts/sql/source-business-subject-links-assertions.sql':'scripts/sql/source-business-continuation-assertions.sql';
const checkKey={migration:textFileSha256(file),assertions:textFileSha256(assertions),runner:textFileSha256('scripts/source-business-continuation.mjs')};
if(mode==='--apply'&&JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'check.json'),'utf8')).checkKey)!==JSON.stringify(checkKey))throw new Error('CHECK_REQUIRED');
if(sql(`begin read only;select count(*) from public.schema_migrations where version='${migration}';commit;`)!=='0')throw new Error('MIGRATION_ALREADY_APPLIED');
const protectedTables=['students','families','contacts','family_students','family_contacts','classrooms','class_sessions','enrollments','session_attendance','activities','activity_registrations','assessment_results','assessment_reports','course_enrollments','course_enrollment_assignments','course_opportunities','business_record_revisions','history_import_records','history_import_associations',...(subjectLinks?['history_import_association_events']:[])];
const scopes=subjectLinks?{}:{activities:"where coalesce(history_key,'') not like 'operation-visit:%' or history_revision>0",activity_registrations:"where coalesce(history_key,'') not like 'operation-visit:%' or history_revision>0",assessment_results:"where source_record_id is null or history_revision>0 or source_record_id not in(select id from public.history_import_records where record_data->>'tableName'='到访数据与信息表1.0-总')"};
const fingerprint=protectedTables.map(t=>`select '${t}'::text relation,count(*) rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public.${t} t ${scopes[t]??''}`).join(' union all ');
const before=sql(`begin read only;select jsonb_agg(t order by relation) from (${fingerprint}) t;commit;`);
if(mode==='--check')fs.writeFileSync(path.join(root,'schema-before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner']));
const statement=`begin;set local lock_timeout='5s';set local statement_timeout='90s';select pg_advisory_xact_lock(hashtextextended('source-business-continuation',0));
create temp table before_business on commit drop as ${fingerprint};
${fs.readFileSync(file,'utf8')}
${mode==='--check'?fs.readFileSync(assertions,'utf8'):''}
create temp table after_business on commit drop as ${fingerprint};
do $verify$ begin if exists((select * from before_business except select * from after_business) union all(select * from after_business except select * from before_business)) then raise exception 'BUSINESS_DATA_CHANGED';end if;end $verify$;
${mode==='--apply'?`insert into public.schema_migrations(version,checksum) values('${migration}','${checkKey.migration}');notify pgrst,'reload schema';commit;`:'rollback;'}`;
try {execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']});}
catch(error){fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr??error.message));throw new Error('LOCAL_MIGRATION_FAILED: inspect private error file');}
const after=sql(`begin read only;select jsonb_agg(t order by relation) from (${fingerprint}) t;commit;`);
if(before!==after)throw new Error('BUSINESS_DATA_CHANGED_AFTER_TRANSACTION');
const report={mode,checkKey,localTargetVerified:true,protectedTables:protectedTables.length,protectedDataUnchanged:true,...(mode==='--check'?{rollback:true,...(subjectLinks?{subjectBinding:true}:{sourcePlacement:true,reportScale:true}),anonymousBoundary:true}:{}),checkedAt:new Date().toISOString()};
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
