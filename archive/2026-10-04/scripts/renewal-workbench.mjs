import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply', '--status'].includes(mode)) throw new Error('Use --preflight, --check, --apply or --status');
const root = path.resolve('.tmp/renewal-workbench');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({
  attestationPath: path.join(root, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt'),
});
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const migration = '20260907000300_renewal_workbench_details';
const migrationFile = `supabase/migrations/${migration}.sql`, checksum = textFileSha256(migrationFile);
const applied = sql(`begin read only;select count(*) from public.schema_migrations where version='${migration}';commit;`) !== '0';
if (mode === '--status') {
  const fixture = JSON.parse(sql(`begin read only;select jsonb_build_object('entries',count(*),
    'available',count(*) filter(where o.stage is distinct from 'enrolled'))
    from public.renewal_cycle_entries e join public.renewal_cycles c on c.id=e.renewal_cycle_id
    left join public.course_opportunities o on o.id=e.opportunity_id where c.name='P5验收 · 暑期衔接→秋季续报';commit;`));
  console.log(JSON.stringify({ applied, checksum, details: sql("begin read only;select to_regclass('public.renewal_workbench_details') is not null;commit;") === 't', fixture }));
  process.exit(0);
}
if (applied) throw new Error('ALREADY_APPLIED');
const checkFile = path.join(root, 'check.json');
const assertionFile = 'scripts/sql/renewal-workbench-assertions.sql';
const assertionChecksum = textFileSha256(assertionFile);
if (mode === '--apply' && (!fs.existsSync(checkFile) || JSON.parse(fs.readFileSync(checkFile, 'utf8')).checksum !== checksum
  || JSON.parse(fs.readFileSync(checkFile, 'utf8')).assertionChecksum !== assertionChecksum)) throw new Error('CHECK_REQUIRED');
const tables = ['renewal_cycles', 'renewal_cycle_entries', 'course_opportunities', 'course_opportunity_events',
  'renewal_registration_records', 'course_enrollments', 'course_enrollment_events', 'course_enrollment_assignments',
  'students', 'profiles', 'staff_role_members', 'classrooms', 'enrollments', 'class_sessions', 'session_attendance', 'teacher_professional_signals'];
const columns = JSON.parse(sql(`begin read only;select jsonb_object_agg(table_name,names) from
  (select table_name,jsonb_agg(column_name order by ordinal_position) names from information_schema.columns where table_schema='public' group by table_name)c;commit;`));
const fingerprint = tables.map(table => {
  if (!columns[table]) throw new Error(`MISSING_TABLE_${table}`);
  const row = `jsonb_build_object(${columns[table].map(column => `'${column}',t.${column}`).join(',')})`;
  return `select '${table}'::text name,count(*)::integer rows,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) digest from public.${table} t`;
}).join('\nunion all\n');
const checking = mode === '--check';
let identities = '';
if (checking) {
  const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
  const roles = { admin: /^管理员\s+admin(?:\s|$)/, other: /^教研\s+staff\/research(?:\s|$)/ };
  for (const [role, pattern] of Object.entries(roles)) {
    const cells = manifest.split(/\r?\n/).map(line => line.split('|').slice(1,-1).map(cell => cell.replace(/[*_`]/g,'').trim()))
      .find(row => pattern.test(row[0] ?? ''));
    if (!cells || !/^[^@'\s]+@[^@'\s]+$/.test(cells[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
    identities += `select set_config('mathin.assertion.${role}',coalesce((select id::text from auth.users where email='${cells[1]}'),''),true);\n`;
  }
}
sql(`begin isolation level repeatable read;
  set local lock_timeout='5s';set local statement_timeout='90s';
  select pg_advisory_xact_lock(hashtextextended('renewal-workbench-v1',0));
  create temp table renewal_data_before on commit drop as ${fingerprint};
  ${fs.readFileSync(migrationFile, 'utf8')}
  ${identities}
  ${checking ? `savepoint before_behavior;${fs.readFileSync(assertionFile, 'utf8')}rollback to before_behavior;` : ''}
  create temp table renewal_data_after on commit drop as ${fingerprint};
  do $check$ begin if exists((select * from renewal_data_before except select * from renewal_data_after)
    union all(select * from renewal_data_after except select * from renewal_data_before)) then raise exception 'RENEWAL_EXISTING_DATA_CHANGED';end if;end $check$;
  ${checking ? 'rollback;' : `insert into public.schema_migrations(version,checksum) values('${migration}','${checksum}');notify pgrst,'reload schema';commit;`}
`);
if (checking && sql("begin read only;select to_regclass('public.renewal_workbench_details') is null;commit;") !== 't') throw new Error('ROLLBACK_FAILED');
const result = { mode, checksum, assertionChecksum, checkedAt: new Date().toISOString(), host: observed.host,
  protectedTables: tables.length, businessDataUnchanged: true, assertionsRolledBack: checking };
fs.writeFileSync(path.join(root, checking ? 'check.json' : 'applied.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
