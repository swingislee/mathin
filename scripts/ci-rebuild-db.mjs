import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertNonProductionWriteTarget } from "./lib/r1-write-target-policy.mjs";
import { sanitizedPostgresEnvironment } from "./lib/postgres-process-env.mjs";

/** 在明确要求的隔离空库中重建：平台垫片 → 全部 migration（文件名序）→ 断言夹具。
 *  手动调用并按 docs/ops/data-operations.md 核对目标与破坏性操作范围。 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for ci:db-rebuild");
  process.exit(2);
}
if (process.env.CI_ALLOW_DB_REBUILD !== "1") {
  console.error("ci:db-rebuild refuses to run without CI_ALLOW_DB_REBUILD=1 (it is destructive; never point it at a real database)");
  process.exit(2);
}
try {
  assertNonProductionWriteTarget({
    operation: "ci:db-rebuild",
    databaseUrl,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const root = process.cwd();
const ciDir = path.join(root, "supabase", "ci");
const migrationDir = path.join(root, "supabase", "migrations");
const preFamilySeed = path.join(root, "supabase", "seed", "courses.pre-family.seed.sql");
const versionedCourseSeed = path.join(root, "supabase", "seed", "courses.seed.sql");
const childEnvironment = sanitizedPostgresEnvironment(process.env);

const run = (args, label) => {
  const result = spawnSync("psql", [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    env: childEnvironment,
    stdio: ["inherit", "inherit", "inherit"],
    shell: false,
    windowsHide: true,
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

const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
const familyMigration = "20260720000300_p4h_course_families.sql";
const familyMigrationIndex = migrations.indexOf(familyMigration);
const catalogVersionMigration = "20260803000300_p6_course_catalog_versions.sql";
const catalogVersionMigrationIndex = migrations.indexOf(catalogVersionMigration);
if (familyMigrationIndex < 0) {
  console.error(`${familyMigration} is required for the CI replay order`);
  process.exit(2);
}
if (catalogVersionMigrationIndex <= familyMigrationIndex) {
  console.error(`${catalogVersionMigration} must follow ${familyMigration} in the CI replay order`);
  process.exit(2);
}
if (!fs.existsSync(preFamilySeed) || !fs.existsSync(versionedCourseSeed)) {
  console.error("Both pre-family and versioned course seeds are required for the CI replay");
  process.exit(2);
}

const files = [
  path.join(ciDir, "00_platform_bootstrap.sql"),
  ...migrations.slice(0, familyMigrationIndex).map((name) => path.join(migrationDir, name)),
  preFamilySeed,
  ...migrations.slice(familyMigrationIndex, catalogVersionMigrationIndex + 1).map((name) => path.join(migrationDir, name)),
  versionedCourseSeed,
  ...migrations.slice(catalogVersionMigrationIndex + 1).map((name) => path.join(migrationDir, name)),
  path.join(ciDir, "10_fixtures.sql"),
];

for (const file of files) {
  const label = path.relative(root, file);
  console.log(`-- ${label}`);
  run(["-f", file], label);
}

console.log(`Database rebuilt from scratch (${files.length} files)`);
