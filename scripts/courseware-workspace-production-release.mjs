import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS,
  loadCandidateMigrations,
  stripMigrationTransaction,
} from "./lib/courseware-workspace-candidate.mjs";

const EXPECTED_FINGERPRINT = "10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c";
const EXPECTED_HEAD = "20260830000700_teacher_microcourse_editor_unification";
const WRITE_CONFIRMATION = "courseware-workspace-20260903";
const SAFE_SSH = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/;
const SAFE_CONTAINER = /^[A-Za-z0-9_.-]+$/;
const SAFE_COMMIT = /^[0-9a-f]{40}$/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseOptions(argv) {
  const options = {
    mode: null,
    candidateRoot: null,
    candidateCommit: null,
    sshTarget: "xiaomi",
    container: "supabase-db",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mode") options.mode = argv[++index] ?? fail("--mode requires a value");
    else if (argument === "--candidate-root") options.candidateRoot = argv[++index] ?? fail("--candidate-root requires a value");
    else if (argument === "--candidate-commit") options.candidateCommit = argv[++index] ?? fail("--candidate-commit requires a value");
    else if (argument === "--ssh-target") options.sshTarget = argv[++index] ?? fail("--ssh-target requires a value");
    else if (argument === "--container") options.container = argv[++index] ?? fail("--container requires a value");
    else fail(`unknown argument: ${argument}`);
  }
  if (!["preflight", "backup", "rehearse", "apply", "postflight"].includes(options.mode)) fail("invalid --mode");
  if (!options.candidateRoot || !path.isAbsolute(options.candidateRoot)) fail("--candidate-root must be absolute");
  if (!options.candidateCommit || !SAFE_COMMIT.test(options.candidateCommit)) fail("--candidate-commit must be a full SHA");
  if (!SAFE_SSH.test(options.sshTarget) || options.sshTarget.startsWith("-")) fail("invalid --ssh-target");
  if (!SAFE_CONTAINER.test(options.container)) fail("invalid --container");
  const actualCommit = run("git.exe", ["-C", options.candidateRoot, "rev-parse", "HEAD"]).stdout.trim();
  if (actualCommit !== options.candidateCommit) fail(`candidate commit drift: ${actualCommit}`);
  if (run("git.exe", ["-C", options.candidateRoot, "status", "--porcelain"]).stdout.trim()) fail("candidate worktree is not clean");
  return options;
}

function run(executable, args, input) {
  const result = spawnSync(executable, args, {
    input,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) fail(result.stderr || result.stdout || `${executable} failed with ${result.status}`);
  return result;
}

function runRemoteScript(options, script) {
  return run("ssh.exe", ["-o", "BatchMode=yes", options.sshTarget, "bash -s"], script).stdout.trim();
}

function runPsql(options, sql) {
  const remote = `docker exec -i ${options.container} psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1`;
  const text = run("ssh.exe", ["-o", "BatchMode=yes", options.sshTarget, remote], sql).stdout.trim();
  try { return JSON.parse(text); } catch { fail(`psql did not return one JSON value: ${text.slice(0, 500)}`); }
}

const candidateVersions = COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS.map((name) => name.replace(/\.sql$/, ""));
const versionValues = candidateVersions.map((value) => `('${value}')`).join(",");

const countsExpression = String.raw`jsonb_build_object(
  'pageDocs',(select count(*) from public.cw_page_docs),
  'pageRevisions',(select count(*) from public.cw_page_revisions),
  'trackHeads',(select count(*) from public.cw_page_track_heads),
  'assetBindings',(select count(*) from public.cw_page_asset_bindings),
  'assetObjects',(select count(*) from public.cw_asset_objects),
  'sharedAssets',(select count(*) from public.cw_shared_assets),
  'assetRevisions',(select count(*) from public.cw_asset_revisions),
  'assetVariantHeads',(select count(*) from public.cw_asset_variant_heads),
  'releases',(select count(*) from public.cw_lecture_releases),
  'frozenSessions',(select count(*) from public.class_sessions where deleted_at is null and courseware_frozen_at is not null),
  'storageObjects',(select count(*) from storage.objects)
)`;

function inspectionSql(stage) {
  return String.raw`
begin transaction isolation level repeatable read read only;
with requested(version) as (values ${versionValues})
select jsonb_build_object(
  'stage','${stage}',
  'capturedAt',clock_timestamp(),
  'databaseFingerprint',public.r1_current_database_fingerprint(),
  'migrationHead',(select max(version) from public.schema_migrations),
  'migrationRows',(select count(*) from public.schema_migrations),
  'candidateMigrations',(select jsonb_agg(jsonb_build_object('version',requested.version,'checksum',ledger.checksum) order by requested.version) from requested left join public.schema_migrations ledger using(version)),
  'counts',${countsExpression},
  'futureTwoHourSessions',(select count(*) from public.class_sessions where deleted_at is null and scheduled_at between now() and now() + interval '2 hours'),
  'operationalErrors',(select jsonb_build_object('count',count(*),'latest',max(occurred_at)) from public.operational_errors),
  'activeOtherConnections',(select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state <> 'idle'),
  'constraintValidated',coalesce((select convalidated from pg_constraint where conrelid='public.cw_page_revisions'::regclass and conname='cw_page_revisions_doc_check'),false),
  'newFunctionsReady',jsonb_build_object(
    'rename',to_regprocedure('public.rename_cw_page(uuid,text)') is not null,
    'saveSource',to_regprocedure('public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)') is not null,
    'insertAsset',to_regprocedure('public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)') is not null
  ),
  'legacyPublishPresent',jsonb_build_object(
    'batch',to_regprocedure('public.publish_cw_adapt_releases(uuid[],text)') is not null,
    'track',to_regprocedure('public.publish_cw_track_release(uuid,text,text)') is not null
  )
);
rollback;
`;
}

function assertInspection(result, mode) {
  if (result.databaseFingerprint !== EXPECTED_FINGERPRINT) fail("production fingerprint drift");
  if (!result.constraintValidated) fail("cw_page_revisions constraint is not validated");
  const applied = result.candidateMigrations.filter((row) => row.checksum !== null);
  if (mode === "preflight") {
    if (result.migrationHead !== EXPECTED_HEAD) fail(`production migration head drift: ${result.migrationHead}`);
    if (applied.length !== 0) fail("candidate migrations are partially applied");
  } else {
    if (applied.length !== candidateVersions.length) fail("candidate ledger is incomplete");
    if (result.legacyPublishPresent.batch || result.legacyPublishPresent.track) fail("legacy publish RPC remains callable");
    if (!Object.values(result.newFunctionsReady).every(Boolean)) fail("candidate RPC set is incomplete");
  }
}

function migrationSql(migrations, rollback) {
  const bodies = migrations.map((migration) => `\n-- ${migration.name}\n${stripMigrationTransaction(migration.sql)}`).join("\n");
  const ledger = migrations.map(({ version, sha256 }) => String.raw`
do $$ begin
  if exists(select 1 from public.schema_migrations where version='${version}' and checksum<>'${sha256}') then
    raise exception 'MIGRATION_CHECKSUM_MISMATCH: ${version}';
  end if;
  insert into public.schema_migrations(version,checksum) values('${version}','${sha256}') on conflict(version) do nothing;
end $$;`).join("\n");
  return String.raw`
create temp table courseware_workspace_release_baseline(snapshot jsonb) on commit preserve rows;
insert into courseware_workspace_release_baseline values (${countsExpression});
begin isolation level serializable;
select pg_advisory_xact_lock(hashtextextended('mathin-courseware-workspace-release',0));
set local role supabase_admin;
do $$ begin
  if public.r1_current_database_fingerprint() <> '${EXPECTED_FINGERPRINT}' then raise exception 'PRODUCTION_FINGERPRINT_DRIFT'; end if;
  if (select max(version) from public.schema_migrations) is distinct from '${EXPECTED_HEAD}' then raise exception 'PRODUCTION_MIGRATION_HEAD_DRIFT'; end if;
  if exists(select 1 from public.schema_migrations where version in (${candidateVersions.map((value) => `'${value}'`).join(",")})) then raise exception 'COURSEWARE_CANDIDATE_ALREADY_APPLIED'; end if;
end $$;
${bodies}
${ledger}
do $$ declare before_counts jsonb; after_counts jsonb := ${countsExpression}; begin
  select snapshot into before_counts from courseware_workspace_release_baseline;
  if before_counts is distinct from after_counts then raise exception 'COURSEWARE_MIGRATION_CHANGED_BUSINESS_COUNTS'; end if;
  if to_regprocedure('public.rename_cw_page(uuid,text)') is null
     or to_regprocedure('public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)') is null
     or to_regprocedure('public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)') is null then
    raise exception 'COURSEWARE_CANDIDATE_FUNCTION_MISSING';
  end if;
  if to_regprocedure('public.publish_cw_adapt_releases(uuid[],text)') is not null
     or to_regprocedure('public.publish_cw_track_release(uuid,text,text)') is not null then
    raise exception 'COURSEWARE_LEGACY_PUBLISH_PRESENT';
  end if;
end $$;
${rollback ? "rollback;" : "commit;"}
with requested(version) as (values ${versionValues})
select jsonb_build_object(
  'mode','${rollback ? "rehearse" : "apply"}',
  'transactionFinished',true,
  'candidateRows',(select count(*) from public.schema_migrations where version in (select version from requested)),
  'migrationHead',(select max(version) from public.schema_migrations),
  'counts',${countsExpression},
  'legacyPublishPresent',to_regprocedure('public.publish_cw_adapt_releases(uuid[],text)') is not null or to_regprocedure('public.publish_cw_track_release(uuid,text,text)') is not null,
  'newFunctionsReady',to_regprocedure('public.rename_cw_page(uuid,text)') is not null and to_regprocedure('public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)') is not null and to_regprocedure('public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)') is not null
);
`;
}

function backup(options, migrations) {
  const commitShort = options.candidateCommit.slice(0, 12);
  const hashes = JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 })));
  const hashesB64 = Buffer.from(`${hashes}\n`, "utf8").toString("base64");
  const script = `set -Eeuo pipefail
backup_root=/mnt/openlist-disk/Backups/Mathin
container=${options.container}
commit=${options.candidateCommit}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name=mathin-db-prechange-$stamp-courseware-workspace-${commitShort}
tmp=$backup_root/.$name.partial
final=$backup_root/$name
case "$tmp" in "$backup_root"/.*.partial) ;; *) echo unsafe-backup-path >&2; exit 1 ;; esac
test -d "$backup_root"
exec 9>"$backup_root/.p4e-backup.lock"
flock -n 9 || { echo backup-lock-busy >&2; exit 1; }
test ! -e "$tmp" && test ! -e "$final"
mkdir -- "$tmp"
cleanup(){ case "$tmp" in "$backup_root"/.*.partial) rm -rf -- "$tmp" ;; esac; }
trap cleanup EXIT
docker exec "$container" pg_dump -U postgres -d postgres --format=custom --no-owner >"$tmp/database.dump"
docker exec "$container" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "begin transaction isolation level repeatable read read only; select ${countsExpression.replaceAll("\n", " ")}; rollback;" >"$tmp/database-counts.json"
docker exec -i "$container" pg_restore -l <"$tmp/database.dump" >"$tmp/database.toc"
printf '%s' '${hashesB64}' | base64 -d >"$tmp/migration-hashes.json"
printf 'candidate_commit=%s\\ndatabase_fingerprint=${EXPECTED_FINGERPRINT}\\ncreated_at=%s\\nscope=postgresql-only-courseware-workspace\\n' "$commit" "$stamp" >"$tmp/manifest.env"
(cd "$tmp" && sha256sum database.dump database-counts.json database.toc migration-hashes.json manifest.env >SHA256SUMS)
mv -- "$tmp" "$final"
trap - EXIT
dump_sha=$(sha256sum "$final/database.dump" | awk '{print $1}')
sums_sha=$(sha256sum "$final/SHA256SUMS" | awk '{print $1}')
dump_bytes=$(stat -c '%s' "$final/database.dump")
toc_lines=$(wc -l <"$final/database.toc")
printf 'BACKUP_PATH=%s\\nDUMP_SHA256=%s\\nSHA256SUMS_SHA256=%s\\nDUMP_BYTES=%s\\nTOC_LINES=%s\\n' "$final" "$dump_sha" "$sums_sha" "$dump_bytes" "$toc_lines"
`;
  const output = runRemoteScript(options, script);
  const result = Object.fromEntries(output.split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!result.BACKUP_PATH || !result.DUMP_SHA256) fail(`backup output invalid: ${output}`);
  return result;
}

function systemPreflight(options) {
  const script = `set -Eeuo pipefail
service_root=/home/swing/services/mathin
backup_root=/mnt/openlist-disk/Backups/Mathin
deploy_lock=free
backup_lock=free
exec 8>"$service_root/.deploy.lock"
flock -n 8 || deploy_lock=busy
exec 9>"$backup_root/.p4e-backup.lock"
flock -n 9 || backup_lock=busy
current=$(readlink -f "$service_root/current")
previous=$(readlink -f "$service_root/previous")
disk=$(df -P "$service_root" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
backup_disk=$(df -P "$backup_root" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
latest=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'mathin-*' -printf '%T@ %p\\n' | sort -nr | head -1 | cut -d' ' -f2-)
printf 'CURRENT=%s\\nPREVIOUS=%s\\nDEPLOY_LOCK=%s\\nBACKUP_LOCK=%s\\nSERVICE_DISK_PERCENT=%s\\nBACKUP_DISK_PERCENT=%s\\nLATEST_BACKUP=%s\\n' "$current" "$previous" "$deploy_lock" "$backup_lock" "$disk" "$backup_disk" "$latest"
`;
  return Object.fromEntries(runRemoteScript(options, script).split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)));
}

const options = parseOptions(process.argv.slice(2));
const migrations = loadCandidateMigrations(options.candidateRoot);
const migrationHashes = migrations.map(({ name, sha256 }) => ({ name, sha256 }));

if (options.mode === "preflight") {
  const database = runPsql(options, inspectionSql("preflight"));
  assertInspection(database, "preflight");
  const system = systemPreflight(options);
  if (system.DEPLOY_LOCK !== "free" || system.BACKUP_LOCK !== "free") fail("production lock is busy");
  if (Number(system.SERVICE_DISK_PERCENT) >= 75 || Number(system.BACKUP_DISK_PERCENT) >= 85) fail("production disk threshold exceeded");
  process.stdout.write(`${JSON.stringify({ ok: true, database, system, migrationHashes }, null, 2)}\n`);
} else if (options.mode === "backup") {
  if (process.env.MATHIN_PRODUCTION_WRITE_AUTHORIZED !== WRITE_CONFIRMATION) fail("production write confirmation missing");
  process.stdout.write(`${JSON.stringify({ ok: true, backup: backup(options, migrations), migrationHashes }, null, 2)}\n`);
} else if (options.mode === "rehearse") {
  if (process.env.MATHIN_PRODUCTION_WRITE_AUTHORIZED !== WRITE_CONFIRMATION) fail("production write confirmation missing");
  const result = runPsql(options, migrationSql(migrations, true));
  if (result.candidateRows !== 0 || result.migrationHead !== EXPECTED_HEAD || !result.legacyPublishPresent || result.newFunctionsReady) fail("rollback rehearsal left residue");
  process.stdout.write(`${JSON.stringify({ ok: true, result, migrationHashes }, null, 2)}\n`);
} else if (options.mode === "apply") {
  if (process.env.MATHIN_PRODUCTION_WRITE_AUTHORIZED !== WRITE_CONFIRMATION) fail("production write confirmation missing");
  const result = runPsql(options, migrationSql(migrations, false));
  if (result.candidateRows !== migrations.length || result.migrationHead !== migrations.at(-1).version || result.legacyPublishPresent || !result.newFunctionsReady) fail("formal migration postcondition failed");
  process.stdout.write(`${JSON.stringify({ ok: true, result, migrationHashes }, null, 2)}\n`);
} else {
  const database = runPsql(options, inspectionSql("postflight"));
  assertInspection(database, "postflight");
  for (const migration of migrations) {
    const row = database.candidateMigrations.find((candidate) => candidate.version === migration.version);
    if (row?.checksum !== migration.sha256) fail(`ledger checksum mismatch: ${migration.version}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, database, migrationHashes }, null, 2)}\n`);
}
