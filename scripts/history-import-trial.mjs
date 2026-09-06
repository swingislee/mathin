import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildHistoryIdentityIndex, matchHistoryRecords } from './lib/history-archive-identity.mjs';
import { buildHistoryFamilyPayload, buildHistoryTrialPayload, historyPayloadHash, selectHistoryTrialCases, validateHistoryTrialTarget } from './lib/history-import-trial.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf('=');
  return split < 0 ? [value.replace(/^--/, ''), true] : [value.slice(2, split), value.slice(split + 1)];
}));
if ((!args.prepare && !args.apply) || (args.prepare && args.apply) || typeof args.attestation !== 'string') {
  throw new Error('Use --prepare or --apply with --attestation=local-file');
}
if (args.family && (typeof args.family !== 'string' || !args.family.trim() || args.family.length > 100)) throw new Error('HISTORY_FAMILY_NAME_REQUIRED');
const trialRoot = path.resolve('.tmp/history-import-trial');
const root = args.family ? path.join(trialRoot, `family-${historyPayloadHash(args.family.trim()).slice(0, 12)}`) : trialRoot;
fs.mkdirSync(root, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const docker = argv => execFileSync('docker.exe', ['--context', 'desktop-linux', ...argv], { encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024 }).trim();
function sql(statement) {
  try {
    return execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fs.writeFileSync(path.join(root, 'last-database-error.txt'), String(error.stderr ?? error.message), 'utf8');
    throw new Error('HISTORY_TRIAL_DATABASE_ERROR: inspect private local error file');
  }
}
const attestation = read(args.attestation);
if (process.platform !== 'win32' || process.env.SSH_CONNECTION || process.env.DOCKER_HOST) throw new Error('HISTORY_TRIAL_LOCAL_HOST_REQUIRED');
const envMatch = fs.readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\r\n"']+)/m);
const origin = envMatch ? new URL(envMatch[1].trim()).origin : null;
const endpoint = JSON.parse(docker(['context', 'inspect', 'desktop-linux', '--format', '{{json .Endpoints.docker.Host}}']));
const systemIdentifier = sql('begin read only; select system_identifier::text from pg_control_system(); commit;');
validateHistoryTrialTarget(attestation, { host: os.hostname(), envOrigin: origin, dockerEndpoint: endpoint, systemIdentifier });
const listenerText = execFileSync('netstat.exe', ['-ano'], { encoding: 'utf8', windowsHide: true });
const observed = [];
for (const [address, port, processName] of [['127.0.0.1', 35421, 'com.docker.backend'], ['0.0.0.0', 3130, 'node']]) {
  const line = listenerText.split(/\r?\n/).find(line => line.includes(`${address}:${port}`) && line.includes('LISTENING'));
  const pid = line?.trim().split(/\s+/).at(-1);
  if (!pid || !/^\d+$/.test(pid)) throw new Error('HISTORY_TRIAL_LISTENER_CHANGED');
  const processOutput = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (!processOutput.toLowerCase().includes(`"${processName}.exe"`)) throw new Error('HISTORY_TRIAL_LISTENER_PROCESS_CHANGED');
  observed.push({ Address: address, Port: port, Process: processName, pid: Number(pid) });
}
const gateway = JSON.parse(docker(['inspect', 'supabase-envoy', '--format', '{{json .NetworkSettings}}']));
const databaseNetworks = JSON.parse(docker(['inspect', 'supabase-db', '--format', '{{json .NetworkSettings.Networks}}']));
if (!gateway.Ports?.['8000/tcp']?.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '35421')
  || !gateway.Networks?.['mathin-isolated-loopback']
  || gateway.Networks['mathin-isolated-loopback'].NetworkID !== databaseNetworks['mathin-isolated-loopback']?.NetworkID) throw new Error('HISTORY_TRIAL_NETWORK_TARGET_CHANGED');

const archiveRoot = path.resolve('.tmp/history-archive-rehearsal');
const pointer = read(path.join(archiveRoot, 'current.json'));
if (!/^run-[a-zA-Z0-9-]+\/archive\.sqlite$/.test(pointer.database) || !/^run-[a-zA-Z0-9-]+\/manifest\.json$/.test(pointer.manifest)) throw new Error('HISTORY_TRIAL_ARCHIVE_POINTER');
const archiveFile = path.join(archiveRoot, pointer.database);
const sourceManifest = read(path.join(archiveRoot, pointer.manifest));
const archiveHash = createHash('sha256').update(fs.readFileSync(archiveFile)).digest('hex');
if (archiveHash !== sourceManifest.databaseSha256) throw new Error('HISTORY_TRIAL_ARCHIVE_HASH_CHANGED');
const archive = new DatabaseSync(archiveFile, { readOnly: true });
let records, sources;
try {
  archive.exec('pragma query_only=ON');
  records = archive.prepare('select data from records order by id').all().map(row => JSON.parse(row.data));
  sources = archive.prepare('select data from sources order by id').all().map(row => JSON.parse(row.data));
} finally { archive.close(); }

const identityTables = ['students', 'leads', 'enrollments', 'data_import_rows', 'data_import_batches'];
const snapshot = Object.fromEntries(sql(`begin isolation level repeatable read read only; ${identityTables.map(table => `select jsonb_build_object('table','${table}','rows',coalesce(jsonb_agg(t),'[]'::jsonb)) from public.${table} t;`).join('\n')} commit;`)
  .split('\n').filter(Boolean).map(line => { const result = JSON.parse(line); return [result.table, result.rows]; }));
const identities = buildHistoryIdentityIndex({ tables: snapshot });
const matches = matchHistoryRecords(records, identities);
if (args.diagnostics) console.log(JSON.stringify({identities:identities.diagnostics, sources:sources.map(source=>({id:source.id,filename:source.filename})),statuses:matches.reduce((counts,match)=>({...counts,[match.status]:(counts[match.status]??0)+1}),{}),tableSample:records.find(record=>record.tableName==='（老数据）各选拔产品协作信息表-总')?.sourceId}));
const planFile = path.join(root, 'plan.json');
const seedCases = args.family ? read(path.join(trialRoot, 'plan.json')).manifest.cases.filter(item => item.label === args.family.trim() && item.entityKind === 'student') : [];
if (args.family && seedCases.length !== 1) throw new Error('HISTORY_FAMILY_SAMPLE_AMBIGUOUS');
const cases = args.family ? null : args.prepare ? selectHistoryTrialCases(records, matches, identities.entities) : read(planFile).manifest.cases;
const payload = args.family
  ? buildHistoryFamilyPayload({ records, matches, entities: identities.entities, sources, seedCase: seedCases[0] })
  : buildHistoryTrialPayload({ records, matches, entities: identities.entities, sources, cases });
if (args.prepare) {
  if (fs.existsSync(planFile) && read(planFile).payloadHash !== payload.payloadHash) throw new Error('HISTORY_TRIAL_PLAN_EXISTS_WITH_DIFFERENT_INPUT');
  fs.writeFileSync(planFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'fresh-identity-snapshot.json'), `${JSON.stringify(snapshot)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: 'prepared', records: payload.records.length, cases: payload.manifest.cases.length,
    linkedIdentities: payload.manifest.linkedIdentities, reviewCases: payload.manifest.reviewCases, unmatchedCases: payload.manifest.unmatchedCases,
    searchedSources: payload.manifest.searchedSourceCount ?? null, linkedRecords: payload.manifest.linkedRecordCount ?? null,
    candidateRecords: payload.manifest.candidateRecordCount ?? null, rosterMentions: payload.manifest.rosterRecordCount ?? null, payloadHash: payload.payloadHash }));
  process.exit(0);
}
const saved = read(planFile);
if (historyPayloadHash({ manifest: saved.manifest, records: saved.records }) !== saved.payloadHash || saved.payloadHash !== payload.payloadHash) throw new Error('HISTORY_TRIAL_PLAN_OR_CURRENT_IDENTITY_CHANGED');

// 同一个事务内核对当前工作与身份数据；即使以后误加触发器，也会因指纹变化整批回滚。
const protectedTables = ['students', 'leads', 'families', 'contacts', 'family_contacts', 'family_students', 'student_contacts',
  'lead_identity_conversions', 'student_grade_history', 'lead_communications', 'student_follow_ups', 'activity_followup_contacts',
  'lead_next_actions', 'lead_invitation_threads', 'lead_invitation_events', 'communication_worklists', 'communication_worklist_items',
  'assessment_results', 'activity_registrations', 'course_opportunities', 'course_opportunity_events', 'course_enrollments',
  'course_enrollment_assignments', 'course_enrollment_events', 'renewal_cycles', 'renewal_cycle_entries', 'renewal_registration_records',
  'class_support_tasks', 'class_support_task_recipients', 'classrooms', 'class_sessions', 'enrollments', 'session_attendance'];
protectedTables.push('notifications', 'notification_deliveries', 'work_items', 'work_item_assignments', 'work_item_user_state');
const available = new Set(sql("begin read only; select tablename from pg_tables where schemaname='public'; commit;").split('\n'));
const covered = protectedTables.filter(table => available.has(table));
const fingerprintQuery = covered.map(table => `select '${table}'::text as name, count(*)::integer as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from public.${table} t`).join('\nunion all\n');
const tag = '$history_payload$';
if (JSON.stringify(payload).includes(tag)) throw new Error('HISTORY_TRIAL_SQL_PAYLOAD_DELIMITER');
const statement = `begin isolation level repeatable read;
set local lock_timeout='5s'; set local statement_timeout='45s';
do $guard$ begin if (select system_identifier::text from pg_control_system()) <> '${systemIdentifier}' then raise exception 'HISTORY_TRIAL_DATABASE_CHANGED'; end if; end $guard$;
select pg_advisory_xact_lock(hashtextextended('history-import-trial',0));
create temp table trial_input(payload jsonb) on commit drop;
insert into trial_input values (${tag}${JSON.stringify(payload)}${tag}::jsonb);
create temp table trial_before on commit drop as ${fingerprintQuery};
create temp table trial_records_before on commit drop as select count(*)::integer as rows from public.history_import_records;
do $check$ begin
  if exists(select 1 from public.history_import_batches b, trial_input i where b.batch_key=i.payload->>'batchKey' and b.payload_sha256<>i.payload->>'payloadHash') then raise exception 'HISTORY_TRIAL_BATCH_CHANGED'; end if;
  if exists(select 1 from trial_input i cross join lateral jsonb_array_elements(i.payload->'records') r join public.history_import_records h on h.id=r->>'id' where h.payload_sha256<>r->>'payload_sha256') then raise exception 'HISTORY_TRIAL_RECORD_CHANGED'; end if;
end $check$;
insert into public.history_import_batches(batch_key,payload_sha256,manifest)
select payload->>'batchKey',payload->>'payloadHash',payload->'manifest' from trial_input on conflict(batch_key) do nothing;
insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,entity_data,candidate_data,student_id,lead_id,search_text)
select r->>'id',r->>'source_sha256',r->>'source_table_id',r->>'source_record_id',r->>'payload_sha256',r->'source_data',r->'record_data',r->>'match_status',r->'match_data',nullif(r->'entity_data','null'::jsonb),r->'candidate_data',(r->>'student_id')::uuid,(r->>'lead_id')::uuid,r->>'search_text'
from trial_input i cross join lateral jsonb_array_elements(i.payload->'records') r on conflict(id) do nothing;
insert into public.history_import_batch_records(batch_id,record_id,case_key)
select b.id,r->>'id',r->>'case_key' from trial_input i join public.history_import_batches b on b.batch_key=i.payload->>'batchKey'
cross join lateral jsonb_array_elements(i.payload->'records') r on conflict(batch_id,record_id) do nothing;
create temp table trial_after on commit drop as ${fingerprintQuery};
do $check$ begin
  if exists((select * from trial_before except select * from trial_after) union all (select * from trial_after except select * from trial_before)) then raise exception 'HISTORY_TRIAL_CURRENT_WORK_CHANGED'; end if;
  if (select count(*) from public.history_import_batch_records br join public.history_import_batches b on b.id=br.batch_id join trial_input i on b.batch_key=i.payload->>'batchKey') <> (select jsonb_array_length(payload->'records') from trial_input) then raise exception 'HISTORY_TRIAL_COVERAGE'; end if;
  if exists(select 1 from trial_input i cross join lateral jsonb_array_elements(i.payload->'records') r join public.history_import_records h on h.id=r->>'id' where h.record_data<>r->'record_data' or h.source_data<>r->'source_data') then raise exception 'HISTORY_TRIAL_ORIGINAL_CHANGED'; end if;
end $check$;
update public.history_import_batches b set verification=jsonb_build_object(
  'attempts',coalesce((b.verification->>'attempts')::integer,0)+1,
  'lastVerifiedAt',clock_timestamp(), 'originalsEqual',true, 'currentWorkUnchanged',true,
  'insertedRecords',(select count(*) from public.history_import_records)-(select rows from trial_records_before),
  'before',(select jsonb_object_agg(name,rows) from trial_before), 'after',(select jsonb_object_agg(name,rows) from trial_after),
  'fingerprintsBefore',(select jsonb_object_agg(name,digest) from trial_before), 'fingerprintsAfter',(select jsonb_object_agg(name,digest) from trial_after))
from trial_input i where b.batch_key=i.payload->>'batchKey';
select json_build_object('mode','imported','batchId',b.id,'records',b.manifest->'recordCount','verification',b.verification)
from public.history_import_batches b join trial_input i on b.batch_key=i.payload->>'batchKey';
commit;`;
const output = sql(statement).split('\n').findLast(line => line.startsWith('{'));
if (!output) throw new Error('HISTORY_TRIAL_REPORT_MISSING');
const report = JSON.parse(output);
fs.writeFileSync(path.join(root, `attempt-${report.verification.attempts}.json`), `${JSON.stringify({ ...report, observed }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ mode: report.mode, records: report.records, attempts: report.verification.attempts,
  insertedRecords: report.verification.insertedRecords, originalsEqual: report.verification.originalsEqual,
  currentWorkUnchanged: report.verification.currentWorkUnchanged, protectedTables: covered.length }));
