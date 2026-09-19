import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { ToolView } from "@/features/tools/components";
import { CopyEmbedButton } from "@/features/tools/copy-embed-button";
import { getTool } from "@/features/tools/registry";
import { Link } from "@/i18n/navigation";
import { getTermsForTool } from "@/lib/content";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; tool: string }> }): Promise<Metadata> {
  const { locale, tool } = await params;
  if (!getTool(tool)) return {};
  const t = await getTranslations({ locale, namespace: "tools" });
  return buildMetadata({
    locale,
    path: `/tools/${tool}`,
    title: t(`items.${tool}.name`),
    description: t(`items.${tool}.desc`),
  });
}

export default async function ToolPage({ params }: { params: Promise<{ locale: string; tool: string }> }) {
  const { locale, tool } = await params;
  setRequestLocale(locale);
  const def = getTool(tool);
  if (!def) notFound();
  const t = await getTranslations("tools");
  const relatedTerms = getTermsForTool(locale, tool);
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const preparation = def.id !== "spatial-lab";
  const header = {
    start: <>
      <Link href="/tools" aria-label={t("backToTools")} title={t("backToTools")} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted transition-colors duration-200 hover:text-ink">
        <ArrowLeft size={15} aria-hidden /><span className="hidden @2xl/tool-toolbar:inline">{t("backToTools")}</span>
      </Link>
      <span aria-hidden className="hidden h-4 w-px shrink-0 bg-line @2xl/tool-toolbar:block" />
      <span className="hidden shrink-0 whitespace-nowrap font-serif text-xs text-[var(--p-accent)] @2xl/tool-toolbar:inline" title={t(`items.${def.id}.name`)}>Nº {String(def.no).padStart(2, "0")}</span>
    </>,
    end: <>
      {relatedTerms.map(term => <Link key={term.uid} href={`/terms/concepts/${term.slug}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">{term.title}</Link>)}
      <CopyEmbedButton toolId={def.id} locale={locale} />
    </>,
  };
  return (
    <main data-planet="businessman" className="@container/tool-toolbar flex h-screen flex-col">
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: common("home"), path: "" },
          { name: nav("tools"), path: "/tools" },
          { name: t(`items.${def.id}.name`) },
        ])}
      />
      {!preparation && <div className="flex items-center gap-3 border-b px-4 py-2">
        {header.start}
        <span className="text-sm font-medium">{t(`items.${def.id}.name`)}</span>
        <div className="ml-auto flex items-center gap-3">{header.end}</div>
      </div>}
      <div className="flex min-h-0 flex-1 flex-col">
        <ToolView id={def.id} preparation={preparation} preparationHeader={preparation ? header : undefined} />
      </div>
    </main>
  );
}
