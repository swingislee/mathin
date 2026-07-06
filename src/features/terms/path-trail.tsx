"use client";

import { useMemo } from "react";
import { Star4 } from "@/components/star4";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { parseStudied, useStudiedRaw } from "./studied";

export interface TrailNode {
  slug: string;
  title: string;
  summary: string;
  no: number;
}

const ROW_H = 128;
const W = 680;

/** 岛屿学习路径：多邻国式蜿蜒小路，星石状态＝已点亮/当前推荐/待探索（不置灰） */
export function PathTrail({ nodes, currentLabel }: { nodes: TrailNode[]; currentLabel: string }) {
  const studied = parseStudied(useStudiedRaw());
  const currentIdx = useMemo(() => {
    const i = nodes.findIndex((n) => !studied.has(n.slug));
    return i === -1 ? null : i;
  }, [nodes, studied]);

  const points = nodes.map((_, i) => ({
    x: W / 2 + Math.sin(i * 1.15 + 0.6) * 190,
    y: 70 + i * ROW_H,
  }));

  const pathD = points
    .map((p, i) => {
      if (i === 0) return `M${p.x} ${p.y}`;
      const prev = points[i - 1];
      return `C ${prev.x} ${prev.y + ROW_H * 0.55}, ${p.x} ${p.y - ROW_H * 0.55}, ${p.x} ${p.y}`;
    })
    .join(" ");

  const height = 70 + (nodes.length - 1) * ROW_H + 90;

  return (
    <div className="relative mx-auto w-full max-w-2xl" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${height}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <path d={pathD} fill="none" stroke="var(--crater)" strokeWidth={2} strokeLinecap="round" strokeDasharray="0.5 10" opacity={0.7} />
      </svg>
      {nodes.map((n, i) => {
        const lit = studied.has(n.slug);
        const current = currentIdx === i;
        const p = points[i];
        const labelLeft = p.x > W / 2;
        return (
          <div key={n.slug} className="absolute" style={{ left: `${(p.x / W) * 100}%`, top: p.y }}>
            <Link href={`/terms/concepts/${n.slug}`} className="group block">
              {/* 星石：圆心锚定在路径点上 */}
              <span
                className={cn(
                  "absolute grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[1.5px] shadow-sm transition-transform duration-200 group-hover:-translate-y-[calc(50%+2px)]",
                  lit ? "border-[var(--crater)] bg-moon" : "border-crater bg-card",
                )}
              >
                {current && <span className="absolute -inset-1.5 animate-pulse rounded-full border-2 border-rose/70" aria-hidden />}
                <Star4 size={20} className={lit ? "text-rose" : "text-crater"} />
              </span>
              {/* 说明：伸向路径外侧 */}
              <span className={cn("absolute top-0 w-48 -translate-y-1/2 md:w-60", labelLeft ? "right-10 text-right" : "left-10 text-left")}>
                <span className="block text-sm font-medium text-ink group-hover:underline">
                  {n.title}
                  {current && <span className="ml-2 rounded-full bg-rose px-1.5 py-px text-[10px] text-white">{currentLabel}</span>}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">{n.summary}</span>
                <span className="mt-0.5 block font-serif text-[10px] text-muted/80">Nº {String(n.no).padStart(3, "0")}</span>
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
