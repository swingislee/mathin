import { DASHBOARD_ROUTES, type DashboardRoute } from "../dashboard-routes";
import type { UserEnvironment } from "@/lib/environment";

/**
 * 返回来源合同（doc 23 §18）。
 *
 * 对象工作区可以从多个入口进入——课次可以来自班级详情，也可以来自课表；讲次可以来自
 * 课程版本的教学计划，也可以来自课件队列。返回必须回到**来的地方**，否则用户每处理
 * 一条课表上的异常就要重新找回课表。
 *
 * 但"回到来的地方"不能靠 `router.back()`：表单提交、`router.refresh()`、被拦截的
 * 覆盖层都会往 history 里塞条目，后退会退回自己刚离开的中间态。所以来源走显式的
 * `?returnTo=`，并且必须过这道校验——URL 上的东西是用户可改的输入，不是可信状态。
 *
 * 校验规则（§18）：
 *   1. 只接受站内 Dashboard 路径（拒绝外部 URL 与协议相对 `//host`）；
 *   2. 必须命中 dashboard-routes 合同（拒绝已删除的旧路由和臆造路径）；
 *   3. 目标路由必须对当前使用环境开放（家长不能被送回员工页）；
 *   4. 任何一条不成立就回落到该对象的 canonical 父页面。
 *
 * 注意这里只做**导航安全**，不做授权：能不能看那一页仍由目标页自己的
 * requireDashboardEnvironment / requirePerm 和 RLS 决定。
 */

function segmentsOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function matchesRoute(route: DashboardRoute, segments: readonly string[]): boolean {
  const pattern = route.href ?? route.hrefPattern;
  if (!pattern) return false;
  const patternSegments = segmentsOf(pattern);
  if (patternSegments.length !== segments.length) return false;
  return patternSegments.every((patternSegment, index) =>
    patternSegment.startsWith("[") ? segments[index].length > 0 : patternSegment === segments[index],
  );
}

export function resolveReturnTarget({
  returnTo,
  fallback,
  environment,
}: {
  /** 原始 `?returnTo=` 值（未解码前已由框架解码），可能缺失、可能是攻击载荷。 */
  returnTo: string | string[] | undefined;
  /** 该对象的 canonical 父页面，校验不通过时使用。 */
  fallback: string;
  environment: UserEnvironment;
}): string {
  const candidate = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (!candidate) return fallback;

  // 单斜杠开头的站内绝对路径；`//evil.com` 是协议相对外链，必须挡掉。
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  // 反斜杠在部分浏览器里等价于斜杠，`/\evil.com` 同样会跳出站外。
  if (candidate.includes("\\")) return fallback;

  const [pathname, ...rest] = candidate.split("?");
  const query = rest.join("?");
  const segments = segmentsOf(pathname);
  if (segments[0] !== "dashboard") return fallback;

  const route = (Object.values(DASHBOARD_ROUTES) as DashboardRoute[]).find((entry) => matchesRoute(entry, segments));
  if (!route) return fallback;
  if (!route.environments.includes(environment)) return fallback;

  return query ? `${pathname}?${query}` : pathname;
}

/** 把当前地址编码进目标链接，供列表/队列页给出"改完能回来"的入口。 */
export function withReturnTo(href: string, returnTo: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}
