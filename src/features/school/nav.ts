import type { PermissionKey } from "./permissions";

export interface SchoolNavItem {
  href: string;
  labelKey: string;
  requiredPerm?: PermissionKey;
}

export const HOME_NAV_ITEM: SchoolNavItem = { href: "/dashboard", labelKey: "home" };

export const SCHOOL_NAV_ITEMS: readonly SchoolNavItem[] = [
  { href: "/dashboard/students", labelKey: "students", requiredPerm: "student.view.assigned" },
  { href: "/dashboard/courses", labelKey: "courses", requiredPerm: "course.view" },
  { href: "/dashboard/classes", labelKey: "classes", requiredPerm: "class.view.mine" },
  { href: "/dashboard/schedule", labelKey: "schedule" },
  { href: "/dashboard/finance", labelKey: "finance", requiredPerm: "finance.order.view" },
  { href: "/dashboard/staff", labelKey: "staff", requiredPerm: "staff.manage" },
  { href: "/dashboard/staff/roles", labelKey: "roles", requiredPerm: "permission.configure" },
];

/** 侧边栏导航项：总览 + 按权限过滤后的功能入口。 */
export function filterSchoolNav(perms: ReadonlySet<PermissionKey>): SchoolNavItem[] {
  return [HOME_NAV_ITEM, ...SCHOOL_NAV_ITEMS.filter((item) => !item.requiredPerm || perms.has(item.requiredPerm))];
}

export const STUDENT_NAV_ITEMS: readonly SchoolNavItem[] = [
  HOME_NAV_ITEM,
  { href: "/dashboard/schedule", labelKey: "schedule" },
  { href: "/dashboard/assignments", labelKey: "assignments" },
  { href: "/dashboard/finance", labelKey: "finance" },
];

export const PARENT_NAV_ITEMS: readonly SchoolNavItem[] = [
  HOME_NAV_ITEM,
  { href: "/dashboard/children", labelKey: "children" },
  { href: "/dashboard/schedule", labelKey: "schedule" },
  { href: "/dashboard/finance", labelKey: "finance" },
];
