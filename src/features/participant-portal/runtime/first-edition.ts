import { runtimeText as t, type RuntimeAction, type RuntimeBlockSpec as Block, type RuntimeEntrySpec as Entry, type RuntimeScreenSpec as Screen, type RuntimeSpec } from "../../../../contracts/participant-api/runtime";
import { addRewardScreens } from "../rewards/screens";

const open = (screen: string): RuntimeAction => ({ type: "screen", screen });
const entry = (id: string, zh: string, en: string, icon: string, action: RuntimeAction): Entry => ({ id, label: t(zh, en), icon, action });
const child = (id: string): Block => ({ id, type: "participants", style: "picker", title: t(), empty: t("请先关联参与人", "Link a participant first") });
const grid = (id: string, zh: string, en: string, items: Entry[]): Block => ({ id, type: "entries", title: t(zh, en), style: "grid", items });
const list = (id: string, source: Extract<Block, { type: "list" }>["source"], zh = "", en = "", params?: Record<string, string>): Block => ({
  id, type: "list", source, title: t(zh, en), template: "row", limit: 30, empty: t("暂无记录", "No records yet"), actionLabel: t(), facets: [], ...(params ? { params } : {}),
});
const page = (id: string, zh: string, en: string, blocks: Block[]): Screen => ({ id, title: t(zh, en), navigation: "title", blocks });

/** The reference App's work areas, using live sources and existing destinations.
 * Only the first-edition pages are replaced; unrelated pages and form definitions survive. */
export function appFirstEdition(input: RuntimeSpec): RuntimeSpec {
  // Refresh only the old first-edition UI labels, retaining published forms and real activity names.
  const labels: Record<string, ReturnType<typeof t>> = {
    "请先关联孩子": t("请先关联参与人", "Link a participant first"), "学习成长": t("积分与收藏", "Points and collection"),
    "错题与复习": t("回顾整理", "Review"), "习题记录": t("回顾详情", "Review details"),
    "请从错题列表选择题目": t("请从回顾列表选择题目", "Choose a question from the list"), "学习诊断预约": t("测评预约", "Assessment booking"),
  };
  const relabel = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(relabel);
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    if (typeof row.zh === "string" && typeof row.en === "string" && labels[row.zh]) return labels[row.zh];
    return Object.fromEntries(Object.entries(row).map(([key, child]) => [key, relabel(child)]));
  };
  const base = addRewardScreens({ ...input, screens: input.screens.map(s => s.id.startsWith("learning-") || s.id === "discover" ? relabel(s) as Screen : s) });
  const existing = new Set(base.screens.map(s => s.id));
  const optional = (screen: string, zh: string, en: string, icon: string): Entry[] => existing.has(screen) ? [entry(screen, zh, en, icon, open(screen))] : [];
  const courses = entry("courses", "我的活动", "My activities", "book", open("courses"));
  const reports = entry("reports", "参与记录", "Records", "report", open("learning-reports"));
  const assessment = entry("assessment", "测评记录", "Assessments", "activity", { type: "route", route: "reflections" });
  const growth = entry("growth", "积分与收藏", "Points and collection", "activity", open("growth"));
  const screens: Screen[] = [
    { ...page("messages", "消息", "Messages", [
      { id: "message-tabs", type: "tabs", style: "segmented", tabs: [
        { id: "message-all", label: t("全部消息", "All"), blocks: [{ ...list("message-list", "account.notifications"), facets: ["q"] } as Block] },
        { id: "message-unread", label: t("未读消息", "Unread"), blocks: [list("message-unread-list", "account.notifications", "", "", { unread: "true" })] },
        { id: "message-services", label: t("服务进度", "Requests"), blocks: [list("message-requests", "account.requests")] },
      ] },
      grid("message-contact", "", "", [entry("contact", "联系客服", "Contact", "form", { type: "contact" }), ...optional("mailbox", "意见反馈", "Feedback", "form")]),
    ]), refreshSeconds: 30 },
    page("learning-notice", "通知详情", "Notification", [{ ...list("notice-detail", "account.notice"), template: "message" } as Block]),
    page("course-home", "发现", "Discover", [child("course-child"), grid("course-shortcuts", "", "", [courses, reports, assessment, entry("tasks", "参与任务", "Tasks", "task", open("tasks"))]),
      { id: "course-report", type: "feature", title: t("参与记录", "Participation records"), body: t("回看每一次参与与发现", "Revisit your activities and discoveries"), image: "asset:icons/report", action: open("learning-reports") },
      { id: "course-week", type: "calendar", title: t("本周安排", "This week"), empty: t("这一天没有活动安排", "No activities on this day"), weekNavigation: true,
        more: { label: t("全部安排", "Schedule"), action: open("calendar") } },
    ]),
    page("courses", "我的活动", "My activities", [child("courses-child"),
      grid("activity-tools", "", "", [entry("tasks", "探索任务", "Explore", "task", open("practice")), entry("review", "回顾整理", "Review", "form", open("learning-mistakes"))]),
      { ...list("course-list", "account.courses"), template: "card", facets: ["q"] } as Block]),
    page("course-lessons", "活动场次", "Activity sessions", [child("lessons-child"), { ...list("lesson-list", "account.lessons"), template: "timeline" } as Block]),
    page("tasks", "任务", "Tasks", [child("task-child"), grid("task-shortcuts", "", "", [
      entry("practice", "探索任务", "Explore", "book", open("practice")), entry("mistakes", "回顾整理", "Review", "form", open("learning-mistakes")),
      entry("collection", "成长收藏", "Collection", "activity", open("growth")), entry("checkins", "参与打卡", "Check-ins", "complete", open("checkins")),
    ]), { id: "task-views", type: "tabs", style: "underline", tabs: [
      { id: "task-pending", label: t("待完成", "To do"), blocks: [list("pending-tasks", "account.tasks", "", "", { status: "pending" })] },
      { id: "task-completed", label: t("已提交", "Submitted"), blocks: [list("completed-tasks", "account.tasks", "", "", { status: "submitted" })] },
    ] }]),
    page("practice", "探索任务", "Explore", [child("practice-child"), { id: "practice-tabs", type: "tabs", style: "underline", tabs: [
      { id: "practice-current", label: t("当前练习", "Current"), blocks: [list("practice-current-list", "account.tasks", "", "", { status: "pending" })] },
      { id: "practice-history", label: t("历史练习", "History"), blocks: [list("practice-history-list", "account.tasks", "", "", { status: "submitted" })] },
    ] }]),
    page("learning-reports", "参与记录", "Participation records", [child("report-child"), list("reports-list", "account.reports")]),
    page("account", "我的", "Me", [
      { id: "family-identity", type: "account", trailing: { label: t("设置", "Settings"), action: open("family-settings") } },
      { id: "family-top", type: "section", style: "row", title: t(), blocks: [
        { id: "family-mailbox", type: "feature", style: "tile", title: t("意见反馈", "Feedback"), body: t("听听你的想法", "We are listening"), image: "asset:icons/form", action: existing.has("mailbox") ? open("mailbox") : { type: "contact" } },
        { id: "family-children", type: "participants", style: "tile", title: t("参与人", "Participants"), empty: t("关联参与人", "Link a participant") },
      ] },
      { id: "family-services", type: "section", style: "card", title: t(), blocks: [
        grid("family-course-services", "活动与预约", "Activities and bookings", [
          entry("reservations", "我的预约", "My bookings", "reservations", { type: "route", route: "reservations" }),
          entry("requests", "活动报名", "Activity sign-ups", "ticket", { type: "route", route: "activity-requests" }), courses, reports, assessment,
          entry("calendar", "参与安排", "Schedule", "calendar", open("calendar")),
          entry("points", "我的积分", "Points", "complete", open("learning-points")), growth]),
        grid("family-tools", "常用工具", "Tools", [entry("guardian", "共同管理", "Shared access", "participants", { type: "route", route: "guardian-binding" }),
          entry("discover", "活动与服务", "Activities", "discover", open("discover")), entry("contact", "联系客服", "Contact", "form", { type: "contact" }),
          entry("settings", "设置", "Settings", "account", open("family-settings"))]),
      ] },
    ]),
    { ...page("growth", "积分与收藏", "Points and collection", [child("growth-child"), { id: "growth-points", type: "metrics", title: t(), columns: 2, items: [], source: "rewards.balance" },
      { id: "growth-draw", type: "feature", title: t("探索新的收藏", "Discover your next collectible"), body: t("查看奖池与规则", "Explore pools and rules"), image: "asset:icons/activity", action: open("learning-draws") },
      grid("growth-tools", "", "", [entry("collection", "我的收藏", "Collection", "book", open("learning-collection")), entry("prizes", "积分兑换", "Rewards", "activity", open("learning-prizes")),
        entry("orders", "获得与领取", "Pickups", "ticket", open("learning-rewards-history")), entry("ledger", "积分明细", "History", "complete", open("learning-points"))]),
      { ...list("growth-collection", "rewards.collection", "最近收藏", "Recent collectibles"), template: "tile", limit: 6 } as Block,
    ]), tone: "night" },
    page("checkins", "我的打卡", "My check-ins", [child("checkin-child"), { id: "checkin-progress", type: "progress", title: t(), items: [], source: "account.checkins" },
      { id: "checkin-action", type: "button", label: t("今日打卡", "Check in today"), appearance: "primary", action: { type: "command", command: "checkin" } },
      list("checkin-history", "account.events", "打卡记录", "History", { command: "checkin" })]),
    page("family-settings", "设置", "Settings", [
      grid("settings-tools", "账号与服务", "Account and services", [entry("privacy", "隐私协议", "Privacy", "privacy", { type: "route", route: "document", query: { id: "privacy" } }),
        entry("guardian", "共同管理", "Shared access", "participants", { type: "route", route: "guardian-binding" }), entry("cache", "清理缓存", "Clear cache", "cancel", { type: "clearCache" }),
        entry("update", "检查版本", "Updates", "activity", { type: "update" }), entry("contact", "问题反馈", "Feedback", "form", { type: "contact" })]),
      { id: "settings-logout", type: "button", label: t("退出登录", "Sign out"), appearance: "secondary", action: { type: "logout" }, visibleWhen: { kind: "signedIn" } },
    ]),
  ];
  const replacements = new Map(screens.map(s => [s.id, s]));
  const merged = base.screens.map(s => replacements.get(s.id) ?? s);
  for (const s of screens) if (!base.screens.some(old => old.id === s.id)) merged.push(s);
  return { ...base, presentation: "app", tabs: [
    { slot: 1, order: 1, screen: "discover", label: t("发现", "Discover"), icon: "discover" },
    { slot: 2, order: 2, screen: "calendar", label: t("日历", "Calendar"), icon: "calendar" },
    { slot: 3, order: 3, screen: "account", label: t("我的", "Me"), icon: "account" },
    { slot: 4, order: 4, screen: "tasks", label: t("任务", "Tasks"), icon: "task", hidden: true },
    { slot: 5, order: 5, screen: "messages", label: t("消息", "Messages"), icon: "form", hidden: true },
  ], screens: merged.map(s => s.id === "learning-mistakes" || s.id === "learning-mistake" ? { ...s, refreshSeconds: 15 } : s.id === "calendar" ? { ...s, title: t("日历", "Calendar") } : s) };
}
