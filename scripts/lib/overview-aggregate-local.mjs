import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './history-local-target.mjs';

export const aggregateRoot = '.tmp/overview-aggregate-20260921';
export const aggregateVersion = '20260921007000_overview_acquisition_contact_aggregation';
export const aggregateMigration = `supabase/migrations/${aggregateVersion}.sql`;
export const aggregateAssertions = 'scripts/sql/overview-aggregate-assertions.sql';

/** 先核对本机组合指纹，再用实际表 owner 的维护角色执行；不修改现有 owner。 */
export function openOverviewAggregateLocal() {
  fs.mkdirSync(aggregateRoot, { recursive: true });
  const { observed } = openHistoryLocalTarget({ attestationPath: `${aggregateRoot}/target.json`, refresh: true, errorFile: `${aggregateRoot}/error.private.txt` });
  const sql = input => {
    try {
      return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
        input, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      fs.writeFileSync(`${aggregateRoot}/error.private.txt`, String(error.stderr ?? error.message));
      throw Error('LOCAL_AGGREGATE_SQL_FAILED: private error file recorded');
    }
  };
  const business = `jsonb_build_object(
    'communications',(select md5(string_agg((to_jsonb(t)-'overview_contact_v2')::text,'' order by id)) from public.lead_communications t),
    'registrations',(select md5(string_agg((to_jsonb(t)-'overview_contact_v2')::text,'' order by id)) from public.activity_registrations t),
    'archives',(select md5(string_agg((to_jsonb(t)-'overview_acquisition_v2')::text,'' order by id)) from public.history_import_records t))`;
  const businessFingerprint = () => sql(`begin read only;select ${business};commit;`);
  const footprint = () => sql(`begin read only;select jsonb_build_object(
    'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity) order by c.relname) from pg_class c where c.oid in ('public.lead_communications'::regclass,'public.activity_registrations'::regclass,'public.history_import_records'::regclass)),
    'columns',(select md5(jsonb_agg(to_jsonb(a) order by attrelid,attnum)::text) from pg_attribute a where a.attrelid in ('public.lead_communications'::regclass,'public.activity_registrations'::regclass,'public.history_import_records'::regclass) and a.attnum>0),
    'policies',(select md5(jsonb_agg(to_jsonb(p) order by oid)::text) from pg_policy p),
    'views',(select md5(string_agg(pg_get_viewdef(oid,true)||coalesce(relacl::text,'')||relowner::text||coalesce(reloptions::text,''),'' order by oid)) from pg_class where oid in ('public.business_lead_communications'::regclass,'public.business_activity_registrations'::regclass)),
    'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
    'business',${business},
    'ledger',(select md5(jsonb_agg(to_jsonb(m) order by version)::text) from public.schema_migrations m));commit;`);
  return { sql, observed, footprint, businessFingerprint };
}
