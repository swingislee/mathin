import { newId } from "@/lib/uuid";
import {
  runtimeChildren, runtimeText as t, type RuntimeAction, type RuntimeBlockSpec, type RuntimeBlockType, type RuntimeRoute, type RuntimeRule, type RuntimeScreenSpec, type RuntimeSpec,
  type RuntimeTabSpec,
} from "../../../../contracts/participant-api/runtime";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

export type Locale = "zh" | "en";
export const blockNames: Record<RuntimeBlockType, { zh: string; en: string }> = {
  section: { zh: "区段", en: "Section" }, text: { zh: "文字", en: "Text" }, image: { zh: "图片", en: "Image" }, feature: { zh: "功能卡", en: "Feature card" },
  entries: { zh: "入口", en: "Entries" }, list: { zh: "数据列表", en: "Data list" }, participants: { zh: "孩子切换", en: "Participants" },
  calendar: { zh: "本周日历", en: "Week calendar" }, filters: { zh: "筛选条", en: "Filter bar" }, account: { zh: "账号头部", en: "Account header" }, content: { zh: "图文页", en: "Content page" },
  button: { zh: "按钮", en: "Button" }, divider: { zh: "分隔线", en: "Divider" },
  tabs: { zh: "标签页", en: "Tabs" }, collapse: { zh: "折叠分组", en: "Collapsible group" }, video: { zh: "视频", en: "Video" }, audio: { zh: "音频列表", en: "Audio list" },
  card: { zh: "证书 / 凭证卡", en: "Certificate / card" }, metrics: { zh: "指标组", en: "Metrics" }, chart: { zh: "图表", en: "Chart" }, progress: { zh: "进度", en: "Progress" },
  badges: { zh: "徽章墙", en: "Badges" }, table: { zh: "表格", en: "Table" }, form: { zh: "表单", en: "Form" }, bar: { zh: "底部按钮栏", en: "Bottom bar" },
};
const shortId = (prefix: string) => `${prefix}-${newId().slice(0, 8)}`;

export function newBlock(type: RuntimeBlockType): RuntimeBlockSpec {
  const id = shortId(type);
  switch (type) {
    case "section": return { id, type, title: t("新区段", "New section"), style: "card", blocks: [] };
    case "text": return { id, type, text: t("在这里输入文字", "Write here"), tone: "body" };
    case "image": return { id, type, image: "asset:appointment", fit: "width" };
    case "feature": return { id, type, title: t("新功能", "New feature"), body: t("立即查看", "Open"), image: "asset:appointment", action: { type: "route", route: "assessment" } };
    case "entries": return { id, type, title: t("常用入口", "Shortcuts"), style: "grid", items: [{ id: shortId("entry"), label: t("我的预约", "Bookings"), icon: "reservations", action: { type: "route", route: "reservations" } }] };
    case "list": return { id, type, title: t("我的任务", "My tasks"), source: "account.tasks", template: "row", limit: 5, empty: t("暂无内容", "Nothing yet"), facets: [], actionLabel: t() };
    case "participants": return { id, type, title: t(), empty: t("暂未关联参与人，请联系工作人员。", "No participant linked. Contact staff.") };
    case "calendar": return { id, type, title: t("本周日历安排", "This week"), empty: t("暂无安排", "No arrangements"), more: { label: t("全部安排", "All"), action: { type: "route", route: "agenda" } } };
    case "account": return { id, type, trailing: { label: t("我的预约", "My reservations"), action: { type: "route", route: "reservations" } } };
    case "content": return { id, type, pageId: "home" };
    case "button": return { id, type, label: t("按钮", "Button"), appearance: "primary", action: { type: "login" } };
    case "filters": return { id, type, clearLabel: t("重置所有筛选", "Reset filters") };
    case "divider": return { id, type };
    case "tabs": return { id, type, style: "segmented", tabs: [
      { id: shortId("tab"), label: t("全部", "All"), blocks: [newBlock("text")] }, { id: shortId("tab"), label: t("进行中", "Ongoing"), blocks: [] }] };
    case "collapse": return { id, type, title: t("第 1 讲", "Lesson 1"), summary: t("点击展开", "Tap to expand"), open: false, blocks: [newBlock("text")] };
    case "video": return { id, type, title: t("视频讲解", "Video"), src: "", poster: "" };
    case "audio": return { id, type, title: t("磨耳朵", "Listening"), loop: true, tracks: [] };
    case "card": return { id, type, style: "credential", title: t("学员卡", "Student card"), subtitle: t(), fields: [], image: "", stamp: t(), source: "account.participant" };
    case "metrics": return { id, type, title: t("学习概况", "Overview"), columns: 2, items: [], source: "account.summary" };
    case "chart": return { id, type, title: t("能力对比", "Skills"), kind: "radar", labels: [t("计算"), t("推理"), t("表达"), t("空间"), t("专注")],
      series: [{ name: t("孩子", "Child"), values: [80, 72, 65, 88, 70] }, { name: t("班级平均", "Class average"), values: [70, 68, 70, 75, 72] }], max: 100, caption: t() };
    case "progress": return { id, type, title: t("本周打卡", "Check-ins"), items: [], source: "account.checkins" };
    case "badges": return { id, type, title: t("我的徽章", "Badges"), columns: 4, items: [
      { id: shortId("badge"), label: t("坚持之星", "Steady"), image: "asset:icons/complete", earned: true, caption: t() },
      { id: shortId("badge"), label: t("思考达人", "Thinker"), image: "asset:icons/book", earned: false, caption: t() }] };
    case "table": return { id, type, title: t("级别表", "Levels"), columns: [t("科目", "Subject"), t("级别", "Level"), t("状态", "Status")], rows: [[t("思维", "Thinking"), t("L3"), t("有效", "Valid")]] };
    case "form": return { id, type, title: t(), formId: "", submitLabel: t() };
    case "bar": return { id, type, buttons: [{ id: shortId("button"), label: t("提交", "Submit"), appearance: "primary", action: { type: "login" } }] };
  }
}
export function newScreen(index: number): RuntimeScreenSpec {
  return { id: shortId("page"), title: t(`新页面 ${index}`, `New page ${index}`), navigation: "title", blocks: [newBlock("text")] };
}

/** Applies a change to the blocks inside a container; other blocks are returned unchanged. */
function withChildren(block: RuntimeBlockSpec, change: (rows: RuntimeBlockSpec[], tab?: string) => RuntimeBlockSpec[]): RuntimeBlockSpec {
  if (block.type === "section" || block.type === "collapse") return { ...block, blocks: change(block.blocks) };
  if (block.type === "tabs") return { ...block, tabs: block.tabs.map(tab => ({ ...tab, blocks: change(tab.blocks, tab.id) })) };
  return block;
}
export const isContainer = (block: RuntimeBlockSpec) => block.type === "section" || block.type === "collapse" || block.type === "tabs";
export function findBlock(blocks: RuntimeBlockSpec[], id: string): RuntimeBlockSpec | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    const found = findBlock(runtimeChildren(block), id);
    if (found) return found;
  }
  return null;
}
export function updateBlock(blocks: RuntimeBlockSpec[], id: string, change: (block: RuntimeBlockSpec) => RuntimeBlockSpec): RuntimeBlockSpec[] {
  return blocks.map(block => block.id === id ? change(block) : withChildren(block, rows => updateBlock(rows, id, change)));
}
export function removeBlock(blocks: RuntimeBlockSpec[], id: string): RuntimeBlockSpec[] {
  return blocks.filter(block => block.id !== id).map(block => withChildren(block, rows => removeBlock(rows, id)));
}
/** Moves a block among its siblings. */
export function moveBlock(blocks: RuntimeBlockSpec[], id: string, offset: -1 | 1): RuntimeBlockSpec[] {
  const index = blocks.findIndex(block => block.id === id);
  if (index >= 0) {
    const target = index + offset;
    if (target < 0 || target >= blocks.length) return blocks;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  return blocks.map(block => withChildren(block, rows => moveBlock(rows, id, offset)));
}
/** Inserts into a selected container (the chosen tab of a tabs block), after a selected block, or at the end of the page.
 * `tab` names the tab shown on the canvas for a selected tabs block. */
export function insertBlock(blocks: RuntimeBlockSpec[], selected: string, block: RuntimeBlockSpec, tab = ""): RuntimeBlockSpec[] {
  const target = selected ? findBlock(blocks, selected) : null;
  if (target && isContainer(target) && !isContainer(block)) return updateBlock(blocks, target.id, row => {
    if (row.type === "tabs") { const into = row.tabs.some(item => item.id === tab) ? tab : row.tabs[0]?.id; return { ...row, tabs: row.tabs.map(item => item.id === into ? { ...item, blocks: [...item.blocks, block] } : item) }; }
    return withChildren(row, rows => [...rows, block]);
  });
  if (!target) return [...blocks, block];
  const place = (rows: RuntimeBlockSpec[]): RuntimeBlockSpec[] => rows.flatMap(row => row.id === selected ? [row, block] : [withChildren(row, place)]);
  return place(blocks);
}
export function outline(blocks: RuntimeBlockSpec[], depth = 0): { block: RuntimeBlockSpec; depth: number }[] {
  return blocks.flatMap(block => [{ block, depth }, ...outline(runtimeChildren(block), depth + 1)]);
}
export function blockSummary(block: RuntimeBlockSpec, locale: Locale): string {
  const text = (value: { zh: string; en: string }) => value[locale] || value.zh || value.en;
  switch (block.type) {
    case "section": return text(block.title);
    case "text": return text(block.text).slice(0, 18);
    case "feature": return text(block.title);
    case "entries": return text(block.title) || block.items.map(item => text(item.label)).join("、").slice(0, 18);
    case "list": case "participants": case "calendar": return text(block.title);
    case "button": return text(block.label);
    case "content": return block.pageId;
    case "collapse": case "video": case "audio": case "card": case "metrics": case "chart": case "progress": case "badges": case "table": case "form": return text(block.title) || (block.type === "form" ? block.formId : "");
    case "tabs": return block.tabs.map(tab => text(tab.label)).join(" / ").slice(0, 18);
    case "bar": return block.buttons.map(button => text(button.label)).join(" / ").slice(0, 18);
    default: return "";
  }
}

/** Hidden objects stay in the draft; the flag is left out while shown. */
export function withHidden<T extends { hidden?: boolean }>(row: T, hidden: boolean): T {
  const next = { ...row };
  if (hidden) next.hidden = true; else delete next.hidden;
  return next;
}
/** Slot 1 is the page WeChat opens first, and the tab bar keeps at least two shown tabs. */
export function canHideTab(tabs: RuntimeTabSpec[], slot: RuntimeTabSpec["slot"]) {
  return slot !== 1 && tabs.filter(row => !row.hidden && row.slot !== slot).length >= 2;
}

/** Visibility presets offered in the inspector; other combinations are kept as published. */
export type RulePreset = "all" | "signedIn" | "signedOut" | "hasParticipants" | "stage" | "between" | "custom";
export function rulePreset(rule: RuntimeRule | undefined): RulePreset {
  if (!rule) return "all";
  if (["signedIn", "signedOut", "hasParticipants", "stage", "between"].includes(rule.kind)) return rule.kind as RulePreset;
  return "custom";
}
export function presetRule(preset: RulePreset, current?: RuntimeRule): RuntimeRule | undefined {
  switch (preset) {
    case "all": return undefined;
    case "signedIn": case "signedOut": case "hasParticipants": return { kind: preset };
    case "stage": return current?.kind === "stage" ? current : { kind: "stage", stages: [1] };
    case "between": return current?.kind === "between" ? current : { kind: "between", from: "", to: "" };
    case "custom": return current;
  }
}

export type ActionKind = "none" | RuntimeAction["type"];
export function defaultAction(kind: ActionKind, screens: RuntimeScreenSpec[]): RuntimeAction | undefined {
  switch (kind) {
    case "none": return undefined;
    case "screen": return { type: "screen", screen: screens[0]?.id || "discover" };
    case "tab": return { type: "tab", slot: 1 };
    case "route": return { type: "route", route: "assessment" };
    case "phone": return { type: "phone", number: "4000000000" };
    case "copy": return { type: "copy", text: "" };
    case "web": return { type: "web", url: "/zh/family", signIn: true };
    case "command": return { type: "command", command: "checkin" };
    case "toast": return { type: "toast", text: t("已收到", "Got it") };
    case "preview": return { type: "preview", images: ["asset:appointment"] };
    case "save": return { type: "save", image: "asset:appointment" };
    case "document": return { type: "document", url: "/zh/family" };
    case "location": return { type: "location", latitude: 31.2304, longitude: 121.4737, name: t("校区", "Campus"), address: t() };
    case "subscribe": return { type: "subscribe", templates: ["TEMPLATE_ID"] };
    default: return { type: kind } as RuntimeAction;
  }
}

/** Plain-language changes between what clients receive now and the draft. */
export function changes(live: RuntimeSpec, draft: RuntimeSpec, locale: Locale): string[] {
  const zh = locale === "zh", rows: string[] = [];
  // Tab pages often have no title of their own, so their tab label names them.
  const title = (screen: RuntimeScreenSpec) => { const tab = draft.tabs.find(row => row.screen === screen.id);
    return screen.title[locale] || screen.title.zh || (tab && (tab.label[locale] || tab.label.zh)) || screen.id; };
  for (const screen of draft.screens) {
    const before = live.screens.find(row => row.id === screen.id);
    if (!before) rows.push((zh ? "新增页面：" : "New page: ") + title(screen));
    else if (JSON.stringify(before) !== JSON.stringify(screen)) rows.push((zh ? "修改页面：" : "Changed page: ") + title(screen));
  }
  for (const screen of live.screens) if (!draft.screens.some(row => row.id === screen.id)) rows.push((zh ? "移除页面：" : "Removed page: ") + title(screen));
  for (const tab of draft.tabs) {
    const before = live.tabs.find(row => row.slot === tab.slot), label = tab.label[locale] || tab.label.zh;
    if (before && !!before.hidden !== !!tab.hidden) rows.push((tab.hidden ? (zh ? "隐藏底部导航：" : "Hide tab: ") : (zh ? "重新显示底部导航：" : "Show tab: ")) + label);
  }
  const rest = (tabs: RuntimeTabSpec[]) => JSON.stringify(tabs.map(row => ({ ...row, hidden: undefined })));
  if (rest(live.tabs) !== rest(draft.tabs)) rows.push(zh ? "底部导航有调整" : "Tab bar changed");
  return rows;
}

/** Settings that pages use. The canvas opens them one level deeper; they are saved with the Mini Program settings draft. */
export type LibraryKind = "brand" | "stages" | "contacts" | "booking" | "pages" | "forms" | "reports";
export type LibraryTarget = { kind: LibraryKind; id?: string };
export const libraryNames: Record<LibraryKind, { zh: string; en: string }> = {
  brand: { zh: "名称与主题", en: "Name & theme" }, stages: { zh: "学习阶段", en: "Learning stages" }, contacts: { zh: "联系方式", en: "Contacts" },
  booking: { zh: "诊断预约规则", en: "Assessment booking rules" }, pages: { zh: "图文页", en: "Content pages" }, forms: { zh: "表单", en: "Forms" }, reports: { zh: "报告版式", en: "Report layouts" },
};
/** Objects listed under a library entry, or null when the entry is a single settings object. */
export function libraryItems(settings: MiniappSettings, kind: LibraryKind): { id: string; title: { zh: string; en: string }; enabled: boolean }[] | null {
  const x = settings.experience;
  if (kind === "pages" || kind === "reports") return (x?.pages ?? []).filter(page => (page.purpose === "report") === (kind === "reports"));
  if (kind === "forms") return x?.forms ?? [];
  return null;
}
/** Settings not yet moved into the workbench; they open in the original settings page. */
export const moreSettings: { tab: string; zh: string; en: string; href?: string }[] = [
  { tab: "native-pages", zh: "功能页说明与附加内容", en: "Feature page content" }, { tab: "offerings", zh: "服务目录", en: "Services" },
  { tab: "flows", zh: "服务预约流程", en: "Booking flows" }, { tab: "policies", zh: "服务预约规则", en: "Service policies" },
  { tab: "requests", zh: "服务申请受理", en: "Service requests" }, { tab: "notifications", zh: "通知与事件", en: "Notifications" },
  { tab: "resources", zh: "人员与资源", en: "Resources" }, { tab: "dictionaries", zh: "分类与人群", en: "Categories" },
  { tab: "websites", zh: "外部网页", en: "Websites" }, { tab: "connections", zh: "业务连接", en: "Connections" },
  { tab: "documents", zh: "帮助与协议文档", en: "Help & agreements", href: "/dashboard/miniapp-settings/documents" },
];
/** Where the settings behind an existing feature live, shown as "去设置" on blocks that open it. */
export function routeSettings(route: RuntimeRoute): { library: LibraryTarget } | { href: string; zh: string; en: string } | null {
  switch (route) {
    case "assessment": return { library: { kind: "booking" } };
    case "service": return { library: { kind: "contacts" } };
    case "reflections": return { library: { kind: "reports" } };
    case "experience-form": return { library: { kind: "forms" } };
    case "activity-catalog": case "activity-detail": case "activity-requests": case "records": return { href: "/dashboard/activities", zh: "活动", en: "Activities" };
    case "document": return { href: "/dashboard/miniapp-settings/documents", zh: "帮助与协议文档", en: "Help & agreements" };
    case "service-catalog": case "service-detail": return { href: "/dashboard/miniapp-settings?tab=offerings", zh: "服务目录", en: "Services" };
    case "experience-requests": case "provider-bookings": return { href: "/dashboard/miniapp-settings?tab=requests", zh: "服务申请受理", en: "Service requests" };
    case "experience-notifications": return { href: "/dashboard/miniapp-settings?tab=notifications", zh: "通知与事件", en: "Notifications" };
    case "web": return { href: "/dashboard/miniapp-settings?tab=websites", zh: "外部网页", en: "Websites" };
    default: return null;
  }
}

/** JSON with sorted keys, so drafts compare equal regardless of key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, row: unknown) => row && typeof row === "object" && !Array.isArray(row)
    ? Object.fromEntries(Object.entries(row as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : row);
}
/** Plain-language list of library objects that differ from the published settings. */
export function settingsChanges(live: MiniappSettings, draft: MiniappSettings, locale: Locale): string[] {
  const pages = (value: MiniappSettings, report: boolean) => (value.experience?.pages ?? []).filter(page => (page.purpose === "report") === report);
  const sections: [string, (value: MiniappSettings) => unknown][] = [
    [libraryNames.brand[locale], value => value.brand], [libraryNames.stages[locale], value => value.stages],
    [libraryNames.contacts[locale], value => value.contacts ?? null], [libraryNames.booking[locale], value => value.booking ?? null],
    [libraryNames.pages[locale], value => pages(value, false)], [libraryNames.forms[locale], value => value.experience?.forms ?? []],
    [libraryNames.reports[locale], value => [pages(value, true), value.experience?.reportBindings ?? [], value.reports ?? null]],
    [locale === "zh" ? "更多设置" : "More settings", value => ({ ...value, brand: null, stages: null, contacts: null, booking: null, reports: null,
      experience: value.experience ? { ...value.experience, pages: null, forms: null, reportBindings: null } : null })],
  ];
  return sections.filter(([, read]) => stable(read(live)) !== stable(read(draft))).map(([name]) => (locale === "zh" ? "修改资料：" : "Changed settings: ") + name);
}
