import type { PermissionKey } from "./permissions";

/** 员工侧栏分组（doc19 §4）；不设置时该项渲染在无分组区（今日工作/财务）。 */
export type SchoolNavGroup = "studentService" | "teachingOps" | "curriculum" | "org" | "system";

export interface SchoolNavItem {
  href: string;
  labelKey: string;
  requiredPerm?: PermissionKey;
  /** 任一持有即放行（如财务：sales 失 order.view 后仍靠 order.create 进财务页）。 */
  requiredAnyPerm?: readonly PermissionKey[];
  group?: SchoolNavGroup;
}

/** 任一财务功能键即显示财务入口（与 finance 页 FINANCE_PERM_KEYS 门控同口径）。 */
const FINANCE_NAV_PERMS: readonly PermissionKey[] = [
  "finance.order.view",
  "finance.order.create",
  "finance.payment.record",
  "finance.refund.approve",
  "finance.coupon.manage",
  "finance.scholarship.grant",
  "finance.account.adjust",
  "finance.report.view",
];

/** 课件中台的只读入口与路由 `requireAnyPerm` 使用同一组权限键。 */
const COURSEWARE_NAV_PERMS: readonly PermissionKey[] = [
  "courseware.page.edit",
  "courseware.release.publish",
  "courseware.asset.manage",
];

export const HOME_NAV_ITEM: SchoolNavItem = { href: "/dashboard", labelKey: "home" };

/** 学生花名册：分配制（assigned）或全量（all）任一即放行，与 students 页自身的 requireAnyPerm 同口径。 */
const STUDENTS_NAV_PERMS: readonly PermissionKey[] = ["student.view.assigned", "student.view.all"];

/** 班级：我的班级、全量查看、管理权限任一即放行——resolve_classroom_scope 用这三者中任一即可解出 all/teaching 之外的可用 scope（support 纯靠 assignment 关系，无法静态权限判定，维持既有"需手动 ?scope=support"设计不变）。 */
const CLASSES_NAV_PERMS: readonly PermissionKey[] = ["class.view.mine", "class.view.all", "class.manage"];

export const SCHOOL_NAV_ITEMS: readonly SchoolNavItem[] = [
  // 无分组独立顶部项：必须排在第一个分组开始之前，否则 DashboardShell 的
  // withGroupHeaders() 不会为它插入新标题，视觉上会"挂"在前一个分组下面。
  { href: "/dashboard/finance", labelKey: "finance", requiredAnyPerm: FINANCE_NAV_PERMS },
  { href: "/dashboard/students", labelKey: "students", requiredAnyPerm: STUDENTS_NAV_PERMS, group: "studentService" },
  { href: "/dashboard/followups", labelKey: "followups", requiredPerm: "followup.view", group: "studentService" },
  { href: "/dashboard/activities", labelKey: "activities", requiredPerm: "activity.register", group: "studentService" },
  { href: "/dashboard/classes", labelKey: "classes", requiredAnyPerm: CLASSES_NAV_PERMS, group: "teachingOps" },
  { href: "/dashboard/schedule", labelKey: "schedule", group: "teachingOps" },
  { href: "/dashboard/courseware", labelKey: "workbench", requiredAnyPerm: COURSEWARE_NAV_PERMS, group: "curriculum" },
  { href: "/dashboard/courses", labelKey: "courses", requiredPerm: "course.view", group: "curriculum" },
  { href: "/dashboard/adapt-review", labelKey: "adaptReview", requiredAnyPerm: COURSEWARE_NAV_PERMS, group: "curriculum" },
  { href: "/dashboard/shared-assets", labelKey: "sharedAssets", requiredPerm: "courseware.asset.manage", group: "curriculum" },
  { href: "/dashboard/staff", labelKey: "staff", requiredPerm: "staff.manage", group: "org" },
  { href: "/dashboard/staff/roles", labelKey: "roles", requiredPerm: "permission.configure", group: "org" },
  { href: "/dashboard/operations", labelKey: "operations", requiredPerm: "audit.view", group: "system" },
  { href: "/dashboard/operations/testdata", labelKey: "testdata", requiredPerm: "testdata.purge", group: "system" },
];

/** 侧边栏导航项：总览 + 按权限过滤后的功能入口。 */
export function filterSchoolNav(perms: ReadonlySet<PermissionKey>): SchoolNavItem[] {
  return [
    HOME_NAV_ITEM,
    ...SCHOOL_NAV_ITEMS.filter((item) => {
      if (item.requiredPerm && !perms.has(item.requiredPerm)) return false;
      if (item.requiredAnyPerm && !item.requiredAnyPerm.some((key) => perms.has(key))) return false;
      return true;
    }),
  ];
}

export const STUDENT_NAV_ITEMS: readonly SchoolNavItem[] = [
  HOME_NAV_ITEM,
  { href: "/dashboard/schedule", labelKey: "schedule" },
  { href: "/dashboard/assignments", labelKey: "assignments" },
  // 学生端去财务（P4C-1 §4.4）：家长管钱，学生只关心课/作业/成绩。
];

export const PARENT_NAV_ITEMS: readonly SchoolNavItem[] = [
  HOME_NAV_ITEM,
  { href: "/dashboard/children", labelKey: "children" },
  { href: "/dashboard/schedule", labelKey: "schedule" },
  { href: "/dashboard/finance", labelKey: "finance" },
];
