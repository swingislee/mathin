import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { historyPayloadHash } from './lib/history-import-trial.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { buildBaseActivitySourceLinks, parseBaseActivityEntries } from './lib/base-activity-source-links.mjs';
import { baseBusinessFieldsSchema } from '../src/features/school/base-business-fields-schema.mjs';

const [mode, explicitSourceId] = process.argv.slice(2);
if (!['--prepare','--check','--apply','--verify'].includes(mode)) throw new Error('Use --prepare SOURCE_ID, --check, --apply or --verify');
const root = path.resolve('.tmp/base-activity-associations');
fs.mkdirSync(root, { recursive: true });
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const sourceId = explicitSourceId ?? read('prepared.json').sourceId;
if (!/^source-record:[a-f\d]{64}$/u.test(sourceId)) throw new Error('SOURCE_ID_REQUIRED');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const version = '20260911002000_base_activity_source_links';
const file = `supabase/migrations/${version}.sql`;
const head = sql('begin read only;select max(version) from public.schema_migrations;commit;');
const checksum = textFileSha256(file);
const applied = sql(`begin read only;select checksum from public.schema_migrations where version=${q(version)};commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');
if (sql("begin read only;select checksum from public.schema_migrations where version='20260911001000_base_review_resolution';commit;")
  !== textFileSha256('supabase/migrations/20260911001000_base_review_resolution.sql')) throw new Error('BASE_REVIEW_MIGRATION_REQUIRED');
const source = JSON.parse(sql(`begin read only;select to_jsonb(h) from public.history_import_records h where h.id=${q(sourceId)};commit;`));
const names = [...new Set(parseBaseActivityEntries(source).map(entry => entry.name))].map(name => `public.school_identity_name(${q(name)})`).join(',');
const input = JSON.parse(sql(`begin isolation level repeatable read read only;select jsonb_build_object(
  'leads',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from public.leads l where public.school_identity_name(l.provisional_student_name) in (${names})),
  'students',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.students s where s.deleted_at is null and public.school_identity_name(s.name) in (${names})),
  'records',(select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from public.history_import_records h where exists(
    select 1 from jsonb_array_elements_text(coalesce(h.record_data->'names','[]')) n where public.school_identity_name(n) in (${names})))
);commit;`));
const plan = buildBaseActivitySourceLinks(source, input.leads, input.students, input.records);
for (const link of plan.links) baseBusinessFieldsSchema.parse(link.business_fields);
const checkKey = { checksum, planHash: historyPayloadHash(plan), inputHash: historyPayloadHash({ source, input }),
  runner: textFileSha256('scripts/base-activity-source-links.mjs'), library: textFileSha256('scripts/lib/base-activity-source-links.mjs'),
  assertions: textFileSha256('scripts/sql/base-activity-source-links-assertions.sql'), reviewAssertions: textFileSha256('scripts/sql/school-record-review-assertions.sql') };
if (mode === '--prepare') {
  write('plan.json', plan); write('prepared.json', { sourceId, checkKey, preparedAt: new Date().toISOString() });
  console.log(JSON.stringify({ mode, ...plan.summary })); process.exit(0);
}
if (JSON.stringify(read('prepared.json').checkKey) !== JSON.stringify(checkKey)) throw new Error('SOURCE_LINK_INPUT_CHANGED_PREPARE_AGAIN');
if (mode === '--apply' && (JSON.stringify(read('check.json').checkKey) !== JSON.stringify(checkKey) || (!applied && read('check.json').head !== head))) throw new Error('CURRENT_SOURCE_LINK_CHECK_REQUIRED');
const tables = ['students','leads','profiles','lead_communications','lead_identity_conversions','student_follow_ups','history_import_records',
  'history_import_batches','history_import_batch_records','history_import_associations','history_import_association_events','history_import_identity_candidates',
  'history_source_business_facts','school_subject_participants','school_subject_groups','activity_registrations','assessment_results','course_enrollments','course_opportunities'];
const fingerprints = tables.map(table => `select ${q(table)} as name,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from public.${table} t`).join('\nunion all\n');
const snapshot = () => sql(`begin read only;select jsonb_agg(t order by name) from (${fingerprints}) t;commit;`);
const definition = () => sql("begin read only;select jsonb_build_object('table',to_regclass('public.history_source_fragments')::text,'guard',to_regprocedure('public.guard_history_source_fragment()')::text,'rpc',(select md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')) from pg_proc p where p.oid='public.read_school_record_source_context(uuid,uuid,integer)'::regprocedure));commit;");
const payload = q(JSON.stringify(plan.links));
const comparison = `not exists(select 1 from jsonb_array_elements(${payload}::jsonb) i left join public.history_source_fragments f on f.id=i->>'id' where f.id is null or (to_jsonb(f)-'created_at')<>i)`;
if (mode === '--verify') {
  if (!applied || sql(`begin read only;select ${comparison};commit;`) !== 't') throw new Error('SOURCE_LINK_STORED_FIELDS_DIFFER');
  const result = { checkedAt: new Date().toISOString(), checkKey, storedFieldsEqual: true, ...plan.summary };
  write('verified.json', result); console.log(JSON.stringify(result)); process.exit(0);
}
const before = snapshot(), beforeDefinition = definition();
const columns = 'id,source_record_id,source_payload_sha256,source_field_id,entry_index,original_text,student_id,lead_id,match_state,match_reason,business_fields,event_date';
const statement = `begin isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='120s';
  select pg_advisory_xact_lock(hashtextextended('base-activity-source-links',0));
  create temp table source_links_business_before on commit drop as ${fingerprints};
  ${applied ? '' : fs.readFileSync(file, 'utf8')}
  create temp table source_link_input on commit drop as select * from jsonb_to_recordset(${payload}::jsonb)
    as x(id text,source_record_id text,source_payload_sha256 text,source_field_id text,entry_index integer,original_text text,
      student_id uuid,lead_id uuid,match_state text,match_reason jsonb,business_fields jsonb,event_date date);
  insert into public.history_source_fragments(${columns}) select ${columns} from source_link_input on conflict(id) do nothing;
  do $stored$ begin if not (${comparison}) then raise exception 'SOURCE_LINK_STORED_FIELDS_DIFFER'; end if;end;$stored$;
  ${fs.readFileSync('scripts/sql/school-record-review-assertions.sql', 'utf8')}
  ${fs.readFileSync('scripts/sql/base-activity-source-links-assertions.sql', 'utf8')}
  create temp table source_links_business_after on commit drop as ${fingerprints};
  do $unchanged$ begin if exists((select * from source_links_business_before except select * from source_links_business_after)
    union all (select * from source_links_business_after except select * from source_links_business_before)) then raise exception 'EXISTING_BUSINESS_CHANGED';end if;end;$unchanged$;
  ${mode === '--check' ? 'rollback;' : `${applied ? '' : `insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});`}notify pgrst,'reload schema';commit;`}`;
try {
  execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, stdio: ['pipe','pipe','pipe'] });
} catch (error) { fs.writeFileSync(path.join(root, 'database-error.txt'), String(error.stderr ?? error.message), 'utf8'); throw new Error('SOURCE_LINK_DATABASE_ERROR: inspect private error file'); }
if (snapshot() !== before) throw new Error('EXISTING_BUSINESS_CHANGED');
if (mode === '--check' && definition() !== beforeDefinition) throw new Error('SOURCE_LINK_ROLLBACK_FAILED');
const result = { mode, checkKey, head, checkedAt: new Date().toISOString(), localTargetVerified: true, existingBusinessUnchanged: true,
  protectedTables: tables.length, rollbackVerified: mode === '--check', ...plan.summary };
write(mode === '--check' ? 'check.json' : 'applied.json', result); console.log(JSON.stringify({ ...result, host: observed.host }));
