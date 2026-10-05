/** 宽度与显隐分别记忆；cookie 让服务端首帧直接使用上次布局。 */
export const DASHBOARD_SIDEBAR_COOKIE = "mathin.dashboard-sidebar";
export const DASHBOARD_SIDEBAR_WIDTH_COOKIE = "mathin.dashboard-sidebar-width";

export const DASHBOARD_SIDEBAR_ICON_WIDTH = 56;
export const DASHBOARD_SIDEBAR_TEXT_MIN_WIDTH = 176;
export const DASHBOARD_SIDEBAR_DEFAULT_WIDTH = 240;
export const DASHBOARD_SIDEBAR_MAX_WIDTH = 320;

export type DashboardSidebarPreference = { width: number; hidden: boolean };

/** 图标与可读文字区之间吸附，避免留下不能阅读的半截标签。 */
export function normalizeDashboardSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DASHBOARD_SIDEBAR_DEFAULT_WIDTH;
  const snapPoint = (DASHBOARD_SIDEBAR_ICON_WIDTH + DASHBOARD_SIDEBAR_TEXT_MIN_WIDTH) / 2;
  if (width < snapPoint) return DASHBOARD_SIDEBAR_ICON_WIDTH;
  return Math.round(Math.min(DASHBOARD_SIDEBAR_MAX_WIDTH, Math.max(DASHBOARD_SIDEBAR_TEXT_MIN_WIDTH, width)));
}

export function dashboardSidebarMode({ width, hidden }: DashboardSidebarPreference): "hidden" | "icons" | "expanded" {
  return hidden ? "hidden" : width === DASHBOARD_SIDEBAR_ICON_WIDTH ? "icons" : "expanded";
}

/** 兼容旧三态偏好；旧隐藏态没有宽度时，重新打开使用默认宽度。 */
export function parseDashboardSidebarPreference(
  mode: string | undefined,
  savedWidth: string | undefined,
): DashboardSidebarPreference {
  const width = savedWidth?.trim() ? Number(savedWidth) : Number.NaN;
  return {
    width: mode === "icons"
      ? DASHBOARD_SIDEBAR_ICON_WIDTH
      : normalizeDashboardSidebarWidth(width),
    hidden: mode === "hidden",
  };
}
