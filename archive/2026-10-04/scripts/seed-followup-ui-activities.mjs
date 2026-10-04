import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadFixedAccount } from "../e2e/support/fixed-accounts.ts";
import { assertNonProductionWriteTarget } from "./lib/r1-write-target-policy.mjs";

// 人工 UI 验收专用。默认 dry-run，使用 --apply 显式保留新增活动。
// Node 22.16 使用 node --experimental-strip-types 加载仓库固定账号工具。
const apply = process.argv.includes("--apply");
const expectedId = process.argv.find((arg) => arg.startsWith("--expected-system-id="))?.split("=")[1];
if (process.platform !== "win32" || !/^\d+$/.test(expectedId ?? "")) throw new Error("A Windows-local database preflight and --expected-system-id are required");
if (process.env.SUPABASE_DB_SSH || process.env.SUPABASE_META_SSH || process.env.DOCKER_HOST) throw new Error("Use the verified local Docker Desktop context without remote overrides");
const origin = fs.readFileSync(".env.local", "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, "");
if (origin !== "http://127.0.0.1:35421") throw new Error("Expected the isolated local Supabase origin");
assertNonProductionWriteTarget({ operation: "followup-ui-activities", supabaseUrl: origin, environment: process.env });
function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", shell: false, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Docker operation failed");
  return result.stdout;
}
const context = JSON.parse(docker(["context", "inspect"]))[0];
if (context.Endpoints.docker.Host !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("Expected local Docker Desktop");
const containers = JSON.parse(docker(["inspect", "supabase-db", "supabase-envoy"]));
for (const container of containers) {
  const labels = container.Config.Labels;
  if (labels["com.docker.compose.project"] !== "mathin-isolated"
      || path.resolve(labels["com.docker.compose.project.working_dir"]) !== path.resolve(".tmp/mathin-supabase-selfhosted")) throw new Error("Unexpected Compose target");
}
if (!containers[1].NetworkSettings.Ports["8000/tcp"]?.some((port) => port.HostIp === "127.0.0.1" && port.HostPort === "35421")) throw new Error("Unexpected local gateway binding");
const actor = loadFixedAccount("principal");
if (!actor) throw new Error("Fixed principal account unavailable");
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = [
  "begin; set local lock_timeout='5s'; set local statement_timeout='60s'; set local timezone='Asia/Shanghai';",
  `select set_config('mathin.seed_expected_system_id',${literal(expectedId)},true);`,
  `select set_config('request.jwt.claim.sub',coalesce((select id::text from auth.users where email=${literal(actor.email)}),''),true);`,
  fs.readFileSync("supabase/fixtures/followup_ui_activities.sql", "utf8"),
  apply ? "commit;" : "rollback;",
].join("\n");
const output = docker(["exec", "-i", "supabase-db", "psql", "-X", "-q", "-A", "-t", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], sql);
// 固定身份仅用于授权；日志和验收 manifest 只含本批虚构活动。
const summary = output.split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line)).findLast((item) => item.dataset === "FOLLOWUP-UI-20260906");
if (!summary) throw new Error("Missing activity fixture summary");
const result = { ...summary, persisted: apply };
const directory = ".tmp/followup-ui-activities";
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(`${directory}/${apply ? "manifest" : "dry-run"}.json`, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ dataset: result.dataset, persisted: result.persisted, count: result.activities.length,
  start: result.activities[0]?.scheduledAt, end: result.activities.at(-1)?.scheduledAt, manifest: `${directory}/${apply ? "manifest" : "dry-run"}.json` }, null, 2));
