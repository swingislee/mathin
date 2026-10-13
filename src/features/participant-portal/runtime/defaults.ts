import type { MiniappAction, MiniappEntry, MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import {
  runtimeText as t, type RuntimeAction, type RuntimeBlockSpec, type RuntimeRule, type RuntimeSpec, type RuntimeStringKey, type RuntimeText,
} from "../../../../contracts/participant-api/runtime";

/** Built-in interface copy; published screens provide their own text. */
export const runtimeStrings: Record<RuntimeStringKey, RuntimeText> = {
  loading: t("正在读取…", "Loading…"), retry: t("重新读取", "Try again"), unavailable: t("内容暂时无法读取，请稍后重试。", "This content is unavailable. Please try again."),
  signIn: t("登录", "Sign in"), signInPrompt: t("登录后查看个人安排与记录", "Sign in to view your arrangements and records"), signOut: t("退出登录", "Sign out"),
  today: t("今", "Today"), weekdays: t("一,二,三,四,五,六,日", "M,T,W,T,F,S,S"), all: t("全部", "All"), close: t("关闭", "Close"),
  updateRequired: t("此内容需要更新小程序后查看", "Update the Mini Program to view this content"), choose: t("请选择", "Choose"), clear: t("清除筛选", "Clear filters"),
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

function discoverBlocks(settings: MiniappSettings): RuntimeBlockSpec[] {
  const blocks: RuntimeBlockSpec[] = [];
  if (settings.brand.image || settings.brand.introduction.zh || settings.brand.introduction.en) blocks.push({ id: "brand", type: "section", title: t(), style: "plain", blocks: [
    ...(settings.brand.image ? [{ id: "brand-image", type: "image", image: settings.brand.image, fit: "width" } as const] : []),
    ...(settings.brand.introduction.zh || settings.brand.introduction.en ? [{ id: "brand-introduction", type: "text", text: settings.brand.introduction, tone: "muted" } as const] : []),
  ] });
  for (const row of settings.home.filter(item => item.visible)) {
    const action = legacyAction(row.action, row.target);
    if (row.type === "feature") blocks.push({ id: row.id, type: "feature", title: row.title, body: row.body, image: row.image || "asset:appointment", ...(action ? { action } : {}) });
    else if (row.type === "activities") blocks.push({ id: row.id, type: "list", title: row.title, source: "activities.catalog", template: "card", limit: row.limit,
      empty: t("暂无符合条件的公益活动", "No matching community activities"), facets: ["stage", "topic"], actionLabel: t("报名参与", "Apply to join"),
      more: { label: t("查看全部", "View all"), action: { type: "route", route: "activity-catalog" } } });
    else if (row.type === "image" && row.image) blocks.push({ id: row.id, type: "image", image: row.image, fit: "width", ...(action ? { action } : {}) });
    else blocks.push({ id: row.id, type: "section", title: row.title, style: "card", blocks: [{ id: row.id + "-body", type: "text", text: row.body, tone: "body" }],
      ...(action ? { more: { label: t("查看", "Open"), action } } : {}) });
  }
  const floating = entryItems(settings.floating);
  if (floating.length) blocks.push({ id: "floating", type: "entries", title: t(), style: "floating", items: floating });
  return blocks;
}

function accountBlocks(settings: MiniappSettings): RuntimeBlockSpec[] {
  const reservations = (filter: string) => ({ type: "route", route: "reservations", query: { filter } } as const);
  return [
    { id: "identity", type: "account", trailing: { label: t("我的预约", "My reservations"), action: { type: "route", route: "reservations" } } },
    { id: "registration", type: "feature", title: t("参与登记", "Participation form"), body: t("去填写", "Fill in"), image: "asset:icons/form",
      action: { type: "route", route: "register", query: { source: "account" } } },
    { id: "participants", type: "participants", title: t("关联参与人", "Linked participants"), empty: t("暂未关联参与人，请联系工作人员。", "No participant linked. Contact staff.") },
    { id: "bookings", type: "entries", title: t(), style: "grid", visibleWhen: { kind: "signedIn" }, items: [
      { id: "upcoming", label: t("待参与", "Upcoming"), icon: "reservations", action: reservations("upcoming") },
      { id: "attended", label: t("已参与", "Attended"), icon: "complete", action: reservations("attended") },
      { id: "cancelled", label: t("已取消", "Cancelled"), icon: "cancel", action: reservations("cancelled") },
      { id: "all", label: t("全部预约", "All bookings"), icon: "ticket", action: reservations("all") },
    ] },
    ...settings.accountGroups.flatMap((group): RuntimeBlockSpec[] => {
      const items = entryItems(group.entries);
      return items.length ? [{ id: "menu-" + group.id, type: "entries", title: group.title, style: "grid", items }] : [];
    }),
    { id: "privacy", type: "button", label: t("隐私说明", "Privacy"), appearance: "link", action: { type: "route", route: "document", query: { id: "privacy" } } },
    { id: "sign-out", type: "button", label: t("退出登录", "Sign out"), appearance: "secondary", action: { type: "logout" }, visibleWhen: { kind: "signedIn" } },
  ];
}

/** Until Mathin publishes a runtime specification, clients receive the current published home and menu settings in runtime form. */
export function defaultRuntimeSpec(settings: MiniappSettings): RuntimeSpec {
  return {
    version: 1,
    tabs: [
      { slot: 1, screen: "discover", label: t("发现", "Discover"), icon: "discover" },
      { slot: 2, screen: "calendar", label: t("日历", "Calendar"), icon: "calendar" },
      { slot: 3, screen: "account", label: t("我的", "Account"), icon: "account" },
    ],
    screens: [
      { id: "discover", title: settings.brand.name, navigation: "brand", blocks: discoverBlocks(settings) },
      { id: "calendar", title: t("日历", "Calendar"), navigation: "title", blocks: [
        { id: "participant", type: "participants", title: t(), empty: t("暂未关联参与人，请联系工作人员。", "No participant linked. Contact staff.") },
        { id: "week", type: "calendar", title: t("本周日历安排", "This week’s calendar"), empty: t("暂无安排", "No arrangements"),
          more: { label: t("全部安排", "All arrangements"), action: { type: "route", route: "agenda" } } },
      ] },
      { id: "account", title: t("我的", "Account"), navigation: "title", blocks: accountBlocks(settings) },
    ],
  };
}
