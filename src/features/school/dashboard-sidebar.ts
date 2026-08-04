/**
 * Dashboard 侧栏的三态合同（docs/plan/27 §3 D1）。
 *
 * 三态而不是开关：`icons` 保住导航可达性、`hidden` 把 240px 全部还给正文，
 * 两种诉求在 1024–1280 上同时存在——图标态适合"我还要来回跳"，隐藏态适合
 * "这一屏就是要铺满"（备课、课表、课件工作区）。
 *
 * 状态存 cookie 而不是 localStorage：布局宽度必须在服务端渲染的第一帧就正确，
 * 否则每次进 Dashboard 都会先按 240px 画一遍再跳成 56px/0px。localStorage 只能
 * 在挂载后读到，那一跳无法避免。
 */
export const DASHBOARD_SIDEBAR_COOKIE = "mathin.dashboard-sidebar";

export const DASHBOARD_SIDEBAR_MODES = ["expanded", "icons", "hidden"] as const;

export type DashboardSidebarMode = (typeof DASHBOARD_SIDEBAR_MODES)[number];

export const DEFAULT_DASHBOARD_SIDEBAR_MODE: DashboardSidebarMode = "expanded";

/** 未知值一律回落到展开态：宽屏用户是多数，误判成隐藏会让人以为导航丢了。 */
export function parseDashboardSidebarMode(value: string | undefined): DashboardSidebarMode {
  return DASHBOARD_SIDEBAR_MODES.includes(value as DashboardSidebarMode)
    ? (value as DashboardSidebarMode)
    : DEFAULT_DASHBOARD_SIDEBAR_MODE;
}

/** 循环顺序：展开 → 图标 → 隐藏 → 展开。 */
export function nextDashboardSidebarMode(mode: DashboardSidebarMode): DashboardSidebarMode {
  const index = DASHBOARD_SIDEBAR_MODES.indexOf(mode);
  return DASHBOARD_SIDEBAR_MODES[(index + 1) % DASHBOARD_SIDEBAR_MODES.length];
}
