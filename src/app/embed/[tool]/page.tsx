import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { ToolView } from "@/features/tools/components";
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
      {/* embed 没有 locale 段，文档根落到默认 zh-CN；英文嵌入在这里就地标注语言 */}
      <div lang={locale === "en" ? "en" : "zh-CN"} data-planet="businessman" className="flex min-h-screen flex-col">
        <ToolView id={def.id} embedded />
      </div>
    </NextIntlClientProvider>
  );
}
