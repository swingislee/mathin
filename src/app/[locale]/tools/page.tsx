import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { ToolDesk, ToolGroupButton, type ToolDeskShelfOption } from "@/features/tools/desk/ToolDesk";
import { TOOL_SHELVES, toolShelf } from "@/features/tools/desk/shelves";
import { tools } from "@/features/tools/registry";
import { toolThumbs } from "@/features/tools/thumbs";
import { Link } from "@/i18n/navigation";
import { getProfile } from "@/lib/auth";
import { buildMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

/** 草稿分组所有访客可见；读取失败时按全部正式展示，不阻断目录。 */
async function readToolGroups() {
  const supabase = await createClient();
  const [{ data: drafts }, { data: { user } }] = await Promise.all([
    supabase.from("tool_catalog_drafts").select("tool_id"),
    supabase.auth.getUser(),
  ]);
  const canManage = user ? (await getProfile(user.id))?.role === "admin" : false;
  return { draftIds: new Set((drafts ?? []).map((row) => row.tool_id)), canManage };
}

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
  const { draftIds, canManage } = await readToolGroups();

  // 按格架自上而下排序，同层保留 registry 顺序。
  const items = tools
    .map(({ id, no, category, grades: [from, to] }) => ({
      id,
      no,
      shelf: toolShelf({ id, category }),
      name: t(`items.${id}.name`),
      grades: t("desk.grades", { from, to }),
      draft: draftIds.has(id),
    }))
    .sort((a, b) => TOOL_SHELVES.indexOf(a.shelf) - TOOL_SHELVES.indexOf(b.shelf));
  const shelves: ToolDeskShelfOption[] = [
    { id: "all", label: t("desk.shelves.all"), count: t("desk.count", { count: items.filter((item) => !item.draft).length }) },
    ...TOOL_SHELVES.map((shelf) => ({
      id: shelf,
      label: t(`desk.shelves.${shelf}`),
      count: t("desk.count", { count: items.filter((item) => !item.draft && item.shelf === shelf).length }),
    })),
    { id: "draft", label: t("desk.shelves.draft"), count: t("desk.count", { count: items.filter((item) => item.draft).length }) },
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
          items={items.map(({ id, no, name, grades }) => ({ id, no, name, grades }))}
          shelfLabel={t("desk.shelfLabel")}
          noteHint={t(canManage ? "desk.manageHint" : "desk.noteHint")}
          canManage={canManage}
          moveFailed={t("desk.moveFailed")}
          header={
            <header data-scene-tone="tools" className="tool-desk-header scene-enter">
              <p className="theme-page-eyebrow text-xs uppercase tracking-[0.22em]">{nav("planetNames.tools")}</p>
              <div className="tool-desk-heading">
                <h1 className="theme-page-title font-display leading-tight">{nav("tools")}</h1>
                <p className="theme-page-description text-sm leading-6">{t("intro")}</p>
              </div>
            </header>
          }
        >
          {items.map(({ id, no, shelf, name, draft }, index) => (
            <div
              key={id}
              data-tool-id={id}
              data-shelf={shelf}
              data-draft={draft || undefined}
              draggable={canManage || undefined}
              className="tool-desk-card scene-enter group"
              style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
            >
              <Link href={`/tools/${id}`} draggable={canManage ? false : undefined} className="tool-desk-card-link">
                <div className="relative aspect-[5/3] overflow-hidden rounded-lg border border-[#c9a87b] bg-[#f5ead5]">
                  {toolThumbs[id]}
                  <span className="absolute right-1.5 top-1 text-[0.65rem] tracking-[0.12em] text-[#8d6a43]">Nº {String(no).padStart(2, "0")}</span>
                  {draft ? <span className="tool-desk-draft-stamp">{t("desk.draftStamp")}</span> : null}
                </div>
                <div className="flex items-start gap-1.5 px-0.5 pt-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="tool-desk-card-name font-display">{name}</h2>
                    <p className="tool-desk-card-desc line-clamp-2">{t(`items.${id}.desc`)}</p>
                  </div>
                  <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-[#866647] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </div>
              </Link>
              <ToolGroupButton toolId={id} draft={draft} label={t(draft ? "desk.publish" : "desk.moveToDraft")} />
            </div>
          ))}
        </ToolDesk>
      </main>
    </div>
  );
}
