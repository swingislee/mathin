#!/usr/bin/env node

/**
 * Prevent planning drift: every numbered plan has an explicit lifecycle state,
 * doc 04 owns the sole current stage, and the active truth sources stay linked.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { textFileSha256 } from "./lib/text-hash.mjs";

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
  ["26", "partial"],
  ["27", "active"],
  ["28", "deferred"],
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

for (let number = 0; number <= 28; number += 1) {
  const key = String(number).padStart(2, "0");
  if (!byNumber.has(key)) fail(`00～28 序列缺少 ${key}`);
}
if (planFiles.length !== 29) fail(`编号规划文件应恰为 29 个，当前 ${planFiles.length} 个`);

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
  "90",
  "1135",
  "52",
  "1187",
  "2374",
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
if (!production.includes("`swingislee`") || !production.includes("实际人员/账号")) {
  fail("doc 25 缺少 R1 实际责任人映射");
}
if (production.includes("pending location") || production.includes("最终位置在 R1-0 确定")) {
  fail("doc 25 的 R1 证据位置仍未冻结");
}

const productionBaselineFiles = [
  "schemas/r1-production-baseline-manifest.schema.json",
  "docs/manifests/r1-production-baseline.example.json",
  "scripts/plan-r1-production-baseline.mjs",
  "tests/r1-production-baseline.test.ts",
];
for (const relativePath of productionBaselineFiles) {
  if (!existsSync(path.join(ROOT, relativePath))) fail(`缺少 R1-15 只读生产基线合同：${relativePath}`);
}
const productionBaselineSchemaPath = path.join(ROOT, productionBaselineFiles[0]);
if (existsSync(productionBaselineSchemaPath)) {
  const schema = JSON.parse(readFileSync(productionBaselineSchemaPath, "utf8"));
  const properties = schema?.properties ?? {};
  const counts = properties.expected?.properties ?? {};
  if (properties.mode?.const !== "plan-only" || properties.writesAllowed?.const !== false) {
    fail("R1-15 生产基线 manifest 必须保持 plan-only 且 writesAllowed=false");
  }
  if (properties.target?.properties?.environment?.const !== "isolated-production-snapshot") {
    fail("R1-15 生产基线 manifest 只能接受 isolated-production-snapshot 目标");
  }
  for (const [name, expected] of Object.entries({
    courseCount: 94,
    lectureCount: 1187,
    nativeHeadCount: 1187,
    adaptedHeadCount: 1187,
    releaseCount: 2374,
    legacyCurrentReleaseCount: 1187,
    releaseNoGreaterThanOneCount: 0,
  })) {
    if (counts[name]?.const !== expected) fail(`R1-15 生产基线 schema 的 ${name} 应为 ${expected}`);
  }
}

const EVIDENCE_DIR = path.join(ROOT, "docs", "evidence", "r1");
const evidenceIndexPath = path.join(EVIDENCE_DIR, "README.md");
if (!existsSync(evidenceIndexPath)) fail("缺少 R1 证据索引：docs/evidence/r1/README.md");

// 阶段推进到 R1-N 即代表 R1-0～R1-(N-1) 已关闭，其证据不得缺失或被删除。
// 由 doc 04 推导而非在此硬编码：关闭新阶段时无需再改本脚本。
const currentStageNumber = Number(currentStage?.match(/^R1-(\d+)\b/)?.[1] ?? NaN);
if (!Number.isInteger(currentStageNumber)) {
  fail(`无法从当前施工阶段解析 R1 序号：${currentStage ?? "无"}`);
}
const closedStages = Number.isInteger(currentStageNumber)
  ? Array.from({ length: currentStageNumber }, (_, index) => index)
  : [];

// 表格里 `artifact_hash` 紧跟在 `artifact_url_or_path` 之后，逐对匹配即可把 hash 绑到具体
// artifact 上；整篇 includes(hash) 无法发现两个 artifact 的 hash 互换或张冠李戴。
const ARTIFACT_PAIR =
  /^\|\s*`artifact_url_or_path`\s*\|\s*`([^`]+)`\s*\|[^\n]*\n\|\s*`artifact_hash`\s*\|[^`\n]*`([0-9A-Fa-f]{64})`\s*\|/gm;

const referencedArtifacts = new Set();
for (const stage of closedStages) {
  const relativeEvidence = `docs/evidence/r1/r1-${stage}.md`;
  const evidencePath = path.join(EVIDENCE_DIR, `r1-${stage}.md`);
  if (!existsSync(evidencePath)) {
    fail(`缺少已关闭阶段 R1-${stage} 的证据：${relativeEvidence}`);
    continue;
  }
  const pairs = [...readFileSync(evidencePath, "utf8").matchAll(ARTIFACT_PAIR)];
  if (pairs.length === 0) {
    fail(`${relativeEvidence} 缺少可校验的 artifact_url_or_path/artifact_hash 配对`);
  }
  for (const [, artifactRelativePath, recordedHash] of pairs) {
    referencedArtifacts.add(artifactRelativePath.replaceAll("\\", "/"));
    const artifactPath = path.join(ROOT, artifactRelativePath);
    if (!existsSync(artifactPath)) {
      fail(`${relativeEvidence} 引用的 artifact 不存在：${artifactRelativePath}`);
      continue;
    }
    // 归一化换行后取 hash（见 lib/text-hash.mjs）：证据摘要必须只依赖内容，
    // 否则 CRLF 工作区记录的值在 CI 的 LF clone 上必然对不上。
    const actualHash = textFileSha256(artifactPath).toUpperCase();
    if (actualHash !== recordedHash.toUpperCase()) {
      fail(`${relativeEvidence} 记录的 artifact_hash 与 ${path.basename(artifactRelativePath)} 不一致：记录 ${recordedHash}，实际 ${actualHash}`);
    }
  }
}

// 反向：artifacts 目录下的每个文件都必须被某份证据登记 hash，杜绝未纳入合同的孤儿证据。
const artifactsDir = path.join(EVIDENCE_DIR, "artifacts");
if (existsSync(artifactsDir)) {
  for (const entry of readdirSync(artifactsDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relativePath = path.relative(ROOT, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/");
    if (!referencedArtifacts.has(relativePath)) {
      fail(`artifact 未被任何 R1 证据登记 hash：${relativePath}`);
    }
  }
}

if (existsSync(evidenceIndexPath)) {
  const evidenceIndex = readFileSync(evidenceIndexPath, "utf8");
  for (const term of ["artifact", "SHA-256", "保留期", "访问角色", "secret", "PII"]) {
    if (!evidenceIndex.includes(term)) fail(`R1 证据索引缺少存储合同：${term}`);
  }
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

console.log("规划治理审计通过：00～28 状态、唯一阶段、索引与 1.0 契约一致。");
