import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const { values } = parseArgs({ options: { run: { type: 'string' }, 'source-run': { type: 'string' }, capture: { type: 'boolean', default: false } } });
if (!values.run || !values['source-run']) throw new Error('REVIEW_AND_SOURCE_RUN_REQUIRED');
const root = path.resolve(values.run);
const privateRoot = path.resolve('.tmp/source-refresh');
if (!root.startsWith(`${privateRoot}${path.sep}`)) throw new Error('REVIEW_MUST_USE_PRIVATE_SOURCE_REFRESH_DIRECTORY');
fs.mkdirSync(root, { recursive: true });
const snapshotPath = path.join(root, 'target-snapshot.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (values.capture) {
  if (fs.existsSync(snapshotPath)) throw new Error('TARGET_SNAPSHOT_ALREADY_EXISTS');
  const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'target-attestation.json'), refresh: true,
    errorFile: path.join(root, 'target-error.private.txt') });
  // 只读一致性快照保留身份、来源映射与修订状态，避免导出绑定码或班级邀请码。
  const columns = {
    students: 'id,name,phone,parent_phone,parent_name,grade,school,public_school_class,status,updated_at,deleted_at',
    leads: 'id,provisional_student_name,phone,phone_normalized,grade_hint,student_id,suggested_student_id,identity_confirmed_at,status,updated_at',
    contacts: 'id,display_name,phone,phone_normalized,updated_at', student_contacts: 'student_id,contact_id,relation,is_primary',
    family_students: 'family_id,student_id', family_contacts: 'family_id,contact_id',
    enrollments: 'id,student_id,classroom_id,status,joined_at,left_at,term_id',
    classrooms: 'id,name,grade,purpose,term_id,room,operational_status,archived_at,trashed_at',
    data_import_batches: 'id,import_kind,source_system,source_file_name,source_file_hash,source_sheet_name,status,completed_at',
    data_import_rows: 'batch_id,row_no,normalized_key,row_status,target_id,payload',
    history_import_records: 'id,source_table_id,source_record_id,source_sha256,student_id,lead_id,match_status,payload_sha256',
    activities: 'id,record_state,source_record_id,history_revision',
    activity_registrations: 'id,student_id,activity_id,record_state,source_record_id,history_revision',
    assessment_results: 'id,student_id,record_state,source_record_id,history_revision',
    course_enrollments: 'id,student_id,record_state,source_record_id,history_revision',
    course_enrollment_assignments: 'id,course_enrollment_id,record_state,source_record_id,history_revision',
    course_opportunities: 'id,student_id,record_state,source_record_id,history_revision',
    student_follow_ups: 'id,student_id,record_state,source_record_id,history_revision',
    business_record_revisions: 'id,kind,record_id,recorded_at,reason',
  };
  const lines = sql(`begin isolation level repeatable read read only;
    ${Object.entries(columns).map(([table, projection]) => `select jsonb_build_object('table','${table}','rows',coalesce(jsonb_agg(t),'[]'::jsonb)) from (select ${projection} from public.${table}) t;`).join('\n')}
    commit;`);
  const tables = Object.fromEntries(lines.split(/\r?\n/u).filter(Boolean).map(line => { const item = JSON.parse(line); return [item.table, item.rows]; }));
  fs.writeFileSync(snapshotPath, JSON.stringify({ capturedAt: new Date().toISOString(), target: observed, tables }), { flag: 'wx', encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'snapshot-digest.json'), JSON.stringify({ sha256: digest(snapshotPath) }), { flag: 'wx', encoding: 'utf8' });
  console.log(JSON.stringify({ mode: 'read_only_snapshot', tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])), businessWrites: 0 }));
} else {
  if (digest(snapshotPath) !== read(path.join(root, 'snapshot-digest.json')).sha256) throw new Error('TARGET_SNAPSHOT_CHANGED');
  const sourceRoot = path.resolve(values['source-run']);
  const latest = read(path.join(sourceRoot, 'latest-analysis.json'));
  const analysisPath = path.resolve(sourceRoot, latest.file);
  if (!analysisPath.startsWith(`${sourceRoot}${path.sep}`) || digest(analysisPath) !== latest.sha256) throw new Error('SOURCE_ANALYSIS_CHANGED');
  const { buildAutumnIdentityReview } = await import('./lib/autumn-identity-review.mjs');
  const result = buildAutumnIdentityReview(read(analysisPath), read(snapshotPath));
  result.provenance = { sourceAnalysisSha256: latest.sha256, targetSnapshotSha256: digest(snapshotPath),
    implementationHashes: Object.fromEntries(['scripts/autumn-identity-review.mjs', 'scripts/lib/autumn-identity-review.mjs'].map(file => [file, textFileSha256(file)])) };
  const filename = `review-${new Date().toISOString().replace(/[-:.]/gu, '')}.json`;
  fs.writeFileSync(path.join(root, filename), JSON.stringify(result, null, 2), { flag: 'wx', encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'latest-review.json'), JSON.stringify({ file: filename, sha256: digest(path.join(root, filename)) }), 'utf8');
  console.log(JSON.stringify({ output: path.join(root, filename), totals: result.totals, businessWrites: 0 }));
}
