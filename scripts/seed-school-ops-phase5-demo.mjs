import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadFixedAccount } from "../e2e/support/fixed-accounts.ts";

// 仅接入已经核对过的本机隔离 Docker；默认回滚，--apply 才保存验收数据。
const expectedId = process.argv.find((arg) => arg.startsWith("--expected-system-id="))?.split("=")[1];
if (!/^\d+$/.test(expectedId ?? "")) throw new Error("Provide --expected-system-id from a fresh local preflight");
const envText = fs.readFileSync(".env.local", "utf8");
const origin = envText.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, "");
if (origin !== "http://127.0.0.1:35421") throw new Error("Expected the isolated local Supabase origin");
function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, shell: false });
  if (result.status !== 0) throw new Error(result.stderr || "Docker command failed");
  return result.stdout;
}
const context = JSON.parse(docker(["context", "inspect"]))[0];
if (context.Endpoints.docker.Host !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("Expected local Docker Desktop");
const containers = JSON.parse(docker(["inspect", "supabase-db", "supabase-envoy"]));
for (const container of containers) {
  if (container.Config.Labels["com.docker.compose.project"] !== "mathin-isolated") throw new Error("Unexpected Compose target");
  const composeDir = container.Config.Labels["com.docker.compose.project.working_dir"];
  if (path.resolve(composeDir) !== path.resolve(".tmp/mathin-supabase-selfhosted")) throw new Error("Unexpected Compose directory");
}
const ports = containers[1].NetworkSettings.Ports["8000/tcp"];
if (!ports?.some((port) => port.HostIp === "127.0.0.1" && port.HostPort === "35421")) throw new Error("Unexpected gateway listener");
const actors = ["principal", "teacher"].map((role) => {
  const account = loadFixedAccount(role);
  if (!account) throw new Error(`Fixed ${role} account unavailable`);
  return account.email;
});
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = [
  "begin; set local lock_timeout='5s'; set local statement_timeout='90s';",
  `select set_config('mathin.seed_expected_system_id',${literal(expectedId)},true);`,
  ...actors.map((email, index) => `select set_config('mathin.seed_${index === 0 ? "principal" : "teacher"}',coalesce((select id::text from auth.users where email=${literal(email)}),''),true);`),
  fs.readFileSync("supabase/fixtures/school_ops_phase5_demo.sql", "utf8"),
  process.argv.includes("--apply") ? "commit;" : "rollback;",
].join("\n");
const output = docker(["exec", "-i", "supabase-db", "psql", "-X", "-q", "-A", "-t", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], sql);
// 配置行含固定账号 ID，只输出最终的非敏感样例清单。
const summary = output.split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line)).findLast((item) => item.dataset === "P5-DEMO-20260905");
if (!summary) throw new Error("Missing seed summary");
const result = { ...summary, persisted: process.argv.includes("--apply") };
const dir = ".tmp/school-ops-phase5-demo";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/${result.persisted ? "manifest" : "dry-run"}.json`, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
