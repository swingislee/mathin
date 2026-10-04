import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const browser = args.includes("--browser");
const selected = args.filter((arg) => arg !== "--browser");
const list = JSON.parse(fs.readFileSync(path.join(root, "tests/safety-cases.json"), "utf8"));
const configured = process.env.MATHIN_RISK_FILES?.trim().split(/\s+/).filter(Boolean) ?? [];
const files = [...selected, ...configured];

if (files.includes("--help") || files.length === 0) {
  console.log("按明确任务或重大安全、生产风险选择文件；此命令没有默认回归套件。");
  console.log(browser ? "用法：pnpm e2e -- e2e/auth-boundaries.spec.ts" : "用法：pnpm test -- tests/auth-safe-redirect.test.ts");
  console.log("现有安全用例：\n" + (browser ? ["e2e/auth-boundaries.spec.ts"] : list.files).join("\n"));
  process.exit(files.includes("--help") ? 0 : 2);
}

const directory = browser ? "e2e/" : "tests/";
const suffix = browser ? ".spec.ts" : ".test.ts";
for (const file of files) {
  if (!file.startsWith(directory) || !file.endsWith(suffix) || file.includes("..") || file.includes("\\")
      || !fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) {
    console.error("请选择当前仓库中明确存在的用例文件。");
    process.exit(2);
  }
}
const packageName = browser ? "@playwright/test" : "vitest";
const cli = path.join(path.dirname(require.resolve(packageName + "/package.json")), browser ? "cli.js" : "vitest.mjs");
const result = spawnSync(process.execPath, [cli, browser ? "test" : "run", ...files], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});
if (result.error) console.error("验证进程无法启动：" + result.error.message);
process.exitCode = result.status ?? 1;
