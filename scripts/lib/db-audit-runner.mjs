import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNonProductionWriteTarget } from "./r1-write-target-policy.mjs";
import { sanitizedPostgresEnvironment } from "./postgres-process-env.mjs";

const assertionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/tests");

// SQL 断言包含造数；即使最后 rollback，也必须先识别隔离目标。
// environment / execute 可注入，使目标拒绝与执行范围能在不连接数据库时验证。
export function runAssertionFiles(label, fileNames, { environment = process.env, execute = spawnSync } = {}) {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    throw new Error("SQL_CHECK:FILES_REQUIRED: select explicit files from supabase/tests");
  }
  const files = [...new Set(fileNames)].map((name) => {
    if (typeof name !== "string" || !/^(?:supabase\/tests\/)?[a-zA-Z0-9_-]+\.sql$/.test(name)) {
      throw new Error("SQL_CHECK:INVALID_FILE: select explicit SQL files without traversal, globs or options");
    }
    const file = path.join(assertionRoot, path.basename(name));
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()
      || path.dirname(fs.realpathSync(file)) !== fs.realpathSync(assertionRoot)) {
      throw new Error("SQL_CHECK:INVALID_FILE: the selected SQL file must exist inside supabase/tests");
    }
    return file;
  });
  const databaseUrl = environment.DATABASE_URL;
  assertNonProductionWriteTarget({
    operation: label,
    databaseUrl,
    sshHost: environment.SUPABASE_DB_SSH,
    environment,
  });
  const childEnvironment = sanitizedPostgresEnvironment(environment);
  // 当前目标策略只接受明确声明的 loopback 数据库，SSH 远端尚未登记。
  for (const file of new Set(files)) {
    const result = execute("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file], {
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    if (result.error) {
      throw new Error("SQL_CHECK:START_FAILED: unable to start psql");
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}
