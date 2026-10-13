import { experienceText as t, localText, type ExperienceAction, type ExperienceText, type MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

export const workbenchGroups = [
  { id: "presentation", title: t("页面与呈现", "Pages & presentation"), items: [
    ["structure", t("结构关系", "Relationships"), t("查看包含关系与跨层引用，沿着真实对象继续编辑。", "Follow containment and references to edit each object.")],
    ["native-pages", t("现有页面", "Existing screens"), t("按使用场景查看现有小程序页面、组成模块与配置入口。", "Explore current screens, their modules and configuration.")],
    ["home", t("发现首页", "Discovery home"), t("选择首页使用的内容，维护当前首页模块。", "Choose and arrange the discovery homepage.")],
    ["pages", t("组合页面", "Composed pages"), t("页面包含模块；模块引用数据与动作。", "Pages contain modules; modules reference data and actions.")],
    ["reports", t("报告版式", "Report layouts"), t("将真实报告数据绑定到图表、证据和简要说明。", "Bind report measurements to charts, evidence and concise observations.")],
    ["modules", t("模块库", "Module library"), t("同一模块可在多个页面使用，每个实例分别配置内容与数据。", "Reuse rendering modules across pages with separate content and data bindings.")],
  ] },
  { id: "interaction", title: t("导航与动作", "Navigation & actions"), items: [
    ["menus", t("菜单与按钮入口", "Menus & entries"), t("入口定义位置、文字、图标与动作，引用已经定义的目标。", "Entries define placement, labels, icons and actions referencing existing targets.")],
    ["websites", t("网页跳转目标", "Website destinations"), t("登记按钮可打开的网页地址，供页面、菜单和服务引用。", "Define website destinations used by buttons, menus and services.")],
  ] },
  { id: "data", title: t("数据与内容", "Data & content"), items: [
    ["data", t("对象与字段", "Objects & fields"), t("区分业务对象、字段类型、真实数据来源和可用的展示模块。", "Inspect business objects, field types, data sources and compatible modules.")],
    ["forms", t("表单定义", "Form definitions"), t("表单包含问题组和字段；流程通过引用表单收集数据。", "Forms contain groups and fields; flows reference forms to collect answers.")],
    ["dictionaries", t("分类字典", "Dictionaries"), t("为服务与对象提供可重复使用的分类值。", "Define reusable category values.")],
    ["stages", t("学习阶段", "Learning stages"), t("统一维护阶段名称及新选择中的可见性。", "Maintain stage labels and availability in new selections.")],
    ["resources", t("人员与场地", "People & places"), t("定义可被服务引用的人员、地点、房间和设备。", "Define people, locations, rooms and equipment referenced by services.")],
    ["contacts", t("联系资料", "Contact details"), t("维护联系人数据，联系模块与业务入口共同引用。", "Maintain contact data shared by contact modules and service entries.")],
  ] },
  { id: "business", title: t("业务与流程", "Business & flows"), items: [
    ["capabilities", t("功能目录", "Capabilities"), t("功能定义可执行的业务；页面与按钮提供进入功能的位置。", "Capabilities define business operations; pages and buttons provide access.")],
    ["offerings", t("服务定义", "Services"), t("一项服务引用详情页、流程、资源和业务提供方。", "A service references its details, flow, resources and provider.")],
    ["flows", t("预约流程", "Booking flows"), t("流程组织资料收集、参与人、规则、确认与完成后的动作。", "Flows connect intake, participants, rules, confirmation and completion actions.")],
    ["policies", t("通用预约规则", "Provider booking rules"), t("供通用申请与外部预约流程引用的业务约束。", "Rules referenced by generic requests and external booking flows.")],
    ["booking", t("现有测评规则", "Assessment rules"), t("现有测评预约单独使用已发布排班与测评规则。", "Existing assessment bookings use published schedules and assessment rules.")],
    ["notifications", t("事件与通知", "Events & notifications"), t("业务事件触发通知规则，再由指定渠道发送。", "Business events trigger notification rules and delivery channels.")],
  ] },
  { id: "system", title: t("系统与运行", "System & operations"), items: [
    ["brand", t("品牌与外观", "Brand & appearance"), t("统一管理小程序名称、介绍与主题。", "Manage the application name, introduction and theme.")],
    ["connections", t("业务系统连接", "Provider connections"), t("连接声明提供方及实际支持的接口能力。", "Connections identify providers and the capabilities they support.")],
    ["requests", t("申请受理", "Request handling"), t("处理运行中收到的提交，定义与业务记录分别管理。", "Handle submitted requests separately from their definitions.")],
    ["history", t("发布版本", "Publication history"), t("草稿、已发布配置与历史快照分别保留。", "Keep drafts, published configurations and historical snapshots distinct.")],
  ] },
] as const;
export const workbenchItems = workbenchGroups.flatMap(g => g.items.map(([id, title, description]) => ({ id, title, description, group: g.title })));

export type ScreenDefinition = { id: string; title: ExperienceText; group: ExperienceText; modules: ExperienceText[]; settings: string[]; feature: ExperienceText };
const screen = (id: string, zh: string, en: string, group: ExperienceText, modules: [string, string][], settings: string[], feature: [string, string]): ScreenDefinition => ({ id, title: t(zh, en), group, modules: modules.map(([a, b]) => t(a, b)), settings, feature: t(...feature) });
const discover = t("发现与了解", "Discovery"), booking = t("报名与预约", "Booking"), records = t("安排与记录", "Records"), identity = t("账号与参与人", "Identity"), support = t("帮助与承载", "Support");
export const nativeScreens: ScreenDefinition[] = [
  screen("discover", "发现", "Discover", discover, [["阶段与主题筛选", "Stage and topic filters"], ["品牌介绍", "Brand introduction"], ["主推入口与内容模块", "Feature and content modules"], ["活动列表", "Activity list"], ["快捷入口", "Quick entries"]], ["home", "pages", "menus", "brand", "stages"], ["公开浏览活动与服务", "Browse public activities and services"]),
  screen("activity-catalog", "活动目录", "Activity catalog", discover, [["阶段与主题筛选", "Stage and topic filters"], ["活动条目", "Activity rows"]], ["stages"], ["筛选已发布活动", "Filter published activities"]),
  screen("activity-detail", "活动详情", "Activity details", discover, [["封面与摘要", "Cover and summary"], ["活动介绍与场次", "Content and sessions"], ["报名按钮", "Apply button"]], [], ["了解活动后选择场次", "Explore activities and sessions"]),
  screen("service-catalog", "服务目录", "Service catalog", discover, [["分类筛选", "Category filter"], ["服务条目", "Service rows"], ["我的申请、预约与消息入口", "Request, booking and notification entries"]], ["offerings", "dictionaries"], ["查找可用服务", "Find available services"]),
  screen("service-detail", "服务详情", "Service details", discover, [["服务摘要", "Service summary"], ["内容模块", "Content document"], ["资源列表", "Resources"], ["参加前说明", "Preparation"], ["预约按钮", "Booking action"]], ["offerings", "pages", "resources", "flows"], ["进入服务绑定的预约流程", "Start the linked booking flow"]),
  screen("assessment", "测评预约与记录", "Assessment booking", booking, [["参与人与主题选择", "Participant and topic selection"], ["地点与老师选择", "Location and teacher selection"], ["时段表", "Time slots"], ["确认与取消操作", "Confirmation and cancellation"]], ["booking", "stages"], ["现有测评预约", "Book existing assessments"]),
  screen("provider-booking", "服务预约", "Provider booking", booking, [["参与人选择", "Participant selection"], ["可约时段", "Availability"], ["资料表单", "Intake form"], ["协议确认", "Consent"], ["提交与候补", "Submit or waitlist"]], ["offerings", "flows", "forms", "policies", "connections"], ["外部提供方预约", "Book with a provider"]),
  screen("activity-signup", "活动报名", "Activity signup", booking, [["参与人选择", "Participant selection"], ["场次选择", "Session selection"], ["报名问题", "Signup questions"], ["提交确认", "Submission"]], [], ["活动报名", "Apply to an activity"]),
  screen("experience-form", "服务表单", "Service form", booking, [["问题组", "Question groups"], ["条件字段", "Conditional fields"], ["重复填写", "Repeated entries"], ["校验与提交", "Validation and submission"]], ["forms", "flows"], ["资料与意向提交", "Submit intake or enquiries"]),
  screen("register", "参与登记", "Registration", booking, [["个人资料", "Profile fields"], ["登记问题", "Registration questions"], ["协议确认", "Consent"]], [], ["首次参与登记", "Register to participate"]),
  screen("calendar", "日历", "Calendar", records, [["月份与日期", "Month and day selection"], ["安排条目", "Arrangement rows"]], [], ["查看本人安排", "View personal arrangements"]),
  screen("agenda", "全部安排", "All arrangements", records, [["时间分组", "Date groups"], ["安排详情", "Arrangement details"]], [], ["查看待参加事项", "View upcoming arrangements"]),
  screen("reservations", "预约记录", "Reservations", records, [["状态筛选", "Status filters"], ["预约条目", "Booking rows"], ["取消操作", "Cancellation"]], ["booking"], ["管理现有预约", "Manage existing bookings"]),
  screen("provider-bookings", "服务预约记录", "Service bookings", records, [["预约状态", "Booking status"], ["改期与取消", "Reschedule and cancel"]], ["policies", "connections"], ["管理提供方预约", "Manage provider bookings"]),
  screen("activity-requests", "报名记录", "Applications", records, [["报名状态", "Application status"], ["申请详情", "Application details"]], [], ["查看活动申请", "View activity applications"]),
  screen("experience-requests", "服务申请记录", "Service requests", records, [["提交状态", "Submission status"], ["表单快照", "Form snapshot"], ["结果说明", "Confirmation content"]], ["forms", "flows", "requests"], ["跟踪服务意向", "Track service requests"]),
  screen("reflections", "思考回顾", "Reflections", records, [["参与人选择", "Participant selection"], ["报告与图表", "Reports and charts"], ["观察证据", "Evidence"]], ["reports"], ["查看已发布报告", "View published reports"]),
  screen("records", "活动记录", "Activity records", records, [["参与人选择", "Participant selection"], ["活动记录", "Activity records"]], [], ["回顾参与过程", "Review participation"]),
  screen("activity", "活动与学习任务", "Activities and tasks", records, [["活动摘要", "Activity summary"], ["任务列表", "Task list"]], [], ["查看已参与活动", "View joined activities"]),
  screen("task", "任务详情", "Task details", records, [["任务内容", "Task content"], ["作答与材料", "Answers and materials"], ["提交反馈", "Submission feedback"]], [], ["完成已分配任务", "Complete assigned tasks"]),
  screen("experience-notifications", "服务消息", "Notifications", records, [["消息列表", "Notification list"], ["阅读状态", "Read state"]], ["notifications"], ["查看本人的通知", "Read personal notifications"]),
  screen("account", "我的", "Account", identity, [["账号身份", "Account identity"], ["参与人档案", "Participant profiles"], ["预约快捷入口", "Booking shortcuts"], ["服务分组入口", "Service entry groups"]], ["menus", "brand"], ["管理账号与进入个人服务", "Manage the account and personal services"]),
  screen("onboarding", "首次账号资料", "Account onboarding", identity, [["基本资料", "Basic profile"], ["手机号授权", "Phone authorization"], ["协议确认", "Consent"]], [], ["建立账号基础资料", "Complete account information"]),
  screen("guardian-binding", "关联已有孩子", "Link a child", identity, [["关联码输入", "Link code"], ["身份核对", "Identity check"], ["主动确认", "Explicit confirmation"]], [], ["确认监护关联", "Confirm a guardian link"]),
  screen("service", "联系服务", "Contact service", support, [["阶段筛选", "Stage filter"], ["联系人资料", "Contact details"], ["电话与二维码", "Phone and QR code"]], ["contacts", "stages"], ["联系工作人员", "Contact staff"]),
  screen("document", "帮助与协议文档", "Help and agreements", support, [["标题与正文", "Title and document body"]], [], ["阅读已发布文档", "Read published documents"]),
  screen("experience", "组合页面承载", "Composed page host", support, [["页面标题", "Page title"], ["内容模块", "Content modules"], ["数据与动作绑定", "Data and action bindings"]], ["pages", "modules"], ["渲染已发布组合页面", "Render published composed pages"]),
  screen("web", "网页承载", "Website host", support, [["网页容器", "Web view"], ["复制链接与返回", "Copy link and return"]], ["websites"], ["打开已登记的网页目标", "Open a configured website destination"]),
];

export type ObjectReference = { fromTab: string; fromId: string; label: ExperienceText; toTab: string; toId: string; relation: ExperienceText };
export function experienceReferences(config: MiniappSettings): ObjectReference[] {
  const x = config.experience;
  if (!x) return [];
  const result: ObjectReference[] = [];
  const add = (fromTab: string, fromId: string, label: ExperienceText, toTab: string, toId: string, zh: string, en: string) => { if (toId) result.push({ fromTab, fromId, label, toTab, toId, relation: t(zh, en) }); };
  const pageTab = (id: string) => x.pages.find(p => p.id === id)?.purpose === "report" ? "reports" : "pages";
  const action = (fromTab: string, id: string, label: ExperienceText, a: ExperienceAction) => {
    const targetTab = { page: pageTab(a.target), offering: "offerings", form: "forms", web: "websites" }[a.kind as "page" | "offering" | "form" | "web"];
    if (targetTab) add(fromTab, id, label, targetTab, a.target, "打开", "Opens");
  };
  add("home", "", t("发现首页", "Discovery home"), "pages", x.homePageId, "使用页面", "Uses page");
  for (const p of x.pages) for (const b of p.blocks) {
    if (b.kind === "action") action(pageTab(p.id), p.id, p.title, b.action);
    if (b.kind === "services") for (const id of b.ids) add(pageTab(p.id), p.id, p.title, "offerings", id, "展示服务", "Displays service");
  }
  for (const s of x.services) {
    add("offerings", s.id, s.name, "pages", s.detailPageId, "详情页面", "Details page"); add("offerings", s.id, s.name, "flows", s.flowId, "预约流程", "Booking flow");
    add("offerings", s.id, s.name, "connections", s.binding.connectionId, "业务连接", "Provider");
    if (s.binding.adapter === "web") add("offerings", s.id, s.name, "websites", s.binding.target, "打开网页", "Website");
    for (const id of s.resourceIds) add("offerings", s.id, s.name, "resources", id, "使用资源", "Uses resource");
    for (const dictionary of x.dictionaries) if (dictionary.entries.some(e => e.id === s.categoryId || s.audienceTags.includes(e.id))) add("offerings", s.id, s.name, "dictionaries", dictionary.id, "使用分类", "Uses dictionary");
  }
  for (const f of x.flows) {
    add("flows", f.id, f.name, "forms", f.formId, "采集表单", "Intake form"); add("flows", f.id, f.name, "policies", f.policyId, "执行规则", "Policy");
    add("flows", f.id, f.name, "pages", f.preparationPageId, "参加前说明", "Preparation"); add("flows", f.id, f.name, "pages", f.confirmationPageId, "完成说明", "Confirmation"); action("flows", f.id, f.name, f.completionAction);
  }
  for (const n of x.notifications) {
    add("notifications", n.id, n.name, "connections", n.connectionId, "通知渠道", "Delivery provider");
    for (const id of n.serviceIds) add("notifications", n.id, n.name, "offerings", id, "监听服务事件", "Listens for service events");
  }
  for (const r of x.resources) add("resources", r.id, r.name, "connections", r.connectionId, "资源来源", "Resource provider");
  for (const d of x.destinations) add("websites", d.id, d.name, "pages", d.returnPageId, "返回页面", "Return page");
  for (const b of x.reportBindings) if (b.enabled) add("reports", "", t(b.kind === "assessment" ? "测评报告" : "活动反馈", b.kind), "reports", b.pageId, "发布时冻结版式", "Freezes layout on publication");
  for (const e of [...config.floating, ...config.accountGroups.flatMap(g => g.entries)]) action("menus", "", e.title, { kind: e.action as ExperienceAction["kind"], target: e.target, label: e.title });
  for (const e of config.home) action("home", "", e.title, { kind: e.action as ExperienceAction["kind"], target: e.target, label: e.title });
  return result;
}
export function objectTitle(x: MiniappExperience, tab: string, id: string, locale: "zh" | "en") {
  const collections: Record<string, { id: string; name?: ExperienceText; title?: ExperienceText }[]> = { pages: x.pages, reports: x.pages, offerings: x.services, forms: x.forms, flows: x.flows, policies: x.policies, connections: x.connections, resources: x.resources, websites: x.destinations, notifications: x.notifications, dictionaries: x.dictionaries };
  const item = collections[tab]?.find(v => v.id === id);
  return localText(item?.name || item?.title, locale) || (id ? (locale === "zh" ? "引用的对象已移除" : "Referenced object removed") : "");
}
