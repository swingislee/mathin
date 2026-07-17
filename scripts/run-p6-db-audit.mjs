import { spawnSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for p6:db-audit");
  process.exit(2);
}

const file = path.join(process.cwd(), "supabase", "tests", "p6_courseware_security_assertions.sql");
const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) {
  console.error(`Unable to run psql: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
