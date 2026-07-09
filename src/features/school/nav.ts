import type { PermissionKey } from "./permissions";

export interface SchoolNavItem {
  href: string;
  labelKey: string;
  requiredPerm?: PermissionKey;
}

export const SCHOOL_NAV_ITEMS: readonly SchoolNavItem[] = [
  { href: "/dashboard/students", labelKey: "students", requiredPerm: "student.view.assigned" },
  { href: "/dashboard/courses", labelKey: "courses", requiredPerm: "course.view" },
  { href: "/dashboard/classes", labelKey: "classes", requiredPerm: "class.view.mine" },
  { href: "/dashboard/schedule", labelKey: "schedule" },
  { href: "/dashboard/finance", labelKey: "finance", requiredPerm: "finance.order.view" },
  { href: "/dashboard/staff", labelKey: "staff", requiredPerm: "staff.manage" },
  { href: "/dashboard/staff/roles", labelKey: "roles", requiredPerm: "permission.configure" },
];

export function filterSchoolNav(perms: ReadonlySet<PermissionKey>): SchoolNavItem[] {
  return SCHOOL_NAV_ITEMS.filter((item) => !item.requiredPerm || perms.has(item.requiredPerm));
}
