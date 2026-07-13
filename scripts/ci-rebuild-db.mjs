import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 在一次性 CI 容器里从零重建整个库：平台垫片 → 全部 migration（文件名序）→ 断言夹具。
 *  顺带每次 CI 都验证「从零重建库」这条路径没断（docs/plan/15-§5）。 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for ci:db-rebuild");
  process.exit(2);
}
if (!process.env.CI_ALLOW_DB_REBUILD) {
  console.error("ci:db-rebuild refuses to run without CI_ALLOW_DB_REBUILD=1 (it is destructive; never point it at a real database)");
  process.exit(2);
}

const root = process.cwd();
const ciDir = path.join(root, "supabase", "ci");
const migrationDir = path.join(root, "supabase", "migrations");

const run = (args, label) => {
  const result = spawnSync("psql", [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`Unable to run psql: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) {
    console.error(`FAILED: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const files = [
  path.join(ciDir, "00_platform_bootstrap.sql"),
  ...fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort().map((name) => path.join(migrationDir, name)),
  path.join(ciDir, "10_fixtures.sql"),
];

for (const file of files) {
  const label = path.relative(root, file);
  console.log(`-- ${label}`);
  run(["-f", file], label);
}

console.log(`Database rebuilt from scratch (${files.length} files)`);
