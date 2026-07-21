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

export const SCHOOL_NAV_ITEMS: readonly SchoolNavItem[] = [
  { href: "/dashboard/work", labelKey: "work" },
  { href: "/dashboard/students", labelKey: "students", requiredPerm: "student.view.assigned", group: "studentService" },
  { href: "/dashboard/followups", labelKey: "followups", requiredPerm: "followup.view", group: "studentService" },
  { href: "/dashboard/activities", labelKey: "activities", requiredPerm: "activity.register", group: "studentService" },
  { href: "/dashboard/classes", labelKey: "classes", requiredPerm: "class.view.mine", group: "teachingOps" },
  { href: "/dashboard/schedule", labelKey: "schedule", group: "teachingOps" },
  { href: "/dashboard/courseware", labelKey: "workbench", requiredAnyPerm: COURSEWARE_NAV_PERMS, group: "curriculum" },
  { href: "/dashboard/courses", labelKey: "courses", requiredPerm: "course.view", group: "curriculum" },
  { href: "/dashboard/courseware/adapt", labelKey: "adaptReview", requiredAnyPerm: COURSEWARE_NAV_PERMS, group: "curriculum" },
  { href: "/dashboard/courseware/assets", labelKey: "sharedAssets", requiredPerm: "courseware.asset.manage", group: "curriculum" },
  { href: "/dashboard/finance", labelKey: "finance", requiredAnyPerm: FINANCE_NAV_PERMS },
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
