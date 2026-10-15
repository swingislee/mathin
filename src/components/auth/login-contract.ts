import { resolveSafeReturnTo } from "@/lib/safe-redirect";

export type LoginState = { ok: false; code?: "credentials" | "unavailable" } | { ok: true };

/** 主动登录返回当前页面；显式目标与完整登录页共用同一站内校验。 */
export function dialogReturnTo(next: string | undefined, currentPath: string, locale: string) {
  const current = currentPath === `/${locale}` ? `/${locale}/` : currentPath;
  return resolveSafeReturnTo(next, locale, resolveSafeReturnTo(current, locale, `/${locale}/`));
}

/** next-intl 的 router 接收无语言前缀路径；去前缀后仍须保持单斜杠站内地址。 */
export function dialogRouterHref(next: string, locale: string) {
  const safe = resolveSafeReturnTo(next, locale, `/${locale}/`);
  const url = new URL(safe, "https://local.invalid");
  if (!url.pathname.startsWith(`/${locale}/`)) return "/";
  const path = url.pathname.slice(locale.length + 1);
  if (path.startsWith("//") || path.includes("\\")) return "/";
  return `${path}${url.search}${url.hash}`;
}

export function isPlainLoginClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, target?: string) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (!target || target === "_self");
}
