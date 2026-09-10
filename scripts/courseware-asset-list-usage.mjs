import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const root = path.resolve('.tmp/courseware-asset-list-usage');
fs.mkdirSync(root, { recursive: true });
openHistoryLocalTarget({ attestationPath: path.join(root, 'target.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const sql = statement => {
  try {
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt',
      '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('COURSEWARE_ASSET_LIST_CHECK_FAILED: inspect the private database log');
  }
};
const version = '20260910008000_courseware_asset_list_usage', file = `supabase/migrations/${version}.sql`;
const migration = fs.readFileSync(file, 'utf8'), checksum = textFileSha256(file);
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied) {
  assert.equal(applied, checksum, 'MIGRATION_CHECKSUM_CHANGED');
  if (mode !== '--apply') throw new Error('ALREADY_APPLIED');
  console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0);
}
const signature = 'public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)';
// pg_get_functiondef 重建时会移动默认参数的源码位置；保留 AST 的值、类型与结构比较。
const metadata = (ignore = false) => `jsonb_build_object(
  'functions',(select md5(string_agg((${ignore ? `case when p.oid='${signature}'::regprocedure then (to_jsonb(p)-'prosrc')||jsonb_build_object('proargdefaults',regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location 0','g'),'proconfig',array_remove(p.proconfig,'plan_cache_mode=force_custom_plan')) else to_jsonb(p) end` : 'to_jsonb(p)'})::text,'' order by p.oid))
    from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
  'policies',(select md5(string_agg(to_jsonb(p)::text,'' order by p.oid)) from pg_policy p),
  'relations',(select md5(string_agg(jsonb_build_array(oid,relacl,relowner,relrowsecurity,relforcerowsecurity)::text,'' order by oid))
    from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m')),
  'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'))`;
const tables = ['cw_shared_assets', 'cw_asset_variant_heads', 'cw_asset_revisions', 'cw_asset_objects',
  'cw_page_asset_bindings', 'cw_page_docs', 'course_lectures'];
const business = `jsonb_build_object(${tables.map(table => `'${table}',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(h,'' order by h),''))) from (select md5(to_jsonb(t)::text) h from public.${table} t) hashes)`).join(',')})`;
const snapshot = () => JSON.parse(sql(`begin read only;set local statement_timeout='120s';select jsonb_build_object('metadata',${metadata()},'business',${business});commit;`));
const before = snapshot();
const guard = `do $guard$ begin
  if (${metadata(true)}) is distinct from (select metadata from asset_list_guard)
    or (${business}) is distinct from (select business from asset_list_guard)
    then raise exception 'UNEXPECTED_SCHEMA_PERMISSION_OR_BUSINESS_CHANGE'; end if;
  if not (select coalesce(proconfig @> array['plan_cache_mode=force_custom_plan'],false) from pg_proc where oid='${signature}'::regprocedure)
    then raise exception 'ASSET_FILTER_PLAN_REQUIRED'; end if;
end; $guard$;`;
if (mode === '--apply') {
  const check = JSON.parse(fs.readFileSync(path.join(root, 'check.json'), 'utf8'));
  assert.equal(check.checksum, checksum, 'FRESH_CHECK_REQUIRED');
  assert.equal(check.head, head, 'FRESH_CHECK_REQUIRED');
  assert.deepEqual(check.before, before, 'FRESH_CHECK_REQUIRED');
  fs.writeFileSync(path.join(root, 'original-function.sql'), `${sql(`begin read only;select pg_get_functiondef('${signature}'::regprocedure);commit;`)};\n`, 'utf8');
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='120s';
    select pg_advisory_xact_lock(hashtextextended('courseware-asset-list-usage',0));
    create temp table asset_list_guard as select ${metadata(true)} as metadata,${business} as business;
    ${migration}${guard}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
  const after = snapshot();
  assert.deepEqual(after.business, before.business, 'BUSINESS_FACTS_CHANGED');
  fs.writeFileSync(path.join(root, 'apply.json'), JSON.stringify({ checksum, head, before, after, applied: true }, null, 2), 'utf8');
  console.log(JSON.stringify({ applied: true, permissionsUnchanged: true, businessUnchanged: true })); process.exit(0);
}

const cases = [];
const add = (label, options = {}) => cases.push({ label, actor: 'admin', query: '', kind: null, role: null,
  track: 'native-16x9', minUsage: 0, limit: 11, offset: 0, digest: false, ...options });
for (const track of ['native-16x9', 'adapted-4x3']) {
  add(`${track}:first`, { track });
  add(`${track}:next`, { track, offset: 10 });
  add(`${track}:deep`, { track, offset: 5000, limit: 101 });
  add(`${track}:all`, { track, limit: null, digest: true });
  add(`${track}:usage`, { track, minUsage: 50, limit: 20 });
}
for (const kind of ['image', 'video', 'audio', 'svg', 'h5']) add(`kind:${kind}`, { kind });
add('role', { role: 'thumbnail' });
add('search', { query: '  source  ', kind: 'image', offset: 10 });
add('search-empty', { query: '__missing_asset_usage_check__' });
add('out-of-range', { offset: 100000 });
add('null-track', { track: null });
add('null-min-usage', { minUsage: null });
for (const actor of ['research', 'multirole', 'teacher', 'sales', 'registrar', 'principal', 'student', 'parent', 'anonymous']) add(`identity:${actor}`, { actor });
for (const [label, options] of Object.entries({ 'bad-track': { track: 'invalid' }, 'long-query': { query: 'q'.repeat(201) },
  'bad-kind': { kind: 'invalid' }, 'empty-role': { role: ' ' }, 'negative-usage': { minUsage: -1 },
  'zero-limit': { limit: 0 }, 'large-limit': { limit: 102 }, 'negative-offset': { offset: -1 }, 'large-offset': { offset: 100001 } })) add(label, options);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const capture = phase => `do $capture$ declare item record; actor uuid; value jsonb; started timestamptz; begin
  for item in select * from asset_list_cases order by ordinal loop
    actor:=null;
    if item.actor<>'anonymous' then
      select id into actor from auth.users where email='test-'||item.actor||'@mathin.local';
      if actor is null then raise exception 'FIXED_IDENTITY_REQUIRED'; end if;
    end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role',case when actor is null then 'anon' else 'authenticated' end,'aal','aal2')::text,true);
    execute case when actor is null then 'set local role anon' else 'set local role authenticated' end;
    started:=clock_timestamp();
    begin
      if item.digest then
        select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(to_jsonb(t)::text,'' order by ordinality),''))) into value
          from public.list_cw_shared_assets(item.query,item.kind,item.role,item.track,item.min_usage,item.page_limit,item.page_offset) with ordinality t;
      else
        select coalesce(jsonb_agg(to_jsonb(t) order by ordinality),'[]') into value
          from public.list_cw_shared_assets(item.query,item.kind,item.role,item.track,item.min_usage,item.page_limit,item.page_offset) with ordinality t;
      end if;
    exception when others then value:=jsonb_build_object('error',sqlerrm,'state',sqlstate); end;
    execute 'reset role';insert into asset_list_results values('${phase}',item.label,value,extract(epoch from clock_timestamp()-started)*1000);
  end loop;
  perform set_config('request.jwt.claims','{}',true);
end; $capture$;`;
console.log(JSON.stringify({ checking: true, cases: cases.length }));
const out = sql(`begin;set local lock_timeout='5s';set local statement_timeout='300s';
  select pg_advisory_xact_lock(hashtextextended('courseware-asset-list-usage',0));
  create temp table asset_list_guard as select ${metadata(true)} as metadata,${business} as business;
  create temp table asset_list_cases as select n::integer as ordinal,value->>'label' as label,value->>'actor' as actor,
    value->>'query' as query,value->>'kind' as kind,value->>'role' as role,value->>'track' as track,
    (value->>'minUsage')::integer as min_usage,(value->>'limit')::integer as page_limit,(value->>'offset')::integer as page_offset,(value->>'digest')::boolean as digest
    from jsonb_array_elements(${literal(JSON.stringify(cases))}::jsonb) with ordinality c(value,n);
  create temp table asset_list_results(phase text,label text,result jsonb,ms numeric);
  ${capture('before')}${migration}${capture('after')}${guard}
  select jsonb_build_object('cases',(select jsonb_agg(jsonb_build_object('case',a.label,'equal',a.result=b.result,'beforeMs',round(b.ms,1),'afterMs',round(a.ms,1),
    'error',a.result->>'error','rows',case when jsonb_typeof(a.result)='array' then jsonb_array_length(a.result) else (a.result->>'count')::integer end) order by a.label)
    from asset_list_results a join asset_list_results b using(label) where a.phase='after' and b.phase='before'));
  rollback;`);
const result = Object.assign({}, ...out.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line)));
fs.writeFileSync(path.join(root, 'trial-report.json'), JSON.stringify(result, null, 2), 'utf8');
assert.equal(result.cases.length, cases.length);
assert.equal(result.cases.every(item => item.equal), true, 'READ_RESULTS_CHANGED');
for (const item of result.cases) {
  if (item.case.startsWith('identity:') && !['identity:research', 'identity:multirole'].includes(item.case)) assert(item.error, 'FORBIDDEN_IDENTITY_RETURNED_DATA');
  else if (/^(bad-|long-|empty-|negative-|zero-|large-)/.test(item.case)) assert.equal(item.error, 'INVALID_ASSET_FILTER');
  else assert.equal(item.error, null, 'AUTHORIZED_READ_FAILED');
}
assert.deepEqual(snapshot(), before, 'ROLLBACK_LEFT_CHANGES');
fs.writeFileSync(path.join(root, 'check.json'), JSON.stringify({ checksum, head, before, ...result, rollback: true }, null, 2), 'utf8');
console.log(JSON.stringify({ ...result, permissionsUnchanged: true, businessUnchanged: true, rollback: true }));
