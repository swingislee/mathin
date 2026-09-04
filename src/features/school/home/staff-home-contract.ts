export const STAFF_HOME_VIEWS = ["work", "overview"] as const;
export type StaffHomeView = (typeof STAFF_HOME_VIEWS)[number];

export const STAFF_HOME_VIEW_COOKIE = "mathin_staff_home_view";

const MANAGEMENT_PERMISSIONS = [
  "work_item.manage",
  "approval.manage",
  "class.manage",
  "class.view.all",
  "student.view.all",
  "finance.refund.approve",
] as const;

function parseStaffHomeView(value: string | undefined): StaffHomeView | null {
  return value === "work" || value === "overview" ? value : null;
}

export function hasStaffHomeManagementScope(perms: ReadonlySet<string>): boolean {
  return MANAGEMENT_PERMISSIONS.some((permission) => perms.has(permission));
}

/** 显式 URL 最高优先，其次沿用个人偏好，首次进入才按岗位能力选择默认视图。 */
export function resolveStaffHomeView({
  requested,
  remembered,
  hasManagementScope,
}: {
  requested?: string;
  remembered?: string;
  hasManagementScope: boolean;
}): StaffHomeView {
  return parseStaffHomeView(requested)
    ?? parseStaffHomeView(remembered)
    ?? (hasManagementScope ? "overview" : "work");
}

export function staffHomeHref(view: StaffHomeView, period: "week" | "month" = "week"): string {
  return view === "work"
    ? "/dashboard?view=work"
    : `/dashboard?view=overview&period=${period}`;
}
