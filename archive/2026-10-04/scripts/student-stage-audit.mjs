// 学员阶段只读审计：业务明细仅写入 gitignored 私有目录，控制台只输出匿名统计。
import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const root = path.resolve('.tmp/student-stage-audit');
fs.mkdirSync(root, { recursive: true });
const { sql } = openHistoryLocalTarget({ attestationPath: path.resolve('.tmp/student-stage-workspace/preflight.json'),
  errorFile: path.join(root, 'database-error.txt') });
const tables = {
  students: "select id,name,phone,parent_phone,grade,status,source,assigned_to,follow_up_status,last_follow_up_at,remark,tags,deleted_at from public.students",
  leads: "select id,provisional_student_name,normalized_name,phone,phone_normalized,status,student_id,suggested_student_id,owner_id,source_record_id,note from public.leads",
  lead_communications: "select id,lead_id,outcome,note,occurred_at,occurred_on,source_record_id,wechat_added,interest_level from public.lead_communications",
  communication_record_revisions: "select source,event_id,revision_no,effective_patch from public.communication_record_revisions",
  lead_invitation_threads: "select id,lead_id,kind,state,activity_id,scheduled_at,updated_at from public.lead_invitation_threads",
  lead_source_records: "select id,lead_id,source_system,batch_label,source_marked_duplicate,remark,payment_status from public.lead_source_records",
  activity_registrations: "select id,student_id,lead_id,activity_id,status,record_state,source_record_id,registered_on,reported_result,result_link_status,assessment_started_at,assessment_completed_at,source_enrollment_facts from public.activity_registrations",
  activities: "select id,kind,title,record_state,source_record_id,scheduled_at,occurred_on,deleted_at from public.activities",
  assessment_results: "select id,student_id,activity_registration_id,score,assessment_band,strengths,result_source,result_finalized_at,record_state,source_record_id,assessed_on from public.assessment_results",
  course_enrollments: "select id,student_id,opportunity_id,course_id,term_id,status,record_state,source_record_id,period_label,registered_on,confirmed_at,cancelled_at from public.course_enrollments",
  enrollments: "select e.id,e.student_id,e.classroom_id,e.status,e.left_at,c.name as classroom_name,c.term_id from public.enrollments e join public.classrooms c on c.id=e.classroom_id",
  school_terms: "select id,name,starts_on,ends_on from public.school_terms",
  course_opportunities: "select id,student_id,lead_id,opportunity_type,stage,record_state,source_record_id,term_label,class_label,period_year,period_key,course_id,term_id from public.course_opportunities",
  student_follow_ups: "select id,student_id,content,kind,record_state,context_kind,source_record_id,occurred_on,created_at from public.student_follow_ups",
  history_import_records: `select id,jsonb_build_object('format',source_data->'format','filename',source_data->'filename') as source_data,
    jsonb_build_object('tableName',record_data->'tableName','names',record_data->'names','phones',record_data->'phones',
      'cells',(select jsonb_agg(jsonb_build_object('fieldId',cell->'fieldId','fieldName',cell->'fieldName','text',cell->'text'))
        from jsonb_array_elements(coalesce(record_data->'cells','[]'::jsonb)) cell where length(coalesce(cell->>'text',''))>0)) as record_data,
    match_status,student_id,lead_id from public.history_import_records`,
  history_import_associations: "select record_id,student_id,version,context from public.history_import_associations",
};
const body = Object.entries(tables).map(([name, query]) => `'${name}',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (${query}) r)`).join(',');
const snapshot = JSON.parse(sql(`begin isolation level repeatable read read only;
  set local statement_timeout='45s';
  select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated')::text,true) is not null;
  select jsonb_build_object('capturedAt',now(),'stages',(select jsonb_agg(to_jsonb(s)) from public.student_stage_workspace_index('all','') s),${body});
  commit;`).split('\n').filter(line => line.startsWith('{')).join('\n'));
const run = path.join(root, new Date().toISOString().replace(/[-:.]/g, ''));
fs.mkdirSync(run);
fs.writeFileSync(path.join(run, 'snapshot.json'), JSON.stringify(snapshot), 'utf8');
fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ run }), 'utf8');
const countBy = (rows, getKey) => Object.entries(rows.reduce((counts, row) => { const key = getKey(row); counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}))
  .map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
const first = snapshot.stages.filter(row => row.stage === 'awaiting_first_contact');
const leads = new Map(snapshot.leads.map(row => [row.id, row]));
const students = new Map(snapshot.students.map(row => [row.id, row]));
const sources = new Map(snapshot.history_import_records.map(row => [row.id, row]));
console.log(JSON.stringify({ counts: Object.fromEntries(Object.entries(tables).map(([name]) => [name, snapshot[name].length])),
  stages: countBy(snapshot.stages, row => row.stage), firstContact: {
    subjects: countBy(first, row => row.student_id ? 'student' : 'unlinked_lead'),
    leadStatuses: countBy(first.filter(row => row.lead_id), row => leads.get(row.lead_id)?.status ?? 'missing'),
    studentStatuses: countBy(first.filter(row => row.student_id), row => students.get(row.student_id)?.status ?? 'missing'),
    sources: countBy(first, row => row.lead_id && leads.get(row.lead_id)?.source_record_id
      ? sources.get(leads.get(row.lead_id).source_record_id)?.record_data.tableName ?? 'source_missing'
      : row.student_id ? students.get(row.student_id)?.source ?? 'student_no_source' : 'lead_intake_or_manual'),
  } }));
