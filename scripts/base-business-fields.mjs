import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { buildBaseBusinessPlan } from './lib/base-business-fields.mjs';
import { historyPayloadHash } from './lib/history-import-trial.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { baseBusinessFieldsSchema } from '../src/features/school/base-business-fields-contract.ts';

const mode = process.argv[2];
if (!['--preflight', '--prepare', '--check', '--apply', '--verify'].includes(mode)) throw new Error('Use --preflight, --prepare, --check, --apply or --verify');
const root = path.resolve('.tmp/base-data-organization');
fs.mkdirSync(root, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'),
  refresh: mode === '--preflight', errorFile: path.join(root, 'database-error.txt') });
// 既有资料 RPC 由迁移身份持有；始终复用上面已核对的本机容器和 Docker context。
const migrate = statement => {
  try {
    return execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt',
      '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8',
      windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('BASE_DATABASE_ERROR: inspect private error file');
  }
};
const version = '20260910004000_base_business_fields';
const migration = `supabase/migrations/${version}.sql`;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const checksum = textFileSha256(migration);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if (applied && applied !== checksum) throw new Error('BASE_MIGRATION_CHANGED');
if (mode === '--preflight') {
  console.log(JSON.stringify({ host: observed.host, localTargetVerified: true, head, migrationApplied: Boolean(applied) }));
  process.exit(0);
}

const records = sql(`begin isolation level repeatable read read only;
  select to_jsonb(h) from public.history_import_records h where source_data->>'format'='feishu-base' order by id;commit;`)
  .split('\n').filter(Boolean).map(line => JSON.parse(line));
const plan = buildBaseBusinessPlan(records);
for (const fact of plan.facts) baseBusinessFieldsSchema.parse(fact.fields);
const planHash = historyPayloadHash(plan);
const checkKey = { checksum, planHash, script: textFileSha256('scripts/base-business-fields.mjs'),
  library: textFileSha256('scripts/lib/base-business-fields.mjs'), contract: textFileSha256('src/features/school/base-business-fields-contract.ts'),
  schema: textFileSha256('src/features/school/base-business-fields-schema.mjs'), normalizer: textFileSha256('src/features/school/business-source-contract.ts'),
  assertions: textFileSha256('scripts/sql/base-business-fields-assertions.sql') };
if (mode === '--prepare') {
  write('plan.json', plan);
  write('field-report.json', { summary: plan.summary, fields: plan.fields });
  write('prepared.json', { checkKey, preparedAt: new Date().toISOString(), summary: plan.summary });
  console.log(JSON.stringify({ mode, ...plan.summary }));
  process.exit(0);
}
if (historyPayloadHash(read('plan.json')) !== planHash || (mode !== '--verify' && JSON.stringify(read('prepared.json').checkKey) !== JSON.stringify(checkKey))) throw new Error('BASE_INPUT_CHANGED_PREPARE_AGAIN');
if (plan.summary.unmapped) throw new Error('BASE_UNMAPPED_FIELDS_REMAIN');
if (mode === '--apply') {
  const check = read('check.json');
  if (JSON.stringify(check.checkKey) !== JSON.stringify(checkKey) || (!applied && check.head !== head)) throw new Error('BASE_CURRENT_CHECK_REQUIRED');
}

const tables = ['students','profiles','leads','lead_source_records','lead_communications','lead_identity_conversions','student_follow_ups',
  'history_import_records','history_import_associations','history_import_association_events','history_import_identity_candidates',
  'history_workflow_scopes','history_business_workflow_scopes','course_enrollments','course_enrollment_assignments','course_opportunities',
  'assessment_results','activities','activity_registrations','school_subject_participants','school_subject_groups','enrollments','classrooms',
  'class_sessions','session_attendance','payments','work_items','notifications'];
const available = new Set(sql("begin read only;select tablename from pg_tables where schemaname='public';commit;").split('\n'));
const covered = tables.filter(table => available.has(table));
const fingerprints = covered.map(table => `select '${table}'::text as name,count(*) as rows,
  md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from public.${table} t`).join('\nunion all\n');
const snapshot = () => sql(`begin read only;select jsonb_agg(t order by name) from (${fingerprints}) t;commit;`);
const before = snapshot();
const contextDefinition = () => sql("begin read only;select md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')) from pg_proc p where p.oid='public.read_school_record_source_context(uuid,uuid,integer)'::regprocedure;commit;");
const beforeDefinition = contextDefinition();
const expected = JSON.stringify(plan.facts);
const tag = '$base_business_input$';
if (expected.includes(tag)) throw new Error('BASE_PAYLOAD_DELIMITER');
const dataAssertions = `
do $verify$
begin
  if exists(select 1 from base_business_input i left join public.history_source_business_facts b
    on b.source_record_id=i.source_record_id and b.mapping_version=i.mapping_version
    where b.source_record_id is null or b.fields<>i.fields or b.source_payload_sha256<>i.source_payload_sha256) then raise exception 'BASE_STORED_FIELDS_DIFFER'; end if;
  if exists(select 1 from base_business_input i join public.history_import_records h on h.id=i.source_record_id
    where h.payload_sha256<>i.source_payload_sha256) then raise exception 'BASE_ORIGINAL_CHANGED'; end if;
end;
$verify$;`;
if (mode === '--verify') {
  if (!applied) throw new Error('BASE_MIGRATION_REQUIRED');
  const matches = sql(`begin read only;with expected as (select * from jsonb_to_recordset(${tag}${expected}${tag}::jsonb)
    as x(source_record_id text,mapping_version integer,source_payload_sha256 text,fields jsonb))
    select not exists(select 1 from expected i left join public.history_source_business_facts b
      on b.source_record_id=i.source_record_id and b.mapping_version=i.mapping_version
      where b.source_record_id is null or b.fields<>i.fields or b.source_payload_sha256<>i.source_payload_sha256);commit;`);
  if (matches !== 't') throw new Error('BASE_STORED_FIELDS_DIFFER');
  const result = { mode, checkedAt: new Date().toISOString(), planHash, storedFieldsEqual: true, ...plan.summary };
  write('verified.json', result);
  console.log(JSON.stringify(result));
  process.exit(0);
}

const statement = `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='180s';
  select pg_advisory_xact_lock(hashtextextended('base-business-fields',0));
  create temp table base_business_before on commit drop as ${fingerprints};
  ${applied ? '' : fs.readFileSync(migration, 'utf8')}
  create temp table base_business_input on commit drop as select * from jsonb_to_recordset(${tag}${expected}${tag}::jsonb)
    as x(source_record_id text,mapping_version integer,source_payload_sha256 text,fields jsonb);
  do $guard$ begin
    if exists(select 1 from base_business_input i join public.history_source_business_facts b
      on b.source_record_id=i.source_record_id and b.mapping_version=i.mapping_version
      where b.fields<>i.fields or b.source_payload_sha256<>i.source_payload_sha256) then raise exception 'BASE_MAPPING_VERSION_CHANGED'; end if;
  end $guard$;
  select public.store_base_business_fields((select coalesce(jsonb_agg(t),'[]'::jsonb) from base_business_input t));
  ${dataAssertions}
  ${fs.readFileSync('scripts/sql/base-business-fields-assertions.sql', 'utf8')}
  create temp table base_business_after on commit drop as ${fingerprints};
  do $unchanged$ begin
    if exists((select * from base_business_before except select * from base_business_after)
      union all (select * from base_business_after except select * from base_business_before)) then raise exception 'BASE_EXISTING_BUSINESS_CHANGED'; end if;
  end $unchanged$;
  ${mode === '--check' ? 'rollback;' : `${applied ? '' : `insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');`}notify pgrst,'reload schema';commit;`}`;
migrate(statement);
if (snapshot() !== before) throw new Error('BASE_EXISTING_BUSINESS_CHANGED');
if (mode === '--check' && !applied && sql("begin read only;select (to_regclass('public.history_source_business_facts') is null)::text;commit;") !== 'true') throw new Error('BASE_ROLLBACK_FAILED');
if (mode === '--check' && contextDefinition() !== beforeDefinition) throw new Error('BASE_SOURCE_CONTEXT_ROLLBACK_FAILED');
const result = { mode, checkKey, head, checkedAt: new Date().toISOString(), localTargetVerified: true,
  existingBusinessUnchanged: true, protectedTables: covered.length, storedFieldsEqual: true, ...plan.summary };
write(mode === '--check' ? 'check.json' : 'applied.json', result);
console.log(JSON.stringify(result));
