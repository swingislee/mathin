import { runAssertionFiles } from "./lib/db-audit-runner.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const configured = process.env.MATHIN_SQL_FILES?.trim().split(/\s+/).filter(Boolean) ?? [];
const files = [...args, ...configured];

if (args.includes("--help") || files.length === 0) {
  console.log("按实际权限或数据风险显式选择 SQL 文件；此命令没有默认批次。");
  console.log("用法：pnpm db:test -- supabase/tests/r1_account_security_assertions.sql");
  console.log("调用前识别隔离目标，设置 DATABASE_URL、MATHIN_WRITE_TARGET_ENVIRONMENT 与 MATHIN_WRITE_ALLOWED_DATABASE_TARGET。");
  console.log("目标规则见 docs/ops/data-operations.md；CI 可使用 MATHIN_SQL_FILES 传入文件。");
  process.exitCode = args.includes("--help") ? 0 : 2;
} else {
  try {
    process.exitCode = runAssertionFiles("db:test", files);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "SQL_CHECK:FAILED");
    process.exitCode = 2;
  }
}
