import fs from 'node:fs';
import path from 'node:path';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {buildCompleteBusinessHistory,COMPLETE_HISTORY_TABLES} from './lib/complete-business-history.mjs';
import {historyPayloadHash} from './lib/history-import-trial.mjs';
import {textFileSha256} from './lib/text-hash.mjs';

const mode=process.argv[2];
if(!['--preflight','--prepare','--check','--apply'].includes(mode))throw new Error('Use --preflight, --prepare, --check or --apply');
const root=path.resolve('.tmp/complete-business-history');fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify({host:observed.host,origin:observed.supabaseOrigin,localTargetVerified:true}));process.exit(0);}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const source=read('.tmp/full-source-import/plan.json');
const sourceBatch=JSON.parse(sql(`begin read only;select to_jsonb(b) from public.history_import_batches b where batch_key=${q(source.batchKey)};commit;`));
if(sourceBatch.payload_sha256!==source.payloadHash)throw new Error('COMPLETE_BUSINESS_SOURCE_CHANGED');
const planPath=path.join(root,'plan.json');
if(mode==='--prepare') {
  const prior=JSON.parse(sql(`begin read only;select coalesce(jsonb_agg(h),'[]') from public.history_import_records h where ${COMPLETE_HISTORY_TABLES.map(table=>`exists(select 1 from public.${table} t where t.source_record_id=h.id)`).join(' or ')};commit;`));
  const plan=buildCompleteBusinessHistory(source,prior);
  fs.writeFileSync(planPath,JSON.stringify(plan));
  console.log(JSON.stringify({mode,counts:plan.counts,priorSourcesRetained:plan.skippedExistingSourceIds.length}));process.exit(0);
}
const plan=read(planPath);
if(plan.sourcePayloadHash!==source.payloadHash||plan.sourceBatchKey!==source.batchKey)throw new Error('COMPLETE_BUSINESS_INPUT_CHANGED');
const checkKey={payload:historyPayloadHash(plan),script:textFileSha256('scripts/complete-business-history.mjs'),library:textFileSha256('scripts/lib/complete-business-history.mjs')};
if(mode==='--apply'&&(!fs.existsSync(path.join(root,'check.json'))||JSON.stringify(read(path.join(root,'check.json')).checkKey)!==JSON.stringify(checkKey)))throw new Error('COMPLETE_BUSINESS_CHECK_REQUIRED');
const defaultColumns={activity_registrations:{reported_result:'',result_link_status:'none',result_source_record_id:null,result_field_ids:[]}};
const inserts=COMPLETE_HISTORY_TABLES.flatMap(table=>{
  const rows=plan.rows[table].map(row=>({...defaultColumns[table],...row}));
  if(!rows.length)return[];
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  return [`insert into public.${table}(${columns.join(',')},record_state,history_batch_id,history_imported_at)
    select ${columns.map(column=>`r.${column}`).join(',')},'historical',${q(sourceBatch.id)}::uuid,clock_timestamp()
    from jsonb_populate_recordset(null::public.${table},${q(JSON.stringify(rows))}::jsonb) r on conflict(history_key) do nothing;`];
}).join('\n');
const protectedTables=['students','leads','classrooms','class_sessions','enrollments','session_attendance','student_grade_history','lead_communications',
  'lead_next_actions','lead_invitation_threads','lead_invitation_events','communication_worklists','communication_worklist_items','course_opportunity_events',
  'course_enrollment_events','renewal_cycles','renewal_cycle_entries','class_support_tasks','work_items','notifications','business_record_revisions'];
const available=new Set(sql("begin read only;select tablename from pg_tables where schemaname='public';commit;").split('\n'));
const fingerprint=protectedTables.filter(table=>available.has(table)).map(table=>`select '${table}'::text as name,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public.${table} t`).join('\nunion all\n');
const existing=COMPLETE_HISTORY_TABLES.map(table=>`select '${table}'::text as relation,id,md5(to_jsonb(t)::text) digest from public.${table} t`).join(' union all ');
const used=new Set(Object.values(plan.rows).flat().map(row=>row.source_record_id));
const originals=source.records.filter(row=>used.has(row.id)).map(row=>({id:row.id,student_id:row.student_id,payload_sha256:row.payload_sha256}));
const result=sql(`begin;set local lock_timeout='5s';set local statement_timeout='90s';select pg_advisory_xact_lock(hashtextextended('complete-business-history',0));
create temp table business_before on commit drop as ${fingerprint};
create temp table prior_business on commit drop as ${existing};
do $source$ begin if exists(select 1 from jsonb_to_recordset(${q(JSON.stringify(originals))}::jsonb) x(id text,student_id uuid,payload_sha256 text)
left join public.history_import_records h on h.id=x.id where h.id is null or h.student_id is distinct from x.student_id or h.payload_sha256<>x.payload_sha256) then raise exception 'SOURCE_CHANGED';end if;end $source$;
${inserts}
create temp table business_after on commit drop as ${fingerprint};
create temp table final_business on commit drop as ${existing};
do $verify$ begin
 if exists((select * from business_before except select * from business_after) union all(select * from business_after except select * from business_before)) then raise exception 'CURRENT_BUSINESS_CHANGED';end if;
 if exists(select 1 from prior_business p left join final_business f on f.relation=p.relation and f.id=p.id where f.id is null or f.digest<>p.digest) then raise exception 'PRIOR_BUSINESS_REVISION_CHANGED';end if;
 ${COMPLETE_HISTORY_TABLES.filter(table=>plan.rows[table].length).map(table=>`if (select count(*) from public.${table} where history_key=any(array[${plan.rows[table].map(row=>q(row.history_key)).join(',')}]::text[]))<>${plan.rows[table].length} then raise exception 'BUSINESS_COVERAGE_${table}';end if;`).join('\n')}
end $verify$;
select jsonb_build_object('priorRecordsUnchanged',true,'currentWorkUnchanged',true,'inserted',(select count(*) from final_business)-(select count(*) from prior_business));
${mode==='--apply'?`update public.history_import_batches set verification=verification||jsonb_build_object('businessProjection',${q(JSON.stringify(plan.counts))}::jsonb,'businessProjectionHash',${q(checkKey.payload)}) where id=${q(sourceBatch.id)};commit;`:'rollback;'}`);
const report={mode,checkKey,...JSON.parse(result.split('\n').findLast(line=>line.startsWith('{'))),counts:plan.counts,localTargetVerified:true};
fs.writeFileSync(path.join(root,mode==='--check'?'check.json':'applied.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
