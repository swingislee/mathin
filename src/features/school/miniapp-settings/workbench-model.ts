import { experienceText as t, localText, type ExperienceAction, type ExperienceText, type MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { nativeScreens, nativeActionScreens } from "../../../../contracts/participant-api/miniapp-native";
import { accountRecordTargets } from "../../../../contracts/participant-api/miniapp-records";

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

export { nativeScreens };

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
    const screenId = nativeActionScreens[a.kind === "native" ? a.target : a.kind];
    if (screenId && !targetTab) add(fromTab, id, label, "native-pages", screenId, "进入功能页面", "Opens a feature screen");
  };
  for (const screen of x.screens || []) for (const id of [screen.beforePageId, screen.afterPageId]) add("native-pages", screen.id, nativeScreens.find(s => s.id === screen.id)!.title, "pages", id, "引用共用内容", "Shared content");
  add("home", "", t("发现首页", "Discovery home"), "pages", x.homePageId, "使用页面", "Uses page");
  for (const p of x.pages) for (const b of p.blocks) {
    if (b.kind === "action") action(pageTab(p.id), p.id, p.title, b.action);
    if (b.kind === "services") for (const id of b.ids) add(pageTab(p.id), p.id, p.title, "offerings", id, "展示服务", "Displays service");
    if (b.kind === "accountRecords") add(pageTab(p.id), p.id, p.title, "native-pages", nativeActionScreens[accountRecordTargets[b.source]], "读取本人记录并进入详情", "Reads personal records and opens details");
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
  if (tab === "native-pages") return localText(nativeScreens.find(s => s.id === id)?.title, locale);
  const collections: Record<string, { id: string; name?: ExperienceText; title?: ExperienceText }[]> = { pages: x.pages, reports: x.pages, offerings: x.services, forms: x.forms, flows: x.flows, policies: x.policies, connections: x.connections, resources: x.resources, websites: x.destinations, notifications: x.notifications, dictionaries: x.dictionaries };
  const item = collections[tab]?.find(v => v.id === id);
  return localText(item?.name || item?.title, locale) || (id ? (locale === "zh" ? "引用的对象已移除" : "Referenced object removed") : "");
}
