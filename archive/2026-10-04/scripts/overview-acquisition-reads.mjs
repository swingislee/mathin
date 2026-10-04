import fs from 'node:fs';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const root = '.tmp/overview-acquisition-reads';
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/database-error.txt` });
console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, supabaseOrigin: observed.supabaseOrigin, listeners: observed.listeners, ssh: false }));
const version = '20260908130000_overview_acquisition_reads';
const migration = `supabase/migrations/${version}.sql`;
const assertions = 'scripts/sql/overview-acquisition-read-assertions.sql';
const checksum = textFileSha256(migration), assertionsChecksum = textFileSha256(assertions);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (applied && mode === '--apply') { console.log(JSON.stringify({ alreadyApplied: true })); process.exit(0); }
if (mode === '--apply') {
  const check = fs.existsSync(`${root}/check.json`) ? JSON.parse(fs.readFileSync(`${root}/check.json`, 'utf8')) : null;
  if (check?.checksum !== checksum || check?.assertionsChecksum !== assertionsChecksum) throw new Error('CHECK_REQUIRED');
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const admin = loadFixedAccount('admin'), teacher = loadFixedAccount('teacher');
if (!admin || !teacher) throw new Error('FIXED_ACCOUNTS_REQUIRED');
const claims = email => `select set_config('request.jwt.claims',jsonb_build_object('sub',
  (select id from auth.users where email=${literal(email)}),'role','authenticated')::text,true) is not null;`;
const footprint = () => sql(`begin read only;select jsonb_build_object('function',to_regprocedure(
  'public.list_staff_overview_acquisition_sources(text,text,text,integer)')::text,
  'index',to_regclass('public.history_import_records_source_cursor_idx')::text);commit;`);
const before = footprint();
const result = sql(`begin;set local lock_timeout='3s';set local statement_timeout='45s';
  ${applied ? '' : fs.readFileSync(migration, 'utf8')}
  ${claims(admin.email)} set local role authenticated;
  ${fs.readFileSync(assertions, 'utf8')}
  reset role; ${claims(teacher.email)} set local role authenticated;
  do $$ begin
    if auth.uid() is null or public.is_admin(auth.uid()) then raise exception 'FIXED_NON_ADMIN_REQUIRED'; end if;
    if public.list_staff_overview_acquisition_sources(
      '2026-09-07【思维】用户与产品运营表.base','获客&私域信息登记表1.0-总',null,1000)
      <> '{"records":[],"hasMore":false}'::jsonb then raise exception 'ACQUISITION_RLS_CHANGED'; end if;
  end; $$;
  reset role;
  do $$ begin
    if exists(select 1 from pg_proc where oid='public.list_staff_overview_acquisition_sources(text,text,text,integer)'::regprocedure
      and (prosecdef or provolatile <> 's'))
      or has_function_privilege('anon','public.list_staff_overview_acquisition_sources(text,text,text,integer)','execute')
      then raise exception 'ACQUISITION_FUNCTION_ACCESS_CHANGED'; end if;
  end; $$;
  select jsonb_build_object('nonAdminRlsPreserved',true,'anonymousExecuteDenied',true,'stableInvoker',true);
  ${mode === '--check' ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`}`);
if (mode === '--check' && footprint() !== before) throw new Error('ROLLBACK_FAILED');
const report = { mode, checksum, assertionsChecksum, localTargetVerified: true, checkedAt: new Date().toISOString(),
  checks: result.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)) };
fs.writeFileSync(`${root}/${mode === '--check' ? 'check' : 'applied'}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report));
