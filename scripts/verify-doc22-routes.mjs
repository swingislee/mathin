#!/usr/bin/env node
/**
 * docs/plan/22 §14：Dashboard 路由信息架构的防回流检查。
 *
 * doc 22 是一次性 hard cut——旧 URL 不留重定向、不留 alias、直接 404。这类清理最容易
 * 回流的地方不是页面本身，而是散在 revalidatePath、router.push、面包屑和文档里的字符串。
 * 这个脚本盯四件事：
 *
 *   1. §6 的八条旧路由不得以任何可执行形式回来；
 *   2. dashboard 下不得再出现泛化的 `[id]` 目录；
 *   3. §7 明确禁止的创建路由不得被"补齐对称性"式地加回来；
 *   4. src/features/school/dashboard-routes.ts 的路由合同必须与真实文件路由树一一对应
 *      ——合同写了但没建的路由、建了但没登记的路由都算失败。
 *
 * 第 4 条是这份脚本存在的主要理由：合同一旦和现实脱节，它就从"防止 agent 靠目录对称
 * 推断产品结构"的护栏退化成一份过期注释。
 *
 * 注释里必须能自由写出旧路径——迁移的"为什么"正是靠注释解释的，所以扫描前先把注释
 * 换成等长空白（保留行号），只看真正会被执行的字符串。
 *
 * 用法：node scripts/verify-doc22-routes.mjs
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "src", "app", "[locale]", "dashboard");
const CONTRACT = path.join(ROOT, "src", "features", "school", "dashboard-routes.ts");
const SCAN_DIRS = [path.join(ROOT, "src"), path.join(ROOT, "scripts")];

const failures = [];
const fail = (message) => failures.push(message);
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");

async function walk(dir, filter) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, filter)));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
}

// ---------------------------------------------------------------------------
// 1 + 3：旧路由与被禁创建路由的字符串扫描
// ---------------------------------------------------------------------------

/** §6 已删除的旧 URL。用 `/dashboard/...` 前缀锚定，避免误伤 features/courseware-studio
 *  下同名的**代码模块**文件（adapt-review-data.ts 等）——§2.2 明确代码目录与 URL 无关。 */
const RETIRED_ROUTES = [
  "/dashboard/staff/roles",
  "/dashboard/operations",
  "/dashboard/registration",
  "/dashboard/adapt-review",
  "/dashboard/curriculum",
  "/dashboard/shared-assets",
  "/dashboard/work",
  "/dashboard/videos",
];

/** §7：本轮不得仅为目录对称新增的创建路由。 */
const FORBIDDEN_CREATE_ROUTES = [
  "/dashboard/students/new",
  "/dashboard/activities/new",
  "/dashboard/staff/new",
  "/dashboard/staff/add",
  "/dashboard/access-control/new",
  "/dashboard/sessions/new",
  "/dashboard/courseware/lectures/new",
  "/dashboard/courseware-assets/new",
  "/dashboard/courseware-assets/upload",
  "/dashboard/followups/new",
  "/dashboard/children/new",
  "/dashboard/assignments/new",
  "/dashboard/finance/new",
  "/dashboard/registration-settings/new",
];

const sourceFiles = (
  await Promise.all(SCAN_DIRS.map((dir) => walk(dir, (name) => /\.(ts|tsx|mjs|js)$/.test(name))))
).flat();

const SELF = path.join(ROOT, "scripts", "verify-doc22-routes.mjs");

for (const file of sourceFiles) {
  // 合同与本脚本自身要列出这些路径才能防住它们。
  if (file === CONTRACT || file === SELF) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  for (const route of RETIRED_ROUTES) {
    // `/dashboard/registration-settings` 合法，`/dashboard/registration"` 不合法——
    // 只有后面紧跟路径分隔或字符串结束才算命中旧路由。
    if (new RegExp(`${route.replaceAll("/", "\\/")}(?![\\w-])`).test(source)) {
      fail(`${relative(file)} 仍引用已删除的旧路由 ${route}（doc22 §6：不留重定向、不留 alias）`);
    }
  }
  for (const route of FORBIDDEN_CREATE_ROUTES) {
    if (source.includes(route)) {
      fail(`${relative(file)} 引用了 §7 明确禁止的创建路由 ${route}——先更新资源合同，再加路由`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2 + 4：真实路由树 vs 路由合同
// ---------------------------------------------------------------------------

const pageFiles = await walk(DASHBOARD_DIR, (name) => name === "page.tsx");
const actualRoutes = new Set();
for (const file of pageFiles) {
  const segments = path.relative(DASHBOARD_DIR, path.dirname(file)).split(path.sep).filter((s) => s && s !== ".");
  if (segments.includes("[id]")) {
    fail(`${relative(file)} 使用泛化参数 [id]——动态参数必须表达业务语义（doc22 §12 阶段 F）`);
  }
  actualRoutes.add(["/dashboard", ...segments].join("/"));
}

const contractSource = readFileSync(CONTRACT, "utf8");
const declaredRoutes = new Set(
  [...contractSource.matchAll(/^\s*(?:href|hrefPattern):\s*"(\/dashboard[^"]*)"/gm)].map((match) => match[1]),
);

for (const route of actualRoutes) {
  if (!declaredRoutes.has(route)) {
    fail(`路由 ${route} 存在于 app 目录但未登记进 dashboard-routes.ts——每条路由都要声明 kind 与 createSurface`);
  }
}
for (const route of declaredRoutes) {
  if (!actualRoutes.has(route)) {
    fail(`dashboard-routes.ts 登记了 ${route}，但 app 目录下没有对应 page.tsx`);
  }
}

// 合同内部引用（parent / creationOwner）必须指向已登记的路由键。
const routeKeys = new Set([...contractSource.matchAll(/^ {2}([a-zA-Z][\w]*):\s*\{$/gm)].map((match) => match[1]));
for (const match of contractSource.matchAll(/^\s*(parent|creationOwner):\s*"([^"]+)"/gm)) {
  if (!routeKeys.has(match[2])) {
    fail(`dashboard-routes.ts 的 ${match[1]}: "${match[2]}" 指向了一个不存在的路由键`);
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`doc22 route audit: ${message}`);
  process.exit(1);
}
console.log(
  `doc22 route audit passed (${actualRoutes.size} dashboard routes, ${routeKeys.size} contract entries, ${sourceFiles.length} files scanned)`,
);
