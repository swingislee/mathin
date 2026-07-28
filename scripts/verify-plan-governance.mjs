#!/usr/bin/env node

/**
 * Prevent planning drift: every numbered plan has an explicit lifecycle state,
 * doc 04 owns the sole current stage, and the active truth sources stay linked.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLAN_DIR = path.join(ROOT, "docs", "plan");
const failures = [];
const fail = (message) => failures.push(message);

const expectedStatuses = new Map([
  ["00", "active"],
  ["01", "reference"],
  ["02", "reference"],
  ["03", "reference"],
  ["04", "active"],
  ["05", "reference"],
  ["06", "partial"],
  ["07", "complete"],
  ["08", "complete"],
  ["09", "partial"],
  ["10", "complete"],
  ["11", "complete"],
  ["12", "complete"],
  ["13", "complete"],
  ["14", "partial"],
  ["15", "partial"],
  ["16", "partial"],
  ["17", "partial"],
  ["18", "complete"],
  ["19", "complete"],
  ["20", "complete"],
  ["21", "complete"],
  ["22", "complete"],
  ["23", "complete"],
  ["24", "complete"],
  ["25", "active"],
]);

const planFiles = readdirSync(PLAN_DIR)
  .filter((name) => /^\d{2}-.*\.md$/.test(name))
  .sort();

const byNumber = new Map();
for (const name of planFiles) {
  const number = name.slice(0, 2);
  if (byNumber.has(number)) fail(`doc ${number} 有多个文件：${byNumber.get(number)}、${name}`);
  byNumber.set(number, name);
}

for (const [number, expectedStatus] of expectedStatuses) {
  const name = byNumber.get(number);
  if (!name) {
    fail(`缺少 docs/plan/${number}-*.md`);
    continue;
  }

  const source = readFileSync(path.join(PLAN_DIR, name), "utf8");
  const header = source.split(/\r?\n/).slice(0, 12).join("\n");
  const match = header.match(/^> \*\*规划状态\*\*：`(active|reference|complete|partial|deferred|superseded)`/m);
  if (!match) {
    fail(`${name} 前 12 行缺少合法的“规划状态”头`);
  } else if (match[1] !== expectedStatus) {
    fail(`${name} 状态为 ${match[1]}，预期 ${expectedStatus}`);
  }
}

for (let number = 0; number <= 25; number += 1) {
  const key = String(number).padStart(2, "0");
  if (!byNumber.has(key)) fail(`00～25 序列缺少 ${key}`);
}
if (planFiles.length !== 26) fail(`编号规划文件应恰为 26 个，当前 ${planFiles.length} 个`);

const sources = new Map(
  planFiles.map((name) => [name, readFileSync(path.join(PLAN_DIR, name), "utf8")]),
);
const stageOwners = [];
for (const [name, source] of sources) {
  if (/^> \*\*当前施工阶段\*\*：/m.test(source)) stageOwners.push(name);
}
if (stageOwners.length !== 1 || stageOwners[0] !== byNumber.get("04")) {
  fail(`“当前施工阶段”必须只出现在 doc 04，当前：${stageOwners.join(", ") || "无"}`);
}

const overview = sources.get(byNumber.get("00")) ?? "";
for (const name of planFiles) {
  if (!overview.includes(`\`${name}\``)) fail(`00-overview.md 索引缺少 ${name}`);
}

const roadmap = sources.get(byNumber.get("04")) ?? "";
const currentStage = roadmap.match(/^> \*\*当前施工阶段\*\*：`([^`]+)`/m)?.[1];
if (!currentStage) fail("04-roadmap.md 无法解析当前施工阶段值");
for (let stage = 0; stage <= 18; stage += 1) {
  if (!roadmap.includes(`R1-${stage}`)) fail(`04-roadmap.md 缺少 R1-${stage}`);
}

const production = sources.get(byNumber.get("25")) ?? "";
const requiredProductTerms = [
  "Story",
  "Games",
  "Minds",
  "Terms",
  "Tools",
  "Notebook",
  "865",
  "1730",
  "release_no=1",
  "唯一生产管理员",
  "work_items",
  "证据等级",
  "量化发布门",
  "104 份视觉",
];
for (const term of requiredProductTerms) {
  if (!production.includes(term)) fail(`doc 25 缺少关键发布契约：${term}`);
}

const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
for (const [name, source] of [
  ["AGENTS.md", agents],
  ["README.md", readme],
]) {
  for (const number of ["00", "04", "25"]) {
    if (!source.includes(`docs/plan/${byNumber.get(number)}`)) {
      fail(`${name} 缺少 doc ${number} 的规划入口`);
    }
  }
  if (!source.includes("唯一") || !source.includes("release_no=1")) {
    fail(`${name} 缺少正式生产唯一管理员/release-1 安全提示`);
  }
  for (const term of ["Story", "Games", "Minds", "Terms", "Tools", "Notebook", "zh/en"]) {
    if (!source.includes(term)) fail(`${name} 缺少 1.0 产品/双语契约：${term}`);
  }
}
if (!agents.includes("pnpm plan:audit")) fail("AGENTS.md 缺少 plan:audit 关闭纪律");
if (currentStage && !readme.includes(currentStage)) {
  fail(`README.md 当前阶段未与 doc 04 同步：${currentStage}`);
}

for (const [name, source] of [
  ["00-overview.md", overview],
  ["01-design-system.md", sources.get(byNumber.get("01")) ?? ""],
  ["04-roadmap.md", roadmap],
  ["05-planet-themes.md", sources.get(byNumber.get("05")) ?? ""],
  ["25-production-1.0-product-completeness.md", production],
  ["AGENTS.md", agents],
  ["README.md", readme],
]) {
  if (!source.includes("小王子")) fail(`${name} 缺少全站小王子视觉合同`);
}

if (failures.length > 0) {
  console.error("规划治理审计失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("规划治理审计通过：00～25 状态、唯一阶段、索引与 1.0 契约一致。");
