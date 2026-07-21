import { setRequestLocale } from "next-intl/server";

/**
 * Studio 是脱离 Dashboard 的专用工具壳（docs/plan/19-p4i-final.md §12）：
 * 不带 SiteHeader/左导航，页面自己就是唯一工具栏，故不复用 dashboard/layout.tsx。
 * h-dvh + overflow-hidden 锁死 window 滚动，交给 FullScreenToolShell 内部分区滚动。
 */
export default async function StudioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="flex h-screen h-dvh flex-col overflow-hidden">{children}</div>;
}
