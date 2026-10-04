import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

// 本次授权：清除学校运营虚构批次、35 条手工沟通、3 条手工邀约及 Phase 2 的 7 名验收学生。
// 真实导入身份和事实、固定账号、课程内容及保护 manifest 均保留。
const mode = process.argv[2];
if (!['--plan', '--check', '--apply'].includes(mode)) throw new Error('Use --plan, --check or --apply');
const root = path.resolve('.tmp/staff-overview-cleanup');
fs.mkdirSync(root, { recursive: true });
const target = openHistoryLocalTarget({ attestationPath: path.join(root, 'target.json'), refresh: true, errorFile: path.join(root, 'error.txt') });
const sql = target.sql;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const identifier = value => { if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error('UNEXPECTED_IDENTIFIER'); return `"${value}"`; };
const hash = value => createHash('sha256').update(value).digest('hex');
const read = statement => JSON.parse(sql(`begin read only;${statement}commit;`));
const preview = statement => JSON.parse(sql(`begin;${statement}rollback;`));
const catalog = read(`select jsonb_build_object(
  'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'pk',coalesce((select jsonb_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num where p.conrelid=c.oid and p.contype='p'),'[]'::jsonb))) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),
  'fks',(select jsonb_agg(jsonb_build_object('child',c.conrelid::regclass::text,'parent',c.confrelid::regclass::text,'deleteType',c.confdeltype,'columns',(select jsonb_agg(jsonb_build_object('child',a.attname,'parent',b.attname) order by k.ord) from unnest(c.conkey,c.confkey) with ordinality k(a,b,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.a join pg_attribute b on b.attrelid=c.confrelid and b.attnum=k.b))) from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace));`);
const tables = new Map(catalog.tables.map(table => [table.name, table]));
const fks = catalog.fks.filter(fk => tables.has(fk.child) && tables.has(fk.parent));
const key = (name, alias = 'r') => {
  const columns = tables.get(name).pk;
  if (!columns.length) return `to_jsonb(${alias})`;
  return `jsonb_build_object(${columns.flatMap(column => [literal(column), `${alias}.${identifier(column)}`]).join(',')})`;
};
const roots = {
  students: "source in ('ROSTER-ACCEPTANCE-20260905','P5-DEMO-20260905','DEMO-ENROLLMENT-20260905','DEV-SCHOOL-OPS-1','Phase 2 本机验收') and user_id is null",
  classrooms: "invite_code in ('roster9051','roster9052','roster9053','roster9054','d3s905a1','d3s905b1','d3s905c1','p5demo01','p5demo02')",
  activities: "source_record_id is null and (remark like 'FOLLOWUP-UI-20260906:%' or id in ('f3380000-0905-4000-8002-000000000001','ef15b7f7-1276-4668-9ad0-8cd0fe93a8a4','a273dfa7-dc18-4c32-a7d1-3402e9672f67') or source_invitation_id in (select id from public.lead_invitation_threads))",
  lead_communications: 'source_record_id is null',
  lead_invitation_threads: 'true',
  renewal_cycles: "name='P5验收 · 暑期衔接→秋季续报'",
  families: "display_name in ('P5验收·林知夏家庭','P5验收·江晨曦家庭')",
  contacts: "display_name in ('P5验收·林家长','P5验收·江家长')",
  leads: "(provisional_student_name in ('P5验收12·待确认朋友','P5验收11·江晨曦') or (id='d987f44a-19a7-4d4b-891c-58306bd46269' and provisional_student_name='验收·待测评孩子' and student_id is null)) and source_record_id is null and not exists(select 1 from public.lead_source_records sr where sr.lead_id=r.id)",
};
const expectedRoots = { students: 66, classrooms: 9, activities: 34, lead_communications: 35, lead_invitation_threads: 3, renewal_cycles: 1, families: 2, contacts: 2, leads: 3 };
const insert = (name, from) => `insert into cleanup_scope select ${literal(name)},${key(name)},to_jsonb(r) from public.${identifier(name)} r ${from} on conflict do nothing;`;
const buildScope = `create temp table cleanup_scope(table_name text,row_key jsonb,row_data jsonb,primary key(table_name,row_key)) on commit drop;
create index cleanup_scope_id on cleanup_scope((row_data->>'id'));
${Object.entries(roots).map(([name, where]) => insert(name, `where ${where}`)).join('\n')}
create temp table cleanup_roots on commit drop as select * from cleanup_scope;
do $closure$ declare added integer; n integer; begin loop added:=0;
${fks.map(fk => `if exists(select 1 from cleanup_scope where table_name=${literal(fk.parent)}) then ${insert(fk.child, `join cleanup_scope p on p.table_name=${literal(fk.parent)} and ${fk.columns.map(column => `r.${identifier(column.child)} is not null and to_jsonb(r.${identifier(column.child)})=p.row_data->${literal(column.parent)}`).join(' and ')}`)} get diagnostics n=row_count;added:=added+n;end if;`).join('\n')}
${insert('work_items', "where exists(select 1 from cleanup_scope p where p.row_data->>'id'=r.source_id::text)")}get diagnostics n=row_count;added:=added+n;
${insert('notifications', "where exists(select 1 from public.domain_events e where e.id=r.source_event_id and exists(select 1 from cleanup_scope p where p.row_data->>'id'=e.entity_id::text or exists(select 1 from jsonb_each(e.payload) v where v.value=to_jsonb(p.row_data->>'id'))))")}get diagnostics n=row_count;added:=added+n;
exit when added=0;end loop;end $closure$;`;
const plan = preview(`${buildScope}select jsonb_build_object('roots',(select jsonb_object_agg(table_name,n) from (select table_name,count(*) n from cleanup_roots group by table_name)t),'rows',(select coalesce(jsonb_agg(t order by table_name,row_key),'[]'::jsonb) from cleanup_scope t));`);
if (JSON.stringify(Object.entries(plan.roots).sort()) !== JSON.stringify(Object.entries(expectedRoots).sort())) throw new Error(`ROOT_COUNTS_CHANGED:${JSON.stringify(plan.roots)}`);
const allowed = new Set(['students','classrooms','activities','lead_communications','lead_invitation_threads','renewal_cycles','families','contacts','leads',
  'student_school_year_grades','student_grade_history','student_follow_ups','enrollments','classroom_members','classroom_staff_assignments','class_sessions','session_attendance','class_support_tasks','class_support_task_recipients',
  'activity_registrations','assessment_results','assessment_reports','assessment_question_results','assessment_workflow_states','assessment_workflow_events','assessment_quick_entries','assessment_entry_events','sales_opportunities','activity_routes','activity_followup_contacts',
  'course_opportunities','course_opportunity_events','course_enrollments','course_enrollment_assignments','course_enrollment_events','renewal_cycle_entries','renewal_registration_records','renewal_workbench_details','teacher_professional_signals','student_referrals',
  'family_contacts','family_students','student_contacts','lead_source_records','lead_interest_selections','lead_import_row_reviews','lead_identity_conversions','lead_invitation_events','lead_next_actions',
  'public_class_segments','public_class_participant_records','public_class_segment_staff_assignments','public_class_classroom_links','public_class_classroom_participants','public_class_segment_participations',
  'consume_rules','lesson_ledger','student_accounts','work_items','notifications','notification_deliveries']);
const unexpected = [...new Set(plan.rows.filter(row => !allowed.has(row.table_name)).map(row => row.table_name))];
if (unexpected.length) { fs.writeFileSync(path.join(root, 'review-scope.json'), JSON.stringify(plan, null, 2)); throw new Error(`UNREVIEWED_DEPENDENTS:${unexpected.join(',')}`); }
if (plan.rows.some(row => row.row_data.source_record_id || row.row_data.history_batch_id || row.row_data.history_key)) throw new Error('IMPORTED_RECORD_IN_DELETE_SCOPE');
const fixtureStudents = new Set(plan.rows.filter(row => row.table_name === 'students').map(row => row.row_data.id));
const fixtureSessions = new Set(plan.rows.filter(row => row.table_name === 'class_sessions').map(row => row.row_data.id));
for (const row of plan.rows) {
  if (['enrollments','course_enrollments','course_opportunities','student_accounts','lesson_ledger'].includes(row.table_name)
    && row.row_data.student_id && !fixtureStudents.has(row.row_data.student_id)) throw new Error('REAL_STUDENT_BUSINESS_IN_SCOPE');
  if (row.table_name === 'student_accounts' && row.row_data.balance !== 0) throw new Error('MONETARY_BALANCE_IN_SCOPE');
  if (row.table_name === 'lesson_ledger' && (!fixtureSessions.has(row.row_data.session_id)
    || row.row_data.created_at !== '2026-09-05T06:08:10.007424+00:00')) throw new Error('NON_FIXTURE_LESSON_LEDGER');
}
const manifest = { ...plan, target: target.observed, hash: hash(JSON.stringify(plan.rows)) };
const rootOnly = ['students','classrooms','activities','leads','families','contacts'];
for (const table of rootOnly) {
  if (plan.rows.filter(row => row.table_name === table).length !== expectedRoots[table]) throw new Error(`UNAPPROVED_ROOT_REACHED:${table}`);
}
const protectedHits = read(`select coalesce(jsonb_agg(e),'[]'::jsonb) from public.r1_object_protection_entries e where e.classification='protected' and e.object_key in (${plan.rows.filter(row => row.row_data.id).map(row => literal(row.row_data.id)).join(',')});`);
if (protectedHits.length) throw new Error('PROTECTED_OBJECT_IN_SCOPE');
const counts = Object.fromEntries([...new Set(plan.rows.map(row => row.table_name))].sort().map(name => [name, plan.rows.filter(row => row.table_name === name).length]));
if (mode === '--plan') {
  fs.writeFileSync(path.join(root, 'cleanup-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ target: target.observed, roots: plan.roots, counts, hash: manifest.hash, total: plan.rows.length }));
  process.exit(0);
}
const approved = JSON.parse(fs.readFileSync(path.join(root, 'cleanup-manifest.json'), 'utf8'));
if (approved.hash !== manifest.hash) throw new Error('MANIFEST_DRIFT');
const selectedTables = Object.keys(counts);
// 仓库整班清理采用相同事务维护方式。仅临时停用以下已核对的历史不变性触发器；
// 目标行、来源保护、正式对象保护与外键继续执行，提交前恢复原状并检查全部触发器。
const immutableTriggers = [
  ['assessment_reports', 'assessment_reports_immutable', 'guard_phase3_enrollment_history'],
  ['assessment_workflow_events', 'assessment_workflow_events_immutable', 'guard_phase3_enrollment_history'],
  ['course_enrollment_events', 'course_enrollment_events_immutable', 'guard_phase3_enrollment_history'],
  ['course_opportunity_events', 'course_opportunity_events_immutable', 'guard_phase3_enrollment_history'],
  ['lead_identity_conversions', 'lead_identity_conversions_append_only', 'prevent_lead_identity_conversion_mutation'],
].filter(([table]) => selectedTables.includes(table));
const triggerState = read(`select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'function',p.proname) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid where c.relnamespace='public'::regnamespace;`);
for (const [table, name, fn] of immutableTriggers) {
  if (!triggerState.some(t => t.table === table && t.name === name && t.function === fn && t.enabled === 'O')) throw new Error('IMMUTABLE_TRIGGER_CHANGED');
}
const disableImmutable = immutableTriggers.map(([table, trigger]) => `alter table public.${identifier(table)} disable trigger ${identifier(trigger)};`).join('\n');
const restoreImmutable = immutableTriggers.map(([table, trigger]) => `alter table public.${identifier(table)} enable trigger ${identifier(trigger)};`).join('\n');
const order = [];
const pending = new Set(selectedTables);
while (pending.size) {
  // 两条可空的来源反向链接使用 SET NULL 解环；其余关系按子记录在先排序。
  const ready = [...pending].filter(parent => !fks.some(fk => fk.parent === parent && fk.child !== parent && pending.has(fk.child)
    && !(fk.deleteType === 'n' && ((fk.child === 'activities' && fk.parent === 'lead_invitation_threads')
      || (fk.child === 'course_opportunities' && fk.parent === 'activity_routes')))));
  if (!ready.length) throw new Error(`RESTRICT_DEPENDENCY_CYCLE:${[...pending].join(',')}`);
  order.push(...ready); ready.forEach(name => pending.delete(name));
}
const fingerprint = [...tables.keys()].filter(name => name !== 'schema_migrations').map(name => `select ${literal(name)} table_name,count(*)::integer n,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) digest from public.${identifier(name)} r where not exists(select 1 from cleanup_scope s where s.table_name=${literal(name)} and s.row_key=${key(name)})`).join(' union all ');
const setup = `set local lock_timeout='5s';set local statement_timeout='90s';select pg_advisory_xact_lock(hashtextextended('school-overview-fixture-cleanup-20260908',0));
${buildScope}
do $verify_scope$ begin if (select jsonb_agg(t order by table_name,row_key) from cleanup_scope t) is distinct from ${literal(JSON.stringify(plan.rows))}::jsonb then raise exception 'TRANSACTION_SCOPE_DRIFT';end if;end $verify_scope$;
create temp table cleanup_before on commit drop as ${fingerprint};
create temp table cleanup_auth on commit drop as select id,md5(to_jsonb(u)::text) digest from auth.users u;
create temp table cleanup_triggers on commit drop as select oid,md5(to_jsonb(t)::text) digest from pg_trigger t;`;
const deletes = order.map(name => `delete from public.${identifier(name)} r using cleanup_scope s where s.table_name=${literal(name)} and ${key(name)}=s.row_key;`).join('\n');
const verify = `create temp table cleanup_after on commit drop as ${fingerprint};do $verify$ begin
if exists((select * from cleanup_before except select * from cleanup_after) union all (select * from cleanup_after except select * from cleanup_before)) then raise exception 'PRESERVED_PUBLIC_DATA_CHANGED';end if;
if exists((select id,md5(to_jsonb(u)::text) from auth.users u except select * from cleanup_auth) union all (select * from cleanup_auth except select id,md5(to_jsonb(u)::text) from auth.users u)) then raise exception 'AUTH_USERS_CHANGED';end if;
if exists((select oid,md5(to_jsonb(t)::text) from pg_trigger t except select * from cleanup_triggers) union all (select * from cleanup_triggers except select oid,md5(to_jsonb(t)::text) from pg_trigger t)) then raise exception 'TRIGGER_STATE_CHANGED';end if;
${selectedTables.map(name => `if exists(select 1 from public.${identifier(name)} r join cleanup_scope s on s.table_name=${literal(name)} and s.row_key=${key(name)}) then raise exception 'FIXTURE_ROWS_REMAIN';end if;`).join('\n')}
end $verify$;`;
const checkPath = path.join(root, 'cleanup-check.json');
if (mode === '--check') {
  const dumpPath = '/tmp/mathin-overview-cleanup-20260908.dump';
  target.docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--format=custom','--file',dumpPath]);
  target.docker(['cp',`supabase-db:${dumpPath}`,path.join(root,'before.dump')]);
  target.docker(['exec','supabase-db','pg_restore','--list',dumpPath]);
  sql(`begin isolation level repeatable read;${setup}${disableImmutable}${deletes}${restoreImmutable}${verify}rollback;`);
  const restored = preview(`${buildScope}select coalesce(jsonb_agg(t order by table_name,row_key),'[]'::jsonb) from cleanup_scope t;`);
  if (hash(JSON.stringify(restored)) !== manifest.hash) throw new Error('ROLLBACK_SCOPE_MISMATCH');
  const report = { hash: manifest.hash, counts, total: plan.rows.length, fullBackupBytes: fs.statSync(path.join(root,'before.dump')).size, fullBackupSha256: hash(fs.readFileSync(path.join(root,'before.dump'))), backupIndexReadable: true, transactionRollback: true, preservedTables: tables.size, importedAndProtectedDataUnchanged: true };
  fs.writeFileSync(checkPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} else {
  // 2026-09-08 产品负责人明确要求直接清理，不再备份或进行回滚演练。
  const skipRehearsal = process.argv.includes('--skip-rehearsal');
  const checked = skipRehearsal
    ? { hash: manifest.hash, counts, total: plan.rows.length, rehearsalSkippedByRequest: true, preservedTables: tables.size }
    : JSON.parse(fs.readFileSync(checkPath, 'utf8'));
  if (checked.hash !== manifest.hash || (!skipRehearsal && hash(fs.readFileSync(path.join(root,'before.dump'))) !== checked.fullBackupSha256)) throw new Error('VERIFIED_BACKUP_REQUIRED');
  console.log(JSON.stringify({ action: 'apply', target: target.observed, hash: manifest.hash, total: plan.rows.length }));
  sql(`begin isolation level repeatable read;${setup}${disableImmutable}${deletes}${restoreImmutable}${verify}commit;`);
  const remaining = preview(`${buildScope}select count(*) from cleanup_scope;`);
  if (remaining !== 0) throw new Error('POSTFLIGHT_FIXTURES_REMAIN');
  const report = { ...checked, appliedAt: new Date().toISOString(), remaining: 0, importedAndProtectedDataUnchanged: true, authUsersUnchanged: true, triggerStatesRestored: true };
  fs.writeFileSync(path.join(root,'cleanup-applied.json'), JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
}
