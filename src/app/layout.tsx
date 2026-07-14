import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { SITE_NAME, siteUrl } from "@/lib/seo";
import { getThemePreference, htmlLang, themeClassName } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: "探索数学故事、游戏、思维与工具。",
};

/** `<html>` 必须留在根布局：404 走 Next 的 fallback 渲染路径，只认根布局给的文档外壳，
 *  把它下沉到 [locale]/layout.tsx 会让所有 404 掉进 `<html id="__next_error__">` 空壳
 *  （SSR 出来的 body 是空的，内容只剩在 flight payload 里）。
 *  而根布局在 [locale] 之上、拿不到 params——locale 因此由 next-intl 从请求解析：
 *  getLocale() 在 [locale] 段之外一样可用；/embed、/api 没有 locale 段时回落默认语言。 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const theme = await getThemePreference();
  return (
    <html
      lang={htmlLang(locale)}
      suppressHydrationWarning
      data-theme={theme}
      className={`h-full antialiased ${themeClassName(theme)}`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
        <Toaster theme={theme} position="bottom-right" />
      </body>
    </html>
  );
}
