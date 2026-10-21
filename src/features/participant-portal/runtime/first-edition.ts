import { runtimeText as t, type RuntimeAction, type RuntimeBlockSpec as Block, type RuntimeEntrySpec as Entry, type RuntimeScreenSpec as Screen, type RuntimeSpec } from "../../../../contracts/participant-api/runtime";
import { addRewardScreens } from "../rewards/screens";

const open = (screen: string): RuntimeAction => ({ type: "screen", screen });
const entry = (id: string, zh: string, en: string, icon: string, action: RuntimeAction): Entry => ({ id, label: t(zh, en), icon, action });
const child = (id: string): Block => ({ id, type: "participants", style: "picker", title: t(), empty: t("请先关联孩子", "Link a child first") });
const grid = (id: string, zh: string, en: string, items: Entry[]): Block => ({ id, type: "entries", title: t(zh, en), style: "grid", items });
const list = (id: string, source: Extract<Block, { type: "list" }>["source"], zh = "", en = "", params?: Record<string, string>): Block => ({
  id, type: "list", source, title: t(zh, en), template: "row", limit: 30, empty: t("暂无记录", "No records yet"), actionLabel: t(), facets: [], ...(params ? { params } : {}),
});
const page = (id: string, zh: string, en: string, blocks: Block[]): Screen => ({ id, title: t(zh, en), navigation: "title", blocks });

/** The reference App's work areas, using live sources and existing destinations.
 * Only the first-edition pages are replaced; unrelated pages and form definitions survive. */
export function appFirstEdition(input: RuntimeSpec): RuntimeSpec {
  const base = addRewardScreens(input);
  const existing = new Set(base.screens.map(s => s.id));
  const optional = (screen: string, zh: string, en: string, icon: string): Entry[] => existing.has(screen) ? [entry(screen, zh, en, icon, open(screen))] : [];
  const courses = entry("courses", "我的课程", "My courses", "book", open("courses"));
  const reports = entry("reports", "学习报告", "Reports", "report", open("learning-reports"));
  const assessment = entry("assessment", "诊断结果", "Assessments", "activity", { type: "route", route: "reflections" });
  const growth = entry("growth", "成长中心", "Growth", "gift", open("growth"));
  const screens: Screen[] = [
    { ...page("messages", "消息", "Messages", [
      { id: "message-tabs", type: "tabs", style: "segmented", tabs: [
        { id: "message-all", label: t("全部消息", "All"), blocks: [{ ...list("message-list", "account.notifications"), facets: ["q"] } as Block] },
        { id: "message-unread", label: t("未读消息", "Unread"), blocks: [list("message-unread-list", "account.notifications", "", "", { unread: "true" })] },
        { id: "message-services", label: t("服务进度", "Requests"), blocks: [list("message-requests", "account.requests")] },
      ] },
      grid("message-contact", "", "", [entry("contact", "联系客服", "Contact", "message", { type: "contact" }), ...optional("mailbox", "校长信箱", "Mailbox", "form")]),
    ]), refreshSeconds: 30 },
    page("learning-notice", "通知详情", "Notification", [{ ...list("notice-detail", "account.notice"), template: "message" } as Block]),
    page("course-home", "发现", "Discover", [child("course-child"), grid("course-shortcuts", "", "", [courses, reports, assessment, entry("tasks", "课后任务", "Tasks", "task", open("tasks"))]),
      { id: "course-report", type: "feature", title: t("学习报告", "Learning reports"), body: t("每一份进步，都有记录", "See learning progress over time"), image: "asset:icons/report", action: open("learning-reports") },
      { id: "course-week", type: "calendar", title: t("本周课程", "This week"), empty: t("这一天没有课程安排", "No classes on this day"), weekNavigation: true,
        more: { label: t("全部课表", "Timetable"), action: open("calendar") } },
    ]),
    page("courses", "我的课程", "My courses", [child("courses-child"), { ...list("course-list", "account.courses"), template: "card", facets: ["q"] } as Block]),
    page("course-lessons", "课次安排", "Lessons", [child("lessons-child"), { ...list("lesson-list", "account.lessons"), template: "timeline" } as Block]),
    page("tasks", "任务", "Tasks", [child("task-child"), grid("task-shortcuts", "", "", [
      entry("practice", "课后练习", "Practice", "book", open("practice")), entry("mistakes", "错题复习", "Review", "form", open("learning-mistakes")),
      entry("collection", "成长收藏", "Collection", "gift", open("growth")), entry("checkins", "学习打卡", "Check-ins", "complete", open("checkins")),
    ]), { id: "task-views", type: "tabs", style: "underline", tabs: [
      { id: "task-pending", label: t("待完成", "To do"), blocks: [list("pending-tasks", "account.tasks", "", "", { status: "pending" })] },
      { id: "task-completed", label: t("已提交", "Submitted"), blocks: [list("completed-tasks", "account.tasks", "", "", { status: "submitted" })] },
    ] }]),
    page("practice", "课后练习", "Practice", [child("practice-child"), { id: "practice-tabs", type: "tabs", style: "underline", tabs: [
      { id: "practice-current", label: t("当前练习", "Current"), blocks: [list("practice-current-list", "account.tasks", "", "", { status: "pending" })] },
      { id: "practice-history", label: t("历史练习", "History"), blocks: [list("practice-history-list", "account.tasks", "", "", { status: "submitted" })] },
    ] }]),
    page("learning-reports", "学习报告", "Learning reports", [child("report-child"), list("reports-list", "account.reports")]),
    page("account", "我的", "Me", [
      { id: "family-identity", type: "account", trailing: { label: t("设置", "Settings"), action: open("family-settings") } },
      { id: "family-top", type: "section", style: "row", title: t(), blocks: [
        { id: "family-mailbox", type: "feature", style: "tile", title: t("校长信箱", "Mailbox"), body: t("听听你的想法", "We are listening"), image: "asset:icons/form", action: existing.has("mailbox") ? open("mailbox") : { type: "contact" } },
        { id: "family-children", type: "participants", style: "tile", title: t("我的孩子", "My children"), empty: t("关联孩子", "Link a child") },
      ] },
      { id: "family-services", type: "section", style: "card", title: t(), blocks: [
        grid("family-course-services", "课程服务", "Learning services", [courses, reports, entry("leave", "请假", "Leave", "calendar", existing.has("leave") ? open("leave") : { type: "route", route: "agenda" }),
          entry("tasks", "课后练习", "Practice", "task", open("practice")), assessment, entry("mistakes", "错题复习", "Review", "form", open("learning-mistakes")),
          entry("points", "我的积分", "Points", "complete", open("learning-points")), growth]),
        grid("family-tools", "常用工具", "Tools", [entry("guardian", "共同管理", "Family access", "participants", { type: "route", route: "guardian-binding" }),
          entry("discover", "活动与服务", "Activities", "discover", open("discover")), entry("contact", "联系客服", "Contact", "message", { type: "contact" }),
          entry("settings", "设置", "Settings", "settings", open("family-settings"))]),
      ] },
    ]),
    { ...page("growth", "成长中心", "Growth", [child("growth-child"), { id: "growth-points", type: "metrics", title: t(), columns: 2, items: [], source: "rewards.balance" },
      { id: "growth-draw", type: "feature", title: t("探索新的收藏", "Discover your next collectible"), body: t("查看奖池与规则", "Explore pools and rules"), image: "asset:icons/gift", action: open("learning-draws") },
      grid("growth-tools", "", "", [entry("collection", "我的收藏", "Collection", "book", open("learning-collection")), entry("prizes", "积分兑换", "Rewards", "gift", open("learning-prizes")),
        entry("orders", "获得与领取", "Pickups", "ticket", open("learning-rewards-history")), entry("ledger", "积分明细", "History", "complete", open("learning-points"))]),
      { ...list("growth-collection", "rewards.collection", "最近收藏", "Recent collectibles"), template: "tile", limit: 6 } as Block,
    ]), tone: "night" },
    page("checkins", "我的打卡", "My check-ins", [child("checkin-child"), { id: "checkin-progress", type: "progress", title: t(), items: [], source: "account.checkins" },
      { id: "checkin-action", type: "button", label: t("今日打卡", "Check in today"), appearance: "primary", action: { type: "command", command: "checkin" } },
      list("checkin-history", "account.events", "打卡记录", "History", { command: "checkin" })]),
    page("family-settings", "设置", "Settings", [
      grid("settings-tools", "账号与服务", "Account and services", [entry("privacy", "隐私协议", "Privacy", "privacy", { type: "route", route: "document", query: { id: "privacy" } }),
        entry("guardian", "家庭授权", "Family access", "participants", { type: "route", route: "guardian-binding" }), entry("cache", "清理缓存", "Clear cache", "settings", { type: "clearCache" }),
        entry("update", "检查版本", "Updates", "activity", { type: "update" }), entry("contact", "问题反馈", "Feedback", "message", { type: "contact" })]),
      { id: "settings-logout", type: "button", label: t("退出登录", "Sign out"), appearance: "secondary", action: { type: "logout" }, visibleWhen: { kind: "signedIn" } },
    ]),
  ];
  const replacements = new Map(screens.map(s => [s.id, s]));
  const merged = base.screens.map(s => replacements.get(s.id) ?? s);
  for (const s of screens) if (!base.screens.some(old => old.id === s.id)) merged.push(s);
  return { ...base, presentation: "app", tabs: [
    { slot: 1, order: 1, screen: "course-home", label: t("发现", "Discover"), icon: "discover" },
    { slot: 2, order: 2, screen: "calendar", label: t("日历", "Calendar"), icon: "calendar" },
    { slot: 3, order: 3, screen: "account", label: t("我的", "Me"), icon: "account" },
    { slot: 4, order: 4, screen: "tasks", label: t("任务", "Tasks"), icon: "task", hidden: true },
    { slot: 5, order: 5, screen: "messages", label: t("消息", "Messages"), icon: "message", hidden: true },
  ], screens: merged.map(s => s.id === "learning-mistakes" || s.id === "learning-mistake" ? { ...s, refreshSeconds: 15 } : s.id === "calendar" ? { ...s, title: t("日历", "Calendar") } : s) };
}
