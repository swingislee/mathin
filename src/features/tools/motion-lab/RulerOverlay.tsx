"use client";

import { useEffect, useRef, useState } from "react";
import { POST_PAD, fmt, getTickInterval } from "./shared";

const BAND_H = 52;

/**
 * 测距尺（补齐原 demo 的"尺子"本意）：
 * 可上下拖动的刻度带；每个角色向尺子投下虚线参考线，
 * 相邻角色之间实时标注间距（相遇/追及时间距动态变化）。
 */
export function RulerOverlay({ xs, ppm, length }: {
  /** 各角色位置（米），未排序 */
  xs: number[];
  ppm: number;
  length: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerY: number; y0: number } | null>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  const [y, setY] = useState(8);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tick = getTickInterval(length);
  const decimals = tick < 1 ? String(tick).split(".")[1]?.length ?? 0 : 0;
  const marks: number[] = [];
  for (let m = 0; m <= length + 1e-9; m += tick) marks.push(m);

  const sorted = [...xs].sort((a, b) => a - b);
  const px = (m: number) => POST_PAD + m * ppm;
  const bandTop = Math.max(0, Math.min(size.h - BAND_H, y));
  const gapY = bandTop + BAND_H + 14;

  return (
    <div ref={ref} className="absolute inset-0">
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {/* 角色 → 尺子的投影参考线 */}
        {sorted.map((m, i) => (
          <line key={i} x1={px(m)} x2={px(m)} y1={0} y2={size.h} stroke="var(--crater)" strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round" opacity={0.7} />
        ))}
        {/* 相邻角色间距标注（相遇/追及的核心读数） */}
        {sorted.slice(1).map((m, i) => {
          const a = px(sorted[i]);
          const b = px(m);
          if (b - a < 36) return null;
          return (
            <g key={i} stroke="var(--rose-deep)" fill="var(--rose-deep)">
              <line x1={a + 3} x2={b - 3} y1={gapY} y2={gapY} strokeWidth={1.5} />
              <line x1={a + 3} x2={a + 3} y1={gapY - 5} y2={gapY + 5} strokeWidth={1.5} />
              <line x1={b - 3} x2={b - 3} y1={gapY - 5} y2={gapY + 5} strokeWidth={1.5} />
              <text x={(a + b) / 2} y={gapY - 7} textAnchor="middle" fontSize={13} fontWeight={500} stroke="none" className="tabular-nums">
                {fmt(m - sorted[i])} m
              </text>
            </g>
          );
        })}
      </svg>

      {/* 刻度带（可拖动） */}
      <div
        className="pointer-events-auto absolute inset-x-0 cursor-grab touch-none rounded-lg border border-crater/50 bg-moon/30 backdrop-blur-[1px] active:cursor-grabbing"
        style={{ top: bandTop, height: BAND_H }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          dragRef.current = { pointerY: e.clientY, y0: bandTop };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          setY(dragRef.current.y0 + (e.clientY - dragRef.current.pointerY));
        }}
        onPointerUp={() => (dragRef.current = null)}
      >
        <svg className="h-full w-full">
          {marks.map((m) => (
            <g key={m} stroke="var(--crater)" fill="var(--ink)">
              <line x1={px(m)} x2={px(m)} y1={0} y2={12} strokeWidth={1.5} />
              <text x={px(m)} y={28} textAnchor="middle" fontSize={12} stroke="none" className="tabular-nums">
                {m.toFixed(decimals)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
