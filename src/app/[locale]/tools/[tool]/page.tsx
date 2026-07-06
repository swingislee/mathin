import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CopyEmbedButton } from "@/features/tools/copy-embed-button";
import { getTool } from "@/features/tools/registry";
import { Link } from "@/i18n/navigation";

export default async function ToolPage({ params }: { params: Promise<{ locale: string; tool: string }> }) {
  const { locale, tool } = await params;
  setRequestLocale(locale);
  const def = getTool(tool);
  if (!def) notFound();
  const t = await getTranslations("tools");
  return (
    <main data-planet="businessman" className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Link href="/tools" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-200 hover:text-ink">
          <ArrowLeft size={15} />
          {t("backToTools")}
        </Link>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span className="font-serif text-xs text-[var(--p-accent)]">Nº {String(def.no).padStart(2, "0")}</span>
        <span className="text-sm font-medium">{t(`items.${def.id}.name`)}</span>
        <div className="ml-auto">
          <CopyEmbedButton toolId={def.id} locale={locale} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <def.Component />
      </div>
    </main>
  );
}
