// 本机只读视图增量：--preflight、--check（事务回滚）和 --apply；无业务表 DML。
import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const root = path.resolve('.tmp/assessment-read-order');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'target.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
if (mode === '--preflight') {
  console.log(JSON.stringify({ localTargetVerified: true, host: observed.host, origin: observed.supabaseOrigin }));
  process.exit(0);
}
const version = '20260907001200_assessment_workbench_read_order';
const file = `supabase/migrations/${version}.sql`;
const checkKey = { migration: textFileSha256(file), runner: textFileSha256('scripts/assessment-read-order.mjs') };
if (mode === '--apply' && JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'checked.json'), 'utf8')).checkKey) !== JSON.stringify(checkKey)) throw new Error('CHECK_REQUIRED');
if (sql(`begin read only; select count(*) from public.schema_migrations where version='${version}'; commit;`) !== '0') throw new Error('MIGRATION_ALREADY_APPLIED');
const roleChecks = ['principal', 'teacher', 'student'].map(role => {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_ACCOUNT_REQUIRED');
  const email = account.email.replaceAll("'", "''");
  return `select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='${email}'), true);
    set local role authenticated;
    do $check$ begin
      if exists(select 1 from public.assessment_workbench_read_order v where v.id like 'invitation:%'
        and not exists(select 1 from public.lead_invitation_threads i where i.id::text=substring(v.id from 12))
        and not exists(select 1 from public.activities a where a.source_invitation_id::text=substring(v.id from 12))) then
        raise exception 'ORDER_RLS_SCOPE_CHANGED';
      end if;
      perform id from public.assessment_workbench_read_order order by assessment_at desc nulls last,id limit 50;
    end $check$;
    reset role;`;
}).join('\n');
const before = sql('begin read only; select count(*) from public.activities; select count(*) from public.activity_registrations; select count(*) from public.assessment_results; commit;');
const assertions = `do $check$ begin
  if not exists(select 1 from pg_class where oid='public.assessment_workbench_read_order'::regclass
    and reloptions @> array['security_invoker=true']) then raise exception 'INVOKER_REQUIRED'; end if;
  if has_table_privilege('anon','public.assessment_workbench_read_order','SELECT')
    or has_table_privilege('authenticated','public.assessment_workbench_read_order','INSERT,UPDATE,DELETE') then
    raise exception 'READ_ONLY_ACL_REQUIRED'; end if;
end $check$;`;
sql(`begin; set local lock_timeout='5s'; set local statement_timeout='60s';
  ${fs.readFileSync(file, 'utf8')}
  ${assertions}
  ${mode === '--check' ? roleChecks : ''}
  ${mode === '--apply' ? `insert into public.schema_migrations(version,checksum) values('${version}','${checkKey.migration}'); notify pgrst,'reload schema'; commit;` : 'rollback;'}`);
const after = sql('begin read only; select count(*) from public.activities; select count(*) from public.activity_registrations; select count(*) from public.assessment_results; commit;');
if (before !== after) throw new Error('BUSINESS_COUNTS_CHANGED');
if (mode === '--check' && sql("begin read only; select to_regclass('public.assessment_workbench_read_order') is null; commit;") !== 't') throw new Error('ROLLBACK_REQUIRED');
const report = { checkKey, localTargetVerified: true, businessWrites: false, businessCountsUnchanged: true,
  mode, ...(mode === '--check' ? { rollback: true, authenticatedRls: true, anonymousDenied: true } : {}), checkedAt: new Date().toISOString() };
fs.writeFileSync(path.join(root, mode === '--check' ? 'checked.json' : 'applied.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
