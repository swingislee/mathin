import type { MiniappAction, MiniappEntry, MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { nativeScreenConfig } from "../../../../contracts/participant-api/miniapp-native";
import {
  runtimeText as t, type RuntimeAction, type RuntimeBlockSpec, type RuntimeRule, type RuntimeSpec, type RuntimeStringKey, type RuntimeText,
} from "../../../../contracts/participant-api/runtime";

/** Built-in interface copy; published screens provide their own text. */
export const runtimeStrings: Record<RuntimeStringKey, RuntimeText> = {
  loading: t("正在读取…", "Loading…"), retry: t("重新读取", "Try again"), unavailable: t("内容暂时无法读取，请稍后重试。", "This content is unavailable. Please try again."),
  signIn: t("登录", "Sign in"), signInPrompt: t("登录后查看个人安排与记录", "Sign in to view your arrangements and records"), signOut: t("退出登录", "Sign out"),
  today: t("今", "Today"), weekdays: t("一,二,三,四,五,六,日", "M,T,W,T,F,S,S"), all: t("全部", "All"), close: t("关闭", "Close"),
  updateRequired: t("此内容需要更新小程序后查看", "Update the Mini Program to view this content"), choose: t("请选择", "Choose"), clear: t("清除筛选", "Clear filters"),
  account: t("我的账号", "My account"), view: t("查看", "View"), chooseParticipant: t("选择参与人", "Choose participant"),
  noParticipants: t("暂未关联参与人，请联系工作人员。", "No participant linked. Contact staff."), signInNow: t("点击登录", "Sign in"),
  more: t("加载更多", "Load more"), search: t("搜索", "Search"), submit: t("提交", "Submit"), submitted: t("已提交", "Submitted"),
  required: t("请完成标 * 的项目", "Complete the items marked *"), upload: t("添加", "Add"), uploading: t("正在上传…", "Uploading…"),
  uploadFailed: t("文件未能上传，请重试", "The file was not uploaded. Try again."), chooseAddress: t("选择收货地址", "Choose address"),
  confirm: t("确定", "OK"), cancel: t("取消", "Cancel"), saved: t("已保存", "Saved"), opening: t("正在打开…", "Opening…"),
  updateReady: t("新版本已准备好，重启后使用", "A new version is ready. Restart to use it."), updateLatest: t("已是最新版本", "You have the latest version"),
  cacheCleared: t("缓存已清理", "Cache cleared"), play: t("播放", "Play"), pause: t("暂停", "Pause"), next: t("下一首", "Next"), previous: t("上一首", "Previous"),
  done: t("完成", "Done"),
};

/** Existing published menu actions keep opening the same native pages while those pages move to runtime screens. */
export function legacyAction(action: MiniappAction, target = ""): RuntimeAction | undefined {
  const query = (key: string) => (target ? { [key]: target } : undefined);
  switch (action) {
    case "none": return undefined;
    case "calendar": return { type: "tab", slot: 2 };
    case "account": case "participants": return { type: "tab", slot: 3 };
    case "activities": return { type: "route", route: "activity-catalog" };
    case "applications": return { type: "route", route: "activity-requests" };
    case "register": return { type: "route", route: "register", query: { source: "account" } };
    case "guardian": return { type: "route", route: "guardian-binding" };
    case "privacy": return { type: "route", route: "document", query: { id: "privacy" } };
    case "document": return { type: "route", route: "document", query: query("id") };
    case "page": return { type: "route", route: "experience", query: query("id") };
    case "offering": return { type: "route", route: "service-detail", query: query("id") };
    case "catalog": return { type: "route", route: "service-catalog", query: query("category") };
    case "form": return { type: "route", route: "experience-form", query: query("id") };
    case "web": return { type: "route", route: "web", query: query("id") };
    case "serviceRequests": return { type: "route", route: "experience-requests" };
    case "serviceBookings": return { type: "route", route: "provider-bookings" };
    case "notifications": return { type: "route", route: "experience-notifications" };
    case "assessment": case "service": case "agenda": case "reflections": case "records": case "reservations":
      return { type: "route", route: action };
  }
}
const audience = (value: MiniappEntry["audience"]): RuntimeRule | undefined =>
  value === "signedIn" ? { kind: "signedIn" } : value === "participants" ? { kind: "hasParticipants" } : undefined;
const entryItems = (rows: MiniappEntry[]) => rows.flatMap(row => {
  const action = row.visible ? legacyAction(row.action, row.target) : undefined;
  const visibleWhen = audience(row.audience);
  return action ? [{ id: row.id, label: row.title, icon: row.icon, action, ...(visibleWhen ? { visibleWhen } : {}) }] : [];
});

type NativeId = "discover" | "calendar" | "account";
const hasText = (value: RuntimeText | undefined) => !!value && !!(value.zh || value.en);
/** Per-page settings that the original pages honoured: title, tab name, description, surrounding content and module visibility and order. */
function native(settings: MiniappSettings, id: NativeId) {
  const config = nativeScreenConfig(settings.experience?.screens, id);
  const visible = (module: string) => config.modules.find(row => row.id === module)?.visible !== false;
  const order = (group: string[]) => { const ids = config.modules.map(row => row.id).filter(row => group.includes(row)); return [...ids, ...group.filter(row => !ids.includes(row))]; };
  const before: RuntimeBlockSpec[] = [
    ...(hasText(config.description) ? [{ id: id + "-description", type: "text", text: config.description, tone: "muted" } as const] : []),
    ...(config.beforePageId ? [{ id: id + "-before", type: "content", pageId: config.beforePageId } as const] : []),
  ];
  const after: RuntimeBlockSpec[] = config.afterPageId ? [{ id: id + "-after", type: "content", pageId: config.afterPageId }] : [];
  return { config, visible, order, before, after };
}

function discoverBlocks(settings: MiniappSettings): RuntimeBlockSpec[] {
  const page = native(settings, "discover"), blocks: RuntimeBlockSpec[] = [...page.before];
  const filters = page.visible("filters");
  for (const part of page.order(["filters", "brand", "content"])) {
    if (!page.visible(part)) continue;
    if (part === "filters") blocks.push({ id: "filters", type: "filters", clearLabel: t("重置所有筛选", "Reset filters") });
    if (part === "brand" && (settings.brand.image || hasText(settings.brand.introduction))) blocks.push({ id: "brand", type: "section", title: t(), style: "plain", blocks: [
      ...(settings.brand.image ? [{ id: "brand-image", type: "image", image: settings.brand.image, fit: "width" } as const] : []),
      ...(hasText(settings.brand.introduction) ? [{ id: "brand-introduction", type: "text", text: settings.brand.introduction, tone: "muted" } as const] : []),
    ] });
    if (part !== "content") continue;
    if (settings.experience?.homePageId) { blocks.push({ id: "home", type: "content", pageId: settings.experience.homePageId }); continue; }
    for (const row of settings.home.filter(item => item.visible)) {
      const action = legacyAction(row.action, row.target);
      if (row.type === "feature") blocks.push({ id: row.id, type: "feature", title: row.title, body: row.body, image: row.image || "asset:appointment", ...(action ? { action } : {}) });
      else if (row.type === "activities") blocks.push({ id: row.id, type: "list", title: row.title, source: "activities.catalog", template: "card", limit: row.limit,
        empty: t("暂无符合条件的公益活动", "No matching community activities"), facets: filters ? ["stage", "topic"] : [], actionLabel: t("报名参与", "Apply to join"),
        more: { label: t("查看全部", "View all"), action: { type: "route", route: "activity-catalog" } } });
      else if (row.type === "image" && row.image) blocks.push({ id: row.id, type: "image", image: row.image, fit: "width", ...(action ? { action } : {}) });
      else blocks.push({ id: row.id, type: "section", title: row.title, style: "card", blocks: [{ id: row.id + "-body", type: "text", text: row.body, tone: "body" }],
        ...(action ? { more: { label: t("查看", "Open"), action } } : {}) });
    }
  }
  blocks.push(...page.after);
  const floating = page.visible("shortcuts") ? entryItems(settings.floating) : [];
  if (floating.length) blocks.push({ id: "floating", type: "entries", title: t(), style: "floating", items: floating });
  return blocks;
}

function calendarBlocks(settings: MiniappSettings): RuntimeBlockSpec[] {
  const page = native(settings, "calendar");
  return [...page.before,
    ...(page.visible("participant") ? [{ id: "participant", type: "participants", title: t(), style: "picker",
      empty: t("暂未关联参与人，请联系工作人员。", "No participant linked. Contact staff.") } as const] : []),
    ...(page.visible("calendar") ? [{ id: "week", type: "calendar", title: t("本周日历安排", "This week's calendar"), empty: t("暂无安排", "No arrangements"),
      signInLabel: t("登录查看日历", "Sign in for calendar"), more: { label: t("全部安排", "All arrangements"), action: { type: "route", route: "agenda" } } } as const] : []),
    ...page.after];
}

function accountBlocks(settings: MiniappSettings): RuntimeBlockSpec[] {
  const page = native(settings, "account");
  const reservations = (filter: string) => ({ type: "route", route: "reservations", query: { filter } } as const);
  const groups: RuntimeBlockSpec[] = page.visible("menu") ? settings.accountGroups.flatMap((group): RuntimeBlockSpec[] => {
    const items = entryItems(group.entries);
    return items.length ? [{ id: "menu-" + group.id, type: "entries", title: group.title, style: "grid", items }] : [];
  }) : [];
  const modules: Record<string, RuntimeBlockSpec[]> = {
    participants: [{ id: "intake", type: "section", title: t(), style: "row", blocks: [
      { id: "registration", type: "feature", style: "tile", title: t("参与登记", "Participation form"), body: t("去填写", "Fill in"), image: "asset:icons/form",
        action: { type: "route", route: "register", query: { source: "account" } } },
      { id: "participants", type: "participants", style: "tile", title: t("关联参与人", "Linked participants"), empty: t("暂无关联", "None linked") },
    ] }],
    shortcuts: [{ id: "bookings", type: "entries", title: t(), style: "grid", items: [
      { id: "upcoming", label: t("待参与", "Upcoming"), icon: "reservations", action: reservations("upcoming") },
      { id: "attended", label: t("已参与", "Attended"), icon: "complete", action: reservations("attended") },
      { id: "cancelled", label: t("已取消", "Cancelled"), icon: "cancel", action: reservations("cancelled") },
      { id: "all", label: t("全部预约", "All bookings"), icon: "ticket", action: reservations("all") },
    ] }],
    menu: groups.length ? [{ id: "menu", type: "section", title: t(), style: "card", blocks: groups }] : [],
  };
  const privacyListed = groups.some(group => group.type === "entries"
    && group.items.some(item => item.action.type === "route" && item.action.route === "document" && item.action.query?.id === "privacy"));
  return [...page.before,
    { id: "identity", type: "account", trailing: { label: t("我的预约", "My reservations"), action: { type: "route", route: "reservations" } } },
    ...page.order(["participants", "shortcuts", "menu"]).flatMap(part => page.visible(part) ? modules[part] : []),
    ...page.after,
    ...(privacyListed ? [] : [{ id: "privacy", type: "button", label: t("隐私说明", "Privacy"), appearance: "link",
      action: { type: "route", route: "document", query: { id: "privacy" } } } as const]),
  ];
}

/** Until Mathin publishes a runtime specification, clients receive the current published home and menu settings in runtime form. */
/** Until Mathin publishes a runtime specification, clients receive the current published settings in the original page layout. */
export function defaultRuntimeSpec(settings: MiniappSettings): RuntimeSpec {
  const label = (id: NativeId, fallback: RuntimeText) => { const value = native(settings, id).config.tabLabel; return hasText(value) ? value! : fallback; };
  const title = (id: NativeId, fallback: RuntimeText) => { const value = native(settings, id).config.title; return hasText(value) ? value : fallback; };
  return {
    version: 1,
    tabs: [
      { slot: 1, screen: "discover", label: label("discover", t("发现", "Discover")), icon: "discover" },
      { slot: 2, screen: "calendar", label: label("calendar", t("日历", "Calendar")), icon: "calendar" },
      { slot: 3, screen: "account", label: label("account", t("我的", "Account")), icon: "account" },
    ],
    screens: [
      // An empty discover title shows the brand name, as the original page did.
      { id: "discover", title: title("discover", t()), navigation: "brand", blocks: discoverBlocks(settings) },
      { id: "calendar", title: title("calendar", t("日历", "Calendar")), navigation: "title", blocks: calendarBlocks(settings) },
      { id: "account", title: title("account", t("我的", "Account")), navigation: "title", blocks: accountBlocks(settings) },
    ],
  };
}
