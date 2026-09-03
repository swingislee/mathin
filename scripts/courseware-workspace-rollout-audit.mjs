import { spawnSync } from "node:child_process";
import os from "node:os";
import { buildCoursewareWorkspaceRolloutPlan } from "./lib/courseware-workspace-rollout.mjs";

const REQUIRED = [
  "20260902000900_courseware_source_runtime_drafts",
  "20260903000700_courseware_page_insertions",
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseOptions(argv) {
  const options = { localDocker: false, container: "supabase-db", compact: false, applicationCommit: "HEAD" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--local-docker") options.localDocker = true;
    else if (arg === "--compact") options.compact = true;
    else if (arg === "--container") options.container = argv[++index] ?? fail("--container requires a value");
    else if (arg === "--application-commit") options.applicationCommit = argv[++index] ?? fail("--application-commit requires a value");
    else fail(`unknown argument: ${arg}`);
  }
  if (!options.localDocker) fail("usage: pnpm cw:workspace-rollout:audit -- --local-docker [--container supabase-db] [--application-commit <git-ref>] [--compact]");
  if (!/^[A-Za-z0-9_.-]+$/.test(options.container)) fail("invalid Docker container name");
  return options;
}

const sql = String.raw`
begin transaction read only;
with page_base as (
  select page.id,
         coalesce(source.source_system,
           case page.doc_version
             when 'page-doc-v1' then 'mofaxiao_or_page_doc'
             when 'courseware-composition-v1' then 'mathin'
             else 'unregistered'
           end) as source_system,
         page.doc_version
  from public.cw_page_docs page
  left join lateral (
    select package.source_system
    from public.cw_source_lectures source_lecture
    join public.cw_source_packages package on package.id = source_lecture.source_package_id
    where source_lecture.lecture_id = page.lecture_id
    order by package.created_at
    limit 1
  ) source on true
  where page.deleted_at is null
), page_groups as (
  select source_system as "sourceSystem", doc_version as "docVersion", count(*)::integer as pages
  from page_base group by source_system, doc_version
), track_groups as (
  select base.source_system as "sourceSystem", head.track,
         coalesce(revision.doc_version, revision.doc ->> 'docVersion') as "docVersion",
         count(*)::integer as "trackHeads",
         count(*) filter (where head.draft_revision_id is not null)::integer as "draftHeads",
         count(*) filter (where head.current_revision_id is not null)::integer as "currentHeads",
         count(*) filter (
           where head.draft_revision_id is not null
             and head.draft_revision_id is distinct from head.current_revision_id
         )::integer as "divergedDraftHeads"
  from page_base base
  join public.cw_page_track_heads head on head.page_doc_id = base.id
  join public.cw_page_revisions revision on revision.id = coalesce(head.draft_revision_id, head.current_revision_id)
  group by base.source_system, head.track, coalesce(revision.doc_version, revision.doc ->> 'docVersion')
), binding_groups as (
  select track, kind, count(*)::integer as bindings
  from public.cw_page_asset_bindings group by track, kind
), release_groups as (
  select track, count(*)::integer as releases, count(distinct lecture_id)::integer as lectures,
         max(release_no)::integer as "maxReleaseNo"
  from public.cw_lecture_releases group by track
)
select jsonb_build_object(
  'migrationHead', (select max(version) from public.schema_migrations),
  'appliedRequiredMigrations', coalesce((
    select jsonb_agg(version order by version) from public.schema_migrations
    where version = any(array['${REQUIRED[0]}','${REQUIRED[1]}'])
  ), '[]'::jsonb),
  'functions', jsonb_build_object(
    'registerInsertedAsset', to_regprocedure('public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)') is not null,
    'sourceRuntimePatchGate', to_regprocedure('public.cw_source_runtime_inserted_node_is_valid(jsonb)') is not null
  ),
  'pageGroups', coalesce((select jsonb_agg(to_jsonb(row_value) order by "sourceSystem", "docVersion") from page_groups row_value), '[]'::jsonb),
  'trackGroups', coalesce((select jsonb_agg(to_jsonb(row_value) order by "sourceSystem", track, "docVersion") from track_groups row_value), '[]'::jsonb),
  'bindingGroups', coalesce((select jsonb_agg(to_jsonb(row_value) order by track, kind) from binding_groups row_value), '[]'::jsonb),
  'releaseGroups', coalesce((select jsonb_agg(to_jsonb(row_value) order by track) from release_groups row_value), '[]'::jsonb),
  'frozenSessionCount', (select count(*)::integer from public.class_sessions where courseware_frozen_at is not null and deleted_at is null)
);
rollback;
`;

function readSnapshot(container) {
  const executable = process.platform === "win32" ? "docker.exe" : "docker";
  const result = spawnSync(executable, [
    "exec", container, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql,
  ], { encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) fail(result.stderr || `psql failed with status ${result.status}`);
  const line = result.stdout.split(/\r?\n/).find((value) => value.trim().startsWith("{"));
  if (!line) fail("database snapshot did not return JSON");
  return JSON.parse(line);
}

function resolveGitCommit(reference) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${reference}^{commit}`], { encoding: "utf8", shell: false });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(result.stdout.trim())) fail(`invalid application commit: ${reference}`);
  return result.stdout.trim();
}

const options = parseOptions(process.argv.slice(2));
const plan = buildCoursewareWorkspaceRolloutPlan(readSnapshot(options.container), {
  environment: "local",
  executionHost: os.hostname(),
  databaseTarget: `docker:${options.container}`,
  applicationCommit: resolveGitCommit(options.applicationCommit),
  generatedAt: new Date().toISOString(),
});
process.stdout.write(`${JSON.stringify(plan, null, options.compact ? 0 : 2)}\n`);
