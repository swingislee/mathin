"use client";

import { Eraser, Plus, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ToolComponentProps } from "../types";

interface Row {
  denominator: number;
  count: number;
  color: string;
}

// 仅引用全局设计 token（不依赖星球作用域，保证任何宿主环境可解析）
const COLORS = ["var(--rose)", "var(--leaf-deep)", "var(--ink)", "var(--crater)", "var(--rose-deep)", "var(--leaf)"];
const AXIS_Y = 96;
const ROW_H = 50;
const ZERO_HOME = 56;
/**
 * 逐级缩放：每一级让对应的分数单位占约 120px（拇指宽），
 * 依次是 全览(0–100) → 1 → 1/10 → 1/100 → 1/1000 → 1/10000。
 * 再往下（1/100000）单个像素已装不下有意义的行内容，且平移距离失控，故止步于万分位。
 */
const ZOOM_LEVELS = [10, 120, 1200, 12000, 120000, 1200000];
const ZOOM_LABELS = [null, "1", "1/10", "1/100", "1/1000", "1/10000"] as const;
// 滑杆与档位共用对数坐标：value = log10(unitLength)，档位按钮就是滑杆上的六个锚点
const ZOOM_POWS = ZOOM_LEVELS.map((v) => Math.log10(v));
const ZOOM_MIN = ZOOM_POWS[0];
const ZOOM_MAX = ZOOM_POWS[ZOOM_POWS.length - 1];

function FractionLabel({ x, y, k, d, color }: { x: number; y: number; k: number; d: number; color: string }) {
  if (d === 1) {
    return <text x={x} y={y + 16} textAnchor="middle" fontSize={15} fill={color}>{k}</text>;
  }
  const w = Math.max(String(k).length, String(d).length) * 8.5 + 4;
  return (
    <g fill={color}>
      <text x={x} y={y + 12} textAnchor="middle" fontSize={13}>{k}</text>
      <line x1={x - w / 2} x2={x + w / 2} y1={y + 16} y2={y + 16} stroke={color} strokeWidth={1} />
      <text x={x} y={y + 29} textAnchor="middle" fontSize={13}>{d}</text>
    </g>
  );
}

export function FractionLine({ embedded }: ToolComponentProps) {
  const t = useTranslations("tools.fractionLine");
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; zeroX: number } | null>(null);
  const [width, setWidth] = useState(960);
  const [rows, setRows] = useState<Row[]>([]);
  const [denomText, setDenomText] = useState("2");
  const [zoomPow, setZoomPow] = useState(ZOOM_POWS[1]);
  const unitLength = Math.round(Math.pow(10, zoomPow));
  const [showTicks, setShowTicks] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [zeroX, setZeroX] = useState(ZERO_HOME);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const denominator = Math.min(10000, Math.max(1, Math.round(Number(denomText) || 1)));

  const nextPoint = () => {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.denominator === denominator) {
        return [...prev.slice(0, -1), { ...last, count: last.count + 1 }];
      }
      return [...prev, { denominator, count: 1, color: COLORS[prev.length % COLORS.length] }];
    });
  };

  const undoPoint = () => {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      if (last.count <= 1) return prev.slice(0, -1);
      return [...prev.slice(0, -1), { ...last, count: last.count - 1 }];
    });
  };

  // 等值对齐参考线：出现在 ≥2 行的同一数值位置（如 2/4 与 1/2）
  const guideXs: number[] = [];
  if (showGuides && rows.length > 1) {
    const seen = new Map<number, number>();
    rows.forEach((row) => {
      const values = new Set<number>();
      for (let k = 1; k <= row.count; k++) values.add(Math.round((k / row.denominator) * 1e6));
      values.forEach((v) => seen.set(v, (seen.get(v) ?? 0) + 1));
    });
    seen.forEach((n, v) => {
      if (n >= 2) guideXs.push(zeroX + (v / 1e6) * unitLength);
    });
  }

  const height = AXIS_Y + 34 + Math.max(rows.length, 1) * ROW_H;

  // 整数刻度自适应密度：保证相邻刻度 ≥ 48px，不重叠
  const tickStep = [1, 2, 5, 10, 20, 50].find((s) => s * unitLength >= 48) ?? 100;
  const ticks: number[] = [];
  if (showTicks) {
    for (let n = tickStep; n <= 200; n += tickStep) {
      const x = zeroX + n * unitLength;
      if (x > width - 20) break;
      if (x >= 4) ticks.push(n);
    }
  }
  // 平移边界随缩放走：最远可看到 102 个单位
  const panMin = -(102 * unitLength);

  // 平移手柄：0 点与全部整数刻度共用一套拖拽（解决 0 点被拖出屏幕后无法复原的问题）
  const panHandlers = {
    onPointerDown: (e: React.PointerEvent<SVGGElement>) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragRef.current = { pointerX: e.clientX, zeroX };
    },
    onPointerMove: (e: React.PointerEvent<SVGGElement>) => {
      if (!dragRef.current) return;
      const next = dragRef.current.zeroX + (e.clientX - dragRef.current.pointerX);
      setZeroX(Math.min(width - 40, Math.max(panMin, next)));
    },
    onPointerUp: () => (dragRef.current = null),
    onDoubleClick: () => setZeroX(ZERO_HOME),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 ${embedded ? "py-2" : "py-3"}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">{t("unitLabel")}</span>
          <div className="flex flex-col items-center leading-none">
            <span className="text-sm">1</span>
            <input
              type="number"
              min={1}
              max={100}
              value={denomText}
              onChange={(e) => setDenomText(e.target.value)}
              className="w-12 border-t border-ink bg-transparent pt-0.5 text-center text-sm outline-none"
              aria-label={t("unitLabel")}
            />
          </div>
        </div>
        <Button size="sm" onClick={nextPoint}><Plus size={14} />{t("nextPoint")}</Button>
        <Button variant="ghost" size="sm" onClick={undoPoint}><Undo2 size={14} />{t("undoPoint")}</Button>
        <Button variant="ghost" size="sm" onClick={() => setRows((p) => p.slice(0, -1))}><Eraser size={14} />{t("deleteRow")}</Button>
        <Button variant="ghost" size="sm" onClick={() => setRows([])}><RotateCcw size={14} />{t("clearAll")}</Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span>{t("zoom")}</span>
          <Slider
            value={[zoomPow]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            onValueChange={([v]) => setZoomPow(v)}
            className="w-36"
            aria-label={t("zoom")}
          />
          <div className="flex overflow-hidden rounded-full border">
            {ZOOM_POWS.map((pow, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setZoomPow(pow)}
                className={`px-2 py-1 tabular-nums transition-colors duration-200 ${i > 0 ? "border-l" : ""} ${Math.abs(zoomPow - pow) < 0.05 ? "bg-moon text-ink" : "hover:bg-moon/40"}`}
              >
                {ZOOM_LABELS[i] ?? t("overview")}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showTicks} onChange={(e) => setShowTicks(e.target.checked)} className="accent-[var(--p-accent)]" />
          {t("showTicks")}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} className="accent-[var(--p-accent)]" />
          {t("showGuides")}
        </label>
      </div>
      <p className="px-4 pt-2 text-xs text-muted">{t("zeroHint")}</p>
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto">
        <svg width={width} height={height} className="block">
          {/* 数轴与箭头 */}
          <line x1={8} y1={AXIS_Y} x2={width - 14} y2={AXIS_Y} stroke="var(--ink)" strokeWidth={1.5} />
          <path d={`M${width - 22} ${AXIS_Y - 5} L${width - 10} ${AXIS_Y} L${width - 22} ${AXIS_Y + 5}`} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />

          {/* 整数刻度：每个刻度都是平移手柄（0 由原点标记承担） */}
          {ticks.map((n) => {
            const x = zeroX + n * unitLength;
            return (
              <g key={n} className="cursor-grab active:cursor-grabbing" {...panHandlers} stroke="var(--crater)" fill="var(--muted)">
                <circle cx={x} cy={AXIS_Y} r={14} fill="transparent" stroke="none" />
                <line x1={x} y1={AXIS_Y - 6} x2={x} y2={AXIS_Y + 6} strokeWidth={1.5} />
                <text x={x} y={AXIS_Y - 12} textAnchor="middle" fontSize={11} stroke="none">{n}</text>
              </g>
            );
          })}

          {/* 等值对齐参考线 */}
          {guideXs.map((x) =>
            x > 4 && x < width - 4 ? (
              <line key={x} x1={x} y1={AXIS_Y - 8} x2={x} y2={height - 6} stroke="var(--crater)" strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round" opacity={0.65} />
            ) : null,
          )}

          {/* 各行的点与分数标签 */}
          {rows.map((row, idx) =>
            Array.from({ length: row.count }, (_, i) => i + 1).map((k) => {
              const x = zeroX + (k / row.denominator) * unitLength;
              if (x < -20 || x > width + 20) return null;
              return (
                <g key={`${idx}-${k}`}>
                  <circle cx={x} cy={AXIS_Y} r={4} fill={row.color} />
                  <FractionLabel x={x} y={AXIS_Y + 22 + idx * ROW_H} k={k} d={row.denominator} color={row.color} />
                </g>
              );
            }),
          )}

          {/* 可拖动的原点 */}
          <g className="cursor-grab active:cursor-grabbing" {...panHandlers}>
            <circle cx={zeroX} cy={AXIS_Y} r={14} fill="transparent" />
            <circle cx={zeroX} cy={AXIS_Y} r={5} fill="var(--rose)" />
            <text x={zeroX} y={AXIS_Y - 12} textAnchor="middle" fontSize={12} fill="var(--ink)">0</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
