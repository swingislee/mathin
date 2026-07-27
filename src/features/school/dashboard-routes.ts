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
  | "work"
  | "studentService"
  | "teachingOps"
  | "courseware"
  | "finance"
  | "org"
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
    nav: { labelKey: "home", group: "work" },
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
    nav: { labelKey: "schedule", group: "work" },
  },

  // ── 学员服务 ────────────────────────────────────────────────────────────
  followups: {
    href: "/dashboard/followups",
    kind: "queue",
    environments: STAFF_ONLY,
    permission: "followup.view",
    // 跟进记录从学生详情或队列行内 FollowUpForm 创建，没有 /followups/new（§5.8）。
    createSurface: "dialog",
    nav: { labelKey: "followups", group: "studentService" },
  },
  students: {
    href: "/dashboard/students",
    kind: "collection",
    environments: STAFF_ONLY,
    permissionAny: STUDENTS_PERMS,
    // 单个学生只建立最小线索档案 → NewStudentDialog；完整资料在详情页维护（§5.5）。
    createSurface: "dialog",
    nav: { labelKey: "students", group: "studentService" },
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
    permission: "activity.register",
    // 活动字段仍属轻量范围 → ActivitiesManager Dialog（§5.9）。
    createSurface: "dialog",
    nav: { labelKey: "activities", group: "studentService" },
  },

  // ── 教学运营 ────────────────────────────────────────────────────────────
  classes: {
    href: "/dashboard/classes",
    kind: "collection",
    environments: STAFF_ONLY,
    permissionAny: CLASSES_PERMS,
    // 建班要过课程版本/主讲/学辅/学期/排课预览/冲突检测 → 完整 Wizard（§5.11）。
    createSurface: "page",
    createHref: "/dashboard/classes/new",
    nav: { labelKey: "classes", group: "teachingOps" },
  },
  classNew: {
    href: "/dashboard/classes/new",
    kind: "workflow",
    environments: STAFF_ONLY,
    permission: "class.create",
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
  courses: {
    href: "/dashboard/courses",
    kind: "collection",
    environments: STAFF_ONLY,
    permission: "course.view",
    createSurface: "page",
    createHref: "/dashboard/courses/new",
    nav: { labelKey: "courses", group: "teachingOps" },
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

  // ── 课件 ────────────────────────────────────────────────────────────────
  courseware: {
    href: "/dashboard/courseware",
    kind: "queue",
    environments: STAFF_ONLY,
    permissionAny: COURSEWARE_PERMS,
    createSurface: "none",
    nav: { labelKey: "workbench", group: "courseware" },
  },
  coursewareReview: {
    href: "/dashboard/courseware/review",
    kind: "queue",
    environments: STAFF_ONLY,
    permissionAny: COURSEWARE_PERMS,
    createSurface: "none",
    parent: "courseware",
    nav: { labelKey: "adaptReview", group: "courseware" },
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
    nav: { labelKey: "sharedAssets", group: "courseware" },
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
    nav: { labelKey: "finance", group: "finance" },
  },

  // ── 组织管理 ────────────────────────────────────────────────────────────
  staff: {
    // 添加员工 = 精确邮箱查找已有账号 → 必要时提升为 staff → 分配岗位，
    // 不是创建全新账户，因此没有 /staff/new（§5.22）。
    href: "/dashboard/staff",
    kind: "collection",
    environments: STAFF_ONLY,
    permission: "staff.manage",
    createSurface: "dialog",
    nav: { labelKey: "staff", group: "org" },
  },
  accessControl: {
    // 岗位权限是独立配置控制台，不依赖具体员工——与 staff 是同级而非父子（§5.23）。
    href: "/dashboard/access-control",
    kind: "singleton",
    environments: STAFF_ONLY,
    permission: "permission.configure",
    createSurface: "dialog",
    nav: { labelKey: "roles", group: "org" },
  },

  // ── 系统 ────────────────────────────────────────────────────────────────
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
    permission: "audit.view",
    createSurface: "none",
    nav: { labelKey: "operations", group: "system" },
  },
  dataMaintenance: {
    // 跨资源维护工具：测试数据清理、零引用素材、课程产品/班级清理与级联影响（§5.26）。
    href: "/dashboard/data-maintenance",
    kind: "tool",
    environments: STAFF_ONLY,
    permission: "testdata.purge",
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
  assignments: {
    // learning 环境的任务队列，学生不从这里创建作业（§5.28）。
    href: "/dashboard/assignments",
    kind: "queue",
    environments: ["learning"],
    createSurface: "none",
    nav: { labelKey: "assignments" },
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
