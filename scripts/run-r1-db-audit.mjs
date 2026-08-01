import { spawnSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for r1:db-audit");
  process.exit(2);
}

const files = [
  "r1_organization_settings_assertions.sql",
  "r1_platform_runtime_assertions.sql",
  "r1_account_security_assertions.sql",
  "r1_family_portal_assertions.sql",
  "r1_learning_results_assertions.sql",
  "r1_data_governance_assertions.sql",
  "r1_data_quality_assertions.sql",
  "r1_data_repair_assertions.sql",
  "r1_export_artifacts_assertions.sql",
  "doc26_teacher_workflow_assertions.sql",
  "r1_work_items_assertions.sql",
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
  if (result.status !== 0) process.exit(result.status ?? 1);
}
