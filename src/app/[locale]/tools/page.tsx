import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { ToolDesk, type ToolDeskItem, type ToolDeskShelfOption } from "@/features/tools/desk/ToolDesk";
import { TOOL_SHELVES, toolShelf } from "@/features/tools/desk/shelves";
import { tools } from "@/features/tools/registry";
import { toolThumbs } from "@/features/tools/thumbs";
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
  const nav = await getTranslations("nav");

  // 按格架自上而下排序，同层保留 registry 顺序。
  const items: ToolDeskItem[] = tools
    .map(({ id, no, category, grades: [from, to] }) => ({
      id,
      no,
      shelf: toolShelf({ id, category }),
      name: t(`items.${id}.name`),
      desc: t(`items.${id}.desc`),
      grades: t("desk.grades", { from, to }),
      thumb: toolThumbs[id],
    }))
    .sort((a, b) => TOOL_SHELVES.indexOf(a.shelf) - TOOL_SHELVES.indexOf(b.shelf));
  const shelves: ToolDeskShelfOption[] = [
    { id: "all", label: t("desk.shelves.all"), count: t("desk.count", { count: items.length }) },
    ...TOOL_SHELVES.map((shelf) => ({
      id: shelf,
      label: t(`desk.shelves.${shelf}`),
      count: t("desk.count", { count: items.filter((item) => item.shelf === shelf).length }),
    })),
  ];

  return (
    <div className="scene-day scene-adaptive scene-tools min-h-dvh" data-planet="businessman">
      <SiteHeader />
      <main className="tool-desk text-[var(--scene-ink)]">
        <div className="tool-desk-backdrop" aria-hidden>
          <div className="scene-illustration" />
          <div className="scene-illustration-wash" />
        </div>
        <ToolDesk
          shelves={shelves}
          items={items}
          shelfLabel={t("desk.shelfLabel")}
          noteHint={t("desk.noteHint")}
          header={
            <header data-scene-tone="tools" className="tool-desk-header scene-enter">
              <p className="theme-page-eyebrow text-xs uppercase tracking-[0.22em]">{nav("planetNames.tools")}</p>
              <div className="tool-desk-heading">
                <h1 className="theme-page-title font-display leading-tight">{nav("tools")}</h1>
                <p className="theme-page-description text-sm leading-6">{t("intro")}</p>
              </div>
            </header>
          }
        />
      </main>
    </div>
  );
}
