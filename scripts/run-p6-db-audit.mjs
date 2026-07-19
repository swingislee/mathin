import { spawnSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for p6:db-audit");
  process.exit(2);
}

const files = [
  "p6_courseware_security_assertions.sql",
  "p6_courseware_studio_assertions.sql",
  "p6_courseware_replacement_assertions.sql",
  "p6_courseware_tracks_assertions.sql",
].map((name) => path.join(process.cwd(), "supabase", "tests", name));

for (const file of files) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`Unable to run psql: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
