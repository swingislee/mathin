import { cookies } from "next/headers";

export type ThemePreference = "light" | "dark" | "system";

/** 主题偏好只存在 mathin-theme cookie 里（没用 next-themes，见 components/ui/sonner.tsx）。
 *  两个根布局（[locale] 与 embed）和站头都要读它，收在这里免得三处各解析一遍。 */
export async function getThemePreference(): Promise<ThemePreference> {
  const saved = (await cookies()).get("mathin-theme")?.value;
  return saved === "light" || saved === "dark" ? saved : "system";
}

/** 主题落到 <html> 上的类名：system 交给 CSS 的媒体查询。 */
export function themeClassName(theme: ThemePreference): string {
  return theme === "system" ? "" : theme;
}

/** BCP 47 语言标记：中文要带地区（zh-CN），否则读屏器与搜索引擎会在简繁之间乱猜。
 *  无 locale 段的路由（/embed）落到站点默认语言。 */
export function htmlLang(locale: string | undefined): string {
  return locale === "en" ? "en" : "zh-CN";
}
