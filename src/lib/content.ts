import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { cache } from "react";

/** 学段（docs/plan/02-3.3）：1=1–2年级，2=3–4年级，3=5–6年级（中学/大学后续扩展） */
export type Stage = 1 | 2 | 3;

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
}

export interface MindEntry {
  slug: string;
  title: string;
  order: number;
  summary: string;
  body: string;
}

const CONTENT_DIR = path.join(process.cwd(), "content");

function readDir(sub: string): { slug: string; data: Record<string, unknown>; body: string }[] {
  const dir = path.join(CONTENT_DIR, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      return { slug: f.replace(/\.mdx$/, ""), data, body: content };
    });
}

export const getTerms = cache((): TermEntry[] => {
  const entries = readDir("terms").map(({ slug, data, body }) => ({
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
  }));
  entries.sort((a, b) => a.stage - b.stage || a.order - b.order || a.slug.localeCompare(b.slug));
  entries.forEach((e, i) => (e.no = i + 1));
  return entries;
});

export const getTerm = (slug: string) => getTerms().find((t) => t.slug === slug);
export const getTermByUid = (uid: string) => getTerms().find((t) => t.uid === uid);

export interface ContentRelation { tools: string[]; games: string[] }
const getRelations = cache(() => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, "relations.json"), "utf8")) as Record<string, ContentRelation>);
export const getTermRelation = (uid: string): ContentRelation => getRelations()[uid] ?? { tools: [], games: [] };
export const getTermsForTool = (toolId: string) => getTerms().filter((term) => getTermRelation(term.uid).tools.includes(toolId));
export const getTermsForGame = (gameId: string) => getTerms().filter((term) => getTermRelation(term.uid).games.includes(gameId));

/** 后继概念 = 所有把该 slug 列为前置的概念 */
export const getTermDescendants = (slug: string) => getTerms().filter((t) => t.deps.includes(slug));

/** 某岛屿的学习路径（按 pathOrder） */
export const getTermsByIsland = (planet: string, island: string) =>
  getTerms()
    .filter((t) => t.planet === planet && t.island === island)
    .sort((a, b) => a.pathOrder - b.pathOrder);

/** 某星球全部节点 */
export const getTermsByPlanet = (planet: string) => getTerms().filter((t) => t.planet === planet);

export const getMinds = cache((): MindEntry[] => {
  const entries = readDir("minds").map(({ slug, data, body }) => ({
    slug,
    title: String(data.title ?? slug),
    order: Number(data.order) || 0,
    summary: String(data.summary ?? ""),
    body,
  }));
  entries.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return entries;
});

export const getMind = (slug: string) => getMinds().find((m) => m.slug === slug);

/** 该思维点出现在哪些知识里（terms frontmatter 的 minds 字段反查） */
export const getTermsByMind = (mindSlug: string) => getTerms().filter((t) => t.minds.includes(mindSlug));
