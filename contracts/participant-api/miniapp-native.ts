/** Native screen composition shared by authoring, validation and the Mini Program.
 * Sources and commands are registered by the business controller, never supplied as executable configuration.
 */
import { experienceText as t, localText, type ExperienceText, type ExperienceLocale } from "./miniapp-experience";

export const nativeScreenIds = ["discover", "calendar", "account", "onboarding", "guardian-binding", "reservations", "agenda", "reflections", "records", "register", "activity", "activity-catalog", "activity-detail", "activity-signup", "activity-requests", "service", "assessment", "task", "document", "experience", "web", "service-catalog", "service-detail", "experience-form", "experience-requests", "provider-booking", "provider-bookings", "experience-notifications"] as const;
export type NativeScreenId = typeof nativeScreenIds[number];
export const nativeActionScreens: Readonly<Record<string, NativeScreenId>> = {
  assessment: "assessment", activities: "activity-catalog", applications: "activity-requests", service: "service", agenda: "agenda", calendar: "calendar",
  reflections: "reflections", records: "records", participants: "account", register: "register", guardian: "guardian-binding", account: "account", privacy: "document", document: "document",
  page: "experience", offering: "service-detail", catalog: "service-catalog", form: "experience-form", web: "web", reservations: "reservations",
  serviceRequests: "experience-requests", serviceBookings: "provider-bookings", notifications: "experience-notifications",
};
export type NativeModuleKind = "filters" | "identity" | "participants" | "calendar" | "schedule" | "activities" | "services" | "contacts" | "records" | "report" | "task" | "content" | "form" | "slots" | "summary" | "resources" | "navigation" | "consent";
export type NativeModuleDefinition = { id: string; kind: NativeModuleKind; title: ExperienceText; source: string; commands: string[]; required: boolean; compact: boolean };
export type NativeScreenDefinition = { id: NativeScreenId; title: ExperienceText; group: ExperienceText; feature: ExperienceText; modules: NativeModuleDefinition[]; settings: string[]; editor?: string; redirect?: NativeScreenId };
export type NativeModuleConfig = { id: string; title: ExperienceText; visible: boolean; density: "comfortable" | "compact" };
export type NativeScreenConfig = { id: NativeScreenId; title: ExperienceText; tabLabel?: ExperienceText; description: ExperienceText; beforePageId: string; afterPageId: string; modules: NativeModuleConfig[] };
/** Only sibling presentation modules can move. Transaction steps keep their business order. */
export const nativeReorderGroups: Partial<Record<NativeScreenId, string[]>> = {
  discover: ["filters", "brand", "content"], "activity-catalog": ["filters", "content"], account: ["participants", "shortcuts", "menu"],
  "service-catalog": ["shortcuts", "filters", "content"], "service-detail": ["summary", "content", "resources", "preparation"],
};
const m = (id: string, kind: NativeModuleKind, zh: string, en: string, source: string, commands: string[] = [], required = true): NativeModuleDefinition => ({ id, kind, title: t(zh, en), source, commands, required, compact: ["schedule", "activities", "services", "contacts", "records", "report", "resources"].includes(kind) });
const groups = { discovery: t("发现与服务", "Discovery & services"), booking: t("预约与提交", "Bookings & submissions"), records: t("安排与记录", "Arrangements & records"), identity: t("账号与身份", "Account & identity"), support: t("帮助与承载", "Help & hosts") };
const s = (id: NativeScreenId, zh: string, en: string, group: keyof typeof groups, feature: [string, string], modules: NativeModuleDefinition[], settings: string[] = [], editor?: string): NativeScreenDefinition => ({ id, title: t(zh, en), group: groups[group], feature: t(...feature), modules, settings, editor });
export const nativeScreens: NativeScreenDefinition[] = [
  s("discover", "发现首页", "Discover", "discovery", ["浏览公开内容与服务入口", "Browse public content and service entries"], [m("filters", "filters", "活动筛选", "Activity filters", "activityCatalog.facets", ["filter"], false), m("brand", "summary", "品牌介绍", "Brand introduction", "settings.brand", [], false), m("content", "content", "首页编排", "Home composition", "settings.home / experience.homePageId", ["open"]), m("shortcuts", "navigation", "快捷入口", "Shortcuts", "settings.floating", ["open"], false)], ["home", "menus", "brand", "stages"]),
  s("activity-catalog", "公益活动目录", "Community activities", "discovery", ["筛选并查看已公开的活动", "Filter and view published activities"], [m("filters", "filters", "活动筛选", "Activity filters", "activityCatalog.facets", ["filter"], false), m("content", "activities", "活动列表", "Activity list", "activityCatalog.offers", ["open"])], ["stages"], "activities"),
  s("activity-detail", "活动详情", "Activity details", "discovery", ["阅读活动介绍并进入报名", "Read activity details and enter signup"], [m("content", "content", "活动图文与资料", "Activity content and information", "activityOffer.presentation", ["previewImage"]), m("help", "navigation", "联系服务", "Contact service", "activityOffer.registration", ["contact"], false)], [], "activities"),
  s("service-catalog", "服务目录", "Services", "discovery", ["按分类选择已启用服务", "Choose an enabled service by category"], [m("shortcuts", "navigation", "个人记录入口", "Personal record links", "account", ["requests", "bookings", "notifications"], false), m("filters", "filters", "服务分类", "Service categories", "experience.dictionaries", ["filter"], false), m("content", "services", "服务列表", "Service list", "experience.services", ["open"])], ["offerings", "dictionaries"]),
  s("service-detail", "服务详情", "Service details", "discovery", ["查看服务、资源与参加前说明", "Read the service, resources and preparation"], [m("summary", "summary", "服务资料", "Service summary", "service.document"), m("content", "content", "详情图文", "Detail content", "service.content"), m("resources", "resources", "人员与场地", "People and places", "service.resources", [], false), m("preparation", "content", "参加前说明", "Preparation", "service.preparation")], ["offerings", "pages", "resources", "flows"]),
  s("assessment", "学习诊断预约", "Assessment booking", "booking", ["选择参与人、诊断主题和真实开放时段", "Choose a participant, topics and published availability"], [m("guidance", "content", "预约说明", "Booking guidance", "settings.booking.instructions", [], false), m("booking", "form", "诊断预约及记录", "Assessment booking and history", "account.participants / assessmentOptions / assessmentAvailability / assessmentRequests", ["selectParticipant", "selectSlot", "book", "confirm", "cancel"])], ["booking", "stages"], "assessments"),
  s("activity-signup", "活动报名", "Activity signup", "booking", ["选择参与人并填写活动报名问题", "Choose a participant and answer activity questions"], [m("booking", "form", "参与人、场次与报名表", "Participant, session and signup form", "account.participants / activityOffer.questions", ["selectParticipant", "submit"])], [], "activities"),
  s("experience-form", "服务申请表", "Service request form", "booking", ["填写流程引用的表单并确认协议", "Complete the flow's form and consent"], [m("form", "form", "表单、参与人与确认", "Form, participants and confirmation", "service.flow / service.form / account.participants", ["submit"])], ["forms", "flows"]),
  s("provider-booking", "服务时段预约", "Service time booking", "booking", ["从提供方获取时段并提交预约或改期", "Read provider availability and book or reschedule"], [m("booking", "slots", "时段、表单与确认", "Slots, form and confirmation", "provider.availability / service.flow / service.form", ["selectSlot", "submit", "reschedule"])], ["flows", "forms", "policies", "connections"]),
  s("register", "参与登记", "Registration", "booking", ["填写登记表并查看本人提交历史", "Complete registration and view personal submissions"], [m("registration", "form", "登记表与历史", "Registration and history", "registrationForm / registrationHistory", ["submit", "readMore"])], [], "registration-settings"),
  s("calendar", "日历", "Calendar", "records", ["查看所选参与人的每周安排", "View the selected participant's week"], [m("participant", "participants", "参与人选择", "Participant selector", "account.participants", ["selectParticipant"]), m("calendar", "calendar", "每周日历与安排", "Week and arrangements", "participantCalendar / bookings", ["selectDate", "openAgenda"]) ]),
  s("agenda", "全部安排", "All arrangements", "records", ["按月和日期查看本人安排", "Browse personal arrangements by month and date"], [m("participant", "participants", "参与人选择", "Participant selector", "account.participants", ["selectParticipant"]), m("calendar", "calendar", "月份与日期", "Month and date", "participantCalendar / bookings", ["selectDate", "selectMonth"]), m("content", "schedule", "当日安排", "Daily arrangements", "participantCalendar / bookings")]),
  s("reservations", "预约记录", "Reservations", "records", ["按状态与参与人查看和取消预约", "View bookings by participant and status"], [m("content", "records", "预约条目", "Booking records", "bookings", ["openAssessment", "cancel"])], ["booking"]),
  s("provider-bookings", "服务预约记录", "Service bookings", "records", ["查看真实状态并改期或取消", "View actual status, reschedule or cancel"], [m("content", "records", "提供方预约", "Provider bookings", "providerBookings", ["refresh", "reschedule", "cancel"])], ["policies", "connections"]),
  s("activity-requests", "活动报名记录", "Activity applications", "records", ["查看报名状态、原回答与处理回复", "View application status, original answers and replies"], [m("filters", "filters", "状态筛选", "Status filters", "activityRequests.status", ["filter"], false), m("content", "records", "报名记录与回答", "Applications and answers", "activityRequests", ["readAnswers", "cancel"])], [], "activities"),
  s("experience-requests", "服务申请记录", "Service requests", "records", ["查看申请与提交时表单快照", "View requests and their original form snapshots"], [m("content", "records", "申请与原始回答", "Requests and original answers", "experienceRequests", ["expand", "cancel", "readMore"])], ["forms", "flows", "requests"]),
  s("reflections", "思考回顾", "Reflections", "records", ["阅读已发布报告和冻结版式", "Read published reports and frozen layouts"], [m("content", "report", "报告列表与详情", "Reports and details", "reports", ["expand"])], ["reports"]),
  s("records", "活动记录", "Activity records", "records", ["查看本人任务与提交状态", "View personal tasks and submission status"], [m("content", "records", "任务记录", "Task records", "tasks", ["openTask"])]),
  s("task", "任务详情", "Task details", "records", ["阅读任务、上传材料并提交", "Read a task, attach evidence and submit"], [m("task", "task", "任务、附件与作答", "Task, evidence and answers", "task / taskSubmissionRules / submissions", ["previewMedia", "submit"])], [], "classes"),
  s("experience-notifications", "服务消息", "Notifications", "records", ["阅读当前账号的服务通知", "Read service notifications for the current account"], [m("content", "records", "通知列表", "Notification list", "experienceNotifications")], ["notifications"]),
  s("account", "我的", "Account", "identity", ["管理账号、参与人与个人服务入口", "Manage the account, participants and service entries"], [m("identity", "identity", "账号身份", "Account identity", "account", ["signIn", "signOut", "bindWechat"]), m("participants", "participants", "登记与参与人", "Registration and participants", "account.participants", ["register", "viewParticipant"]), m("shortcuts", "navigation", "预约快捷入口", "Booking shortcuts", "bookings.status", ["openBookings"], false), m("menu", "navigation", "服务分组入口", "Service entry groups", "settings.accountGroups", ["open"], false)], ["menus", "brand"]),
  s("onboarding", "首次账号资料", "Account onboarding", "identity", ["验证手机号、填写资料与确认协议", "Verify a phone, complete details and confirm consent"], [m("identity", "identity", "身份与登记步骤", "Identity and registration steps", "onboardingPolicy / registrationForm", ["phoneAuthorization", "consent", "complete"])], [], "registration-settings"),
  s("guardian-binding", "关联已有孩子", "Link a child", "identity", ["核对关联邀请、手机号和监护关系", "Verify an invitation, phone and guardian relationship"], [m("identity", "identity", "关联确认", "Guardian link confirmation", "guardianInvitation / guardianPolicy", ["preview", "phoneAuthorization", "consent", "confirm"]) ]),
  s("service", "联系服务", "Contact service", "support", ["按学习阶段与校区联系工作人员", "Find staff contacts by stage and campus"], [m("filters", "filters", "学习阶段与校区", "Stage and campus", "settings.stages / serviceContacts", ["filter"]), m("content", "contacts", "服务联系方式", "Contact details", "serviceContacts", ["call", "previewQr"])], ["contacts", "stages"]),
  s("document", "帮助与协议文档", "Help and agreements", "support", ["按文档版本阅读和确认必要协议", "Read versioned documents and confirm required consent"], [m("content", "consent", "文档正文与必要确认", "Document and required consent", "miniappDocument / consentDocuments", ["consent"])], [], "miniapp-settings/documents"),
  s("experience", "组合页面", "Composed page", "support", ["根据页面定义渲染内容与动作", "Render content and actions from a page definition"], [m("content", "content", "组合内容", "Composed content", "experienceDocument", ["open"])], ["pages", "modules"]),
  s("web", "网页承载", "Website host", "support", ["打开网页目标，失败时复制链接并返回", "Open a website, or copy its URL when unavailable"], [m("content", "navigation", "网页与返回入口", "Website and return links", "webDestination", ["copyLink", "return"])], ["websites"]),
  { ...s("activity", "活动旧链接跳转", "Legacy activity redirect", "support", ["兼容旧链接：有活动标识时转到详情，否则转到目录", "Compatibility route: opens the activity details or catalog"], []), redirect: "activity-detail" },
];

export function nativeScreenDefault(id: NativeScreenId): NativeScreenConfig {
  const definition = nativeScreens.find(s => s.id === id)!;
  return { id, title: t(), ...(["discover", "calendar", "account"].includes(id) ? { tabLabel: t() } : {}), description: t(), beforePageId: "", afterPageId: "", modules: definition.modules.map(m => ({ id: m.id, title: t(), visible: true, density: "comfortable" })) };
}
export function nativeScreenConfig(screens: NativeScreenConfig[] | undefined, id: NativeScreenId): NativeScreenConfig {
  const definition = nativeScreens.find(s => s.id === id)!, saved = Array.isArray(screens) ? screens.find(s => s?.id === id) : undefined, base = nativeScreenDefault(id);
  const savedModules = Array.isArray(saved?.modules) ? saved.modules : [], movable = nativeReorderGroups[id] || [];
  const savedOrder = [...new Set(savedModules.map(m => m?.id).filter(id => movable.includes(id)))];
  const order = [...savedOrder, ...movable.filter(id => !savedOrder.includes(id))];
  let index = 0;
  const definitions = definition.modules.map(m => {
    if (!movable.includes(m.id)) return m;
    const id = order[index++];
    return definition.modules.find(v => v.id === id) || m;
  });
  return { ...base, ...saved, modules: definitions.map(m => {
    const config = savedModules.find(v => v?.id === m.id);
    return { ...base.modules.find(v => v.id === m.id)!, ...config, visible: m.required || config?.visible !== false, density: m.compact && config?.density === "compact" ? "compact" : "comfortable" };
  }) };
}
export function nativeScreenPresentation(screens: NativeScreenConfig[] | undefined, id: NativeScreenId, locale: ExperienceLocale) {
  const config = nativeScreenConfig(screens, id);
  const modules: Record<string, { visible: boolean; title: string; density: string }> = {};
  for (const module of config.modules) modules[module.id] = { visible: module.visible, title: localText(module.title, locale), density: module.density };
  return { id, title: localText(config.title, locale), description: localText(config.description, locale), beforePageId: config.beforePageId, afterPageId: config.afterPageId, modules,
    moduleOrder: config.modules.filter(m => (nativeReorderGroups[id] || []).includes(m.id)).map(m => m.id) };
}
