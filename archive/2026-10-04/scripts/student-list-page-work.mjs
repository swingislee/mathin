import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const root = path.resolve('.tmp/student-list-page-work');
fs.mkdirSync(root, { recursive: true });
openHistoryLocalTarget({ attestationPath: path.join(root, 'target.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const sql = statement => {
  try {
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt',
      '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('STUDENT_PAGE_WORK_CHECK_FAILED: inspect the private database log');
  }
};
const version = '20260910007000_student_list_page_work', file = `supabase/migrations/${version}.sql`;
const migration = fs.readFileSync(file, 'utf8'), checksum = textFileSha256(file);
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied) {
  assert.equal(applied, checksum, 'MIGRATION_CHECKSUM_CHANGED');
  if (mode !== '--apply') throw new Error('ALREADY_APPLIED');
  console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0);
}
const changed = "'student_list_facts','list_student_records_page'";
const added = "'student_list_base_facts','student_list_row_permissions'";
const metadata = (ignore = false) => `jsonb_build_object(
  'functions',(select md5(string_agg((${ignore ? `case when p.proname in (${changed}) then to_jsonb(p)-'prosrc' else to_jsonb(p) end` : 'to_jsonb(p)'})::text,'' order by p.oid))
    from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' ${ignore ? `and p.proname not in (${added})` : ''}),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_policy p),
  'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid))
    from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m')),
  'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'))`;
const tables = ['students', 'leads', 'profiles', 'lead_communications', 'student_follow_ups', 'course_enrollments',
  'enrollments', 'history_workflow_scopes', 'history_workflow_decisions', 'school_subject_participants', 'school_subject_groups', 'school_business_group_members'];
const business = `jsonb_build_object(${tables.map(table => `'${table}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text),'')) from public.${table} t)`).join(',')})`;
const snapshot = () => JSON.parse(sql(`begin read only;select jsonb_build_object('metadata',${metadata()},'business',${business});commit;`));
const before = snapshot();
const guard = `do $guard$ begin
  if (${metadata(true)}) is distinct from (select metadata from page_work_guard) or (${business}) is distinct from (select business from page_work_guard)
    then raise exception 'UNEXPECTED_SCHEMA_PERMISSION_OR_BUSINESS_CHANGE'; end if;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (${added}) and (
    not p.prosecdef or p.provolatile<>'s' or p.proowner<>(select proowner from pg_proc where oid='public.student_list_facts(text,text,text,text)'::regprocedure)
    or not p.proconfig @> array['search_path=public, pg_temp']
    or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
    then raise exception 'PRIVATE_HELPER_METADATA_CHANGED'; end if;
end; $guard$;`;
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(path.join(root, 'check.json'), 'utf8'));
  assert.equal(check.checksum, checksum, 'FRESH_CHECK_REQUIRED');
  assert.equal(check.head, head, 'FRESH_CHECK_REQUIRED');
  assert.deepEqual(check.before, before, 'FRESH_CHECK_REQUIRED');
  const originals = sql(`begin read only;select string_agg(pg_get_functiondef(oid)||';',E'\n' order by proname)
    from pg_proc where pronamespace='public'::regnamespace and proname in (${changed});commit;`);
  fs.writeFileSync(path.join(root, 'original-functions.sql'), `${originals}\n`, 'utf8');
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('student-list-page-work',0));
    create temp table page_work_guard as select ${metadata(true)} as metadata,${business} as business;
    ${migration}${guard}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
  const after = snapshot();
  assert.deepEqual(after.business, before.business, 'BUSINESS_FACTS_CHANGED');
  fs.writeFileSync(path.join(root, 'apply.json'), JSON.stringify({ checksum, head, before, after, applied: true }, null, 2), 'utf8');
  console.log(JSON.stringify({ applied: true, permissionsUnchanged: true, businessUnchanged: true })); process.exit(0);
}

const stages = ['awaiting_first_contact', 'awaiting_assessment', 'awaiting_enrollment', 'awaiting_renewal', 'former_student'];
const cases = [], query = { version: 2, filters: {}, sort: null };
const add = (role, stage, population, extra = {}) => {
  const { label = 'all', ...options } = extra;
  cases.push({ label: `${role}:${population}:${stage}:${label}`, role, stage, population,
    scope: 'all', page: 2, pageSize: 20, query, locale: 'zh', ...options });
};
for (const role of ['admin', 'teacher']) {
  for (const stage of stages.slice(2)) for (const population of ['work', 'records']) add(role, stage, population);
  for (const scope of ['mine', 'group', 'unassigned']) add(role, stages[0], 'work', { scope, label: scope });
  add(role, stages[1], 'records', { label: 'sorted-en', locale: 'en', pageSize: 50,
    query: { ...query, filters: { grade: { kind: 'presence', value: 'present' } }, sort: { field: 'name', direction: 'asc' } } });
  add(role, stages[0], 'records', { label: 'filtered-clamped', page: 999, pageSize: 100,
    query: { ...query, filters: { owner: { kind: 'presence', value: 'present' }, note: { kind: 'presence', value: 'missing' } }, sort: { field: 'lastContactAt', direction: 'desc' } } });
  add(role, stages[3], 'work', { label: 'missing-option', query: { ...query, filters: { grade: { kind: 'enum', values: ['unknown-grade'] } } } });
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const capture = phase => `do $capture$ declare item record; actor record; stage text; value jsonb; started timestamptz; begin
  for item in select c.*,u.id as actor from page_work_cases c join auth.users u on u.email='test-'||c.role||'@mathin.local' order by c.ordinal loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',item.actor,'role','authenticated','aal','aal2')::text,true);
    execute 'set local role authenticated';started:=clock_timestamp();
    value:=public.list_student_records_page(item.stage,item.scope,'',item.population,item.page,item.page_size,item.query,item.locale,'{}');
    execute 'reset role';insert into page_work_results values('${phase}',item.label,value,extract(epoch from clock_timestamp()-started)*1000);
  end loop;
  for actor in select id,split_part(split_part(email,'@',1),'-',2) as label from auth.users
    where email in ('test-admin@mathin.local','test-teacher@mathin.local') order by email loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated','aal','aal2')::text,true);
    foreach stage in array array[${stages.map(literal).join(',')}] loop
      started:=clock_timestamp();
      select jsonb_build_object('count',count(*),'digest',md5(string_agg(coalesce(row_data::text,'null')||':'||index_stage,'' order by row_data->>'key',index_stage)))
        into value from public.student_list_facts('all','','records',stage);
      insert into page_work_results values('${phase}',actor.label||':complete-facts:'||stage,value,extract(epoch from clock_timestamp()-started)*1000);
    end loop;
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end; $capture$;`;
console.log(JSON.stringify({ checking: true, pageCases: cases.length, completeFactCases: 10 }));
const out = sql(`begin;set local lock_timeout='5s';set local statement_timeout='240s';
  select pg_advisory_xact_lock(hashtextextended('student-list-page-work',0));
  create temp table page_work_guard as select ${metadata(true)} as metadata,${business} as business;
  create temp table page_work_cases as select n::integer as ordinal,value->>'label' as label,value->>'role' as role,value->>'stage' as stage,
    value->>'population' as population,value->>'scope' as scope,(value->>'page')::integer as page,(value->>'pageSize')::integer as page_size,
    value->'query' as query,value->>'locale' as locale from jsonb_array_elements(${literal(JSON.stringify(cases))}::jsonb) with ordinality c(value,n);
  do $$begin if (select count(*) from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local'))<>2 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;end$$;
  create temp table page_work_results(phase text,label text,result jsonb,ms numeric);
  ${capture('before')}${migration}${capture('after')}${guard}
  ${fs.readFileSync('scripts/sql/business-subject-read-assertions.sql', 'utf8')}
  set local track_functions='all';
  select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='test-admin@mathin.local'),'role','authenticated','aal','aal2')::text,true) is not null;
  set local role authenticated;
  select jsonb_build_object('pageRows',jsonb_array_length(public.list_student_records_page('awaiting_assessment','all','','records',1,20,'{"version":2,"filters":{}}','zh','{}')->'rows'));
  reset role;
  select jsonb_build_object('permissionCalls',(select calls from pg_stat_xact_user_functions where funcname='student_list_row_permissions'));
  select jsonb_build_object('cases',(select jsonb_agg(jsonb_build_object('case',a.label,'equal',a.result=b.result,'beforeMs',round(b.ms,1),'afterMs',round(a.ms,1)) order by a.label)
    from page_work_results a join page_work_results b using(label) where a.phase='after' and b.phase='before'));
  rollback;`);
const result = Object.assign({}, ...out.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line)));
fs.writeFileSync(path.join(root, 'trial-report.json'), JSON.stringify(result, null, 2), 'utf8');
assert.equal(result.cases.length, cases.length + 10);
assert.equal(result.cases.every(item => item.equal), true, 'READ_RESULTS_CHANGED');
assert.equal(result.pageRows, 20);
assert.equal(result.permissionCalls, result.pageRows, 'PERMISSIONS_COMPUTED_BEFORE_PAGING');
assert.deepEqual(snapshot(), before, 'ROLLBACK_LEFT_CHANGES');
fs.writeFileSync(path.join(root, 'check.json'), JSON.stringify({ checksum, head, before, ...result, rollback: true }, null, 2), 'utf8');
console.log(JSON.stringify({ ...result, permissionsUnchanged: true, businessUnchanged: true, rollback: true }));
