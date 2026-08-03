import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 断言文件的两种执行通道：
 *  - `DATABASE_URL`：CI 的一次性库，本机 psql 直接 `-f` 读文件。
 *  - `SUPABASE_DB_SSH`：开发机没有本机 psql，把文件从 stdin 透传给宿主机容器里的 psql
 *    （与 db:types 的 `SUPABASE_META_SSH` 同构）。psql 的非零退出码经 ssh 原样返回，
 *    失败不会被吞掉。
 *  断言文件自带 begin/rollback，两种通道都不留写入。 */
const CONTAINER = "supabase-db";

export function runAssertionFiles(label, fileNames) {
  const databaseUrl = process.env.DATABASE_URL;
  const dbSsh = process.env.SUPABASE_DB_SSH;
  if (!databaseUrl && !dbSsh) {
    console.error(`DATABASE_URL or SUPABASE_DB_SSH is required for ${label}`);
    process.exit(2);
  }
  for (const name of fileNames) {
    const file = path.join(process.cwd(), "supabase", "tests", name);
    const result = dbSsh
      ? spawnSync(
          process.platform === "win32" ? "ssh.exe" : "ssh",
          [dbSsh, `docker exec -i ${CONTAINER} psql -U postgres -d postgres -X -v ON_ERROR_STOP=1`],
          { input: fs.readFileSync(file), stdio: ["pipe", "inherit", "inherit"], shell: false },
        )
      : spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file], {
          stdio: "inherit",
          shell: process.platform === "win32",
        });
    if (result.error) {
      console.error(`Unable to run ${dbSsh ? "ssh" : "psql"}: ${result.error.message}`);
      process.exit(2);
    }
    if (result.status !== 0) {
      console.error(`Assertion file failed: ${name} (status=${result.status})`);
      process.exit(result.status ?? 1);
    }
  }
}
