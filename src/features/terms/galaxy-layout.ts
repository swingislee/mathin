import type { TermEntry } from "@/lib/content";

/** 星空图布局（服务端纯函数）：模块 = 星带，学段进度 = 自左向右，含确定性抖动 */

export const GALAXY_W = 1600;
export const GALAXY_H = 900;

export interface GalaxyNode {
  slug: string;
  title: string;
  summary: string;
  topic: string;
  stage: number;
  no: number;
  x: number;
  y: number;
}

export interface GalaxyEdge {
  from: string;
  to: string;
}

/** 三条星带：中心 y 与振幅（数与代数节点最多，占最宽的带） */
const BANDS: Record<string, { cy: number; amp: number }> = {
  数与代数: { cy: 250, amp: 130 },
  图形与几何: { cy: 565, amp: 115 },
  统计与概率: { cy: 810, amp: 45 },
};
const FALLBACK_BAND = { cy: 450, amp: 100 };

/** 确定性伪随机（djb2 → [-1, 1]），保证布局在服务端稳定 */
function jitter(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return ((h >>> 0) % 1000) / 500 - 1;
}

export function layoutGalaxy(terms: TermEntry[]): { nodes: GalaxyNode[]; edges: GalaxyEdge[] } {
  const topics = [...new Set(terms.map((t) => t.topic))];
  const nodes: GalaxyNode[] = [];
  for (const topic of topics) {
    const band = BANDS[topic] ?? FALLBACK_BAND;
    const list = terms.filter((t) => t.topic === topic); // getTerms 已按学段+order 排序
    list.forEach((t, i) => {
      const p = list.length > 1 ? i / (list.length - 1) : 0.5;
      const x = 90 + p * (GALAXY_W - 200) + jitter(t.slug) * 14;
      const y = band.cy + Math.sin(i * 2.05 + topics.indexOf(topic) * 1.3) * band.amp * 0.62 + jitter(t.slug + "y") * band.amp * 0.38;
      nodes.push({ slug: t.slug, title: t.title, summary: t.summary, topic: t.topic, stage: t.stage, no: t.no, x, y });
    });
  }
  const known = new Set(nodes.map((n) => n.slug));
  const edges: GalaxyEdge[] = [];
  for (const t of terms) {
    for (const d of t.deps) {
      if (known.has(d)) edges.push({ from: d, to: t.slug });
    }
  }
  return { nodes, edges };
}
