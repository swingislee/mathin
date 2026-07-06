"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { parseStudied, useStudiedRaw } from "../studied";
import type { TermPlanet } from "../universe";
import type { PlanetLabel } from "./galaxy-scene";
import type { IslandCard } from "./planet-scene";

function NightLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center" style={{ background: "#121524" }}>
      <span className="animate-pulse text-2xl" style={{ color: "#ffd98a" }}>✦</span>
    </div>
  );
}

const GalaxyScene = dynamic(() => import("./galaxy-scene"), { ssr: false, loading: NightLoading });
const PlanetScene = dynamic(() => import("./planet-scene"), { ssr: false, loading: NightLoading });

/** 星系首页视图：客户端计算「推荐星球」= 第一颗仍有未点亮节点的星球 */
export function GalaxyView({ planets, labels, planetSlugs }: {
  planets: TermPlanet[];
  labels: Record<string, PlanetLabel>;
  planetSlugs: Record<string, string[]>;
}) {
  const studied = parseStudied(useStudiedRaw());
  const recommendedId = useMemo(() => {
    for (const p of planets) {
      const slugs = planetSlugs[p.id] ?? [];
      if (slugs.length > 0 && slugs.some((s) => !studied.has(s))) return p.id;
    }
    return null;
  }, [planets, planetSlugs, studied]);
  return <GalaxyScene planets={planets} labels={labels} recommendedId={recommendedId} />;
}

export function PlanetView({ planet, islands }: { planet: TermPlanet; islands: IslandCard[] }) {
  return <PlanetScene planet={planet} islands={islands} />;
}

/** 星球页左栏：各岛屿学习进度（客户端读取已点亮集合） */
export function IslandProgressList({ islands, litTemplate }: {
  islands: { id: string; name: string; slugs: string[] }[];
  /** 形如 "已点亮 {n} / {total}" */
  litTemplate: string;
}) {
  const studied = parseStudied(useStudiedRaw());
  return (
    <ul className="space-y-2.5">
      {islands.map((isl) => {
        const lit = isl.slugs.filter((s) => studied.has(s)).length;
        const done = isl.slugs.length > 0 && lit === isl.slugs.length;
        return (
          <li key={isl.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink/90">{isl.name}</span>
            {isl.slugs.length > 0 ? (
              <span className="tabular-nums text-xs" style={{ color: done ? "#ffd98a" : "var(--muted)" }}>
                {litTemplate.replace("{n}", String(lit)).replace("{total}", String(isl.slugs.length))}
              </span>
            ) : (
              <span className="text-xs text-muted">✦ …</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
