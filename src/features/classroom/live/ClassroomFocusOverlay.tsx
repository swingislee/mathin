"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";
import { cn } from "@/lib/utils";
import { StudentCard } from "./LivePanels";
import type { ClassroomRosterStudent } from "./ClassroomRosterGrid";
import { classroomFocusDockLayout } from "./classroom-display-layout";

const CHANGE = "mathin-focus-roster-change";
const subscribe = (listener: () => void) => {
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener("storage", listener); };
};
const serverSnapshot = () => null;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** 专注名单悬浮在可见区域内；仅标题承担拖动，名单继续复用原加星与撤销链路。 */
export function ClassroomFocusOverlay({ scope, size, students, verticalPosition, onPan, onCommit, onStar, onUndo }: {
  scope: string;
  size: { width: number; height: number };
  students: readonly ClassroomRosterStudent[];
  verticalPosition: number | null;
  onPan: (position: number) => void;
  onCommit: () => void;
  onStar: (student: ClassroomRosterStudent) => void;
  onUndo: (student: ClassroomRosterStudent) => void;
}) {
  const t = useTranslations("classroom.live");
  const key = `mathin:focus-roster:v1:${scope}`;
  const snapshot = useCallback(() => panelLayoutStorage.getItem(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const saved = useMemo(() => {
    try {
      const value = JSON.parse(raw ?? "null");
      return { x: typeof value?.x === "number" && Number.isFinite(value.x) ? clamp(value.x) : 1,
        y: typeof value?.y === "number" && Number.isFinite(value.y) ? clamp(value.y) : 0,
        open: value?.open !== false };
    } catch { return { x: 1, y: 0, open: true }; }
  }, [raw]);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const position = dragPosition ?? saved;
  const layout = classroomFocusDockLayout(size.width, size.height, students.length, saved.open, verticalPosition !== null);
  const save = (value: typeof saved) => {
    panelLayoutStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE));
  };
  const endDrag = (id: number) => {
    if (drag.current?.id !== id) return;
    suppressClick.current = drag.current.moved;
    if (drag.current.moved) save({ ...saved, ...position });
    drag.current = null;
    setDragPosition(null);
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-50" data-classroom-focus-overlay>
      {students.length > 0 && (
        <section aria-label={t("focusRoster")} data-classroom-focus-roster
          className="pointer-events-auto absolute flex min-h-11 flex-col overflow-hidden rounded-xl border border-line bg-paper/90 shadow-sm backdrop-blur-md"
          style={{ left: 8 + position.x * layout.xRange, top: 8 + position.y * layout.yRange, width: layout.width, height: layout.height }}>
          <Button type="button" variant="ghost" className={cn("h-11 min-h-11 w-full touch-none gap-1 rounded-none px-2", saved.open && "justify-between")}
            aria-label={t(saved.open ? "collapseFocusRoster" : "expandFocusRoster")} aria-expanded={saved.open}
            title={t("moveFocusRoster")} data-classroom-focus-roster-handle
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              suppressClick.current = false;
              drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: position.x, startY: position.y, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (!active || active.id !== event.pointerId) return;
              const dx = event.clientX - active.x, dy = event.clientY - active.y;
              active.moved ||= Math.hypot(dx, dy) > 5;
              if (active.moved) setDragPosition({ x: clamp(active.startX + dx / Math.max(1, layout.xRange)), y: clamp(active.startY + dy / Math.max(1, layout.yRange)) });
            }}
            onPointerUp={(event) => endDrag(event.pointerId)} onPointerCancel={(event) => endDrag(event.pointerId)}
            onKeyDown={(event) => {
              const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
              if (!direction) return;
              event.preventDefault(); event.stopPropagation();
              save({ ...saved, x: clamp(position.x + direction[0] * 20 / Math.max(1, layout.xRange)), y: clamp(position.y + direction[1] * 20 / Math.max(1, layout.yRange)) });
            }}
            onClick={() => {
              if (suppressClick.current) { suppressClick.current = false; return; }
              save({ ...saved, open: !saved.open });
            }}>
            <Users aria-hidden size={17} />
            {saved.open && <><span className="font-mono text-xs">{students.length}</span><ChevronUp aria-hidden size={14} /></>}
          </Button>
          {saved.open && (
            <ul className="grid min-h-0 flex-1 auto-rows-[44px] content-start gap-0.5 overflow-y-auto overscroll-contain px-1 pb-1"
              style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
              {students.map((student) => (
                <StudentCard key={student.studentId} {...student} compact touchScroll
                  undoHint={t("undoStar")}
                  starTotalLabel={t("studentStarTotal", { name: student.name, count: student.count })}
                  awardStarLabel={t("awardStarLabel", { name: student.name, count: student.count })}
                  undoStarLabel={t("undoStarLabel", { name: student.name, count: student.count })}
                  onStar={() => onStar(student)} onUndo={() => onUndo(student)} />
              ))}
            </ul>
          )}
        </section>
      )}
      {verticalPosition !== null && (
        <div className="pointer-events-auto absolute right-2 top-1/2 flex h-[min(40%,15rem)] w-11 -translate-y-1/2 flex-col items-center gap-3 rounded-xl bg-paper/90 py-2 shadow-sm backdrop-blur-md"
          data-classroom-focus-pan title={t("displayVerticalPosition")}>
          <ChevronUp aria-hidden size={16} className="shrink-0 text-muted" />
          <Slider orientation="vertical" aria-label={t("displayVerticalPosition")} aria-valuetext={t("displayPositionPercent", { value: Math.round(verticalPosition) })}
            value={[100 - verticalPosition]} min={0} max={100} step={1}
            onValueChange={([value]) => onPan(100 - value)} onValueCommit={onCommit}
            className="min-h-0 w-11 flex-1" thumbClassName="size-8 cursor-ns-resize rounded-md bg-card" />
          <ChevronDown aria-hidden size={16} className="shrink-0 text-muted" />
        </div>
      )}
    </div>
  );
}
