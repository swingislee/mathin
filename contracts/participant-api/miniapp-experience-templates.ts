import { experienceText as t, type ContentBlock, type ContentBlockKind, type ContentDocument, type ExperienceAction, type ExperienceForm, type MiniappExperience, type SchedulingPolicy } from "./miniapp-experience";
import type { MiniappSettings } from "./miniapp-settings";

const base = (id: string) => ({ id, version: 1 as const, visible: true });
const paragraph = (id: string, zh: string, en: string, binding = ""): ContentBlock => ({ ...base(id), kind: "paragraph", text: t(zh, en), binding, tone: "neutral" });
const heading = (id: string, zh: string, en: string): ContentBlock => ({ ...base(id), kind: "heading", text: t(zh, en), level: 2 });
const action = (id: string, kind: ExperienceAction["kind"], target: string, zh: string, en: string): ContentBlock => ({ ...base(id), kind: "action", action: { kind, target, label: t(zh, en) }, appearance: "primary" });
const page = (id: string, zh: string, en: string, purpose: ContentDocument["purpose"], blocks: ContentBlock[]): ContentDocument => ({
  id, version: 1, title: t(zh, en), description: t(), purpose, audience: purpose === "report" ? "participants" : "all", enabled: true, layout: "reading", blocks,
});

export const contentKindNames: Record<ContentBlockKind, { zh: string; en: string }> = {
  heading: t("章节标题", "Heading"), paragraph: t("富文本正文", "Rich text"), image: t("图片与说明", "Image"), callout: t("提示说明", "Callout"), quote: t("引用与观察", "Quotation"),
  bullets: t("要点列表", "Bullet list"), steps: t("步骤与时间线", "Steps"), facts: t("资料与键值", "Facts"), table: t("对照表格", "Table"), faq: t("常见问题", "FAQ"),
  action: t("操作入口", "Action"), divider: t("分隔线", "Divider"), services: t("服务目录", "Services"), activities: t("活动目录", "Activities"), contacts: t("服务联系人", "Contacts"),
  metric: t("指标与分值", "Metric"), scale: t("表现等级", "Scale"), evidence: t("表现与证据", "Evidence"),
  chart: t("数据图表", "Data chart"),
  accountRecords: t("我的业务记录", "My records"),
};
export function newContentBlock(kind: ContentBlockKind, id: string): ContentBlock {
  const common = base(id);
  if (kind === "accountRecords") return { ...common, kind, title: contentKindNames[kind], source: "serviceBookings", limit: 3, emptyText: t("暂无相关记录", "No records yet"), density: "comfortable" };
  if (kind === "heading") return { ...common, kind, text: t("新章节", "New section"), level: 2 };
  if (kind === "paragraph" || kind === "callout" || kind === "quote") return { ...common, kind, text: t(), binding: "", tone: "neutral" };
  if (kind === "image") return { ...common, kind, image: "", caption: t(), fit: "contain" };
  if (kind === "bullets" || kind === "steps" || kind === "facts" || kind === "faq") return { ...common, kind, title: t(), items: [{ id: "item-1", title: t(), body: t() }], binding: "" };
  if (kind === "table") return { ...common, kind, title: t(), columns: [t("项目", "Item"), t("说明", "Details")], rows: [[t(), t()]], binding: "" };
  if (kind === "action") return action(id, "none", "", "了解更多", "Learn more");
  if (kind === "divider") return { ...common, kind };
  if (kind === "services" || kind === "activities" || kind === "contacts") return { ...common, kind, title: contentKindNames[kind], ids: [], limit: 6, emptyText: t("暂时没有可展示的内容", "Nothing is available yet"), layout: "list" };
  if (kind === "metric") return { ...common, kind, title: t("表现概览", "Overview"), binding: "report.score", unit: t(), description: t() };
  if (kind === "scale") return { ...common, kind, title: t("表现等级", "Performance level"), binding: "report.assessmentBand", labels: [t("起步", "Starting"), t("发展中", "Developing"), t("熟练", "Proficient")], description: t() };
  if (kind === "chart") return { ...common, kind, title: t("本次表现", "Performance"), binding: "report.scoreBreakdown", chart: "donut", description: t() };
  return { ...common, kind: "evidence", title: t("表现依据", "Evidence"), binding: "report.evidence", emptyText: t() };
}

export function experiencePageTemplates(): ContentDocument[] {
  return [
    page("home", "发现与预约", "Discover and book", "page", [
      heading("welcome", "找到适合的活动与服务", "Find an activity or service"),
      paragraph("intro", "查看服务介绍、参加方式与可约安排，再选择适合自己的下一步。", "Explore services, participation details and available arrangements, then choose your next step."),
      { ...base("services"), kind: "services", title: t("预约服务", "Book a service"), ids: [], limit: 6, emptyText: t("服务正在准备中", "Services are being prepared"), layout: "list" },
      { ...base("activities"), kind: "activities", title: t("近期活动", "Upcoming activities"), ids: [], limit: 4, emptyText: t("新的活动发布后会显示在这里", "New activities will appear here when published"), layout: "list" },
      { ...base("how"), kind: "steps", title: t("如何参与", "How to participate"), binding: "", items: [
        { id: "choose", title: t("了解内容", "Explore"), body: t("阅读服务或活动详情，核对适用对象与参加说明。", "Read the details and check who the service is for and how to participate.") },
        { id: "book", title: t("选择安排", "Choose an arrangement"), body: t("按服务提供的方式选择时段或提交参与意向。", "Choose an available time or submit a request using the service's booking method.") },
        { id: "follow", title: t("查看后续", "Follow your request"), body: t("在记录中查看处理结果和参加安排。", "Check your records for updates and participation details.") },
      ] },
      action("contact", "native", "service", "联系服务人员", "Contact service"),
    ]),
    page("assessment-service", "学习诊断", "Learning assessment", "service", [
      heading("intro", "从实际表现了解学习情况", "Understand learning through observation"),
      paragraph("description", "通过安排的诊断任务与老师观察，记录当前表现，讨论适合的后续学习方向。具体内容以所选诊断主题与服务说明为准。", "Use the assessment tasks and teacher observations to record current performance and discuss possible next steps. The selected assessment topic and service details define the actual content."),
      { ...base("steps"), kind: "steps", title: t("预约与参加", "Booking and participation"), binding: "", items: [
        { id: "participant", title: t("选择参与人和主题", "Choose participant and topic"), body: t("核对参与人资料，并选择当前提供的诊断主题。", "Check the participant details and choose an available assessment topic.") },
        { id: "time", title: t("选择已发布的可约安排", "Choose an available arrangement"), body: t("查看老师、地点和时间，确认后提交预约。", "Review the teacher, location and time before submitting the booking.") },
        { id: "result", title: t("参加与后续反馈", "Participate and receive feedback"), body: t("按确认安排参加；老师发布反馈后，可在自己的记录中查看。", "Attend as arranged. Published feedback can then be viewed in your records.") },
      ] },
      { ...base("prepare"), kind: "callout", text: t("预约前请核对时间与参加方式。已有预约的变更，以该预约显示的规则为准。", "Check the time and participation method before booking. Changes to an existing booking follow the rules shown on that booking."), binding: "", tone: "notice" },
      action("book", "native", "assessment", "查看诊断主题与时间", "Choose a topic and time"),
      { ...base("faq"), kind: "faq", title: t("预约前常见问题", "Before you book"), binding: "", items: [
        { id: "no-time", title: t("没有合适时间怎么办？", "What if no time suits me?"), body: t("可联系服务人员，了解后续安排。", "Contact the service team to discuss possible arrangements.") },
        { id: "cancel", title: t("预约后如何取消？", "How do I cancel a booking?"), body: t("打开预约记录查看可用操作；超过自助取消期限时，请联系服务人员。", "Open the booking record to see available actions. Contact the service team after the self-service cancellation deadline.") },
      ] },
    ]),
    page("preparation", "参加前准备", "Before your visit", "preparation", [
      heading("check", "出发前再核对一次", "Check before you leave"),
      { ...base("list"), kind: "bullets", title: t(), binding: "", items: [
        { id: "time", title: t("时间与地点", "Time and location"), body: t("以预约记录中的确认安排为准。", "Follow the confirmed arrangements in your booking.") },
        { id: "materials", title: t("所需资料", "Required information"), body: t("查看服务说明，补齐需要提交的信息。", "Read the service instructions and complete any requested information.") },
      ] }, action("contact", "native", "service", "需要帮助", "Get help"),
    ]),
    page("confirmation", "已收到你的提交", "Your submission was received", "confirmation", [
      heading("received", "接下来可以这样做", "What happens next"),
      paragraph("status", "提交记录已保存。具体预约是否确认，请以记录中的业务状态和服务人员通知为准。", "Your submission has been saved. Check the status in your records and the service team's updates to confirm whether an appointment is arranged."),
      action("records", "native", "applications", "查看参与记录", "View participation records"),
      action("contact", "native", "service", "联系服务人员", "Contact service"),
    ]),
    page("assessment-report", "学习诊断报告", "Learning assessment report", "report", [
      { ...base("context"), kind: "facts", title: t("本次诊断", "Assessment context"), binding: "report.context", items: [] },
      { ...base("score"), kind: "chart", title: t("本次表现", "Performance"), binding: "report.scoreBreakdown", chart: "donut", description: t() },
      { ...base("dimension-bars"), kind: "chart", title: t("分项表现", "Performance by dimension"), binding: "report.dimensionScores", chart: "bars", description: t() },
      { ...base("dimension-radar"), kind: "chart", title: t("能力分布", "Dimension profile"), binding: "report.dimensionScores", chart: "radar", description: t() },
      { ...base("history"), kind: "chart", title: t("历次变化", "Progress over time"), binding: "report.scoreHistory", chart: "trend", description: t("仅比较同一量尺下的已记录结果。", "Compare recorded results on the same scale only.") },
      { ...base("dimensions"), kind: "table", title: t("分项表现", "Performance by task"), columns: [], rows: [], binding: "report.dimensions" },
      heading("observation-heading", "老师如何看待这些表现", "Teacher observations"),
      paragraph("observation", "", "", "report.summary"),
      { ...base("evidence"), kind: "evidence", title: t("表现与依据", "Observations and evidence"), binding: "report.evidence", emptyText: t() },
      { ...base("strengths"), kind: "callout", text: t(), binding: "report.strengths", tone: "accent", condition: { field: "report.strengths", operator: "present", value: "" } },
      heading("focus-heading", "接下来值得关注的方向", "Areas to focus on"), paragraph("focus", "", "", "report.focusAreas"),
      heading("next-heading", "下一阶段可以怎样做", "Possible next steps"), paragraph("recommendation", "", "", "report.recommendation"),
    ]),
    page("feedback-report", "活动与学习回顾", "Learning reflection", "report", [
      { ...base("context"), kind: "facts", title: t("本次活动", "Activity context"), binding: "report.context", items: [] },
      heading("observations", "本次观察与反馈", "Observations and feedback"), paragraph("summary", "", "", "report.summary"),
      { ...base("evidence"), kind: "evidence", title: t("相关表现", "Supporting observations"), binding: "report.evidence", emptyText: t() },
      { ...base("score"), kind: "metric", title: t("记录的结果", "Recorded result"), binding: "report.score", unit: t(), description: t(), condition: { field: "report.score", operator: "present", value: "" } },
    ]),
    page("help", "参与与预约帮助", "Participation and booking help", "help", [
      heading("help", "找到当前需要的帮助", "Find the help you need"),
      { ...base("faq"), kind: "faq", title: t(), binding: "", items: [
        { id: "browse", title: t("查看服务需要先登录吗？", "Do I need to sign in to browse?"), body: t("公开介绍可以直接浏览。提交或查看自己的资料时，再按页面提示登录。", "Public information is available without signing in. Sign in when a page requires access to your own information or submissions.") },
        { id: "participant", title: t("怎样关联已有参与人？", "How do I link an existing participant?"), body: t("使用工作人员提供的关联方式，核对资料后主动确认。", "Use the linking method provided by staff and confirm after checking the details.") },
      ] }, action("contact", "native", "service", "联系服务人员", "Contact service"),
    ]),
  ];
}

export function defaultExperienceForm(id = "service-request"): ExperienceForm {
  return { id, version: 1, title: t("咨询与预约意向", "Service enquiry"), introduction: t("留下希望了解的内容，服务人员可据此跟进。这份提交本身不占用预约名额。", "Tell the service team what you would like to discuss. This request does not reserve an appointment."),
    submitLabel: t("提交意向", "Submit request"), successMessage: t("已收到你的意向，可在提交记录中查看。", "Your request was received and is available in your submission records."), audience: "signedIn", enabled: true, purpose: "request",
    groups: [{ id: "request", title: t("希望了解什么", "What would you like to discuss?"), description: t(), repeat: false, minEntries: 1, maxEntries: 1, fields: [
      { id: "topic", type: "select", label: t("主要需求", "Main interest"), help: t(), placeholder: t(), required: true, options: [{ id: "assessment", label: t("学习诊断", "Assessment") }, { id: "activity", label: t("活动安排", "Activities") }, { id: "other", label: t("其他咨询", "Other enquiry") }] },
      { id: "other", type: "text", label: t("请说明希望了解的内容", "Please describe your enquiry"), help: t(), placeholder: t(), required: true, options: [], visibleWhen: { fieldId: "topic", operator: "equals", value: "other" } },
      { id: "note", type: "textarea", label: t("补充说明", "Additional details"), help: t("可补充方便联系的时间或希望讨论的问题。", "You can add a suitable contact time or questions you wish to discuss."), placeholder: t(), required: false, options: [] },
    ] }],
  };
}

export function defaultSchedulingPolicy(): SchedulingPolicy {
  return { id: "default", name: t("默认预约规则", "Default booking policy"), timeZone: "Asia/Shanghai", windowDays: 28, minimumNoticeMinutes: 0,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, slotMinutes: 30, capacity: 1, maxActiveBookings: 10,
    cancellation: "self", cancellationCutoffMinutes: 1440, reschedule: "contact", rescheduleCutoffMinutes: 1440, waitlist: false, confirmation: "automatic", weekdays: [], exceptions: [] };
}
export function defaultMiniappExperience(settings?: MiniappSettings): MiniappExperience {
  const policy = defaultSchedulingPolicy();
  if (settings?.booking) Object.assign(policy, { windowDays: settings.booking.windowDays, minimumNoticeMinutes: settings.booking.bookingCutoffMinutes,
    cancellation: settings.booking.selfCancellation ? "self" : "contact", cancellationCutoffMinutes: settings.booking.cancellationCutoffMinutes });
  return { version: 1, homePageId: "", pages: experiencePageTemplates(), forms: [defaultExperienceForm()], destinations: [], resources: [],
    dictionaries: [{ id: "service-categories", name: t("服务分类", "Service categories"), entries: [{ id: "assessment", label: t("学习诊断", "Assessment"), enabled: true }, { id: "activity", label: t("活动体验", "Activities"), enabled: true }, { id: "consultation", label: t("咨询服务", "Consultation"), enabled: true }] }],
    services: [{ id: "assessment", name: t("学习诊断预约", "Book an assessment"), summary: t("选择诊断主题，查看已发布的可约安排。", "Choose an assessment topic and view available arrangements."), image: "", enabled: true, categoryId: "assessment", audienceTags: [], durationMinutes: 0,
      detailPageId: "assessment-service", flowId: "assessment-flow", resourceIds: [], binding: { adapter: "mathin-assessment", target: "", connectionId: "mathin" }, price: { mode: "free", amountMinor: 0, currency: "CNY", note: t() } }],
    policies: [policy], flows: [{ id: "assessment-flow", name: t("学习诊断预约", "Assessment booking"), mode: "appointment", formId: "", preparationPageId: "preparation", confirmationPageId: "", requireParticipant: true, allowMultipleParticipants: false, policyId: "", consentDocumentIds: [], completionAction: { kind: "none", target: "", label: t() } }],
    connections: [{ id: "mathin", name: t("当前业务系统", "Current business system"), adapter: "mathin", enabled: true, capabilities: ["services.read", "availability.read", "booking.read", "booking.create", "booking.cancel", "forms.submit", "reports.read", "records.read", "participants.read"] }],
    notifications: [], reportBindings: [{ kind: "assessment", pageId: "assessment-report", serviceId: "", enabled: true }, { kind: "feedback", pageId: "feedback-report", serviceId: "", enabled: true }],
  };
}
