import {
  DASHBOARD_ROUTES,
  type DashboardRouteKey,
  type SchoolNavGroup,
} from "./dashboard-routes";
import type { PermissionKey } from "./permissions";

export type { SchoolNavGroup };

export interface SchoolNavItem {
  href: string;
  labelKey: string;
  requiredPerm?: PermissionKey;
  /** 任一持有即放行（如财务：sales 失 order.view 后仍靠 order.create 进财务页）。 */
  requiredAnyPerm?: readonly PermissionKey[];
  /** 仅员工侧栏渲染分组标题；家庭/学习侧栏是平铺列表（doc22 §8.2/§8.3）。 */
  group?: SchoolNavGroup;
}

/**
 * 三套侧栏统一从 ./dashboard-routes.ts 的路由合同派生——nav 不再是第二份 href/权限
 * 真相，改任何一条路由只需改合同一处（doc22 §12 阶段 B）。
 */
function navItem(key: DashboardRouteKey, options?: { withGroup?: boolean }): SchoolNavItem {
  const route = DASHBOARD_ROUTES[key];
  if (!("nav" in route) || !route.nav) throw new Error(`DASHBOARD_ROUTES.${key} is not a navigation entry`);
  if (!("href" in route) || !route.href) throw new Error(`DASHBOARD_ROUTES.${key} has no static href`);
  const nav: { labelKey: string; group?: SchoolNavGroup } = route.nav;
  return {
    href: route.href,
    labelKey: nav.labelKey,
    requiredPerm: "permission" in route ? (route.permission as PermissionKey) : undefined,
    requiredAnyPerm: "permissionAny" in route ? (route.permissionAny as readonly PermissionKey[]) : undefined,
    group: options?.withGroup === false ? undefined : nav.group,
  };
}

export const HOME_NAV_ITEM: SchoolNavItem = navItem("home", { withGroup: false });

/**
 * 员工侧栏按真实岗位职能排序。总览是唯一顶层入口；其余页面依次进入学科运营、
 * 教学、教研、组织管理和系统管理。URL 层级仍只表达资源关系，不参与这里的分组。
 */
const STAFF_NAV_KEYS: readonly DashboardRouteKey[] = [
  "home",
  "students",
  "activities",
  "followups",
  "coordination",
  "finance",
  "classes",
  "academicYears",
  "schedule",
  "courses",
  "courseware",
  "coursewareReview",
  "coursewareAssets",
  "organization",
  "campuses",
  "staff",
  "accessControl",
  "registrationSettings",
  "accountSupport",
  "systemHealth",
  "dataMaintenance",
  "accountSecurity",
];

export const SCHOOL_NAV_ITEMS: readonly SchoolNavItem[] = STAFF_NAV_KEYS.map((key) => navItem(key));

/** 侧边栏导航项：按权限过滤后的员工功能入口（总览已在 STAFF_NAV_KEYS 内）。 */
export function filterSchoolNav(perms: ReadonlySet<PermissionKey>): SchoolNavItem[] {
  return SCHOOL_NAV_ITEMS.filter((item) => {
    if (item.requiredPerm && !perms.has(item.requiredPerm)) return false;
    if (item.requiredAnyPerm && !item.requiredAnyPerm.some((key) => perms.has(key))) return false;
    return true;
  });
}

/** 学生端去财务（P4C-1 §4.4）：家长管钱，学生只关心课/作业/成绩。 */
export const STUDENT_NAV_ITEMS: readonly SchoolNavItem[] = (["home", "coursework", "assignments", "progress", "learningClasses", "accountSecurity"] as const).map((key) =>
  navItem(key, { withGroup: false }),
);

export const PARENT_NAV_ITEMS: readonly SchoolNavItem[] = (["home", "children", "assignments", "schedule", "finance", "accountSecurity"] as const).map(
  (key) => navItem(key, { withGroup: false }),
);

/**
 * 最长路径优先（doc22 §9）。
 *
 * 前缀匹配会让 `/dashboard/courseware/review` 同时点亮"课件工作台"和"课件审阅"。
 * 伪父子（staff/roles、operations/testdata）在本轮已按 §6 拆平，但 courseware 下的
 * review 与 lectures/[lectureId] 是**真实**父子结构，仍需要这条规则：
 * 找出所有可匹配项，只高亮路径最长（最具体）的那一个。
 *
 * 桌面与移动端共用同一结果——两端各算一次是双重高亮的另一个来源。
 *
 * 对象详情归属其集合：`/dashboard/sessions/[sessionId]` 是顶层 canonical 对象路由、
 * 没有自己的侧栏项，把高亮落回创建它的班级入口，避免整条侧栏全灭。
 * （`/dashboard/courseware/lectures/[lectureId]` 不需要这条——它本身就在 courseware 前缀下。）
 */
const OBJECT_ROUTE_FALLBACKS: readonly { prefix: string; navHref: string }[] = [
  { prefix: "/dashboard/sessions/", navHref: "/dashboard/classes" },
];

export function resolveActiveNavHref(pathname: string, nav: readonly SchoolNavItem[]): string | null {
  let best: string | null = null;
  for (const item of nav) {
    // 总览只精确匹配，否则它会吃掉每一条 /dashboard/* 路径。
    const matched = item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matched) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  if (best) return best;

  const fallback = OBJECT_ROUTE_FALLBACKS.find((entry) => pathname.startsWith(entry.prefix));
  if (!fallback) return null;
  return nav.some((item) => item.href === fallback.navHref) ? fallback.navHref : null;
}
