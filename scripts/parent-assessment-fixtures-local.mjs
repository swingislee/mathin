import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const fixtureFile = 'supabase/fixtures/parent-assessment-local.sql';
const assertionsFile = 'supabase/tests/parent_assessment_fixtures.sql';
const roles = {
  admin: /^管理员\s+admin$/,
  teacher: /^教师\s+staff\/teacher$/,
  student: /^学生\s+student$/,
  second_student: /^学生2\s+student$/,
  parent: /^家长\s+parent$/,
  outsider: /^未绑定家长\s+parent$/,
};

/** 只提取固定角色的邮箱；密码与其他身份字段不进入 SQL 或日志。 */
export function fixedPreviewActors(manifest) {
  const rows = manifest.split(/\r?\n/).map(line => line.split('|').slice(1, -1)
    .map(cell => cell.replace(/[*`]/g, '').trim()));
  const actors = {};
  for (const [role, pattern] of Object.entries(roles)) {
    const matches = rows.filter(row => pattern.test(row[0] ?? ''));
    if (matches.length !== 1 || !/^[A-Za-z0-9._+-]+@mathin\.local$/i.test(matches[0][1] ?? '')) {
      throw new Error('FIXED_PREVIEW_MANIFEST_REQUIRED');
    }
    actors[role] = matches[0][1].toLowerCase();
  }
  if (new Set(Object.values(actors)).size !== Object.keys(roles).length) throw new Error('FIXED_PREVIEW_ROLES_OVERLAP');
  return actors;
}

export function previewIdentitySql(actors) {
  return `do $identity$ begin\n${Object.keys(roles).map(role => {
    const email = actors[role];
    if (!/^[A-Za-z0-9._+-]+@mathin\.local$/.test(email ?? '')) throw new Error('FIXED_PREVIEW_EMAIL_INVALID');
    return `perform set_config('test.parent_preview.${role}_user_id',coalesce((select id::text from auth.users where lower(email)='${email}'),''),true);`;
  }).join('\n')}
  perform set_config('test.parent_preview.first_student_id',coalesce((select id::text from public.students where user_id=nullif(current_setting('test.parent_preview.student_user_id'),'')::uuid and deleted_at is null),''),true);
  perform set_config('test.parent_preview.second_student_id',coalesce((select id::text from public.students where user_id=nullif(current_setting('test.parent_preview.second_student_user_id'),'')::uuid and deleted_at is null),''),true);
end $identity$;`;
}

export function requireMatchingPreviewCheck(check, expected, now = Date.now()) {
  if (check?.inputHash !== expected.inputHash || check?.target !== expected.target || check?.before !== expected.before
    || !Number.isFinite(Date.parse(check?.checkedAt)) || now - Date.parse(check.checkedAt) < 0
    || now - Date.parse(check.checkedAt) > 30 * 60 * 1000) throw new Error('MATCHING_PREVIEW_CHECK_REQUIRED');
}

// 覆盖本批直接写入及触发器副作用；只持久化摘要，不输出行内容。
const relations = [
  'auth.users', 'public.profiles', 'public.students', 'public.student_guardians',
  'public.classrooms', 'public.enrollments', 'public.classroom_staff_assignments', 'public.classroom_members',
  'public.leads', 'public.lead_invitation_threads', 'public.lead_invitation_events',
  'public.school_subject_participants', 'public.domain_events',
  'public.activities', 'public.miniapp_activity_publications', 'public.class_sessions',
  'public.class_support_tasks', 'public.session_completion_tasks', 'public.miniapp_forms', 'public.miniapp_intakes',
];
const digestSql = `select md5(string_agg(relation||':'||n||':'||digest,'|' order by relation)) from (${relations.map(relation =>
  `select '${relation}' relation,count(*)::text n,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) digest from ${relation} r`
).join('\nunion all\n')}) fingerprints;`;

function inventorySql() {
  return `select jsonb_build_object(
    'fixedActorsFound',(select count(*) from public.profiles where id in (${Object.keys(roles).map(role => `nullif(current_setting('test.parent_preview.${role}_user_id'),'')::uuid`).join(',')})),
    'testClassrooms',(select count(*) from public.classrooms where invite_code='MINIAPP-LOCAL-20260922' and purpose='test' and operational_status='active' and archived_at is null and trashed_at is null),
    'children',(select jsonb_agg(jsonb_build_object('slot',slot,'exists',s.id is not null,
      'linkedLeads',(select count(*) from public.leads where student_id=s.id),
      'eligibleTeachers',(select count(*) from public.parent_assessment_eligible_teachers(s.id)),
      'canRequest',s.id is not null and public.parent_assessment_request_blocker(s.id) is null,
      'requestBlocker',public.parent_assessment_request_blocker(s.id),
      'requests',(select coalesce(jsonb_agg(jsonb_build_object('state',t.state,'sharedFutureTimes',(
        select count(*) from unnest(t.parent_time_options) item where item=any(t.assessor_time_options) and public.parent_assessment_time_at(item)>now()))),'[]')
        from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id where l.student_id=s.id and t.kind='assessment_1v1')
    ) order by slot) from (values(1,nullif(current_setting('test.parent_preview.first_student_id'),'')::uuid),(2,nullif(current_setting('test.parent_preview.second_student_id'),'')::uuid)) child(slot,id) left join public.students s on s.id=child.id),
    'publicFutureActivities',jsonb_array_length(public.miniapp_public_activities()),
    'futureDemoSessions',(select count(*) from public.class_sessions s join public.classrooms c on c.id=s.classroom_id where c.invite_code='MINIAPP-LOCAL-20260922' and s.deleted_at is null and s.scheduled_at>now()),
    'welcomeEnabled',coalesce((select enabled from public.miniapp_forms where slug='welcome'),false),
    'demoIntakes',(select count(*) from public.miniapp_intakes where source='parent-preview-20261002 · 开发演示'),
    'sentReports',(select count(*) from public.assessment_workflow_states w join public.activity_registrations r on r.id=w.registration_id where w.sent_report_id is not null and w.sent_at is not null and r.student_id in(nullif(current_setting('test.parent_preview.first_student_id'),'')::uuid,nullif(current_setting('test.parent_preview.second_student_id'),'')::uuid))
  );`;
}

export function main(mode = process.argv[2]) {
  if (!['--preflight', '--inventory', '--check', '--apply'].includes(mode)) throw new Error('USE_PREFLIGHT_INVENTORY_CHECK_OR_APPLY');
  const output = path.resolve('.tmp/parent-assessment-fixtures');
  fs.mkdirSync(output, { recursive: true });
  const { sql, observed } = openHistoryLocalTarget({
    attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight',
    errorFile: path.join(output, 'database-error.txt'),
  });
  const actors = fixedPreviewActors(fs.readFileSync('.claude/test-accounts.local.md', 'utf8'));
  const identities = previewIdentitySql(actors);
  const inventory = () => JSON.parse(sql(`begin read only;${identities}\n${inventorySql()}\ncommit;`));
  if (['--preflight', '--inventory'].includes(mode)) {
    console.log(JSON.stringify({ mode, target: 'verified-windows-loopback', databaseWrites: false, inventory: inventory() }));
    return;
  }
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(actors))
    .update([fixtureFile, assertionsFile, 'scripts/parent-assessment-fixtures-local.mjs'].map(textFileSha256).join(':')).digest('hex');
  const target = crypto.createHash('sha256').update(JSON.stringify({ host: observed.host, origin: observed.supabaseOrigin, database: observed.systemIdentifier })).digest('hex');
  const fingerprint = () => sql(`begin read only;${digestSql}commit;`);
  const before = fingerprint();
  const fixture = fs.readFileSync(fixtureFile, 'utf8');
  const prefix = `begin;set local lock_timeout='5s';set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('parent-preview-20261002',0));${identities}`;
  const receiptPath = path.join(output, 'check.json');
  if (mode === '--check') {
    // 正向确认仅在外层回滚事务内。重放后比较全部受影响行，防止覆盖人工操作。
    sql(`${prefix}\n${fixture}\n${fs.readFileSync(assertionsFile, 'utf8')}
      do $snapshot$ declare v text; begin ${digestSql.replace(' from (', ' into v from (')}
        perform set_config('test.parent_preview.after_behavior',v,true); end $snapshot$;
      ${fixture}
      do $repeat$ declare v text; begin ${digestSql.replace(' from (', ' into v from (')}
        if v<>current_setting('test.parent_preview.after_behavior') then raise exception 'PREVIEW_REPLAY_CHANGED_STATE';end if;end $repeat$;
      rollback;`);
    if (fingerprint() !== before) throw new Error('PREVIEW_ROLLBACK_CHANGED_DATA');
    fs.writeFileSync(receiptPath, `${JSON.stringify({ inputHash, target, before, checkedAt: new Date().toISOString() })}\n`, 'utf8');
    console.log(JSON.stringify({ mode, passed: true, transactionRolledBack: true, repeatedFixturePreservedState: true }));
    return;
  }
  const check = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
  requireMatchingPreviewCheck(check, { inputHash, target, before });
  sql(`${prefix}\n${fixture}\ncommit;`);
  fs.unlinkSync(receiptPath);
  console.log(JSON.stringify({ mode, applied: true, target: 'verified-windows-loopback', inventory: inventory() }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
