#!/usr/bin/env node

/**
 * 本地复现 CI 的 checks job：门禁清单直接从 .github/workflows/ci.yml 解析，
 * 不在此处另抄一份，避免本地与 CI 的门禁集合漂移。
 * 与 CI 一致地跑完全部门禁再汇总失败——fail-fast 会让第一个失败掩盖其余问题。
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

// 只取 checks job（到下一个同级 job 为止）：database job 需要 DATABASE_URL 与一次性库，不在本地跑。
const checksJob = workflow.match(/^ {2}checks:\n(?: {4}.*\n|\n)*/m)?.[0];
if (!checksJob) {
  console.error("无法在 ci.yml 中定位 checks job");
  process.exit(1);
}

const commands = [...checksJob.matchAll(/^ +(?:- )?run: (pnpm .+)$/gm)]
  .map((match) => match[1].trim())
  .filter((command) => !command.startsWith("pnpm install"));

if (commands.length === 0) {
  console.error("ci.yml 的 checks job 未解析到任何 pnpm 门禁命令");
  process.exit(1);
}

const failed = [];
for (const [index, command] of commands.entries()) {
  console.log(`\n=== [${index + 1}/${commands.length}] ${command} ===`);
  const result = spawnSync(command, { cwd: ROOT, shell: true, stdio: "inherit" });
  if (result.status !== 0) failed.push(command);
}

console.log(`\n=== CI checks 汇总：${commands.length - failed.length}/${commands.length} 通过 ===`);
if (failed.length > 0) {
  for (const command of failed) console.error(`- 失败：${command}`);
  process.exit(1);
}
