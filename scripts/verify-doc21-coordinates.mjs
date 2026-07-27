#!/usr/bin/env node
/**
 * docs/plan/21 §23 阶段 J：唯一内容坐标系的防回退检查。
 *
 * ESLint 只看得到单个 className 字面量，看不到"页面根部又居中了"这种跨文件的
 * 结构性回退，也管不到 CSS 和已删除组件的复活。这个脚本补上那几条：
 *
 *   1. 普通 Dashboard 页面根部不得同时出现 mx-auto 与 max-w-*，
 *      src/features/school 下的页面级组件同理——ESLint 那条只挂在 dashboard
 *      路由上，页壳搬进 features 就会漏检（总览的 max-w-[96rem] 就是这么活下来的）；
 *   2. 已退休的 SchoolPageHeader 不得复活；
 *   3. DashboardShell 不得为悬浮控件重新加整页右侧 padding；
 *   4. 全局 [data-dashboard-content] > .mx-auto 兜底规则不得回来；
 *   5. 页面骨架自身不得引入 max-w-* / mx-auto。
 *
 * 用法：node scripts/verify-doc21-coordinates.mjs
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "src", "app", "[locale]", "dashboard");
const SCHOOL_DIR = path.join(ROOT, "src", "features", "school");
const SHELL = path.join(SCHOOL_DIR, "DashboardShell.tsx");
const GLOBALS = path.join(ROOT, "src", "app", "globals.css");
const PAGE_PACKAGE = path.join(SCHOOL_DIR, "dashboard-page");

const failures = [];

function fail(message) {
  failures.push(message);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

/**
 * 注释里必须能自由地写出被禁的类名——这些规则的“为什么”正是靠注释解释的。
 * 把注释换成等长空白而不是删掉，行号才对得上。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
}

const dashboardFiles = await walk(DASHBOARD_DIR);

for (const file of dashboardFiles) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const [index, line] of source.split("\n").entries()) {
    const centred = /mx-auto[^"'`]*max-w-|max-w-[^"'`]*mx-auto/.test(line);
    if (centred) fail(`${relative(file)}:${index + 1} 页面根重新居中（mx-auto + max-w-*）`);
    if (line.includes("SchoolPageHeader")) fail(`${relative(file)}:${index + 1} 引用了已退休的 SchoolPageHeader`);
  }
}

/**
 * 页壳类组件大量住在 features/school（TodayWorkHome、ScheduleWeekView、各工作区），
 * 它们和 dashboard 路由文件是同一件事，只是不在同一个目录，所以这里补同一条居中检查。
 * 只查 mx-auto 与 max-w-* 同时出现的"重新居中"信号，不像 ESLint 那样一刀切禁 mx-auto——
 * 卡片里居中一个图标是正当用法。
 */
const schoolFiles = (await walk(SCHOOL_DIR)).filter((file) => !file.startsWith(PAGE_PACKAGE + path.sep));

for (const file of schoolFiles) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const [index, line] of source.split("\n").entries()) {
    if (/mx-auto[^"'`]*max-w-|max-w-[^"'`]*mx-auto/.test(line)) {
      fail(`${relative(file)}:${index + 1} 页面级重新居中（mx-auto + max-w-*）`);
    }
  }
}

const shell = stripComments(readFileSync(SHELL, "utf8"));
if (/\b(?:lg|xl|2xl):pr-\d/.test(shell)) {
  fail("src/features/school/DashboardShell.tsx 又为悬浮控件加了整页右侧 padding，应改用页头安全占位");
}

const globals = readFileSync(GLOBALS, "utf8");
if (globals.includes("[data-dashboard-content] > .mx-auto")) {
  fail("src/app/globals.css 里的 [data-dashboard-content] > .mx-auto 兜底规则回来了");
}

for (const file of await walk(PAGE_PACKAGE)) {
  const source = stripComments(readFileSync(file, "utf8"));
  // DashboardReadingColumn 是唯一允许出现 max-w 的地方：它限制的是文字行宽，不是页面。
  const allowed = path.basename(file) === "DashboardContentGrid.tsx";
  for (const [index, line] of source.split("\n").entries()) {
    if (line.includes("mx-auto")) fail(`${relative(file)}:${index + 1} 页面骨架不得使用 mx-auto`);
    if (!allowed && /\bmax-w-/.test(line)) {
      fail(`${relative(file)}:${index + 1} 页面骨架不得使用 max-w-*`);
    }
  }
}

if (failures.length > 0) {
  console.error("doc21 coordinate audit failed:\n" + failures.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}

console.log(
  `doc21 coordinate audit passed (${dashboardFiles.length} dashboard files, ${schoolFiles.length} school feature files)`,
);
