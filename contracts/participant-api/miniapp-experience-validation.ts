import { experienceNativeTargets, type ExperienceAction, type ExperienceIssue, type MiniappExperience } from "./miniapp-experience";
import type { MiniappSettings } from "./miniapp-settings";
import { bindingIssue } from "./miniapp-experience-catalog";

/** Cross references and business readiness are checked at publish, so incomplete drafts remain editable. */
export function experienceIssues(value: MiniappExperience, entryActions: ExperienceAction[] = []): ExperienceIssue[] {
  const issues: ExperienceIssue[] = [];
  const add = (path: string, code: string, zh: string, en: string) => issues.push({ path, code, zh, en });
  const checkPage = (id: string, path: string, required = false, report = false) => {
    if ((id || required) && !value.pages.some(p => p.id === id && p.enabled)) add(path, "PAGE_REQUIRED", "请选择已启用的内容页面", "Choose an enabled content page");
    const page = value.pages.find(p => p.id === id);
    if (page && (page.purpose === "report") !== report) add(path, "PAGE_ROLE", report ? "报告绑定需要选择报告版式" : "报告版式由报告记录承载，请选择普通页面", report ? "Choose a report layout" : "Report layouts belong to report records; choose a content page");
  };
  const checkAction = (a: ExperienceAction, path: string) => {
    if (a.kind !== "none" && a.kind !== "catalog" && !a.target) add(path, "TARGET_REQUIRED", "操作入口还没有绑定目标", "This action needs a destination");
    if (a.kind === "native" && !(experienceNativeTargets as readonly string[]).includes(a.target)) add(path, "NATIVE_ACTION", "请选择已有的业务入口", "Choose an available native destination");
    if (a.kind === "page") checkPage(a.target, path, true);
    if (a.kind === "offering" && !value.services.some(s => s.id === a.target && s.enabled)) add(path, "SERVICE_REQUIRED", "请选择已启用的服务", "Choose an enabled service");
    if (a.kind === "form" && !value.forms.some(f => f.id === a.target && f.enabled)) add(path, "FORM_REQUIRED", "请选择已启用的表单", "Choose an enabled form");
    if (a.kind === "web" && !value.destinations.some(d => d.id === a.target && d.enabled && d.url)) add(path, "WEBSITE_REQUIRED", "请选择已启用并填写地址的网页目的地", "Choose an enabled website with a URL");
    if (a.kind === "phone" && !/^\+?\d[\d -]{5,23}$/.test(a.target)) add(path, "PHONE_REQUIRED", "请填写有效的联系电话", "Enter a valid phone number");
  };
  entryActions.forEach((a, i) => checkAction(a, `entries.${i}`));
  for (const screen of value.screens || []) for (const key of ["beforePageId", "afterPageId"] as const) {
    const id = screen[key];
    checkPage(id, `screens.${screen.id}.${key}`);
    // Native shell additions are public editorial content. Private record content stays inside the authenticated controller.
    if (id && value.pages.find(page => page.id === id)?.audience !== "all") add(`screens.${screen.id}.${key}`, "PUBLIC_SCREEN_CONTENT", "原生页面补充说明请选择公开内容；个人记录由原业务模块按权限读取", "Choose public editorial content; personal records remain in their authorized business module");
  }
  if (value.connections.some(c => c.enabled && c.adapter === "mathin" && c.id !== "mathin")) add("connections", "BUILTIN_CONNECTION", "当前业务系统使用固定连接标识 mathin，新的系统请使用外部接口连接", "The current system uses the mathin connection; use an external connection for another system");
  if (value.homePageId) {
    checkPage(value.homePageId, "homePageId", true);
    if (value.pages.find(p => p.id === value.homePageId)?.audience !== "all") add("homePageId", "PUBLIC_HOME", "发现首页需要允许所有人浏览", "The discovery homepage must be public");
  }
  for (const destination of value.destinations.filter(d => d.enabled)) {
    if (!destination.url) add(`destinations.${destination.id}`, "URL_REQUIRED", "网页目的地需要填写 HTTPS 地址", "Enter an HTTPS website URL");
    if (destination.openMode === "webview" && !destination.domainConfirmed) add(`destinations.${destination.id}`, "DOMAIN_REQUIRED", "请完成微信业务域名配置后确认，或先选择复制链接", "Confirm the WeChat business domain setup, or choose Copy link");
    checkPage(destination.returnPageId, `destinations.${destination.id}.returnPageId`);
  }
  for (const page of value.pages.filter(p => p.enabled)) {
    if (!page.title.zh.trim() && !page.title.en.trim()) add(`pages.${page.id}`, "TITLE_REQUIRED", "内容页面需要名称", "The content page needs a title");
    if (!page.blocks.some(b => b.visible)) add(`pages.${page.id}`, "CONTENT_REQUIRED", "内容页面至少保留一个可见模块", "Keep at least one visible content block");
    for (const block of page.blocks.filter(b => b.visible)) {
      if (block.kind === "accountRecords" && page.purpose === "report") add(`pages.${page.id}.${block.id}`, "LIVE_RECORDS_IN_REPORT", "已冻结的报告版式使用本次报告字段；实时个人记录请放在普通页面", "Frozen reports use the report's own fields; place live personal records on a regular page");
      if (block.kind === "action") checkAction(block.action, `pages.${page.id}.${block.id}`);
      if (block.kind === "table" && !block.binding && block.rows.some(row => row.length !== block.columns.length)) add(`pages.${page.id}.${block.id}`, "TABLE_COLUMNS", "表格每行的列数需要一致", "Use the same column count in every table row");
      if (bindingIssue(page, block)) add(`pages.${page.id}.${block.id}`, "DATA_BINDING", "模块需要绑定当前页面场景支持且类型匹配的数据字段", "Bind a field with a compatible type and page context");
      if (block.kind === "chart" && !block.binding) add(`pages.${page.id}.${block.id}`, "CHART_SOURCE", "图表需要绑定数值序列", "Charts need a measurement series");
    }
  }
  for (const form of value.forms.filter(f => f.enabled)) {
    if (!form.groups.some(g => g.fields.length)) add(`forms.${form.id}`, "FIELDS_REQUIRED", "表单至少需要一个问题", "The form needs at least one question");
    for (const group of form.groups) {
      if (group.minEntries > group.maxEntries || !group.repeat && (group.minEntries !== 1 || group.maxEntries !== 1)) add(`forms.${form.id}.${group.id}`, "REPEAT_COUNT", "请核对问题组的最少与最多份数", "Check the minimum and maximum group counts");
      for (const [index, field] of group.fields.entries()) {
        const path = `forms.${form.id}.${group.id}.${field.id}`;
        if (!field.label.zh.trim() && !field.label.en.trim()) add(path, "LABEL_REQUIRED", "请填写问题名称", "Enter a question label");
        if ((field.type === "select" || field.type === "multiselect") && !field.options.length) add(path, "OPTIONS_REQUIRED", "选择题需要至少一个选项", "Choice questions need at least one option");
        if (field.visibleWhen && !group.fields.slice(0, index).some(f => f.id === field.visibleWhen!.fieldId)) add(path, "CONDITION_ORDER", "显示条件应引用同组前面的问题", "Conditions must reference an earlier question in this group");
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) add(path, "NUMBER_RANGE", "最小值不能大于最大值", "The minimum cannot exceed the maximum");
      }
    }
  }
  for (const flow of value.flows) {
    if (flow.formId && !value.forms.some(f => f.id === flow.formId && f.enabled)) add(`flows.${flow.id}`, "FORM_REQUIRED", "预约流程绑定的表单未启用", "The linked form is not enabled");
    if (flow.policyId && !value.policies.some(p => p.id === flow.policyId)) add(`flows.${flow.id}`, "POLICY_REQUIRED", "预约流程缺少对应规则", "The linked booking policy is missing");
    checkPage(flow.preparationPageId, `flows.${flow.id}.preparationPageId`);
    checkPage(flow.confirmationPageId, `flows.${flow.id}.confirmationPageId`);
    checkAction(flow.completionAction, `flows.${flow.id}.completionAction`);
  }
  for (const policy of value.policies) {
    if (policy.weekdays.some(w => w.start >= w.end) || policy.exceptions.some(e => !e.closed && e.start >= e.end)) add(`policies.${policy.id}`, "TIME_RANGE", "开放时间的结束需要晚于开始", "Opening periods must end after they start");
    if (new Set(policy.exceptions.map(e => e.date)).size !== policy.exceptions.length) add(`policies.${policy.id}`, "DUPLICATE_DATE", "同一天只能设置一条例外规则", "Use one exception per date");
  }
  for (const service of value.services.filter(s => s.enabled)) {
    const path = `services.${service.id}`, flow = value.flows.find(f => f.id === service.flowId);
    if (!service.name.zh.trim() && !service.name.en.trim()) add(path, "NAME_REQUIRED", "服务需要名称", "The service needs a name");
    checkPage(service.detailPageId, path);
    if (!flow) add(path, "FLOW_REQUIRED", "服务需要绑定一个预约流程", "Link a booking flow to this service");
    if (service.resourceIds.some(id => !value.resources.some(r => r.id === id && r.enabled))) add(path, "RESOURCE_REQUIRED", "服务引用了未启用或已移除的资源", "The service references an unavailable resource");
    if (service.binding.adapter === "web" && !value.destinations.some(d => d.id === service.binding.target && d.enabled)) add(path, "WEBSITE_REQUIRED", "服务需要绑定网页目的地", "Link a website destination");
    if (service.binding.adapter === "web" && flow && (flow.mode !== "external" || flow.formId || flow.policyId || flow.confirmationPageId || flow.completionAction.kind !== "none" || flow.consentDocumentIds.length)) add(path, "WEBSITE_FLOW", "网页服务请选择外部服务流程；表单、预约规则和完成页由该网站承接", "Use an external flow; the website handles its forms, booking rules and completion page");
    if (service.binding.adapter === "request" && !flow?.formId) add(path, "FORM_REQUIRED", "意向服务需要绑定登记表单", "Request services need an intake form");
    if (service.binding.adapter === "request" && flow?.mode !== "request") add(path, "REQUEST_FLOW", "收集意向的服务请选择「提交意向后协调」流程", "Use a request-and-coordinate flow for service requests");
    if (service.binding.adapter.startsWith("mathin-")) {
      if (!value.connections.some(c => c.id === "mathin" && c.adapter === "mathin" && c.enabled)) add(path, "BUILTIN_CONNECTION", "请启用当前业务系统连接", "Enable the current business system connection");
      if (flow && (flow.formId || flow.policyId || flow.confirmationPageId || flow.completionAction.kind !== "none" || flow.consentDocumentIds.length || flow.allowMultipleParticipants || !flow.requireParticipant)) add(path, "NATIVE_FLOW_RULES", "现有诊断或活动使用各自的报名表与结果页；此流程可配置详情和参加前说明，通用表单及完成后操作请用于意向登记或外部预约接口", "Current assessments and activities use their own registration forms and result pages; use generic forms and completion actions for requests or external providers");
      if (service.binding.adapter === "mathin-assessment" && service.binding.target) add(path, "NATIVE_TOPICS", "当前诊断入口由参加者选择已开放主题，此处请保留空白", "Participants choose among available assessment topics; leave the target empty");
    }
    if (service.binding.adapter === "mathin-activity" && !/^[0-9a-f-]{36}$/.test(service.binding.target)) add(path, "ACTIVITY_REQUIRED", "请选择要关联的活动", "Choose the linked activity");
    if (service.binding.adapter === "remote") {
      if (flow && !["appointment", "request"].includes(flow.mode)) add(path, "REMOTE_FLOW", "外部预约接口使用时段预约或提交意向流程", "External booking providers use appointment or request flows");
      if (value.resources.some(r => service.resourceIds.includes(r.id) && r.connectionId && r.connectionId !== service.binding.connectionId)) add(path, "RESOURCE_CONNECTION", "预约资源需与服务使用同一业务连接", "Booking resources must use the same provider connection as the service");
      const connection = value.connections.find(c => c.id === service.binding.connectionId && c.enabled && c.adapter === "http-v1");
      if (!connection) add(path, "CONNECTION_REQUIRED", "服务需要绑定已启用的业务连接", "Link an enabled provider connection");
      else if (!connection.capabilities.includes("booking.create") || flow?.mode === "appointment" && !connection.capabilities.includes("availability.read")) add(path, "CAPABILITY_REQUIRED", "连接需要支持预约提交；时段预约还需要可约时间接口", "The connection needs booking creation, plus availability for appointments");
      if (!service.binding.target) add(path, "EXTERNAL_SERVICE_REQUIRED", "请填写外部系统中的服务标识", "Enter the provider's service identifier");
    }
    if (service.price.mode === "online" && service.binding.adapter !== "web") add(path, "PAYMENT_CONNECTION", "在线付款目前由已绑定的外部网页承接；付款接口合同已预留，启用前需接入商户与支付流程", "Online payments currently use a connected website; the payment contract is reserved for a merchant integration");
  }
  for (const rule of value.notifications.filter(n => n.enabled)) {
    if (rule.event === "report.published" && rule.serviceIds.length) add(`notifications.${rule.id}`, "REPORT_NOTIFICATION_SCOPE", "报告发布通知使用全部服务范围，报告权限决定接收人", "Report notifications use all services; report permissions select recipients");
    if (rule.event !== "report.published" && rule.serviceIds.some(id => value.services.find(s => s.id === id)?.binding.adapter.startsWith("mathin-"))) add(`notifications.${rule.id}`, "NATIVE_EVENT_SOURCE", "此通知规则支持通用申请与外部预约，当前业务系统的预约事件尚未接入此规则", "These rules support generic requests and external bookings; native booking events need a separate event adapter");
    if (["waitlist.available", "payment.succeeded", "payment.refunded"].includes(rule.event)) add(`notifications.${rule.id}`, "EVENT_SOURCE_REQUIRED", "此事件已预留合同，尚需提供方接入事件来源；可先保存为停用规则", "This event contract needs a provider event source; save it as a disabled rule for now");
    if (rule.channel !== "inApp" && !value.connections.some(c => c.id === rule.connectionId && c.adapter === "http-v1" && c.enabled && c.capabilities.includes("notifications.send"))) add(`notifications.${rule.id}`, "NOTIFICATION_CONNECTION", "消息渠道尚未绑定通知接口", "Connect a notification provider for this channel");
  }
  const reportKeys = new Set<string>();
  for (const binding of value.reportBindings.filter(b => b.enabled)) {
    if (binding.serviceId) add(`reports.${binding.kind}`, "SERVICE_REPORT_ADAPTER", "当前报告使用统一类型模板，按外部服务选模板需接入对应报告适配器", "Current reports use a shared template per kind; service-specific templates need a report adapter");
    checkPage(binding.pageId, `reports.${binding.kind}`, true, true);
    const key = binding.kind + ":" + binding.serviceId;
    if (reportKeys.has(key)) add(`reports.${binding.kind}`, "DUPLICATE_REPORT", "同一报告类型与服务只能启用一个模板", "Enable one template for each report kind and service");
    reportKeys.add(key);
  }
  return issues;
}
export function settingsExperienceIssues(settings: MiniappSettings): ExperienceIssue[] {
  if (!settings.experience) return [];
  const entries = [...settings.floating, ...settings.accountGroups.flatMap(g => g.entries)].filter(e => e.visible);
  const actions = [...entries.map(e => ({ action: e.action, target: e.target, title: e.title })), ...settings.home.filter(b => b.visible).map(b => ({ action: b.action, target: b.target, title: b.title }))]
    .filter(e => ["page", "offering", "catalog", "form", "web"].includes(e.action))
    .map(e => ({ kind: e.action as ExperienceAction["kind"], target: e.target, label: e.title }));
  return experienceIssues(settings.experience, actions);
}
