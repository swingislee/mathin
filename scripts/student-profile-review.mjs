import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/profile-review');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'),
  refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
const version = '20260907000600_student_profile_review';
const migration = `supabase/migrations/${version}.sql`;
const checksum = textFileSha256(migration);
const reviewRoot = path.resolve('.tmp/source-refresh/autumn-review-20260907');
const pointer = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'latest-review.json'), 'utf8'));
if (!/^review-\d{8}T\d+Z\.json$/u.test(pointer.file)) throw new Error('REVIEW_POINTER_INVALID');
const raw = fs.readFileSync(path.join(reviewRoot, pointer.file));
const sourceHash = createHash('sha256').update(raw).digest('hex');
if (sourceHash !== pointer.sha256) throw new Error('REVIEW_SOURCE_CHANGED');
const review = JSON.parse(raw.toString('utf8'));
if (review.mode !== 'autumn_identity_review' || review.schemaVersion !== 1 || review.businessWrites !== 0
  || review.rows.length !== 166 || review.classes.length !== 28) throw new Error('REVIEW_INPUT_CONTRACT');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = value => {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
};
const batchId = uuid(`profile-review:${sourceHash}`);
const groupIds = new Map(review.classes.map(group => [group.code, uuid(`${batchId}:${group.key}`)]));
const seed = `
  insert into public.student_profile_review_batches(id,source_hash,title,source_label,source_at)
    values(${quote(batchId)},${quote(sourceHash)},'2026 秋季资料确认','2026-09-07 飞书秋季表',${quote(review.generatedAt)}) on conflict(source_hash) do nothing;
  ${review.classes.map(group => `insert into public.student_profile_review_groups(id,batch_id,source_key,label,teacher_name)
    values(${quote(groupIds.get(group.code))},${quote(batchId)},${quote(group.key)},
      ${quote([group.campus,group.grade,group.mode,group.weekday,group.time].filter(Boolean).join(' · '))},${quote(group.teacher)}) on conflict(batch_id,source_key) do nothing;`).join('\n')}
  ${review.rows.map((row,index) => `insert into public.student_profile_review_items(id,group_id,source_key,source_order,name,grade,enrollment_state,needs_contact,grade_attention)
    values(${quote(uuid(`${batchId}:${row.sourceKey}`))},${quote(groupIds.get(row.classCode))},${quote(row.sourceKey)},${index},${quote(row.name)},${quote(row.grade)},${quote(row.businessState)},${row.decision !== 'link_existing'},${row.gradeDifference}) on conflict(group_id,source_key) do nothing;`).join('\n')}
`;
const applied = sql(`begin read only;select coalesce((select checksum from public.schema_migrations where version=${quote(version)}),'');commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (mode === '--preflight') {
  console.log(JSON.stringify({ host: observed.host, origin: observed.supabaseOrigin, localTargetVerified: true,
    migrationApplied: Boolean(applied), sourceRows: review.rows.length, classGroups: review.classes.length,
    plannedCanonicalWrites: 0, plannedAssignments: 0 }));
  process.exit(0);
}
const checkPath = path.join(output, 'check.json');
const checkKey = { checksum, sourceHash, assertions: textFileSha256('scripts/sql/student-profile-review-assertions.sql') };
if (mode === '--apply' && (!fs.existsSync(checkPath)
  || JSON.stringify(JSON.parse(fs.readFileSync(checkPath, 'utf8')).checkKey) !== JSON.stringify(checkKey))) throw new Error('CURRENT_CHECK_REQUIRED');
const result = sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
  select pg_advisory_xact_lock(hashtextextended('student-profile-review',0));
  create temp table review_business_before as select
    (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from public.students s) students,
    (select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) from public.enrollments e) enrollments,
    (select count(*) from auth.users) accounts;
  ${applied ? '' : fs.readFileSync(migration, 'utf8')}
  ${seed}
  ${mode === '--check' ? fs.readFileSync('scripts/sql/student-profile-review-assertions.sql', 'utf8') : ''}
  do $verify$ begin
    if (select count(*) from public.student_profile_review_groups where batch_id=${quote(batchId)})<>28
      or (select count(*) from public.student_profile_review_items i join public.student_profile_review_groups g on g.id=i.group_id where g.batch_id=${quote(batchId)})<>166 then raise exception 'SEED_COUNT_MISMATCH'; end if;
    if exists(select 1 from review_business_before b where
      b.students is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from public.students s)
      or b.enrollments is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) from public.enrollments e)
      or b.accounts<>(select count(*) from auth.users)) then raise exception 'CANONICAL_BUSINESS_CHANGED'; end if;
  end $verify$;
  ${mode === '--check' ? 'rollback;' : `${applied ? '' : `insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});`}notify pgrst,'reload schema';commit;`}
`);
if (mode === '--check' && !applied && sql(`begin read only;select (to_regclass('public.student_profile_review_items') is null)::text;commit;`) !== 'true') throw new Error('ROLLBACK_FAILED');
const report = { mode, checkKey, databaseAssertions: mode === '--check' ? 'PASS' : 'reused', localTargetVerified: true,
  sourceRows: 166, classGroups: 28, canonicalBusinessUnchanged: true, assignmentsCreated: 0, batchId };
fs.writeFileSync(path.join(output, mode === '--check' ? 'check.json' : 'applied.json'), JSON.stringify(report,null,2), 'utf8');
console.log(JSON.stringify({ ...report, checks: result.includes('PROFILE_REVIEW_ASSERTIONS_PASS') ? 'PASS' : undefined }));
