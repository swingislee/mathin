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
  return (
    <main data-planet="businessman" className="flex h-screen flex-col">
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: common("home"), path: "" },
          { name: nav("tools"), path: "/tools" },
          { name: t(`items.${def.id}.name`) },
        ])}
      />
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Link href="/tools" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-200 hover:text-ink">
          <ArrowLeft size={15} />
          {t("backToTools")}
        </Link>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span className="font-serif text-xs text-[var(--p-accent)]">Nº {String(def.no).padStart(2, "0")}</span>
        <span className="text-sm font-medium">{t(`items.${def.id}.name`)}</span>
        <div className="ml-auto">
          {relatedTerms.map(term=><Link key={term.uid} href={`/terms/concepts/${term.slug}`} className="mr-3 text-xs text-muted underline underline-offset-2 hover:text-ink">{term.title}</Link>)}
          <CopyEmbedButton toolId={def.id} locale={locale} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ToolView id={def.id} />
      </div>
    </main>
  );
}
