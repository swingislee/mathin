"use client";

import type { ComponentProps, ReactNode } from "react";
import { SpatialActionIcon } from "./SpatialActionIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Axis } from "@/features/spatial-math/domain";
import { CUBE_AXIS_COLORS, CUBE_COLORS, type CubeColor, type CubeMarkShape, type CubeView } from "../spatial-lab/cube-structures-contract";
import { CUBE_MARK_PATHS } from "../spatial-lab/cube-structures-annotations";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";

export function SpatialIconButton({ label, active, className, ...props }: Omit<ComponentProps<typeof Button>, "aria-label" | "title"> & {
  readonly label: string;
  readonly active?: boolean;
}) {
  return <Button type="button" size="sm" variant={active ? "secondary" : "ghost"} aria-label={label} title={label}
    aria-pressed={active} className={cn(styles.icon, active && "bg-moon/40", className)} {...props} />;
}

/** 非模态工作区侧栏：位于画布内，切换鼠标工具时可以继续保留。 */
export function SpatialCanvasPanel({ title, anchor = "tool", closeLabel, onClose, children }: {
  readonly title: string; readonly closeLabel: string; readonly onClose: () => void; readonly children: ReactNode;
  readonly anchor?: "tool" | "meta" | "bottom";
}) {
  return <aside className={styles.panel} aria-label={title} data-cube-canvas-panel data-cube-panel-anchor={anchor}>
    <div className={styles.panelHeader}><span>{title}</span><SpatialIconButton label={closeLabel} onClick={onClose}><SpatialActionIcon action="close" /></SpatialIconButton></div>
    <div className={styles.panelContent}>{children}</div>
  </aside>;
}

export function SpatialAxisIcon({ axis }: { readonly axis: Axis }) {
  return <svg viewBox="0 0 24 24" aria-hidden style={{ color: CUBE_AXIS_COLORS[axis] }}><text x="12" y="17" textAnchor="middle" fill="currentColor" fontFamily="sans-serif" fontWeight="700" fontSize="18">{axis.toUpperCase()}</text></svg>;
}

export function SpatialColorPicker({ value, labels, label, disabled, onChange }: {
  readonly value: CubeColor; readonly labels: readonly string[]; readonly label: string;
  readonly disabled?: boolean; readonly onChange: (value: CubeColor) => void;
}) {
  return <div className="flex flex-wrap gap-1" aria-label={label}>{CUBE_COLORS.map((color, index) =>
    <SpatialIconButton key={color} label={labels[index]} active={value === color} disabled={disabled} onClick={() => onChange(color)}>
      <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill={color} stroke="currentColor" strokeWidth=".5" /></svg>
    </SpatialIconButton>)}</div>;
}

export function SpatialMarkIcon({ shape }: { readonly shape: CubeMarkShape }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" aria-hidden><path d={CUBE_MARK_PATHS[shape]} /></svg>;
}

export function SpatialViewIcon({ view }: { readonly view: CubeView | "bottom" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <g transform={view === "bottom" ? "translate(0 24) scale(1 -1)" : undefined}>
    <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
    <path d="m3 7 9 5 9-5M12 12v10" />
    {(view === "top" || view === "bottom") && <path d="m12 2 9 5-9 5-9-5Z" fill="currentColor" opacity=".4" />}
    {(view === "front" || view === "left") && <path d="m3 7 9 5v10l-9-5Z" fill="currentColor" opacity=".4" />}
    {view === "left" && <path d="m9 12-4 2 4 2" strokeWidth="1.8" />}
    {view === "right" && <path d="m12 12 9-5v10l-9 5Z" fill="currentColor" opacity=".4" />}
    </g>
  </svg>;
}
