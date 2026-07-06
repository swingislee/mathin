import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { getTool } from "@/features/tools/registry";

/** 纯净嵌入路由（docs/plan/03-§6）：无站点导航，供 iframe 插入课件与教室 */
export default async function EmbedToolPage({ params, searchParams }: {
  params: Promise<{ tool: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { tool } = await params;
  const { locale: raw } = await searchParams;
  const locale = raw === "en" ? "en" : "zh";
  const def = getTool(tool);
  if (!def) notFound();
  const messages = (await import(`../../../../messages/${locale}.json`)).default;
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div data-planet="businessman" className="flex min-h-screen flex-col">
        <def.Component embedded />
      </div>
    </NextIntlClientProvider>
  );
}
