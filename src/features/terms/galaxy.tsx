"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { GALAXY_H, GALAXY_W, type GalaxyEdge, type GalaxyNode } from "./galaxy-layout";
import { parseStudied, useStudiedRaw } from "./studied";

/**
 * 知识星空（docs/plan：terms 板块的学习线全景）。
 * 夜空为固定深色画布（星空即是夜），颜色取自星夜暗色板：
 * 未学 = 暖白星（依然明亮，不表达"不会"），已学 = 金色星 + 光晕。
 */
const TOPIC_COLORS: Record<string, string> = {
  数与代数: "#8fa968", // 王子绿（星夜版）
  图形与几何: "#8e9bc4", // 夜航蓝
  统计与概率: "#d9be7e", // 暗金
};
const STAR = "#f2eddf";
const GOLD = "#ffd98a";
const EDGE = "#cbab8f";

const STAR_PATH = "M12 0C13.2 7.4 16.6 10.8 24 12 16.6 13.2 13.2 16.6 12 24 10.8 16.6 7.4 13.2 0 12 7.4 10.8 10.8 7.4 12 0Z";

function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return (h >>> 0) % 1000;
}

export function KnowledgeGalaxy({ nodes, edges, legendLearned, stageLabels }: {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  legendLearned: string;
  stageLabels: Record<number, string>;
}) {
  const router = useRouter();
  const studied = parseStudied(useStudiedRaw());
  const [hover, setHover] = useState<string | null>(null);

  const pos = useMemo(() => new Map(nodes.map((n) => [n.slug, n])), [nodes]);
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      (m.get(e.from) ?? m.set(e.from, new Set()).get(e.from)!).add(e.to);
      (m.get(e.to) ?? m.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    return m;
  }, [edges]);
  const connected = hover ? (neighbors.get(hover) ?? new Set<string>()) : null;

  // 背景星尘（确定性）
  const dust = useMemo(
    () =>
      Array.from({ length: 110 }, (_, i) => ({
        x: (hash(`dx${i}`) / 1000) * GALAXY_W,
        y: (hash(`dy${i}`) / 1000) * GALAXY_H,
        r: 0.7 + (hash(`dr${i}`) / 1000) * 1.1,
        o: 0.12 + (hash(`do${i}`) / 1000) * 0.3,
      })),
    [],
  );

  const hovered = hover ? pos.get(hover) : null;

  return (
    <div className="relative overflow-x-auto rounded-[2rem] border border-line">
      <div className="relative min-w-[980px]">
        <svg viewBox={`0 0 ${GALAXY_W} ${GALAXY_H}`} className="block w-full" role="img">
          <defs>
            <radialGradient id="g-sky" cx="50%" cy="38%" r="85%">
              <stop offset="0%" stopColor="#252b45" />
              <stop offset="100%" stopColor="#171a28" />
            </radialGradient>
            <radialGradient id="g-halo">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.55" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
            </radialGradient>
            <filter id="g-blur" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="46" />
            </filter>
          </defs>

          <rect width={GALAXY_W} height={GALAXY_H} fill="url(#g-sky)" />

          {/* 三条星带的星云罩色 */}
          {Object.entries(TOPIC_COLORS).map(([topic, color]) => {
            const ys = nodes.filter((n) => n.topic === topic).map((n) => n.y);
            if (ys.length === 0) return null;
            const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
            return <ellipse key={topic} cx={GALAXY_W / 2} cy={cy} rx={GALAXY_W * 0.46} ry={110} fill={color} opacity={0.11} filter="url(#g-blur)" />;
          })}

          {/* 星尘 */}
          {dust.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={STAR} opacity={d.o} />
          ))}

          {/* 前铺后续的航线 */}
          {edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const lit = hover !== null && (e.from === hover || e.to === hover);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - Math.min(70, Math.abs(b.x - a.x) * 0.18) * (hash(e.from + e.to) > 500 ? 1 : -1);
            return (
              <path
                key={i}
                d={`M${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                fill="none"
                stroke={lit ? GOLD : EDGE}
                strokeWidth={lit ? 1.8 : 1.1}
                strokeLinecap="round"
                strokeDasharray="0.5 7"
                opacity={lit ? 0.95 : hover ? 0.14 : 0.3}
              />
            );
          })}

          {/* 知识星 */}
          {nodes.map((n) => {
            const learned = studied.has(n.slug);
            const isHover = hover === n.slug;
            const isNeighbor = connected?.has(n.slug) ?? false;
            const dim = hover !== null && !isHover && !isNeighbor;
            const s = (learned ? 0.95 : 0.68) * (isHover ? 1.35 : 1);
            const color = TOPIC_COLORS[n.topic] ?? STAR;
            return (
              <g
                key={n.slug}
                transform={`translate(${n.x}, ${n.y})`}
                className="cursor-pointer"
                opacity={dim ? 0.4 : 1}
                onMouseEnter={() => setHover(n.slug)}
                onMouseLeave={() => setHover(null)}
                onClick={() => router.push(`/terms/concepts/${n.slug}`)}
              >
                {/* 模块色微光：每颗星都活着，未学不代表不会 */}
                <circle r={learned ? 17 : 9} fill={learned ? "url(#g-halo)" : color} opacity={learned ? 1 : 0.18} />
                <g
                  style={{
                    animation: `twinkle ${6 + (hash(n.slug) / 1000) * 5}s ease-in-out ${(hash(n.slug + "d") / 1000) * 6}s infinite`,
                  }}
                >
                  <path
                    d={STAR_PATH}
                    transform={`scale(${s}) translate(-12 -12)`}
                    fill={learned ? GOLD : STAR}
                    opacity={learned ? 1 : 0.92}
                  />
                </g>
                <text y={learned ? 26 : 22} textAnchor="middle" fontSize={11.5} fill={learned ? GOLD : STAR} opacity={isHover ? 1 : 0.78}>
                  {n.title}
                </text>
                {/* 扩大热区 */}
                <circle r={20} fill="transparent" />
              </g>
            );
          })}

          {/* 图例 */}
          <g transform={`translate(${GALAXY_W - 28}, 34)`} fontSize={12} fill={STAR} textAnchor="end">
            {Object.entries(TOPIC_COLORS).map(([topic, color], i) => (
              <g key={topic} transform={`translate(0, ${i * 22})`}>
                <text opacity={0.75}>{topic}</text>
                <circle cx={12} cy={-4} r={4} fill={color} opacity={0.8} />
              </g>
            ))}
            <g transform={`translate(0, ${Object.keys(TOPIC_COLORS).length * 22 + 4})`}>
              <text opacity={0.9} fill={GOLD}>{legendLearned}</text>
              <path d={STAR_PATH} transform="translate(6 -13) scale(0.45)" fill={GOLD} />
            </g>
          </g>
        </svg>

        {/* 悬浮词条卡 */}
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-xl border border-white/15 bg-[#1d2133]/95 p-3 text-[#f2eddf] shadow-lg"
            style={{
              left: `${(hovered.x / GALAXY_W) * 100}%`,
              top: `${(hovered.y / GALAXY_H) * 100}%`,
              transform: `translate(${hovered.x > GALAXY_W * 0.72 ? "-108%" : "8%"}, ${hovered.y > GALAXY_H * 0.72 ? "-108%" : "8%"})`,
            }}
          >
            <div className="flex items-center gap-2">
              <span className="font-serif text-[10px]" style={{ color: GOLD }}>Nº {String(hovered.no).padStart(3, "0")}</span>
              <span className="rounded-full border border-white/20 px-1.5 py-px text-[10px] opacity-80">{stageLabels[hovered.stage]}</span>
            </div>
            <p className="mt-1.5 font-medium">{hovered.title}</p>
            <p className="mt-1 text-xs leading-5 opacity-75">{hovered.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
}
