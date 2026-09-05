// node --experimental-strip-types scripts/seed-roster-acceptance.mjs [--apply]
// 本机隔离开发库；默认回滚，复跑保留用户已操作的样例。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { loadFixedAccount } from "../e2e/support/fixed-accounts.ts";

const expectedId = "7673999900474441767";
const env = fs.readFileSync(".env.local", "utf8");
if (os.hostname().toLowerCase() !== "whitehouse" || !/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:35421\s*$/m.test(env)) throw new Error("Expected local host and Supabase origin");
function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", shell: false, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "Local Docker command failed");
  return result.stdout;
}
const context = JSON.parse(docker(["context", "inspect"]))[0];
if (context.Endpoints.docker.Host !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("Expected local Docker Desktop");
const containers = JSON.parse(docker(["inspect", "supabase-db", "supabase-envoy"]));
for (const container of containers) {
  if (container.Config.Labels["com.docker.compose.project"] !== "mathin-isolated" || path.resolve(container.Config.Labels["com.docker.compose.project.working_dir"]) !== path.resolve(".tmp/mathin-supabase-selfhosted")) throw new Error("Unexpected Compose target");
}
if (!containers[1].NetworkSettings.Ports["8000/tcp"]?.some((port) => port.HostIp === "127.0.0.1" && port.HostPort === "35421")) throw new Error("Unexpected Supabase listener");
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const actors = ["principal", "teacher"].map((role) => {
  const account = loadFixedAccount(role); if (!account) throw new Error(`Fixed ${role} account unavailable`); return account.email;
});
const sql = ["begin; set local lock_timeout='5s'; set local statement_timeout='90s'; set local timezone='Asia/Shanghai';",
  `select set_config('mathin.seed_expected_system_id',${literal(expectedId)},true);`,
  ...actors.map((email, index) => `select set_config('mathin.seed_${index === 0 ? "principal" : "teacher"}',coalesce((select id::text from auth.users where email=${literal(email)}),''),true);`),
  fs.readFileSync("supabase/fixtures/roster_acceptance.sql", "utf8"), process.argv.includes("--apply") ? "commit;" : "rollback;"].join("\n");
const output = docker(["exec", "-i", "supabase-db", "psql", "-X", "-q", "-A", "-t", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], sql);
const summary = output.split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line)).findLast((row) => row.dataset === "ROSTER-ACCEPTANCE-20260905");
if (!summary) throw new Error("Missing seed summary");
const result = { ...summary, persisted: process.argv.includes("--apply") };
const folder = ".tmp/roster-acceptance"; fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(`${folder}/${result.persisted ? "manifest" : "dry-run"}.json`, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result));
