import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { PlanetAccent } from "./planet-link";
import { SiteHeader } from "./site-header";
import { Star4 } from "./star4";

export type Section = "story" | "games" | "minds" | "terms" | "tools" | "dashboard" | "classroom" | "notebook" | "whiteboard";
export type Planet = "earth" | "king" | "lamplighter" | "geographer" | "businessman";

// 公开板块 → 星球映射（docs/plan/05-§1）；功能板块不绑星球（05-§5 工作台基调）
export const sectionPlanets: Partial<Record<Section, Planet>> = {
  story: "earth",
  games: "king",
  minds: "lamplighter",
  terms: "geographer",
  tools: "businessman",
};

// 功能板块 accent（docs/plan/01-1.3，仅对无星球板块生效）
export const sectionAccents: Record<Section, PlanetAccent> = {
  story: "rose",
  games: "moon",
  minds: "crater",
  terms: "leaf",
  tools: "star",
  dashboard: "leaf",
  classroom: "leaf",
  notebook: "cheek",
  whiteboard: "crater",
};

/** 子页面统一骨架（docs/plan/02-2）：header + 面包屑 + 标题 accent 短横 + 内容槽 + 页脚。 */
export async function SectionShell({ section, intro, wide = false, children }: {
  section: Section;
  intro?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const planet = sectionPlanets[section];
  return (
    <main
      className="flex min-h-screen flex-col"
      data-planet={planet}
      style={{ "--section-accent": planet ? "var(--p-accent)" : `var(--${sectionAccents[section]})` } as CSSProperties}
    >
      <SiteHeader />
      <div className={cn("mx-auto w-full flex-1 px-6 pb-16", wide ? "max-w-6xl" : "max-w-3xl")}>
        <nav className="flex items-center gap-2 text-sm text-muted">
          <Link href="/" className="transition-colors duration-200 hover:text-ink">{common("home")}</Link>
          <span aria-hidden>/</span>
          <span className="text-ink">{nav(section)}</span>
        </nav>
        <h1 className="mt-6 font-display text-4xl md:text-5xl">{nav(section)}</h1>
        <div aria-hidden className="mt-4 h-0.5 w-8 rounded-full bg-[var(--section-accent)]" />
        {intro && <p className="mt-5 leading-7 text-muted">{intro}</p>}
        <div className="mt-10 md:mt-14">{children}</div>
      </div>
      <footer className="flex items-center justify-center gap-2 pb-8 text-sm text-muted">
        <Star4 size={12} />
        <span>Mathin</span>
      </footer>
    </main>
  );
}
