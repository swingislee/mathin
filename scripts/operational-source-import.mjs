import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {buildOperationalSourceImport,OPERATIONAL_TABLES} from './lib/operational-source-import.mjs';
import {historyPayloadHash} from './lib/history-import-trial.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--preflight','--prepare','--check','--apply'].includes(mode))throw new Error('Use --preflight, --prepare, --check or --apply (node --experimental-strip-types)');
const root=path.resolve('.tmp/business-model-alignment');fs.mkdirSync(root,{recursive:true});
const {sql,docker,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
// 沟通审计表由数据库管理员持有；仅在上述本机目标核对后使用同一容器的迁移身份。
const migrate=statement=>{try{return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true,maxBuffer:96*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(error){fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr??error.message));throw new Error('LOCAL_MIGRATION_FAILED: inspect private error file');}};
if(mode==='--preflight'){console.log(JSON.stringify({host:observed.host,origin:observed.supabaseOrigin,localTargetVerified:true}));process.exit(0);}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const source=read('.tmp/full-source-import/plan.json');
const batch=JSON.parse(sql(`begin read only;select to_jsonb(b) from public.history_import_batches b where batch_key=${q(source.batchKey)};commit;`));
if(batch.payload_sha256!==source.payloadHash)throw new Error('SOURCE_BATCH_CHANGED');
const snapshot=Object.fromEntries(OPERATIONAL_TABLES.map(table=>[table,JSON.parse(sql(`begin read only;select coalesce(jsonb_agg(t),'[]'::jsonb) from public.${table} t;commit;`))]));
snapshot.profiles=JSON.parse(sql("begin read only;select coalesce(jsonb_agg(t),'[]'::jsonb) from(select id,display_name,role,is_active,account_status from public.profiles where role in ('staff','admin')) t;commit;"));
snapshot.history_import_associations=JSON.parse(sql("begin read only;select coalesce(jsonb_agg(t),'[]'::jsonb) from(select record_id,student_id from public.history_import_associations) t;commit;"));
const plan=buildOperationalSourceImport(source,snapshot);
fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan));
if(mode==='--prepare'){console.log(JSON.stringify({counts:plan.counts,coverage:plan.coverage.reduce((out,row)=>(out[row.table]=(out[row.table]??0)+1,out),{})}));process.exit(0);}
const migration='20260907000900_operational_source_records';
const migrationFile=`supabase/migrations/${migration}.sql`;
const checkKey={migration:textFileSha256(migrationFile),plan:historyPayloadHash(plan),runner:textFileSha256('scripts/operational-source-import.mjs'),normalizer:textFileSha256('src/features/school/business-source-contract.ts')};
if(mode==='--apply'&&JSON.stringify(read(path.join(root,'check.json')).checkKey)!==JSON.stringify(checkKey))throw new Error('SOURCE_ALIGNMENT_CHECK_REQUIRED');
const already=sql(`begin read only;select checksum from public.schema_migrations where version=${q(migration)};commit;`);
if(already&&already!==checkKey.migration)throw new Error('MIGRATION_CHECKSUM_CHANGED');
const columns=JSON.parse(sql("begin read only;select jsonb_object_agg(table_name,names) from (select table_name,jsonb_agg(column_name order by ordinal_position) names from information_schema.columns where table_schema='public' group by table_name) c;commit;"));
const protectedTables=['students','families','contacts','family_contacts','family_students','student_contacts','lead_identity_conversions','student_grade_history','classrooms','class_sessions','enrollments','session_attendance','notifications','work_items','history_import_records','history_import_batch_records','business_record_revisions'];
const fingerprint=protectedTables.filter(t=>columns[t]).map(t=>`select '${t}'::text relation,count(*) rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public.${t} t`).join(' union all ');
const manualTables=OPERATIONAL_TABLES.filter(t=>!['leads','lead_communications'].includes(t));
const originalRows=manualTables.map(t=>`select '${t}'::text relation,id,md5(jsonb_build_object(${columns[t].map(c=>`${q(c)},t.${c}`).join(',')})::text) digest from public.${t} t where source_record_id is null or history_revision>0`).join(' union all ');
if(mode==='--check')fs.writeFileSync(path.join(root,'before.sql'),docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--no-owner',...OPERATIONAL_TABLES.flatMap(t=>['--table',`public.${t}`])]),'utf8');
const inserts=OPERATIONAL_TABLES.map(table=>{
  const rows=plan.rows[table];if(!rows.length)return '';
  const allColumns=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const canonical=manualTables.includes(table);
  const updates=allColumns.filter(c=>!['id','source_record_id','source_field_ids','history_key','source_payload_sha256'].includes(c));
  return `insert into public.${table} as current(${allColumns.join(',')}${canonical?',record_state,history_batch_id,history_imported_at':''})
    select ${allColumns.map(c=>`r.${c}`).join(',')}${canonical?`,'current',${q(batch.id)}::uuid,clock_timestamp()`:''}
    from jsonb_populate_recordset(null::public.${table},${q(JSON.stringify(rows))}::jsonb) r
    on conflict(id) ${canonical?`do update set ${updates.map(c=>`${c}=excluded.${c}`).join(',')} where current.source_record_id=excluded.source_record_id and current.history_revision=0`:'do nothing'};`;
}).join('\n');
const beforeLedger=already?'':fs.readFileSync(migrationFile,'utf8');
const result=migrate(`begin;set local lock_timeout='5s';set local statement_timeout='180s';select pg_advisory_xact_lock(hashtextextended('operational-source-import',0));
create temp table protected_before on commit drop as ${fingerprint};
create temp table manual_before on commit drop as ${originalRows};
${beforeLedger}
set local role postgres;
${inserts}
update public.leads l set source_record_id=coalesce(l.source_record_id,f.source_record_id),note=case when l.note='' then f.note when position(f.note in l.note)>0 then l.note else l.note||E'\n'||f.note end
 from jsonb_to_recordset(${q(JSON.stringify(plan.leadFacts))}::jsonb) f(id uuid,source_record_id text,note text) where l.id=f.id;
create temp table protected_after on commit drop as ${fingerprint};
create temp table manual_after on commit drop as ${originalRows};
do $verify$ begin
 if exists((select * from protected_before except select * from protected_after) union all(select * from protected_after except select * from protected_before)) then raise exception 'PROTECTED_DATA_CHANGED';end if;
 if exists(select 1 from manual_before b left join manual_after a using(relation,id) where a.id is null or a.digest<>b.digest) then raise exception 'MANUAL_DATA_CHANGED';end if;
 if exists(select 1 from public.assessment_results where assessment_band not in ('a','a_plus','s','c','x_plus','g_plus')) then raise exception 'ASSESSMENT_BAND_NOT_NORMALIZED';end if;
 ${OPERATIONAL_TABLES.map(t=>`if (select count(*) from public.${t} where id=any(array[${plan.rows[t].map(r=>q(r.id)).join(',')}]::uuid[]))<>${plan.rows[t].length} then raise exception 'COVERAGE_${t}';end if;`).join('\n')}
end $verify$;
${mode==='--check'?fs.readFileSync('scripts/sql/operational-source-assertions.sql','utf8'):''}
select jsonb_build_object('protectedDataUnchanged',true,'manualDataUnchanged',true,'sourceRows',${plan.coverage.length});
${mode==='--apply'?`${already?'':`insert into public.schema_migrations(version,checksum) values(${q(migration)},${q(checkKey.migration)});`}notify pgrst,'reload schema';commit;`:'rollback;'}`);
const report={mode,checkKey,counts:plan.counts,...JSON.parse(result.split('\n').findLast(line=>line.startsWith('{'))),localTargetVerified:true};
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
