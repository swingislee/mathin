import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS,
  buildLocalRehearsalSql,
  loadCandidateMigrations,
} from "./lib/courseware-workspace-candidate.mjs";

const SSH_TARGET = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/;
const CONTAINER = /^[A-Za-z0-9_.-]+$/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseOptions(argv) {
  const options = { mode: null, sshTarget: null, output: null, container: "supabase-db", compact: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--local-rehearsal") options.mode = "local-rehearsal";
    else if (argument === "--production-schema-snapshot") {
      options.mode = "production-schema-snapshot";
      options.output = argv[++index] ?? fail("--production-schema-snapshot requires a file path");
    } else if (argument === "--ssh-target") options.sshTarget = argv[++index] ?? fail("--ssh-target requires a value");
    else if (argument === "--container") options.container = argv[++index] ?? fail("--container requires a value");
    else if (argument === "--compact") options.compact = true;
    else fail(`unknown argument: ${argument}`);
  }
  if (!CONTAINER.test(options.container)) fail("invalid Docker container name");
  if (options.mode === "production-schema-snapshot") {
    if (!options.sshTarget || !SSH_TARGET.test(options.sshTarget) || options.sshTarget.startsWith("-")) fail("a valid --ssh-target is required");
    if (!path.isAbsolute(options.output) || path.extname(options.output).toLowerCase() !== ".json") fail("snapshot output must be an absolute .json path");
    if (existsSync(options.output)) fail("snapshot output already exists");
  } else if (options.mode !== "local-rehearsal") {
    fail("use --local-rehearsal or --production-schema-snapshot <absolute-json-path>");
  }
  return options;
}

function runPsql({ container, sshTarget, sql }) {
  const executable = sshTarget
    ? (process.platform === "win32" ? "ssh.exe" : "ssh")
    : (process.platform === "win32" ? "docker.exe" : "docker");
  const remoteCommand = `docker exec -i ${container} psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1`;
  const args = sshTarget
    ? ["-o", "BatchMode=yes", sshTarget, remoteCommand]
    : ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
  const result = spawnSync(executable, args, { input: sql, encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) fail(result.stderr || `psql failed with status ${result.status}`);
  const text = result.stdout.trim();
  try { return JSON.parse(text); } catch { fail("psql did not return a single JSON value"); }
}

function buildProductionSnapshotSql() {
  const versions = COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS.map((name) => name.replace(/\.sql$/, ""));
  const signatures = [
    "public.assert_cw_page_capability(uuid,text)",
    "public.resolve_cw_lecture_capability_for(uuid,uuid,text,timestamptz)",
    "public.rename_cw_page(uuid,text)",
    "public.save_cw_track_page_draft(uuid,text,jsonb,integer,text)",
    "public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)",
    "public.cw_source_runtime_page_doc_is_valid(jsonb)",
    "public.cw_source_runtime_payload_patch_is_valid(jsonb,jsonb)",
    "public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)",
    "public.cw_source_runtime_mathin_editor_is_valid(jsonb)",
    "public.cw_source_runtime_inserted_node_is_valid(jsonb)",
    "public.publish_cw_adapt_releases(uuid[],text)",
    "public.publish_cw_adapt_releases_pre_sml0_impl(uuid[],text)",
    "public.publish_cw_track_release(uuid,text,text)",
    "public.publish_cw_track_release_pre_sml0_impl(uuid,text,text)",
    "public.publish_cw_review_cycle(uuid,text,text)",
  ];
  const signatureValues = signatures.map((value) => `('${value.replaceAll("'", "''")}')`).join(",");
  const versionValues = versions.map((value) => `('${value}')`).join(",");
  return String.raw`
begin transaction isolation level repeatable read read only;
with requested_signatures(signature) as (values ${signatureValues}),
function_rows as (
  select requested.signature requested_signature,
         proc.oid::regprocedure::text actual_signature,
         pg_get_functiondef(proc.oid) definition,
         pg_get_userbyid(proc.proowner) owner,
         proc.prosecdef security_definer,
         proc.proconfig config,
         proc.proacl acl,
         obj_description(proc.oid, 'pg_proc') comment
  from requested_signatures requested
  left join pg_proc proc on proc.oid = to_regprocedure(requested.signature)
), requested_versions(version) as (values ${versionValues})
select jsonb_build_object(
  'schemaVersion', 'mathin-courseware-workspace-schema-snapshot-v1',
  'capturedAt', clock_timestamp(),
  'executionHost', '${os.hostname().replaceAll("'", "''")}',
  'databaseFingerprint', public.r1_current_database_fingerprint(),
  'migrationHead', (select max(version) from public.schema_migrations),
  'candidateMigrations', (select jsonb_agg(jsonb_build_object(
    'version', requested.version,
    'applied', ledger.version is not null,
    'checksum', ledger.checksum
  ) order by requested.version) from requested_versions requested left join public.schema_migrations ledger using(version)),
  'functions', (select jsonb_agg(to_jsonb(function_row) order by requested_signature) from function_rows function_row),
  'pageRevisionConstraint', (select jsonb_build_object(
    'name', conname,
    'definition', pg_get_constraintdef(oid, true),
    'validated', convalidated
  ) from pg_constraint where conrelid = 'public.cw_page_revisions'::regclass and conname = 'cw_page_revisions_doc_check'),
  'aggregateCounts', jsonb_build_object(
    'pageDocs', (select count(*) from public.cw_page_docs),
    'pageRevisions', (select count(*) from public.cw_page_revisions),
    'assetBindings', (select count(*) from public.cw_page_asset_bindings),
    'assetObjects', (select count(*) from public.cw_asset_objects),
    'sharedAssets', (select count(*) from public.cw_shared_assets),
    'releases', (select count(*) from public.cw_lecture_releases)
  )
);
rollback;
`;
}

const options = parseOptions(process.argv.slice(2));
const migrations = loadCandidateMigrations(process.cwd());
if (options.mode === "local-rehearsal") {
  const result = runPsql({ container: options.container, sql: buildLocalRehearsalSql(migrations) });
  process.stdout.write(`${JSON.stringify({
    ...result,
    migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
  }, null, options.compact ? 0 : 2)}\n`);
} else {
  const result = runPsql({ container: options.container, sshTarget: options.sshTarget, sql: buildProductionSnapshotSql() });
  const body = `${JSON.stringify(result, null, 2)}\n`;
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, body, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: result.schemaVersion,
    output: options.output,
    sha256: createHash("sha256").update(body).digest("hex"),
    databaseFingerprint: result.databaseFingerprint,
    migrationHead: result.migrationHead,
    candidateMigrationCount: result.candidateMigrations.length,
    capturedFunctionCount: result.functions.filter((entry) => entry.actual_signature !== null).length,
  }, null, options.compact ? 0 : 2)}\n`);
}
