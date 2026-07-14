import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { cache } from "react";

/** 学段（docs/plan/02-3.3）：1=1–2年级，2=3–4年级，3=5–6年级（中学/大学后续扩展） */
export type Stage = 1 | 2 | 3;

/** 正文语言。中文是骨架语言，永远存在；英文按篇补齐（docs/plan/15-§3.1）。 */
export type ContentLocale = "zh" | "en";
const BASE_LOCALE: ContentLocale = "zh";

export interface QuizItem {
  q: string;
  options: string[];
  /** 正确项下标 */
  answer: number;
}

export interface TermEntry {
  /** 永不随 slug/文件名变化的学习数据主键。 */
  uid: string;
  slug: string;
  title: string;
  stage: Stage;
  topic: string;
  order: number;
  /** 前置概念 slug 列表，图谱关系完全由此推导（docs/plan/02-3.3） */
  deps: string[];
  /** 「看见它」交互演示：工具注册表 id */
  interactive?: string;
  /** 关联思维点 slug（minds 反向链接由此推导） */
  minds: string[];
  summary: string;
  /** 图鉴编号（按学段+order 全局排序生成） */
  no: number;
  body: string;
  quiz: QuizItem[];
  /** 知识宇宙归属：星球 / 岛屿 / 岛内路径序号 */
  planet: string;
  island: string;
  pathOrder: number;
  /** 这份正文实际是哪种语言。请求 en 但该篇尚无英文 MDX 时为 "zh"（回退），页面须显式标注。 */
  contentLocale: ContentLocale;
}

export interface MindEntry {
  slug: string;
  title: string;
  order: number;
  summary: string;
  body: string;
  contentLocale: ContentLocale;
}

const CONTENT_DIR = path.join(process.cwd(), "content");

export function asContentLocale(locale: string): ContentLocale {
  return locale === "en" ? "en" : "zh";
}

function readDir(locale: ContentLocale, sub: string): { slug: string; data: Record<string, unknown>; body: string }[] {
  const dir = path.join(CONTENT_DIR, locale, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      return { slug: f.replace(/\.mdx$/, ""), data, body: content };
    });
}

/** 译文只覆写展示层：标题、摘要、正文、测验。结构字段（uid/deps/星球/编号…）一律以中文骨架为准
 *  ——uid 是语言中立的锚点，缺一篇英文不该把图谱或编号打断（docs/plan/15-§3.1）。 */
interface Overlay {
  title?: string;
  summary?: string;
  body: string;
  quiz?: QuizItem[];
}

const getOverlays = cache((locale: ContentLocale, sub: string): Map<string, Overlay> => {
  if (locale === BASE_LOCALE) return new Map();
  return new Map(
    readDir(locale, sub).map(({ slug, data, body }) => [
      slug,
      {
        title: data.title ? String(data.title) : undefined,
        summary: data.summary ? String(data.summary) : undefined,
        body,
        quiz: Array.isArray(data.quiz) ? (data.quiz as QuizItem[]) : undefined,
      },
    ]),
  );
});

/** 中文骨架：结构与图鉴编号的唯一来源。 */
const getBaseTerms = cache((): TermEntry[] => {
  const entries = readDir(BASE_LOCALE, "terms").map(({ slug, data, body }) => ({
    uid: String(data.uid ?? ""),
    slug,
    title: String(data.title ?? slug),
    stage: (Number(data.stage) || 1) as Stage,
    topic: String(data.topic ?? ""),
    order: Number(data.order) || 0,
    deps: Array.isArray(data.deps) ? data.deps.map(String) : [],
    interactive: data.interactive ? String(data.interactive) : undefined,
    minds: Array.isArray(data.minds) ? data.minds.map(String) : [],
    summary: String(data.summary ?? ""),
    no: 0,
    body,
    quiz: Array.isArray(data.quiz) ? (data.quiz as QuizItem[]) : [],
    planet: String(data.planet ?? ""),
    island: String(data.island ?? ""),
    pathOrder: Number(data.pathOrder) || 0,
    contentLocale: BASE_LOCALE,
  }));
  entries.sort((a, b) => a.stage - b.stage || a.order - b.order || a.slug.localeCompare(b.slug));
  entries.forEach((e, i) => (e.no = i + 1));
  return entries;
});

const getBaseMinds = cache((): MindEntry[] => {
  const entries = readDir(BASE_LOCALE, "minds").map(({ slug, data, body }) => ({
    slug,
    title: String(data.title ?? slug),
    order: Number(data.order) || 0,
    summary: String(data.summary ?? ""),
    body,
    contentLocale: BASE_LOCALE,
  }));
  entries.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return entries;
});

export const getTerms = cache((locale: string = BASE_LOCALE): TermEntry[] => {
  const target = asContentLocale(locale);
  if (target === BASE_LOCALE) return getBaseTerms();
  const overlays = getOverlays(target, "terms");
  return getBaseTerms().map((term) => {
    const overlay = overlays.get(term.slug);
    if (!overlay) return term;
    return {
      ...term,
      title: overlay.title ?? term.title,
      summary: overlay.summary ?? term.summary,
      body: overlay.body,
      quiz: overlay.quiz ?? term.quiz,
      contentLocale: target,
    };
  });
});

export const getMinds = cache((locale: string = BASE_LOCALE): MindEntry[] => {
  const target = asContentLocale(locale);
  if (target === BASE_LOCALE) return getBaseMinds();
  const overlays = getOverlays(target, "minds");
  return getBaseMinds().map((mind) => {
    const overlay = overlays.get(mind.slug);
    if (!overlay) return mind;
    return {
      ...mind,
      title: overlay.title ?? mind.title,
      summary: overlay.summary ?? mind.summary,
      body: overlay.body,
      contentLocale: target,
    };
  });
});

export const getTerm = (locale: string, slug: string) => getTerms(locale).find((t) => t.slug === slug);
export const getTermByUid = (locale: string, uid: string) => getTerms(locale).find((t) => t.uid === uid);
export const getMind = (locale: string, slug: string) => getMinds(locale).find((m) => m.slug === slug);

/** 该篇正文真实存在的语言。供 canonical / hreflang / sitemap 判断是否有英文版
 *  （见 lib/seo 的 contentLocales：没有英文正文就不宣称有 en 版本，docs/plan/15-§2.4）。 */
export function termContentLocales(slug: string): ContentLocale[] {
  return getOverlays("en", "terms").has(slug) ? ["zh", "en"] : ["zh"];
}
export function mindContentLocales(slug: string): ContentLocale[] {
  return getOverlays("en", "minds").has(slug) ? ["zh", "en"] : ["zh"];
}

export interface ContentRelation { tools: string[]; games: string[] }
const getRelations = cache(() => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, "relations.json"), "utf8")) as Record<string, ContentRelation>);
export const getTermRelation = (uid: string): ContentRelation => getRelations()[uid] ?? { tools: [], games: [] };
export const getTermsForTool = (locale: string, toolId: string) => getTerms(locale).filter((term) => getTermRelation(term.uid).tools.includes(toolId));
export const getTermsForGame = (locale: string, gameId: string) => getTerms(locale).filter((term) => getTermRelation(term.uid).games.includes(gameId));

/** 后继概念 = 所有把该 slug 列为前置的概念 */
export const getTermDescendants = (locale: string, slug: string) => getTerms(locale).filter((t) => t.deps.includes(slug));

/** 某岛屿的学习路径（按 pathOrder） */
export const getTermsByIsland = (locale: string, planet: string, island: string) =>
  getTerms(locale)
    .filter((t) => t.planet === planet && t.island === island)
    .sort((a, b) => a.pathOrder - b.pathOrder);

/** 某星球全部节点 */
export const getTermsByPlanet = (locale: string, planet: string) => getTerms(locale).filter((t) => t.planet === planet);

/** 该思维点出现在哪些知识里（terms frontmatter 的 minds 字段反查） */
export const getTermsByMind = (locale: string, mindSlug: string) => getTerms(locale).filter((t) => t.minds.includes(mindSlug));
