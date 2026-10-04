#!/usr/bin/env node
/**
 * docs/plan/23 §21：对象详情页与专业工作区的防回流检查。
 *
 * doc 23 拆掉的是**骨架**，而骨架回流的方式很隐蔽：不是有人把删掉的组件加回来，
 * 而是下一个页面"就近"再手写一份——又一个返回 Link、又一条 Tabs、又一个两栏 grid。
 * doc 21 的脚本盯宽度坐标，doc 22 的盯路由合同，这一份盯的是页面骨架：
 *
 *   1. 已删除的旧骨架组件不得以任何可执行形式回来（ContextBar / LectureWorkspaceShell /
 *      DecisionRail / SharedAssetReplacementEditor / StudentLifecycleActions）；
 *   2. 返回入口只能来自共享的 DashboardBackLink——页面里不得再出现 ArrowLeft 图标或
 *      router.back()（后者在表单提交与 router.refresh() 之后根本不指向"来的地方"）；
 *   3. 素材详情不得再套 DashboardPage：它在合同里是 panel；
 *   4. 对象工作区不得重新居中（mx-auto + max-w-*），沿用 doc21 的判据但覆盖
 *      courseware-studio 下的工作区组件；
 *   5. 外壳模式只能来自路由合同：DashboardShell 不得再按 segment 判断，
 *      session / lecture / asset / schedule 四条必须是 panel，且 panel 路由的页面文件必须存在。
 *
 * 注释里必须能自由写出这些名字——迁移的"为什么"正是靠注释解释的，所以扫描前先把
 * 注释换成等长空白（保留行号），只看真正会被执行的字符串。
 *
 * 用法：node scripts/verify-doc23-object-workspaces.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "src", "app", "[locale]", "dashboard");
const SCHOOL_DIR = path.join(ROOT, "src", "features", "school");
const STUDIO_DIR = path.join(ROOT, "src", "features", "courseware-studio");
const CONTRACT = path.join(ROOT, "src", "features", "school", "dashboard-routes.ts");
const SHELL = path.join(ROOT, "src", "features", "school", "DashboardShell.tsx");
const BACK_LINK = path.join(ROOT, "src", "features", "school", "dashboard-page", "DashboardBackLink.tsx");
const ASSET_DETAIL = path.join(DASHBOARD_DIR, "courseware-assets", "[assetId]", "page.tsx");

const failures = [];
const fail = (message) => failures.push(message);
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");

async function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
}

const pageFiles = [...(await walk(DASHBOARD_DIR)), ...(await walk(SCHOOL_DIR)), ...(await walk(STUDIO_DIR))];
const sources = new Map(pageFiles.map((file) => [file, stripComments(readFileSync(file, "utf8"))]));

// ---------------------------------------------------------------------------
// 1：已删除的旧骨架不得复活
// ---------------------------------------------------------------------------

const RETIRED_COMPONENTS = [
  "ContextBar",
  "LectureWorkspaceShell",
  "DecisionRail",
  "SharedAssetReplacementEditor",
  "StudentLifecycleActions",
  "ProvisionStudentAccountButton",
];

for (const [file, source] of sources) {
  for (const [index, line] of source.split("\n").entries()) {
    for (const name of RETIRED_COMPONENTS) {
      // DecisionRailContent 是保留的**内容**组件（住进通用 WorkspaceRail），
      // 被退休的是那个同名壳层，所以用词边界排除它。
      if (new RegExp(`\\b${name}\\b(?!Content)`).test(line)) {
        fail(`${relative(file)}:${index + 1} 引用了已退休的骨架组件 ${name}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2：返回入口唯一
// ---------------------------------------------------------------------------

for (const [file, source] of sources) {
  if (file === BACK_LINK) continue;
  for (const [index, line] of source.split("\n").entries()) {
    // 只认 JSX 用法与 lucide 导入；"ArrowLeft" 作为 KeyboardEvent.key 字符串是正当用法。
    if (/<ArrowLeft[\s/>]/.test(line)) fail(`${relative(file)}:${index + 1} 页面手写了返回图标，返回入口只能用 DashboardBackLink`);
    if (/from\s+"lucide-react"/.test(line) && /\bArrowLeft\b/.test(line)) {
      fail(`${relative(file)}:${index + 1} 从 lucide 引入 ArrowLeft，返回入口只能用 DashboardBackLink`);
    }
    if (/\brouter\.back\(\)/.test(line)) {
      fail(`${relative(file)}:${index + 1} 用 router.back() 做返回；应走 ?returnTo= 与 resolveReturnTarget`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3：素材详情必须是 panel（不得套普通页壳）
// ---------------------------------------------------------------------------

if (!existsSync(ASSET_DETAIL)) {
  fail(`${relative(ASSET_DETAIL)} 不存在`);
} else if (/\bDashboardPage\b/.test(stripComments(readFileSync(ASSET_DETAIL, "utf8")))) {
  fail(`${relative(ASSET_DETAIL)} 仍在使用 DashboardPage；素材替换是 panel 工作区`);
}

// ---------------------------------------------------------------------------
// 4：工作区不得重新居中
// ---------------------------------------------------------------------------

for (const [file, source] of sources) {
  for (const [index, line] of source.split("\n").entries()) {
    if (/mx-auto[^"'`]*max-w-|max-w-[^"'`]*mx-auto/.test(line)) {
      fail(`${relative(file)}:${index + 1} 工作区重新居中（mx-auto + max-w-*）`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5：外壳模式只能来自路由合同
// ---------------------------------------------------------------------------

const shellSource = stripComments(readFileSync(SHELL, "utf8"));
if (!/resolveDashboardShellMode/.test(shellSource)) {
  fail(`${relative(SHELL)} 未从路由合同解析外壳模式`);
}
if (/segments\s*\[/.test(shellSource)) {
  fail(`${relative(SHELL)} 又开始手写 route segment 判断；外壳模式的唯一来源是 dashboard-routes.ts`);
}

const contractSource = readFileSync(CONTRACT, "utf8");
const PANEL_ROUTES = {
  schedule: "/dashboard/schedule",
  sessionDetail: "/dashboard/sessions/[sessionId]",
  coursewareLecture: "/dashboard/courseware/lectures/[lectureId]",
  coursewareAssetDetail: "/dashboard/courseware-assets/[assetId]",
};

for (const [key, pattern] of Object.entries(PANEL_ROUTES)) {
  const entry = contractSource.match(new RegExp(`\\n  ${key}:\\s*\\{[\\s\\S]*?\\n  \\},`));
  if (!entry) {
    fail(`dashboard-routes.ts 缺少路由 ${key}`);
    continue;
  }
  if (!/shellMode:\s*"panel"/.test(stripComments(entry[0]))) {
    fail(`dashboard-routes.ts 的 ${key} 必须是 shellMode: "panel"`);
  }
  const segments = pattern.split("/").filter(Boolean).slice(1);
  const pageFile = path.join(DASHBOARD_DIR, ...segments, "page.tsx");
  if (!existsSync(pageFile)) fail(`${relative(pageFile)} 不存在，但合同把它登记为 panel 路由`);
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("doc23 object workspace audit failed:");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`doc23 object workspace audit passed (${sources.size} files scanned, ${Object.keys(PANEL_ROUTES).length} panel routes)`);
