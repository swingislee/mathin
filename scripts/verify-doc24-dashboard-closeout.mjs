#!/usr/bin/env node
/**
 * docs/plan/24 §10：Dashboard 视觉与交互收口的防回流检查。
 *
 * doc 21 的脚本盯宽度坐标、doc 22 盯路由合同、doc 23 盯页面骨架。这一份盯的是
 * doc 24 修掉的那几类**会悄悄长回来**的写法——它们的共同点是"单看一处都合理"：
 *
 *   1. 用 `overflow-x-auto` 兜住命令面板的溢出。§3.1 的产品决定是换行、所有选项
 *      可见；给槽位加横向滚动是把决定反过来说，而且桌面端没有滚动提示，后几个
 *      标签就是消失了。
 *   2. `flex-1` / `flex-auto` 与 `min-w-*` 同时出现。`flex-1` 的 basis 是 0，而 flex
 *      的换行判据看的正是 basis，于是元素永不换行、再被 min-width 撑出画布。这类
 *      溢出**根节点宽度检查看不到**：主画布是 `overflow-y-auto`，CSS 会把另一轴
 *      一并算成 auto，溢出静默变成整块工作区横向滚动。
 *   3. 手搓区块卡。同一角色的卡片曾经有五种圆角/内边距组合、三种标题字号。
 *      页面文件里不该再出现卡片外壳字面量——那是 DashboardCard 的活。
 *   4. 弹层丢掉高度约束。`fixed` + `translate-y(-50%)` 居中的弹窗一旦超过视口，
 *      溢出部分是滚不到的，底部的保存按钮直接够不着。
 *   5. 对象内部导航丢掉 `?returnTo=`。进入对象那一跳带了来源，但 Tab / stage /
 *      换轨链接从 baseHref 重新拼，切一次就把来源丢了（§6）。
 *   6. `useAction` 的同步在途闸门被删。`pending` 要等下一次渲染才为真，只靠它
 *      挡不住同一帧内的双击——而收款、下单、退款都走这条路径。
 *
 * 注释里必须能自由写出这些名字，所以扫描前先把注释换成等长空白（保留行号）。
 *
 * 用法：node scripts/verify-doc24-dashboard-closeout.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "src", "app", "[locale]", "dashboard");
const SCHOOL_DIR = path.join(ROOT, "src", "features", "school");
const STUDIO_DIR = path.join(ROOT, "src", "features", "courseware-studio");
const PAGE_PACKAGE = path.join(SCHOOL_DIR, "dashboard-page");
const CARD = path.join(PAGE_PACKAGE, "DashboardCard.tsx");
const COMMAND_PANEL = path.join(PAGE_PACKAGE, "DashboardCommandPanel.tsx");
const ROUTE_TABS = path.join(SCHOOL_DIR, "navigation", "RouteTabs.tsx");
const RETURN_TARGET = path.join(SCHOOL_DIR, "object-workspace", "return-target.ts");
const DIALOG = path.join(ROOT, "src", "components", "ui", "dialog.tsx");
const SHEET = path.join(ROOT, "src", "components", "ui", "sheet.tsx");
const ACTION_FORM = path.join(ROOT, "src", "components", "action-form.tsx");

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

const dashboardFiles = await walk(DASHBOARD_DIR);
const featureFiles = [...(await walk(SCHOOL_DIR)), ...(await walk(STUDIO_DIR))];
const allFiles = [...dashboardFiles, ...featureFiles];
const sources = new Map(allFiles.map((file) => [file, stripComments(readFileSync(file, "utf8"))]));

const eachLine = (predicate) => {
  for (const [file, source] of sources) {
    for (const [index, line] of source.split("\n").entries()) predicate(file, index + 1, line);
  }
};

// ---------------------------------------------------------------------------
// 1：命令面板的槽位不得用横向滚动兜溢出（§3.1）
// ---------------------------------------------------------------------------

eachLine((file, lineNo, line) => {
  if (!/<DashboardCommand(State|Filters|Selection)\b/.test(line)) return;
  if (/overflow-x-(auto|scroll)/.test(line)) {
    fail(`${relative(file)}:${lineNo} 命令面板槽位用 overflow-x 兜溢出；§3.1 的决定是 flex-wrap、所有选项可见`);
  }
});

for (const slot of ["state", "filters"]) {
  const source = sources.get(COMMAND_PANEL) ?? "";
  const block = source.match(new RegExp(`data-dashboard-command-slot="${slot}"[\\s\\S]{0,400}?\\)`));
  if (!block || !/flex-wrap/.test(block[0])) {
    fail(`${relative(COMMAND_PANEL)} 的 ${slot} 槽位必须 flex-wrap（§3.1）`);
  }
}

// ---------------------------------------------------------------------------
// 2：Tabs 一族保持换行 + 宽度可收敛（§3.1 / §7.3）
// ---------------------------------------------------------------------------

const routeTabs = sources.get(ROUTE_TABS);
if (!routeTabs) {
  fail(`${relative(ROUTE_TABS)} 不存在`);
} else {
  if (!/flex-wrap/.test(routeTabs)) fail(`${relative(ROUTE_TABS)} 丢了 flex-wrap；RouteTabs 是六个切换组件的共同实现`);
  if (/overflow-x-(auto|scroll)/.test(routeTabs)) fail(`${relative(ROUTE_TABS)} 不得横向滚动`);
  if (/\bw-fit\b/.test(routeTabs) && !/max-w-full/.test(routeTabs)) {
    fail(`${relative(ROUTE_TABS)} 的 w-fit 必须配 max-w-full，否则祖先没传下可用宽度时按 max-content 铺开`);
  }
}

// ---------------------------------------------------------------------------
// 2b：合法的横向滚动必须是具名容器（§7.2）
// ---------------------------------------------------------------------------

/**
 * §7.2 允许四类内容拥有自己的横向滚动区：宽表格、课表、时间轴、课件画布。
 * 允许的是**这些容器**，不是"哪里放不下就在哪里加一句 overflow-x-auto"——后者
 * 会让横向滚动从一个明确的产品决定退化成随手的兜底，而兜底出来的滚动条在桌面端
 * 是没有提示的，用户根本不知道右边还有东西。新增确实需要横向滚动的容器时，
 * 把文件加进这份名单，同时在代码里说明它属于四类中的哪一类。
 */
const HORIZONTAL_SCROLL_ALLOWLIST = new Set([
  path.join(SCHOOL_DIR, "ScheduleWeekView.tsx"), // 课表
  path.join(SCHOOL_DIR, "teaching-operations", "VariantMatrix.tsx"), // 版本矩阵（宽表格）
  path.join(STUDIO_DIR, "CoursewarePageEditor.tsx"), // 课件画布工具条
]);

eachLine((file, lineNo, line) => {
  if (!/overflow-x-(auto|scroll)/.test(line)) return;
  if (HORIZONTAL_SCROLL_ALLOWLIST.has(file)) return;
  fail(
    `${relative(file)}:${lineNo} 新增了未登记的横向滚动容器；§7.2 只允许宽表格/课表/时间轴/课件画布，` +
      `其余情况用 min-w-0 / flex-wrap 解决（表格走 components/ui/table 的统一容器）`,
  );
});

// ---------------------------------------------------------------------------
// 3：flex-1 与 min-w-* 不得同时出现在同一个 class 串里（§7.3）
// ---------------------------------------------------------------------------

const FLEX_BASIS_ZERO = /\b(flex-1|flex-auto)\b/;
eachLine((file, lineNo, line) => {
  for (const match of line.matchAll(/(?:className|class)=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([^)]*)\))/g)) {
    const classes = match[1] ?? match[2] ?? match[3] ?? "";
    if (!FLEX_BASIS_ZERO.test(classes)) continue;
    // min-w-0 是解法不是问题；只有正数下限才会把行撑爆。
    const guilty = classes.match(/\bmin-w-(?!0\b|full\b)[\w[\].%-]+/);
    if (guilty) {
      fail(`${relative(file)}:${lineNo} flex-1 与 ${guilty[0]} 同时出现：basis 为 0 时永不换行，min-width 会把行撑出画布（§7.3，改用 basis-*）`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4：Dashboard 页面文件不得手搓区块卡外壳（§4.2）
// ---------------------------------------------------------------------------

if (!existsSync(CARD)) fail(`${relative(CARD)} 不存在：区块卡原语是 §4.2 的落点`);

for (const file of dashboardFiles) {
  // loading.tsx 整份就是占位骨架：它的职责恰恰是**模仿**真实卡片的形状，
  // 让它去用 DashboardCard 会把内容组件塞进一个本该没有内容的文件。
  if (path.basename(file) === "loading.tsx") continue;
  const source = sources.get(file);
  for (const [index, line] of source.split("\n").entries()) {
    // 只认"卡片外壳"这一种组合：圆角 + 边框 + 卡底 + 区块级内边距。
    // 骨架屏（animate-pulse）没有内容结构，不属于 DashboardCard 的职责。
    if (/animate-pulse/.test(line)) continue;
    if (/rounded-(xl|2xl)[^"'`]*\bborder\b[^"'`]*bg-card[^"'`]*\bp-[4-8]\b/.test(line)) {
      fail(`${relative(file)}:${index + 1} 页面文件手搓区块卡外壳；用 DashboardCard / DashboardEmptyCard（§4.2）`);
    }
  }
}

// 圆角只有一档：设计系统 §1「卡片 rounded-2xl」。
eachLine((file, lineNo, line) => {
  if (/rounded-xl[^"'`]*\bborder\b[^"'`]*bg-card[^"'`]*\bp-[4-8]\b/.test(line)) {
    fail(`${relative(file)}:${lineNo} 区块卡用了 rounded-xl；设计系统 §1 规定卡片是 rounded-2xl`);
  }
});

// 卡片标题只有两档：正文区块 text-base，侧栏摘要 text-sm。
eachLine((file, lineNo, line) => {
  const match = line.match(/<h2 className="([^"]*)"/);
  if (!match) return;
  const classes = match[1];
  if (!/font-medium/.test(classes)) return;
  if (!/\btext-(base|sm|xs)\b/.test(classes)) {
    fail(`${relative(file)}:${lineNo} 卡片标题没有显式字号；只允许 text-base（正文区块）或 text-sm（侧栏摘要）（§4.4）`);
  }
});

// ---------------------------------------------------------------------------
// 5：弹层的高度约束不得消失（§5.3）
// ---------------------------------------------------------------------------

const dialog = stripComments(readFileSync(DIALOG, "utf8"));
if (!/max-h-\[calc\(100dvh/.test(dialog)) fail(`${relative(DIALOG)} 丢了 max-h（dvh）：居中弹窗溢出的部分滚不到`);
if (!/overflow-y-auto/.test(dialog)) fail(`${relative(DIALOG)} 丢了 overflow-y-auto：内容超出后底部动作区不可达`);
if (/\bw-full\b/.test(dialog)) fail(`${relative(DIALOG)} 用 w-full：390px 上弹窗会贴死屏幕两边`);

const sheet = stripComments(readFileSync(SHEET, "utf8"));
if (!/overflow-y-auto/.test(sheet)) fail(`${relative(SHEET)} 丢了 overflow-y-auto`);
if (!/max-h-\[85dvh\]/.test(sheet)) fail(`${relative(SHEET)} 的上/下抽屉丢了高度上限`);

// ---------------------------------------------------------------------------
// 6：来源返回（§6）
// ---------------------------------------------------------------------------

const returnTarget = stripComments(readFileSync(RETURN_TARGET, "utf8"));
for (const name of ["parseReturnTo", "resolveReturnTarget", "preserveReturnTo", "withReturnTo"]) {
  if (!new RegExp(`export function ${name}\\b`).test(returnTarget)) {
    fail(`${relative(RETURN_TARGET)} 缺少 ${name}；§6 的四个动作（校验/兜底/内部保留/写入）缺一不可`);
  }
}

/** §6.1 的四类对象详情：必须消费 returnTo，且返回入口以它优先。 */
const RETURN_CONSUMERS = {
  "students/[studentId]/page.tsx": path.join(DASHBOARD_DIR, "students", "[studentId]", "page.tsx"),
  "classes/[classId]/page.tsx": path.join(DASHBOARD_DIR, "classes", "[classId]", "page.tsx"),
  "courses/[courseFamilyId]/page.tsx": path.join(DASHBOARD_DIR, "courses", "[courseFamilyId]", "page.tsx"),
  "sessions/[sessionId]/page.tsx": path.join(DASHBOARD_DIR, "sessions", "[sessionId]", "page.tsx"),
  "courseware/lectures/[lectureId]/page.tsx": path.join(DASHBOARD_DIR, "courseware", "lectures", "[lectureId]", "page.tsx"),
};

for (const [label, file] of Object.entries(RETURN_CONSUMERS)) {
  if (!existsSync(file)) {
    fail(`${label} 不存在`);
    continue;
  }
  const source = sources.get(file) ?? stripComments(readFileSync(file, "utf8"));
  if (!/\b(parseReturnTo|resolveReturnTarget)\b/.test(source)) {
    fail(`${label} 没有消费 ?returnTo=；§6 要求这五个对象页都支持来源返回`);
  }
  if (!/\breturnTo\b/.test(source)) fail(`${label} 没有 returnTo 变量`);
}

/**
 * 对象内部导航必须保留来源：这三页各自有 Tab / stage / 换轨链接，
 * 只要出现"从 baseHref 重新拼 URL"就必须过 preserveReturnTo 或显式带上 returnTo。
 */
const PRESERVERS = [
  ["students/[studentId]/page.tsx", RETURN_CONSUMERS["students/[studentId]/page.tsx"]],
  ["classes/[classId]/page.tsx", RETURN_CONSUMERS["classes/[classId]/page.tsx"]],
  [
    "SessionWorkspaceBody.tsx",
    path.join(SCHOOL_DIR, "SessionWorkspaceBody.tsx"),
  ],
  [
    "curriculum/LectureWorkspaceBody.tsx",
    path.join(SCHOOL_DIR, "curriculum", "LectureWorkspaceBody.tsx"),
  ],
];

for (const [label, file] of PRESERVERS) {
  const source = sources.get(file);
  if (source === undefined) {
    fail(`${label} 不存在`);
    continue;
  }
  if (!/preserveReturnTo|returnTo/.test(source)) {
    fail(`${label} 的对象内部链接没有保留来源；切一次 Tab/stage 返回就会退回默认父页面（§6）`);
  }
}

// ---------------------------------------------------------------------------
// 7：重复提交闸门（§5.2）
// ---------------------------------------------------------------------------

const actionForm = stripComments(readFileSync(ACTION_FORM, "utf8"));
if (!/inFlight/.test(actionForm) || !/useRef\(false\)/.test(actionForm)) {
  fail(`${relative(ACTION_FORM)} 的 useAction 丢了同步在途闸门；pending 要等下一次渲染才为真，挡不住同一帧的双击（§5.2）`);
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("doc24 dashboard closeout audit failed:");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `doc24 dashboard closeout audit passed (${dashboardFiles.length} dashboard files, ${featureFiles.length} feature files, ${Object.keys(RETURN_CONSUMERS).length} return-target consumers)`,
);
