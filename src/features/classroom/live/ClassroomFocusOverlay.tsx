"use client";

import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { panelLayoutStorage } from "@/lib/panel-layout-storage";
import { StudentCard } from "./LivePanels";
import type { ClassroomRosterStudent } from "./ClassroomRosterGrid";
import { ClassroomViewportControls, type ClassroomViewportControl, type ClassroomViewportControlsProps } from "./ClassroomViewportControls";
import { classroomFocusRosterNearDock, classroomFocusToolsLayout, classroomFocusToolsRosterLayout, parseClassroomFocusToolsPreferences } from "./classroom-focus-tools";

const CHANGE = "mathin-focus-roster-change";
const subscribe = (listener: () => void) => {
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener("storage", listener); };
};
const serverSnapshot = () => null;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** 下方视图工具可贴边收起；上方学生入口保持独立，并支持拖动调整位置。 */
export function ClassroomFocusOverlay({ scope, size, students, viewport, onStar, onUndo }: {
  scope: string;
  size: { width: number; height: number };
  students: readonly ClassroomRosterStudent[];
  viewport: Omit<ClassroomViewportControlsProps, "height" | "open" | "onToggle">;
  onStar: (student: ClassroomRosterStudent) => void;
  onUndo: (student: ClassroomRosterStudent) => void;
}) {
  const t = useTranslations("classroom.live");
  const rosterId = useId();
  const toolsId = useId();
  const key = `mathin:focus-tools:v1:${scope}`;
  const snapshot = useCallback(() => panelLayoutStorage.getItem(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const saved = useMemo(() => parseClassroomFocusToolsPreferences(raw), [raw]);
  const [slidersOpen, setSlidersOpen] = useState({ size: false, position: false });
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean; position: { x: number; y: number } } | null>(null);
  const suppressClick = useRef(false);
  const hasRoster = students.length > 0;
  const docked = saved.docked && !dragPosition;
  const dock = classroomFocusToolsLayout(size.width, size.height);
  const position = dragPosition ?? (saved.docked ? dock.rosterPosition : saved);
  const layout = classroomFocusToolsRosterLayout(size.width, size.height, students.length, position, docked);
  const save = (value: typeof saved) => {
    panelLayoutStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE));
  };
  const endDrag = (id: number, commit = true) => {
    const active = drag.current;
    if (active?.id !== id) return;
    suppressClick.current = active.moved;
    if (active.moved && commit) save({ ...saved, ...active.position,
      docked: classroomFocusRosterNearDock(size.width, size.height, active.position) });
    drag.current = null;
    setDragPosition(null);
  };
  const toggleSlider = (control: ClassroomViewportControl) => {
    setSlidersOpen((current) => ({ ...current, [control]: !current[control] }));
    if (saved.rosterOpen) save({ ...saved, rosterOpen: false });
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-[60] overflow-hidden" data-classroom-focus-overlay>
      {size.width > 0 && size.height > 0 && (
        <>
          <div className="absolute transition-transform duration-200 motion-reduce:transition-none"
            style={{ left: dock.left, top: dock.top, width: dock.width, height: dock.height,
              transform: saved.hidden ? `translateX(${dock.hiddenOffset}px)` : undefined }}
            data-classroom-focus-tools data-hidden={saved.hidden}>
            <Button type="button" variant="ghost"
              className="pointer-events-auto absolute -left-6 top-1/2 h-11 w-6 -translate-y-1/2 rounded-l-lg rounded-r-none bg-paper/40 p-0 text-muted shadow-sm backdrop-blur-xl hover:bg-paper/65 before:absolute before:inset-y-0 before:-left-5 before:right-0 before:content-[''] focus-visible:ring-inset focus-visible:ring-offset-0"
              aria-label={t(saved.hidden ? "showFocusTools" : "hideFocusTools")} aria-expanded={!saved.hidden} aria-controls={toolsId}
              data-classroom-focus-tools-toggle onClick={() => {
                setSlidersOpen({ size: false, position: false });
                save({ ...saved, hidden: !saved.hidden });
              }}>
              {saved.hidden ? <ChevronLeft aria-hidden size={14} /> : <ChevronRight aria-hidden size={14} />}
            </Button>
            <div id={toolsId} inert={saved.hidden} aria-hidden={saved.hidden}
              className="h-full rounded-[18px] bg-paper/40 p-1 shadow-sm ring-1 ring-inset ring-paper/30 backdrop-blur-xl backdrop-saturate-150">
              <ClassroomViewportControls {...viewport} height={size.height} open={slidersOpen} onToggle={toggleSlider} />
            </div>
          </div>
          {hasRoster && (
            <section aria-label={t("focusRoster")} data-classroom-focus-roster data-docked={docked} data-expand-direction={layout.expandUp ? "up" : "down"}>
              <Button type="button" variant="ghost"
                className="pointer-events-auto absolute z-10 size-11 touch-none rounded-[18px] bg-paper/40 p-0 text-muted shadow-sm ring-1 ring-inset ring-paper/30 backdrop-blur-xl backdrop-saturate-150 hover:bg-paper/50 hover:text-ink data-[expanded=true]:bg-paper/50 data-[expanded=true]:text-ink focus-visible:ring-inset focus-visible:ring-offset-0"
                style={{ left: layout.anchorLeft, top: layout.anchorTop }}
                aria-label={t(saved.rosterOpen ? "collapseFocusRoster" : "expandFocusRoster")} aria-expanded={saved.rosterOpen} aria-controls={rosterId}
                data-expanded={saved.rosterOpen} data-classroom-focus-roster-handle
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
                  save({ ...saved, docked: false, x: clamp(position.x + direction[0] * 20 / Math.max(1, layout.xRange)), y: clamp(position.y + direction[1] * 20 / Math.max(1, layout.yRange)) });
                }}
                onClick={() => {
                  if (suppressClick.current) { suppressClick.current = false; return; }
                  setSlidersOpen({ size: false, position: false });
                  save({ ...saved, rosterOpen: !saved.rosterOpen });
                }}>
                <Users aria-hidden size={18} strokeWidth={1.75} />
              </Button>
              {saved.rosterOpen && (
                <ul id={rosterId} className="pointer-events-auto absolute z-20 grid auto-rows-[44px] content-start gap-0.5 overflow-y-auto overscroll-contain rounded-2xl bg-paper/90 p-1 shadow-sm ring-1 ring-inset ring-paper/30 backdrop-blur-xl"
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
        </>
      )}
    </div>
  );
}
