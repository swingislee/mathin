import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionShell } from "@/components/section-shell";
import { tools } from "@/features/tools/registry";
import { toolThumbs } from "@/features/tools/thumbs";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const nav = await getTranslations({ locale, namespace: "nav" });
  const t = await getTranslations({ locale, namespace: "tools" });
  return buildMetadata({ locale, path: "/tools", title: nav("tools"), description: t("intro") });
}

export default async function ToolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools");
  return (
    <SectionShell section="tools" wide intro={t("intro")}>
      {/* 工具箱：一格一件器具 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {tools.map(({ id, no }) => (
          <Link
            key={id}
            href={`/tools/${id}`}
            className="group rounded-2xl border bg-card p-3 transition duration-200 hover:-translate-y-0.5"
          >
            <div className="relative aspect-5/3 overflow-hidden rounded-xl border border-(--p-line) bg-(--p-wash)">
              {toolThumbs[id]}
              <span className="absolute right-2 top-1.5 font-serif text-xs text-(--p-accent)">Nº {String(no).padStart(2, "0")}</span>
            </div>
            <p className="mt-3 px-1 font-medium">{t(`items.${id}.name`)}</p>
            <p className="mt-1 px-1 pb-1 text-xs leading-5 text-muted">{t(`items.${id}.desc`)}</p>
          </Link>
        ))}
      </div>
    </SectionShell>
  );
}
