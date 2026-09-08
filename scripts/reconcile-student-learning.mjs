// 开发库学习资料按证据推定关联；原始身份与来源保持完整。
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {openHistoryLocalTarget} from './lib/history-local-target.mjs';
import {textFileSha256} from './lib/text-hash.mjs';
const {values}=parseArgs({options:{plan:{type:'string'}}});
const planPath=path.resolve(values.plan??'');
if(!planPath.startsWith(path.resolve('.tmp')+path.sep))throw new Error('PRIVATE_WORKSPACE_PLAN_REQUIRED');
const root=path.dirname(planPath),plan=JSON.parse(fs.readFileSync(planPath,'utf8'));
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
if(!Array.isArray(plan.links)||plan.links.length>5000||plan.links.some(row=>!uuid.test(row.studentId)||!/^(source|feishu)-record:[a-f\d]{64}$/.test(row.recordId)||row.reason?.method!=='evidence_rank_v1'))throw new Error('INVALID_PLAN');
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const target=openHistoryLocalTarget({attestationPath:path.join(root,'target.json'),refresh:true,errorFile:path.join(root,'error.txt')});
const migrations=['20260908006300_history_workflow_manual_review','20260908006400_inferred_student_learning_links','20260908006500_inferred_source_lead_continuity','20260908006600_student_stage_source_key_context'];
let definitions='';
for(const version of migrations){
 const file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file);
 const applied=target.sql(`select checksum from public.schema_migrations where version=${q(version)}`);
 if(applied&&applied!==checksum)throw new Error('MIGRATION_CHECKSUM_CHANGED');
 if(!applied)definitions+=fs.readFileSync(file,'utf8')+`\ninsert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});\n`;
}
const statement=`begin;set local lock_timeout='5s';set local statement_timeout='60s';
${definitions}
create temporary table proposed_learning_links as select * from jsonb_to_recordset(${q(JSON.stringify(plan.links))}::jsonb) as r("recordId" text,"studentId" uuid,reason jsonb,candidates jsonb);
do $check$ begin
 if exists(select 1 from proposed_learning_links p left join public.students s on s.id=p."studentId" left join public.history_import_records h on h.id=p."recordId" left join public.leads l on l.id=h.lead_id
   where s.id is null or s.deleted_at is not null or h.id is null or h.student_id is not null or (l.student_id is not null and l.student_id<>p."studentId") or h.source_data->>'format'<>'feishu-base' or public.history_source_is_shared(h.record_data)) then raise exception 'SOURCE_OR_STUDENT_CHANGED';end if;
end $check$;
with inserted as (
 insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by,match_state,match_reason)
 select p."recordId",p."studentId",1,'assessment',null,'inferred',p.reason from proposed_learning_links p
 on conflict(record_id) do nothing returning *
), events as (
 insert into public.history_import_association_events(record_id,before_data,after_data,recorded_by)
 select i.record_id,'{}',to_jsonb(i),null from inserted i returning id
) select jsonb_build_object('savedInferredLinks',(select count(*) from inserted),'auditEvents',(select count(*) from events));
commit;`;
try {
 const output=execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
 fs.writeFileSync(path.join(root,'inference-applied.json'),JSON.stringify({appliedAt:new Date().toISOString(),target:target.observed,output}));
 console.log(output.trim());
}catch(error){fs.writeFileSync(path.join(root,'error.txt'),String(error.stderr??error.message));throw new Error('LOCAL_INFERENCE_FAILED_INSPECT_PRIVATE_ERROR');}
