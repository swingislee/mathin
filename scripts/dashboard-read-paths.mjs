import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

// 本机固定身份的读取等价性检查；应用迁移前完成当前与协作前两种策略的回滚演练。
const mode = process.argv[2];
if (!['--check', '--check-legacy', '--apply'].includes(mode)) throw new Error('Use --check, --check-legacy or --apply');
const root = path.resolve('.tmp/dashboard-read-paths');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'target.json'), refresh: true,
  errorFile: path.join(root, 'database-error.txt') });
const version = '20260910003000_dashboard_read_paths';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const migration = fs.readFileSync(file, 'utf8');
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied) {
  if (applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
  if (mode !== '--apply') throw new Error('ALREADY_APPLIED');
  console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0);
}
const policies = ['leads_select_pool_scope', 'course_enrollments_select_scope',
  'course_enrollments_pending_source_read', 'course_enrollment_assignments_pending_source_read'];
const businessTables = ['students', 'leads', 'lead_communications', 'lead_source_records', 'course_enrollments',
  'course_enrollment_assignments', 'course_opportunities', 'enrollments', 'profiles', 'staff_role_members',
  'role_permissions', 'school_subject_participants', 'school_business_group_members'];
const digest = table => `(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${table} t)`;
const businessQuery = `select jsonb_build_object(${businessTables.map(t => `'${t}',${digest(t)}`).join(',')});`;
const structureQuery = (ignoreChanged = false) => `select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl,p.proowner) order by p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
  'policies',(select jsonb_agg(${ignoreChanged ? `case when polname in (${policies.map(p => `'${p}'`).join(',')}) then to_jsonb(p)-'polqual' else to_jsonb(p) end` : 'to_jsonb(p)'} order by p.oid)
    from pg_policy p where polrelid in(select oid from pg_class where relnamespace='public'::regnamespace)),
  'relations',(select jsonb_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity) order by oid)
    from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m')),
  'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public'
    ${ignoreChanged ? "and indexname<>'leads_student_scope_idx'" : ''}));`;
const businessBefore = sql(`begin read only;${businessQuery}commit;`);
const structureBefore = sql(`begin read only;${structureQuery()}commit;`);
if (mode === '--apply') {
  for (const name of ['check', 'check-legacy']) {
    const check = JSON.parse(fs.readFileSync(path.join(root, `${name}.json`), 'utf8'));
    if (check.checksum !== checksum || check.head !== head || check.businessBefore !== businessBefore
      || check.structureBefore !== structureBefore) throw new Error('FRESH_CHECK_REQUIRED');
  }
  const rollbackPolicies = sql(`begin read only;select string_agg(format('alter policy %I on %s using (%s);',
    polname,polrelid::regclass,pg_get_expr(polqual,polrelid)),E'\n' order by polname)
    from pg_policy where polname in (${policies.map(p => `'${p}'`).join(',')});commit;`);
  fs.writeFileSync(path.join(root, 'prechange-read-policies.sql'), `${rollbackPolicies}\n`, 'utf8');
}
const readTables = ['leads', 'business_lead_communications', 'lead_source_records', 'operational_leads',
  'business_course_enrollments', 'course_enrollment_assignments'];
// 当前固定开发身份及匿名身份；全量可见行 ID 和所有学生上的报名策略结果同时对照。
const capture = destination => `do $capture$
declare actor record; table_name text; result jsonb:='{}'; actor_result jsonb; value jsonb; qual text;
begin
  select pg_get_expr(polqual,polrelid) into strict qual from pg_policy
    where polrelid='public.course_enrollments'::regclass and polname='course_enrollments_select_scope';
  for actor in select * from dashboard_read_actors order by label loop
    actor_result:='{}';
    perform set_config('request.jwt.claims',case when actor.id is null then '{}' else
      jsonb_build_object('sub',actor.id,'role','authenticated','aal','aal2')::text end,true);
    execute case when actor.id is null then 'set local role anon' else 'set local role authenticated' end;
    foreach table_name in array array[${readTables.map(t => `'${t}'`).join(',')}] loop
      begin
        execute format('select jsonb_build_object(''count'',count(*),''ids'',md5(coalesce(string_agg(id::text,'','' order by id),''''))) from public.%I',table_name) into value;
      exception when insufficient_privilege then value:=jsonb_build_object('error',sqlstate); end;
      actor_result:=actor_result||jsonb_build_object(table_name,value);
    end loop;
    begin
      execute format('select to_jsonb(md5(string_agg(coalesce(student_id::text,''null'')||'':''||coalesce((%s)::text,''null''),'','' order by student_id nulls first))) from dashboard_read_students',qual) into value;
    exception when insufficient_privilege then value:=jsonb_build_object('error',sqlstate); end;
    actor_result:=actor_result||jsonb_build_object('studentPredicate',value);
    execute 'reset role';
    result:=result||jsonb_build_object(actor.label,actor_result);
  end loop;
  perform set_config('request.jwt.claims','{}',true);
  ${destination === 'before' ? "insert into dashboard_read_before values(result);" : "if result is distinct from (select b.result from dashboard_read_before b) then raise exception 'READ_SCOPE_CHANGED'; end if;"}
end;
$capture$;`;
let legacy = '';
if (mode === '--check-legacy') {
  const access = fs.readFileSync('supabase/migrations/20260720000900_p4h_classroom_list_and_roster_scope.sql', 'utf8')
    .match(/create or replace function public\.can_access_student\([\s\S]*?\$\$;/)?.[0];
  const pool = fs.readFileSync('supabase/migrations/20260902000800_school_ops_xiaoditui_intake.sql', 'utf8')
    .match(/create policy leads_select_pool_scope[\s\S]*?\);/)?.[0]
    ?.replace('create policy', 'alter policy').replace('for select to authenticated', '');
  if (!access || !pool) throw new Error('LEGACY_DEFINITIONS_REQUIRED');
  legacy = `${access}\n${pool}\nalter policy course_enrollments_select_scope on public.course_enrollments using (
    public.has_perm((select auth.uid()),'enrollment.manage') or public.can_access_student(student_id,(select auth.uid())));`;
}
const assertions = mode === '--apply' ? '' : `
  create temp table dashboard_read_actors as select id,email as label from auth.users where email in (
    'test-admin@mathin.local','test-teacher@mathin.local','test-sales@mathin.local','test-research@mathin.local',
    'test-multirole@mathin.local','test-student@mathin.local','test-parent@mathin.local');
  do $$begin if (select count(*) from dashboard_read_actors)<>7 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;end$$;
  insert into dashboard_read_actors values(null,'anonymous');
  create temp table dashboard_read_students as select id as student_id from public.students union all select null;
  grant select on dashboard_read_students to authenticated,anon;
  create temp table dashboard_policy_before as select polname as name,pg_get_expr(polqual,polrelid) as qual
    from pg_policy where (polrelid='public.leads'::regclass and polname='leads_select_pool_scope')
      or (polrelid='public.course_enrollments'::regclass and polname='course_enrollments_select_scope');
  create temp table dashboard_read_before(result jsonb);
  ${capture('before')}`;
const unchangedStructure = structureQuery(true).replace(/^select /, '').replace(/;$/, '');
const unchangedBusiness = businessQuery.replace(/^select /, '').replace(/;$/, '');
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='120s';set local search_path=public,pg_temp;
  select pg_advisory_xact_lock(hashtextextended('dashboard-read-paths',0));
  ${legacy}
  create temp table dashboard_structure_before as select ${unchangedStructure} as result;
  create temp table dashboard_business_before as select ${unchangedBusiness} as result;
  ${assertions}
  ${migration}
  ${mode === '--apply' ? '' : capture('after')}
  ${mode === '--apply' ? '' : fs.readFileSync('scripts/sql/dashboard-read-account-state-assertions.sql', 'utf8')}
  ${mode === '--check' ? fs.readFileSync('scripts/sql/school-collaboration-assertions.sql', 'utf8') : ''}
  do $$begin
    if (${unchangedStructure}) is distinct from (select result from dashboard_structure_before) then raise exception 'UNEXPECTED_PERMISSION_OR_SCHEMA_CHANGE'; end if;
    if (${unchangedBusiness}) is distinct from (select result from dashboard_business_before) then raise exception 'BUSINESS_DATA_CHANGED'; end if;
  end$$;
  ${mode === '--apply' ? `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;` : 'rollback;'}
`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
} catch (error) {
  fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
  throw new Error('DASHBOARD_READ_PATHS_CHECK_FAILED: inspect private error file');
}
if (sql(`begin read only;${businessQuery}commit;`) !== businessBefore) throw new Error('BUSINESS_DATA_CHANGED');
if (mode !== '--apply' && sql(`begin read only;${structureQuery()}commit;`) !== structureBefore) throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, head, checkedAt: new Date().toISOString(), host: observed.host,
  localTargetVerified: true, scopeComparison: mode === '--apply' ? 'REUSED' : 'PASS',
  businessDataUnchanged: true, rollbackVerified: mode !== '--apply', businessBefore, structureBefore };
fs.writeFileSync(path.join(root, `${mode.slice(2)}.json`), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ mode, localTargetVerified: true, scopeComparison: result.scopeComparison,
  businessDataUnchanged: true, rollbackVerified: result.rollbackVerified }));
