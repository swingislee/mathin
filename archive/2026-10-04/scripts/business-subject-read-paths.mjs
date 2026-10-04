import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

// 在已核对的本机数据库比较完整 RPC 结果及可见线索；候选 DDL 检查结束后整体回滚。
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const root = path.resolve('.tmp/business-subject-read-paths');
fs.mkdirSync(root, { recursive: true });
openHistoryLocalTarget({ attestationPath: path.join(root, 'target.json'), refresh: true,
  errorFile: path.join(root, 'database-error.txt') });
const sql = statement => {
  try {
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db',
      'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('BUSINESS_SUBJECT_READ_CHECK_FAILED: inspect the private database log');
  }
};
const version = '20260910005000_business_subject_read_paths';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const migration = fs.readFileSync(file, 'utf8');
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied) {
  if (applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
  if (mode !== '--apply') throw new Error('ALREADY_APPLIED');
  console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0);
}
const indexNames = "'history_workflow_scope_student_read','history_workflow_scope_lead_read'";
const structure = (ignoreChanges = false) => `jsonb_build_object(
  'functions',(select md5(string_agg((${ignoreChanges ? `case when p.oid='public.student_list_facts(text,text,text,text)'::regprocedure then to_jsonb(p)-'prosrc' else to_jsonb(p) end` : 'to_jsonb(p)'})::text,'' order by p.oid))
    from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_policy p),
  'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid))
    from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m')),
  'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'
    ${ignoreChanges ? `and indexname not in (${indexNames})` : ''}))`;
const businessTables = ['students', 'leads', 'profiles', 'history_workflow_scopes', 'history_workflow_decisions',
  'communication_worklists', 'communication_worklist_items', 'school_subject_participants', 'school_subject_groups',
  'school_business_group_members', 'course_enrollments', 'enrollments'];
const business = `jsonb_build_object(${businessTables.map(table => `'${table}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${table} t)`).join(',')})`;
const snapshot = () => JSON.parse(sql(`begin read only;select jsonb_build_object('structure',${structure()},'business',${business});commit;`));
const before = snapshot();
const guard = `do $guard$ begin
  if (${structure(true)}) is distinct from (select metadata from business_read_guard)
    or (${business}) is distinct from (select facts from business_read_guard) then raise exception 'UNEXPECTED_SCHEMA_PERMISSION_OR_BUSINESS_CHANGE'; end if;
end; $guard$;`;
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(path.join(root, 'check.json'), 'utf8'));
  assert.equal(check.checksum, checksum, 'FRESH_CHECK_REQUIRED');
  assert.equal(check.head, head, 'FRESH_CHECK_REQUIRED');
  assert.deepEqual(check.before, before, 'FRESH_CHECK_REQUIRED');
  const original = sql("begin read only;select pg_get_functiondef('public.student_list_facts(text,text,text,text)'::regprocedure);commit;");
  fs.writeFileSync(path.join(root, 'prechange-student-list-facts.sql'), `${original};\n`, 'utf8');
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('business-subject-read-paths',0));
    create temp table business_read_guard as select ${structure(true)} as metadata,${business} as facts;
    ${migration}${guard}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');
    notify pgrst,'reload schema';commit;`);
  const after = snapshot();
  assert.deepEqual(after.business, before.business, 'BUSINESS_FACTS_CHANGED');
  fs.writeFileSync(path.join(root, 'apply.json'), JSON.stringify({ checksum, head, applied: true, before, after }, null, 2), 'utf8');
  console.log(JSON.stringify({ applied: true, businessUnchanged: true, permissionsUnchanged: true }));
  process.exit(0);
}

const stages = ['awaiting_first_contact', 'awaiting_assessment', 'awaiting_enrollment', 'awaiting_renewal', 'former_student'];
const baseQuery = { version: 2, filters: {}, sort: null };
const cases = [];
const addCase = (role, stage, population, extra = {}) => {
  const { label = 'all', ...options } = extra;
  cases.push({ label: `${role}:${population}:${stage}:${label}`, role, stage, population,
    scope: 'all', page: 1, pageSize: 20, query: baseQuery, locale: 'zh', ...options });
};
for (const role of ['admin', 'teacher']) {
  for (const population of ['work', 'records']) for (const stage of stages) addCase(role, stage, population);
  for (const scope of ['mine', 'group', 'unassigned']) addCase(role, stages[0], 'work', { scope, label: scope });
  addCase(role, stages[0], 'work', { label: 'page-en', page: 2, pageSize: 50, locale: 'en',
    query: { ...baseQuery, sort: { field: 'name', direction: 'asc' } } });
  addCase(role, 'awaiting_renewal', 'work', { label: 'filtered-clamped', page: 999,
    query: { ...baseQuery, filters: { grade: { kind: 'presence', value: 'present' }, lastContactAt: { kind: 'presence', value: 'missing' } },
      sort: { field: 'assessmentAt', direction: 'desc' } } });
  addCase(role, stages[0], 'work', { label: 'search', search: true });
}
for (const role of ['sales', 'research', 'multirole']) addCase(role, stages[0], 'work');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const capture = phase => `do $capture$
declare item record; result jsonb; started timestamptz; elapsed numeric; query_text text;
begin
  for item in select c.*,u.id as actor from business_read_cases c join auth.users u on u.email='test-'||c.role||'@mathin.local' order by c.ordinal loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',item.actor,'role','authenticated','aal','aal2')::text,true);
    query_text := case when item.search then (select search from business_read_search where role=item.role) else '' end;
    execute 'set local role authenticated';
    started := clock_timestamp();
    begin
      select public.list_student_records_page(item.stage,item.scope,coalesce(query_text,''),item.population,
        item.page,item.page_size,item.query,item.locale,'{}') into result;
    exception when raise_exception then
      if sqlerrm<>'FORBIDDEN' then raise; end if;
      result := jsonb_build_object('error','FORBIDDEN');
    end;
    elapsed := round(extract(epoch from clock_timestamp()-started)*1000,1);
    execute 'reset role';
    insert into business_read_results values('${phase}',item.label,result,elapsed);
  end loop;
  for item in select id,split_part(split_part(email,'@',1),'-',2) as role from auth.users
    where email in ('test-admin@mathin.local','test-teacher@mathin.local') order by email loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',item.id,'role','authenticated','aal','aal2')::text,true);
    execute 'set local role authenticated';
    started := clock_timestamp();
    select jsonb_build_object('operational',(select jsonb_agg(id order by created_at desc,id) from public.operational_leads),
      'collaborative',(select jsonb_agg(jsonb_build_array(id,is_participant,in_my_groups,can_edit) order by created_at desc,id) from public.collaborative_leads)) into result;
    elapsed := round(extract(epoch from clock_timestamp()-started)*1000,1);
    execute 'reset role';
    insert into business_read_results values('${phase}',item.role||':lead-views',result,elapsed);
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end; $capture$;`;
const statement = `begin;set local lock_timeout='5s';set local statement_timeout='240s';
  select pg_advisory_xact_lock(hashtextextended('business-subject-read-paths',0));
  create temp table business_read_guard as select ${structure(true)} as metadata,${business} as facts;
  create temp table business_read_cases as select n::integer as ordinal,
    value->>'label' as label,value->>'role' as role,value->>'stage' as stage,value->>'scope' as scope,
    value->>'population' as population,(value->>'page')::integer as page,(value->>'pageSize')::integer as page_size,
    value->'query' as query,value->>'locale' as locale,coalesce((value->>'search')::boolean,false) as search
    from jsonb_array_elements(${literal(JSON.stringify(cases))}::jsonb) with ordinality c(value,n);
  do $$ begin if (select count(*) from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local',
    'test-sales@mathin.local','test-research@mathin.local','test-multirole@mathin.local','test-student@mathin.local','test-parent@mathin.local'))<>7 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if; end; $$;
  create temp table business_read_search as select r.role,
    (select left(s.name,1) from public.students s where s.deleted_at is null and public.business_subject_is_current(s.id,null)
      and public.can_view_school_student(s.id,u.id) order by s.created_at desc,s.id limit 1) as search
    from (values ('admin'),('teacher')) r(role) join auth.users u on u.email='test-'||r.role||'@mathin.local';
  create temp table business_read_results(phase text,label text,result jsonb,ms numeric);
  ${capture('before')}
  ${migration}
  ${capture('after')}
  ${guard}
  ${fs.readFileSync('scripts/sql/business-subject-read-assertions.sql', 'utf8')}
  select jsonb_build_object('cases',(select jsonb_agg(jsonb_build_object('case',b.label,'equal',b.result=a.result,
    'beforeMs',b.ms,'afterMs',a.ms,'count',a.result->'count') order by b.label)
    from business_read_results b join business_read_results a using(label) where b.phase='before' and a.phase='after'),
    'permissionsUnchanged',true,'businessUnchanged',true);
  rollback;`;
console.log(JSON.stringify({ checking: true, studentListCases: cases.length, leadViewCases: 2 }));
const output = sql(statement);
const report = output.split(/\r?\n/).find(line => line.startsWith('{'));
if (!report) throw new Error('CHECK_REPORT_REQUIRED');
const result = JSON.parse(report);
fs.writeFileSync(path.join(root, 'trial-report.json'), JSON.stringify(result, null, 2), 'utf8');
assert.equal(result.cases.length, cases.length + 2);
assert.equal(result.cases.every(item => item.equal), true, 'READ_RESULTS_CHANGED');
assert.deepEqual(snapshot(), before, 'ROLLBACK_LEFT_CHANGES');
fs.writeFileSync(path.join(root, 'check.json'), JSON.stringify({ checksum, head, before, ...result, rollback: true }, null, 2), 'utf8');
console.log(JSON.stringify({ ...result, rollback: true }));
