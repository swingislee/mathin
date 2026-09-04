import type { PermissionKey } from "./permissions";
import type { UserEnvironment } from "@/lib/environment";

/**
 * Dashboard 路由合同（docs/plan/22 §3）。
 *
 * 存在的理由只有一个：**阻止后续 agent 靠目录对称性推断产品结构**。
 * 看到 `students/[studentId]` 旁边没有 `new`、`classes/[classId]` 旁边有，
 * 很容易得出"学生模块缺个新建页"的错误结论——真实原因是学生单个创建只建立
 * 轻量线索档案（Dialog 足够），而建班要过课程/教师/学辅/学期/排课/冲突检查
 * （必须独立 Wizard）。统一的是资源语义，不是目录外形。
 *
 * 因此每条路由都必须显式声明它是哪一类页面、创建入口在哪；`createSurface: "none"`
 * 是一个**主动结论**（这类资源没有普通创建行为），不是"还没做"。
 *
 * 三层职责严格分离（§2.2）：
 *   URL 层级   → 表达真实资源关系（本文件的 href/hrefPattern/parent）
 *   导航分组   → 表达用户功能领域（本文件的 nav.group，与 URL 无关）
 *   代码目录   → 表达开发领域（src/features/**，不受本文件约束）
 *   权限合同   → 表达访问边界（permission / permissionAny）
 *
 * 员工/家庭/学习三套侧栏都从本文件派生，见 ./nav.ts。
 */

/**
 * 页面外壳模式（doc 23 §6）。
 *
 * `page`：普通 Dashboard 页面，`<main>` 是唯一滚动区，正文随之整体滚动。
 * `panel`：专业工作区，`<main>` 不滚动，滚动责任下沉到工作区内部（主区 / Rail）。
 *
 * 放在路由合同里而不是 DashboardShell 里的原因和 §3 一致：外壳模式是**产品结论**
 * （"这个对象是不是需要固定顶栏 + 内部滚动的工作台"），不是路径长相。原来 Shell 自己
 * 按 segment 猜（`segments[1] === "sessions"`…），于是新增一个工作区就得同时改 Shell，
 * 而 Shell 又完全看不到合同——两处各自演化正是素材详情一直漏在 panel 之外的原因。
 */
export type DashboardShellMode = "page" | "panel";

/** 页面类型（§3.1）。 */
export type DashboardRouteKind =
  /** 资源集合，可通过 Dialog 或页面创建。 */
  | "collection"
  /** 稳定 ID 对象工作区。 */
  | "object"
  /** 多步骤、批量或复杂流程。 */
  | "workflow"
  /** 待办、聚合、审阅或时间视图。 */
  | "queue"
  /** 组织级单例配置。 */
  | "singleton"
  /** 诊断、审计或维护工具。 */
  | "tool";

/** 创建方式（§3.2）。 */
export type DashboardCreateSurface =
  /** 在当前页面轻量创建（字段少、无草稿、无需可分享的中间 URL）。 */
  | "dialog"
  /** 独立 `/new` 或专用流程页。 */
  | "page"
  /** 必须在父对象上下文内创建。 */
  | "parent"
  /** 由其他业务流程自动产生。 */
  | "derived"
  /** 不存在普通创建行为（队列 / 单例 / 工具）。 */
  | "none";

/** 员工侧栏分组（§8.1）；只在员工环境渲染分组标题，家庭/学习侧栏是平铺列表。 */
export type SchoolNavGroup =
  | "subjectOperations"
  | "teaching"
  | "research"
  | "organization"
  | "system";

export interface DashboardRouteNav {
  /** `school.nav.*` 翻译键。 */
  readonly labelKey: string;
  /** 仅用于员工侧栏；家庭/学习侧栏忽略分组。 */
  readonly group?: SchoolNavGroup;
}

export interface DashboardRoute {
  /** 静态路由的完整路径；动态路由改用 hrefPattern。 */
  readonly href?: string;
  /** 动态路由模式，例如 `/dashboard/sessions/[sessionId]`。 */
  readonly hrefPattern?: string;
  readonly kind: DashboardRouteKind;
  /** 外壳模式（doc 23 §6）；缺省为 `page`。 */
  readonly shellMode?: DashboardShellMode;
  /** 允许进入该路由的使用环境（§10），不是岗位角色。 */
  readonly environments: readonly UserEnvironment[];
  /** 单一必需权限键。 */
  readonly permission?: PermissionKey;
  /** 任一持有即放行。 */
  readonly permissionAny?: readonly PermissionKey[];
  readonly createSurface: DashboardCreateSurface;
  /** createSurface === "page" 时的创建入口。 */
  readonly createHref?: string;
  /** createSurface === "parent" 时，创建责任归属的路由键。 */
  readonly creationOwner?: string;
  /** URL 上的真实父路由键（只表达资源关系，不表达导航分组）。 */
  readonly parent?: string;
  /** 出现在侧栏时的导航归属；缺省表示该路由不进侧栏。 */
  readonly nav?: DashboardRouteNav;
}

const ALL_ENVIRONMENTS = ["staff", "family", "learning"] as const satisfies readonly UserEnvironment[];
const STAFF_ONLY = ["staff"] as const satisfies readonly UserEnvironment[];

/** 任一财务功能键即显示财务入口（与 finance 页 FINANCE_PERM_KEYS 门控同口径）。 */
export const FINANCE_NAV_PERMS: readonly PermissionKey[] = [
  "finance.order.view",
  "finance.order.create",
  "finance.payment.record",
  "finance.refund.approve",
  "finance.coupon.manage",
  "finance.scholarship.grant",
  "finance.account.adjust",
  "finance.report.view",
];

/** 学生花名册：分配制（assigned）或全量（all）任一即放行，与 students 页自身的 requireAnyPerm 同口径。 */
const STUDENTS_PERMS: readonly PermissionKey[] = ["student.view.assigned", "student.view.all"];

/**
 * 班级：我的班级、全量查看、管理权限任一即放行——resolve_classroom_scope 用这三者中任一
 * 即可解出 all/teaching 之外的可用 scope（support 纯靠 assignment 关系，无法静态权限判定，
 * 维持既有"需手动 ?scope=support"设计不变）。班级页自身走 requireUser + scope 解析，
 * 这里的权限只是侧栏门禁。
 */
const CLASSES_PERMS: readonly PermissionKey[] = ["class.view.mine", "class.view.all", "class.manage"];

/** 课件中台的只读入口与路由 `requireAnyPerm` 使用同一组权限键。 */
const COURSEWARE_PERMS: readonly PermissionKey[] = [
  "courseware.page.edit",
  "courseware.release.publish",
  "courseware.asset.manage",
  "courseware.review",
];

/**
 * 声明顺序即员工侧栏顺序（家庭/学习侧栏在 ./nav.ts 内按各自顺序显式挑选）。
 *
 * 注意 `/dashboard` 本身按当前激活环境分派三套首页（§5.1），环境切换不改根 URL。
 */
export const DASHBOARD_ROUTES = {
  // ── 工作 ────────────────────────────────────────────────────────────────
  home: {
    href: "/dashboard",
    kind: "queue",
    environments: ALL_ENVIRONMENTS,
    createSurface: "none",
    // 总览是侧栏唯一的顶层入口，不再与领域功能混成“工作”分组。
    nav: { labelKey: "home" },
  },
  coordination: {
    href: "/dashboard/coordination",
    kind: "queue",
    environments: STAFF_ONLY,
    createSurface: "none",
    nav: { labelKey: "coordination", group: "subjectOperations" },
  },
  schedule: {
    href: "/dashboard/schedule",
    kind: "queue",
    // 全高日历：周网格自己滚动（横向 + 纵向），日期表头 sticky 贴的是它而不是 <main>。
    shellMode: "panel",
    environments: ALL_ENVIRONMENTS,
    // 课次创建属于班级上下文；课表只做跨班级/教师/课次的聚合时间视图（§5.3）。
    createSurface: "parent",
    creationOwner: "classes",
    nav: { labelKey: "schedule", group: "teaching" },
  },

  // ── 学员服务 ────────────────────────────────────────────────────────────
  leads: {
    href: "/dashboard/leads",
    kind: "queue",
    environments: STAFF_ONLY,
    permission: "followup.view",
    // 种子由外部名单和后续接触事实产生；导入时不创建学生身份。
    createSurface: "derived",
    nav: { labelKey: "leads", group: "subjectOperations" },
  },
  invitations: {
    href: "/dashboard/invitations",
    kind: "queue",
    environments: STAFF_ONLY,
    permissionAny: ["followup.view", "review.write"],
    // 电联只发起邀约；时间、老师与家长确认在这里按状态接续，不创建虚构的日历待办。
    createSurface: "derived",
    nav: { labelKey: "invitations", group: "subjectOperations" },
  },
  assessments: {
    href: "/dashboard/assessments",
    kind: "queue",
    environments: STAFF_ONLY,
    permissionAny: ["review.write", "followup.view"],
    // 已确认的 1 对 1 邀约自动进入这里；首次录入才物化到访事实，不要求提前建 Student。
    createSurface: "derived",
    nav: { labelKey: "assessments", group: "subjectOperations" },
  },
  followups: {
    href: "/dashboard/followups",
    kind: "queue",
    environments: STAFF_ONLY,
    permission: "followup.view",
    // 跟进记录从学生详情或队列行内 FollowUpForm 创建，没有 /followups/new（§5.8）。
    createSurface: "dialog",
    nav: { labelKey: "followups", group: "subjectOperations" },
  },
  students: {
    href: "/dashboard/students",
    kind: "collection",
    environments: STAFF_ONLY,
    permissionAny: STUDENTS_PERMS,
    // 仅在身份已确认时才直接建立学生；完整资料在详情页维护（§5.5）。
    createSurface: "dialog",
    nav: { labelKey: "students", group: "subjectOperations" },
  },
  studentImport: {
    href: "/dashboard/students/import",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "student.import",
    createSurface: "none",
    parent: "students",
  },
  studentDetail: {
    hrefPattern: "/dashboard/students/[studentId]",
    kind: "object",
    environments: STAFF_ONLY,
    permissionAny: STUDENTS_PERMS,
    createSurface: "parent",
    creationOwner: "students",
    parent: "students",
  },
  activities: {
    href: "/dashboard/activities",
    kind: "collection",
    environments: STAFF_ONLY,
    permissionAny: ["activity.register", "review.write", "followup.view"],
    // 活动字段仍属轻量范围 → ActivitiesManager Dialog（§5.9）。
    createSurface: "dialog",
    nav: { labelKey: "activities", group: "subjectOperations" },
  },
  activityDetail: {
    hrefPattern: "/dashboard/activities/[activityId]",
    kind: "object",
    environments: STAFF_ONLY,
    permissionAny: ["activity.register", "review.write", "followup.view"],
    createSurface: "parent",
    creationOwner: "activities",
    parent: "activities",
  },
  // ── 教学 ────────────────────────────────────────────────────────────────
  academicYears: {
    // 学年是教学领域的顶层对象；页面同时承载教学日历和唯一的新班时长默认值。
    href: "/dashboard/academic-years",
    kind: "singleton",
    environments: STAFF_ONLY,
    permission: "schedule.manage",
    createSurface: "dialog",
    nav: { labelKey: "academicYears", group: "teaching" },
  },
  classes: {
    href: "/dashboard/classes",
    kind: "collection",
    environments: STAFF_ONLY,
    permissionAny: CLASSES_PERMS,
    // 建班要过课程版本/主讲/学辅/学期/排课预览/冲突检测 → 完整 Wizard（§5.11）。
    createSurface: "page",
    createHref: "/dashboard/classes/new",
    nav: { labelKey: "classes", group: "teaching" },
  },
  classNew: {
    href: "/dashboard/classes/new",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "class.create",
    createSurface: "none",
    parent: "classes",
  },
  classImport: {
    href: "/dashboard/classes/import",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "class.create",
    createSurface: "none",
    parent: "classes",
  },
  classRosterImport: {
    href: "/dashboard/classes/import/roster",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "enrollment.manage",
    createSurface: "none",
    parent: "classes",
  },
  classDetail: {
    hrefPattern: "/dashboard/classes/[classId]",
    kind: "object",
    environments: STAFF_ONLY,
    permissionAny: CLASSES_PERMS,
    createSurface: "parent",
    creationOwner: "classes",
    parent: "classes",
  },
  sessionDetail: {
    // 课次从多个入口进入，需要稳定的顶层 canonical 详情 URL；但创建责任属于班级（§5.13）。
    hrefPattern: "/dashboard/sessions/[sessionId]",
    kind: "object",
    shellMode: "panel",
    environments: STAFF_ONLY,
    createSurface: "parent",
    creationOwner: "classes",
  },
  sessionMicrocourse: {
    hrefPattern: "/dashboard/sessions/[sessionId]/microcourse",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "courseware.microcourse.author",
    createSurface: "none",
    parent: "sessionDetail",
  },
  courses: {
    href: "/dashboard/courses",
    kind: "collection",
    environments: STAFF_ONLY,
    permission: "course.view",
    createSurface: "page",
    createHref: "/dashboard/courses/new",
    nav: { labelKey: "courses", group: "research" },
  },
  courseNew: {
    href: "/dashboard/courses/new",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "course.product.create",
    createSurface: "none",
    parent: "courses",
  },
  courseFamilyDetail: {
    // 只接受 Course Family ID；旧 Course Variant ID 兼容已删除（§5.16）。
    hrefPattern: "/dashboard/courses/[courseFamilyId]",
    kind: "object",
    environments: STAFF_ONLY,
    permission: "course.view",
    createSurface: "parent",
    creationOwner: "courses",
    parent: "courses",
  },
  teacherMicrocourseSettings: {
    hrefPattern: "/dashboard/courses/[courseFamilyId]/microcourse-settings",
    kind: "singleton",
    environments: STAFF_ONLY,
    permission: "course.view",
    createSurface: "none",
    parent: "courseFamilyDetail",
  },
  teacherMicrocourseCourse: {
    hrefPattern: "/dashboard/courses/[courseFamilyId]/microcourses/[courseId]",
    kind: "object",
    environments: STAFF_ONLY,
    permission: "course.view",
    createSurface: "parent",
    creationOwner: "courseFamilyDetail",
    parent: "courseFamilyDetail",
  },

  // ── 课件 ────────────────────────────────────────────────────────────────
  courseware: {
    href: "/dashboard/courseware",
    kind: "queue",
    environments: STAFF_ONLY,
    permissionAny: COURSEWARE_PERMS,
    createSurface: "none",
    nav: { labelKey: "workbench", group: "research" },
  },
  coursewareReview: {
    href: "/dashboard/courseware/review",
    kind: "queue",
    environments: STAFF_ONLY,
    permission: "courseware.review",
    createSurface: "none",
    parent: "courseware",
    nav: { labelKey: "coursewareReview", group: "research" },
  },
  microcourseReviewDetail: {
    hrefPattern: "/dashboard/courseware/microcourse-reviews/[reviewCycleId]",
    kind: "object",
    environments: STAFF_ONLY,
    permission: "courseware.review",
    createSurface: "parent",
    creationOwner: "coursewareReview",
    parent: "coursewareReview",
  },
  coursewareLecture: {
    // 讲次在课程版本的教学计划中创建，没有 /courseware/lectures/new（§5.19）。
    hrefPattern: "/dashboard/courseware/lectures/[lectureId]",
    kind: "object",
    shellMode: "panel",
    environments: STAFF_ONLY,
    permission: "course.view",
    createSurface: "parent",
    creationOwner: "courses",
    parent: "courseware",
  },
  coursewareAssets: {
    // 保持顶层而非 /courseware/assets：课件素材是独立侧栏入口（§5.20）。
    href: "/dashboard/courseware-assets",
    kind: "collection",
    environments: STAFF_ONLY,
    permission: "courseware.asset.manage",
    // 素材由课件导入/替换流程产生，素材库只负责审计、预览、全局替换与治理（§5.21）。
    createSurface: "derived",
    nav: { labelKey: "sharedAssets", group: "research" },
  },
  coursewareAssetDetail: {
    hrefPattern: "/dashboard/courseware-assets/[assetId]",
    kind: "object",
    // doc 23 §13.1：素材替换是一个双栏专业编辑器（使用树 + 新旧对比 + 决策栏），
    // 不是一张详情页。之前它被 Shell 漏在 panel 之外，外层页面滚动叠着内部长内容。
    shellMode: "panel",
    environments: STAFF_ONLY,
    permission: "courseware.asset.manage",
    createSurface: "derived",
    parent: "coursewareAssets",
  },

  // ── 财务 ────────────────────────────────────────────────────────────────
  finance: {
    // 订单/收款/退款/优惠券/奖学金/学生账户来源各不相同，/finance/new 没有统一语义（§5.4）。
    href: "/dashboard/finance",
    kind: "queue",
    environments: ["staff", "family"],
    permissionAny: FINANCE_NAV_PERMS,
    createSurface: "none",
    // 招生、转化、续费与退费属于同一条学生生命周期，因此财务入口跟随学科运营。
    nav: { labelKey: "finance", group: "subjectOperations" },
  },

  // ── 组织管理 ────────────────────────────────────────────────────────────
  organization: {
    // 机构级单例只维护名称与统一 IANA 时区；语言固定为产品默认中文。
    href: "/dashboard/organization",
    kind: "singleton",
    environments: STAFF_ONLY,
    permission: "organization.profile.manage",
    createSurface: "none",
    nav: { labelKey: "organizationProfile", group: "organization" },
  },
  campuses: {
    // 校区只是教室目录的上一级，创建入口是列表页 Dialog。
    href: "/dashboard/campuses",
    kind: "collection",
    environments: STAFF_ONLY,
    permission: "location.manage",
    createSurface: "dialog",
    nav: { labelKey: "campuses", group: "organization" },
  },
  campusDetail: {
    hrefPattern: "/dashboard/campuses/[campusId]",
    kind: "object",
    environments: STAFF_ONLY,
    permission: "location.manage",
    createSurface: "parent",
    creationOwner: "campuses",
    parent: "campuses",
  },
  staff: {

    // 新员工由员工集合页批量建档；主管持有窄化的 staff.invite 即可进入，
    // 停用员工、修改岗位等完整管理动作仍由 staff.manage 单独控制。
    href: "/dashboard/staff",
    kind: "collection",
    environments: STAFF_ONLY,
    permission: "staff.invite",
    createSurface: "dialog",
    nav: { labelKey: "staff", group: "organization" },
  },
  accessControl: {
    // 岗位权限是独立配置控制台，不依赖具体员工——与 staff 是同级而非父子（§5.23）。
    href: "/dashboard/access-control",
    kind: "singleton",
    environments: STAFF_ONLY,
    permission: "permission.configure",
    createSurface: "dialog",
    nav: { labelKey: "roles", group: "organization" },
  },

  // ── 系统 ────────────────────────────────────────────────────────────────
  accountSecurity: {
    // 每个已登录用户都能管理自己的密码、MFA、会话、同意和权利请求。
    href: "/dashboard/account-security",
    kind: "singleton",
    environments: ALL_ENVIRONMENTS,
    createSurface: "none",
    nav: { labelKey: "accountSecurity", group: "system" },
  },
  accountSupport: {
    // 精确邮箱查找、恢复/封禁/会话撤销与用户权利请求处置共用审计入口。
    href: "/dashboard/account-support",
    kind: "tool",
    environments: STAFF_ONLY,
    permission: "account.support.manage",
    createSurface: "none",
    nav: { labelKey: "accountSupport", group: "system" },
  },
  registrationSettings: {
    // 数据模型是一套组织级注册邀请设置，不是邀请码集合（§5.24）。
    href: "/dashboard/registration-settings",
    kind: "singleton",
    environments: STAFF_ONLY,
    permission: "registration.invite.manage",
    createSurface: "none",
    nav: { labelKey: "registrationInvites", group: "system" },
  },
  systemHealth: {
    // 展示的是系统错误/请求路径/环境/release/roster mismatch，不是业务运营（§5.25）。
    href: "/dashboard/system-health",
    kind: "tool",
    environments: STAFF_ONLY,
    permissionAny: ["audit.view", "system.operations.manage"],
    createSurface: "none",
    nav: { labelKey: "operations", group: "system" },
  },
  capabilityRelease: {
    href: "/dashboard/system-health/capabilities",
    kind: "tool",
    environments: STAFF_ONLY,
    permissionAny: ["audit.view", "system.operations.manage"],
    createSurface: "none",
    parent: "systemHealth",
  },
  dataMaintenance: {
    // R1-7：audit.view 可读取扫描/修复账本；扫描和修复另需 system.operations.manage，永久清理另需 testdata.purge。
    href: "/dashboard/data-maintenance",
    kind: "tool",
    environments: STAFF_ONLY,
    permission: "audit.view",
    createSurface: "none",
    nav: { labelKey: "testdata", group: "system" },
  },

  // ── 家庭 / 学习 ─────────────────────────────────────────────────────────
  children: {
    // 家长只能绑定已有学生（BindCodeForm），不存在 /children/new（§5.27）。
    href: "/dashboard/children",
    kind: "collection",
    environments: ["family"],
    createSurface: "none",
    nav: { labelKey: "children" },
  },
  learningClasses: {
    // 学生的长期班级入口属于学习运行时；教师班级管理只走 /dashboard/classes。
    href: "/dashboard/learning/classes",
    kind: "collection",
    environments: ["learning"],
    createSurface: "none",
    nav: { labelKey: "classes" },
  },
  learningClassDetail: {
    hrefPattern: "/dashboard/learning/classes/[classId]",
    kind: "object",
    environments: ["learning"],
    createSurface: "parent",
    creationOwner: "learningClasses",
    parent: "learningClasses",
  },
  assignments: {
    // 学生与家庭共用作业/课后视频任务入口；均只操作本人或已授权孩子。
    href: "/dashboard/assignments",
    kind: "queue",
    environments: ["learning", "family"],
    createSurface: "none",
    nav: { labelKey: "assignments" },
  },
  coursework: {
    // 学生按真实课务流程查看上课安排、考勤，并发起请假/跟进补课。
    href: "/dashboard/coursework",
    kind: "queue",
    environments: ["learning"],
    createSurface: "none",
    nav: { labelKey: "coursework" },
  },
  progress: {
    // 学习记录只承载已授权给学生的成绩、课评与课堂成果。
    href: "/dashboard/progress",
    kind: "collection",
    environments: ["learning"],
    createSurface: "none",
    nav: { labelKey: "progress" },
  },
  assignmentDetail: {
    hrefPattern: "/dashboard/assignments/[assignmentId]",
    kind: "object",
    environments: ["learning", "family"],
    createSurface: "parent",
    creationOwner: "assignments",
    parent: "assignments",
  },
} as const satisfies Record<string, DashboardRoute>;

export type DashboardRouteKey = keyof typeof DASHBOARD_ROUTES;

/** 取静态路由的 href；动态路由请直接读 hrefPattern 或自行拼接。 */
export function routeHref(key: DashboardRouteKey): string {
  const route: DashboardRoute = DASHBOARD_ROUTES[key];
  if (!route.href) throw new Error(`DASHBOARD_ROUTES.${key} has no static href`);
  return route.href;
}

function segmentsOf(pathname: string): string[] {
  return pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
}

/** 模式段与真实段是否匹配；`[param]` 吃掉任意一段非空内容。 */
function patternMatches(pattern: string, segments: readonly string[]): boolean {
  const patternSegments = segmentsOf(pattern);
  if (patternSegments.length !== segments.length) return false;
  return patternSegments.every((patternSegment, index) =>
    patternSegment.startsWith("[") ? segments[index].length > 0 : patternSegment === segments[index],
  );
}

/**
 * 从合同解析外壳模式（doc 23 §6）。传入的是**已去掉 locale 前缀**的路径，
 * 也就是 `@/i18n/navigation` 的 `usePathname()` 返回值。
 *
 * 只接受完全匹配，不做前缀继承：`/dashboard/courseware` 队列是普通页面，
 * `/dashboard/courseware/lectures/[lectureId]` 才是 panel——按前缀继承会把
 * 队列页一起拖进内部滚动。合同里没有的路径（尚未登记的子路径）一律回落 `page`，
 * 这是安全的默认值：多一个滚动区只是不够好看，少一个会让内容彻底不可达。
 */
export function resolveDashboardShellMode(pathname: string): DashboardShellMode {
  const segments = segmentsOf(pathname);
  if (segments[0] !== "dashboard") return "page";
  for (const route of Object.values(DASHBOARD_ROUTES) as DashboardRoute[]) {
    const pattern = route.href ?? route.hrefPattern;
    if (!pattern) continue;
    if (patternMatches(pattern, segments)) return route.shellMode ?? "page";
  }
  return "page";
}

/**
 * §7 明确禁止新增的路由：本轮不得仅为目录对称补齐这些地址。
 * 产品模型变化时应先更新上面的资源合同，再增加对应路由。
 */
export const FORBIDDEN_DASHBOARD_ROUTES: readonly string[] = [
  "/dashboard/students/new",
  "/dashboard/activities/new",
  "/dashboard/staff/new",
  "/dashboard/staff/add",
  "/dashboard/access-control/new",
  "/dashboard/sessions/new",
  "/dashboard/courseware/lectures/new",
  "/dashboard/courseware-assets/new",
  "/dashboard/courseware-assets/upload",
  "/dashboard/followups/new",
  "/dashboard/children/new",
  "/dashboard/assignments/new",
  "/dashboard/finance/new",
  "/dashboard/registration-settings/new",
];
