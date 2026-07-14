import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MdxContent } from "@/components/mdx-content";
import { SiteHeader } from "@/components/site-header";
import { Star4 } from "@/components/star4";
import { getTool } from "@/features/tools/registry";
import { Quiz } from "@/features/terms/quiz";
import { MarkStudied } from "@/features/terms/studied";
import { getIsland, getPlanet } from "@/features/terms/universe";
import { Link } from "@/i18n/navigation";
import { getMind, getTerm, getTermDescendants, getTermRelation, getTerms } from "@/lib/content";
import { buildMetadata } from "@/lib/seo";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-12 flex items-center gap-2.5 font-display text-xl text-ink">
      <span aria-hidden className="h-0.5 w-5 rounded-full bg-[var(--p-accent)]" />
      {children}
    </h2>
  );
}

function TermChip({ slug, title, no }: { slug: string; title: string; no: number }) {
  return (
    <Link href={`/terms/concepts/${slug}`} className="inline-flex items-center gap-2 rounded-full border border-crater bg-card px-3.5 py-1.5 text-sm transition duration-200 hover:-translate-y-0.5 hover:bg-moon/40">
      <span className="font-serif text-[10px] text-[var(--p-accent)]">Nº {String(no).padStart(3, "0")}</span>
      {title}
    </Link>
  );
}

export function generateStaticParams() {
  return getTerms().map((t) => ({ slug: t.slug }));
}

/** 概念是一份封闭清单：未知 slug（含 P4G-1 改名前的拼音 URL）由路由层直接 404，
 *  带真状态码，再渲染 [locale]/not-found.tsx。这要求本段之上没有流式边界，
 *  否则外壳先发出、状态码锁死在 200，只剩 soft 404——loading.tsx 因此不放在 /terms 顶层。 */
export const dynamicParams = false;

/** 正文目前只有中文（英译是内容工程，见 doc15 §1 非目标）：/en 的概念页只是中文页的重复品，
 *  canonical 指回中文版、不宣称有 en 语言备份。P4G-4 打通 content/{zh,en} 后按篇改 contentLocales。 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const term = getTerm(slug);
  if (!term) return {};
  return buildMetadata({
    locale,
    path: `/terms/concepts/${term.slug}`,
    title: term.title,
    description: term.summary,
    contentLocales: ["zh"],
    type: "article",
  });
}

export default async function TermPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const term = getTerm(slug);
  if (!term) notFound();
  const t = await getTranslations("terms");
  const tu = await getTranslations("termsUniverse");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const tool = term.interactive ? getTool(term.interactive) : undefined;
  const relation = getTermRelation(term.uid);
  const relatedTools = relation.tools.map(getTool).filter((item)=>item!==undefined);
  const tTools = tool || relatedTools.length ? await getTranslations("tools") : null;
  const tGames = relation.games.length ? await getTranslations("games") : null;
  const prereqs = term.deps.map((d) => getTerm(d)).filter((x) => x !== undefined);
  const descendants = getTermDescendants(term.slug);
  const minds = term.minds.map((m) => getMind(m)).filter((x) => x !== undefined);
  const planet = getPlanet(term.planet);
  const island = planet ? getIsland(term.planet, term.island) : undefined;

  return (
    <main data-planet="geographer" className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16">
        <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Link href="/" className="transition-colors duration-200 hover:text-ink">{common("home")}</Link>
          <span aria-hidden>/</span>
          <Link href="/terms" className="transition-colors duration-200 hover:text-ink">{nav("terms")}</Link>
          {planet && (
            <>
              <span aria-hidden>/</span>
              <Link href={`/terms/${planet.id}`} className="transition-colors duration-200 hover:text-ink">{tu(`planets.${planet.id}.name`)}</Link>
            </>
          )}
          {planet && island && (
            <>
              <span aria-hidden>/</span>
              <Link href={`/terms/${planet.id}/${island.id}`} className="transition-colors duration-200 hover:text-ink">{tu(`islandNames.${planet.id}.${island.id}.name`)}</Link>
            </>
          )}
          <span aria-hidden>/</span>
          <span className="text-ink">{term.title}</span>
        </nav>

        {/* 词条头：编号 + 学段/主题徽记（地理学家的图鉴条目） */}
        <div className="mt-8 flex flex-wrap items-center gap-2.5">
          <span className="font-serif text-sm text-[var(--p-accent)]">{t("entry")} Nº {String(term.no).padStart(3, "0")}</span>
          <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted">{t(`stage${term.stage}`)}</span>
          {term.topic && <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted">{term.topic}</span>}
        </div>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">{term.title}</h1>
        {term.summary && <p className="mt-4 border-l-2 border-[var(--p-accent)] pl-4 leading-7 text-muted">{term.summary}</p>}

        {/* 一、定义 */}
        <SectionHeading>{t("definition")}</SectionHeading>
        <MdxContent source={term.body} />

        {/* 二、看见它（交互演示槽 → 工具注册表） */}
        {tool && tTools && (
          <>
            <SectionHeading>{t("seeIt")}</SectionHeading>
            <div className="mt-4 flex h-[520px] flex-col overflow-hidden rounded-2xl border bg-paper" data-planet="businessman">
              <tool.Component embedded />
            </div>
            <p className="mt-2 text-right text-xs">
              <Link href={`/tools/${tool.id}`} className="inline-flex items-center gap-1 text-muted transition-colors duration-200 hover:text-ink">
                <ExternalLink size={11} />
                {t("openFull")}：{tTools(`items.${tool.id}.name`)}
              </Link>
            </p>
          </>
        )}

        {/* 三、它从哪来 · 到哪去（一阶关系） */}
        <SectionHeading>{t("fromTo")}</SectionHeading>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs tracking-widest text-muted">{t("prereq")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {prereqs.length > 0 ? prereqs.map((p) => <TermChip key={p.slug} slug={p.slug} title={p.title} no={p.no} />) : <span className="text-sm text-muted">{t("none")}</span>}
            </div>
          </div>
          <div>
            <p className="text-xs tracking-widest text-muted">{t("descendants")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {descendants.length > 0 ? descendants.map((p) => <TermChip key={p.slug} slug={p.slug} title={p.title} no={p.no} />) : <span className="text-sm text-muted">{t("none")}</span>}
            </div>
          </div>
        </div>
        {minds.length > 0 && (
          <div className="mt-6">
            <p className="text-xs tracking-widest text-muted">{t("relatedMinds")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {minds.map((m) => (
                <Link key={m.slug} href={`/minds/${m.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-crater bg-card px-3.5 py-1.5 text-sm transition duration-200 hover:-translate-y-0.5 hover:bg-moon/40">
                  <Star4 size={10} />
                  {m.title}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 四、试一试 */}
        {term.quiz.length > 0 && (
          <>
            <SectionHeading>{t("tryIt")}</SectionHeading>
            <Quiz items={term.quiz} correctLabel={t("correct")} wrongLabel={t("wrong")} />
          </>
        )}
        <SectionHeading>{t("nextSteps")}</SectionHeading>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {relatedTools.map(item=><Link key={item.id} href={`/tools/${item.id}`} className="rounded-xl border border-line bg-card p-4 transition hover:-translate-y-0.5 hover:bg-moon/20"><p className="text-xs text-muted">{t("exploreTool")}</p><p className="mt-1 font-medium">{tTools?.(`items.${item.id}.name`)??item.id}</p></Link>)}
          {relation.games.map(gameId=><Link key={gameId} href={`/games/${gameId}`} className="rounded-xl border border-line bg-card p-4 transition hover:-translate-y-0.5 hover:bg-moon/20"><p className="text-xs text-muted">{t("playGame")}</p><p className="mt-1 font-medium">{tGames?.(`items.${gameId}.name`)??gameId}</p></Link>)}
          {descendants.slice(0,1).map(item=><Link key={item.uid} href={`/terms/concepts/${item.slug}`} className="rounded-xl border border-line bg-card p-4 transition hover:-translate-y-0.5 hover:bg-moon/20"><p className="text-xs text-muted">{t("nextConcept")}</p><p className="mt-1 font-medium">{item.title}</p></Link>)}
        </div>
      </article>
      <MarkStudied slug={term.slug} />
      <footer className="flex items-center justify-center gap-2 pb-8 text-sm text-muted">
        <Star4 size={12} />
        <span>Mathin</span>
      </footer>
    </main>
  );
}
