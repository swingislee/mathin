"use client";

import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";
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

/** 名单按钮保持位置锚点；浮窗独立于滑块层，向屏幕内部展开。 */
export function ClassroomFocusOverlay({ scope, size, students, onStar, onUndo }: {
  scope: string;
  size: { width: number; height: number };
  students: readonly ClassroomRosterStudent[];
  onStar: (student: ClassroomRosterStudent) => void;
  onUndo: (student: ClassroomRosterStudent) => void;
}) {
  const t = useTranslations("classroom.live");
  const rosterId = useId();
  const key = `mathin:focus-roster:v2:${scope}`;
  const snapshot = useCallback(() => panelLayoutStorage.getItem(key) ?? panelLayoutStorage.getItem(`mathin:focus-roster:v1:${scope}`), [key, scope]);
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
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean; position: { x: number; y: number } } | null>(null);
  const suppressClick = useRef(false);
  const position = dragPosition ?? saved;
  const layout = classroomFocusDockLayout(size.width, size.height, students.length, position);
  const save = (value: typeof saved) => {
    panelLayoutStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE));
  };
  const endDrag = (id: number, commit = true) => {
    const active = drag.current;
    if (active?.id !== id) return;
    suppressClick.current = active.moved;
    if (active.moved && commit) save({ ...saved, ...active.position });
    drag.current = null;
    setDragPosition(null);
  };
  const pointsUp = saved.open ? !layout.expandUp : layout.expandUp;
  const Direction = pointsUp ? ChevronUp : ChevronDown;
  return (
    <div className="pointer-events-none absolute inset-0 z-[60]" data-classroom-focus-overlay>
      {students.length > 0 && size.width > 0 && size.height > 0 && (
        <section aria-label={t("focusRoster")} data-classroom-focus-roster data-expand-direction={layout.expandUp ? "up" : "down"}>
          <Button type="button" variant="ghost" className="pointer-events-auto absolute z-10 size-11 touch-none flex-col gap-0.5 rounded-full bg-paper/85 p-0 text-muted shadow-sm backdrop-blur-sm hover:bg-paper hover:text-ink"
            style={{ left: layout.anchorLeft, top: layout.anchorTop }}
            aria-label={t(saved.open ? "collapseFocusRoster" : "expandFocusRoster")} aria-expanded={saved.open} aria-controls={rosterId}
            title={t("moveFocusRoster")} data-classroom-focus-roster-handle
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return;
              suppressClick.current = false;
              drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: position.x, startY: position.y, moved: false, position };
              try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (!active || active.id !== event.pointerId) return;
              const dx = event.clientX - active.x, dy = event.clientY - active.y;
              active.moved ||= Math.hypot(dx, dy) > 5;
              if (active.moved) {
                active.position = { x: clamp(active.startX + dx / Math.max(1, layout.xRange)), y: clamp(active.startY + dy / Math.max(1, layout.yRange)) };
                setDragPosition(active.position);
              }
            }}
            onPointerUp={(event) => endDrag(event.pointerId)} onPointerCancel={(event) => endDrag(event.pointerId, false)}
            onLostPointerCapture={(event) => endDrag(event.pointerId, false)}
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
            <Users aria-hidden size={16} />
            <span className="flex items-center gap-0.5 text-[10px] leading-none tabular-nums">{students.length}<Direction aria-hidden size={10} /></span>
          </Button>
          {saved.open && (
            <ul id={rosterId} className="pointer-events-auto absolute grid auto-rows-[44px] content-start gap-0.5 overflow-y-auto overscroll-contain rounded-lg bg-paper/95 p-1 shadow-md ring-1 ring-line/70 backdrop-blur-sm"
              style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height, gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
              {students.map((student) => (
                <StudentCard key={student.studentId} {...student} compact touchScroll flat
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
    </div>
  );
}
