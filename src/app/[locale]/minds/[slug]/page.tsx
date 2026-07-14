import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { MdxContent } from "@/components/mdx-content";
import { SiteHeader } from "@/components/site-header";
import { Star4 } from "@/components/star4";
import { MarkRead } from "@/features/minds/lamp";
import { Link } from "@/i18n/navigation";
import { getMind, getMinds, getTermsByMind } from "@/lib/content";
import { breadcrumbJsonLd } from "@/lib/jsonld";
import { buildMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return getMinds().map((m) => ({ slug: m.slug }));
}

/** 正文只有中文，同概念页：/en 是重复品，canonical 指回中文版、不产出 hreflang。 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const mind = getMind(slug);
  if (!mind) return {};
  return buildMetadata({
    locale,
    path: `/minds/${mind.slug}`,
    title: mind.title,
    description: mind.summary,
    contentLocales: ["zh"],
    type: "article",
  });
}

export default async function MindPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const mind = getMind(slug);
  if (!mind) notFound();
  const t = await getTranslations("mindsSection");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const appearsIn = getTermsByMind(mind.slug);

  return (
    <main data-planet="lamplighter" className="flex min-h-screen flex-col">
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: common("home"), path: "" },
          { name: nav("minds"), path: "/minds" },
          { name: mind.title },
        ])}
      />
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16">
        <nav className="flex items-center gap-2 text-sm text-muted">
          <Link href="/" className="transition-colors duration-200 hover:text-ink">{common("home")}</Link>
          <span aria-hidden>/</span>
          <Link href="/minds" className="transition-colors duration-200 hover:text-ink">{nav("minds")}</Link>
          <span aria-hidden>/</span>
          <span className="text-ink">{mind.title}</span>
        </nav>

        <h1 className="mt-8 font-display text-3xl md:text-4xl">{mind.title}</h1>
        {mind.summary && <p className="mt-4 border-l-2 border-[var(--p-accent)] pl-4 leading-7 text-muted">{mind.summary}</p>}

        <MdxContent source={mind.body} />

        {appearsIn.length > 0 && (
          <div className="mt-12">
            <h2 className="flex items-center gap-2.5 font-display text-xl text-ink">
              <span aria-hidden className="h-0.5 w-5 rounded-full bg-[var(--p-accent)]" />
              {t("appearsIn")}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {appearsIn.map((term) => (
                <Link key={term.slug} href={`/terms/concepts/${term.slug}`} className="inline-flex items-center gap-2 rounded-full border border-crater bg-card px-3.5 py-1.5 text-sm transition duration-200 hover:-translate-y-0.5 hover:bg-moon/40">
                  <span className="font-serif text-[10px] text-[var(--p-accent)]">Nº {String(term.no).padStart(3, "0")}</span>
                  {term.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>
      <MarkRead slug={mind.slug} />
      <footer className="flex items-center justify-center gap-2 pb-8 text-sm text-muted">
        <Star4 size={12} />
        <span>Mathin</span>
      </footer>
    </main>
  );
}
