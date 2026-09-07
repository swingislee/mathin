"use client";

import type { ComponentProps, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Axis } from "@/features/spatial-math/domain";
import { CUBE_AXIS_COLORS, type CubeView } from "./cube-structures-contract";
import styles from "./CubeStructuresWorkbench.module.css";

export function CubeIconButton({ label, active, className, ...props }: Omit<ComponentProps<typeof Button>, "aria-label" | "title"> & {
  readonly label: string;
  readonly active?: boolean;
}) {
  return <Button type="button" size="sm" variant={active ? "secondary" : "ghost"} aria-label={label} title={label}
    aria-pressed={active} className={cn(styles.icon, active && "bg-moon/40", className)} {...props} />;
}

/** 非模态工作区侧栏：位于画布内，切换鼠标工具时可以继续保留。 */
export function CubeCanvasPanel({ title, closeLabel, onClose, children }: {
  readonly title: string; readonly closeLabel: string; readonly onClose: () => void; readonly children: ReactNode;
}) {
  return <aside className={styles.panel} aria-label={title} data-cube-canvas-panel>
    <div className={styles.panelHeader}><span>{title}</span><CubeIconButton label={closeLabel} onClick={onClose}><X aria-hidden /></CubeIconButton></div>
    <div className={styles.panelContent}>{children}</div>
  </aside>;
}

export function CubeAxisIcon({ axis }: { readonly axis: Axis }) {
  return <svg viewBox="0 0 24 24" aria-hidden style={{ color: CUBE_AXIS_COLORS[axis] }}><text x="12" y="17" textAnchor="middle" fill="currentColor" fontFamily="sans-serif" fontWeight="700" fontSize="18">{axis.toUpperCase()}</text></svg>;
}

export function CubeViewIcon({ view }: { readonly view: CubeView }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
    <path d="m3 7 9 5 9-5M12 12v10" />
    {view === "top" && <path d="m12 2 9 5-9 5-9-5Z" fill="currentColor" opacity=".4" />}
    {view === "front" && <path d="m3 7 9 5v10l-9-5Z" fill="currentColor" opacity=".4" />}
    {view === "right" && <path d="m12 12 9-5v10l-9 5Z" fill="currentColor" opacity=".4" />}
  </svg>;
}
