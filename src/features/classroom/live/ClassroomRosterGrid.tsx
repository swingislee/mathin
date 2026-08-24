"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SessionRosterEntry } from "../types";
import { StudentCard } from "./LivePanels";

export interface ClassroomRosterStudent extends SessionRosterEntry {
  count: number;
  hand: boolean;
  online: boolean;
  answerLabel: string | null;
  interactive: boolean;
}

/** Stable 4-column slot projection shared by 1/8/20/21–30 student layouts. */
export function buildClassroomRosterSlots(
  students: readonly SessionRosterEntry[],
  minimumSlots = 20,
): Array<SessionRosterEntry | null> {
  const validSeats = students
    .map((student) => student.seatPosition)
    .filter((seat): seat is number => typeof seat === "number" && Number.isInteger(seat) && seat >= 0);
  const required = Math.max(minimumSlots, students.length, validSeats.length ? Math.max(...validSeats) + 1 : 0);
  const slotCount = Math.max(4, Math.ceil(required / 4) * 4);
  const slots = new Array<SessionRosterEntry | null>(slotCount).fill(null);
  const unseated: SessionRosterEntry[] = [];

  for (const student of students) {
    const seat = student.seatPosition;
    if (typeof seat === "number" && Number.isInteger(seat) && seat >= 0 && seat < slots.length && !slots[seat]) {
      slots[seat] = student;
    } else {
      unseated.push(student);
    }
  }

  let nextFree = 0;
  for (const student of unseated) {
    while (nextFree < slots.length && slots[nextFree]) nextFree += 1;
    if (nextFree === slots.length) slots.push(null, null, null, null);
    slots[nextFree] = student;
  }

  return slots;
}

export function ClassroomRosterGrid({
  students,
  rosterLabel,
  emptySeatLabel,
  seatLabel,
  starTotalLabel,
  awardStarLabel,
  undoStarLabel,
  undoHint,
  collapsed,
  collapseLabel,
  expandLabel,
  onToggleCollapsed,
  onStar,
  onUndo,
}: {
  students: readonly ClassroomRosterStudent[];
  rosterLabel: string;
  emptySeatLabel: (seat: number) => string;
  seatLabel: (seat: number) => string;
  starTotalLabel: (name: string, count: number) => string;
  awardStarLabel: (name: string, count: number) => string;
  undoStarLabel: (name: string, count: number) => string;
  undoHint: string;
  collapsed: boolean;
  collapseLabel: string;
  expandLabel: string;
  onToggleCollapsed: () => void;
  onStar: (student: ClassroomRosterStudent) => void;
  onUndo: (student: ClassroomRosterStudent) => void;
}) {
  const slots = buildClassroomRosterSlots(students);
  const byId = new Map(students.map((student) => [student.studentId, student]));

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper"
      data-classroom-roster-grid
      data-roster-scroll={slots.length > 20 ? "internal" : "none"}
    >
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line px-2">
        {!collapsed && <h2 className="min-w-0 flex-1 truncate text-xs text-muted">{rosterLabel}</h2>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? expandLabel : collapseLabel}
          title={collapsed ? expandLabel : collapseLabel}
          className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          {collapsed ? <ChevronLeft aria-hidden size={15} /> : <ChevronRight aria-hidden size={15} />}
        </button>
      </div>
      {!collapsed && (
        <ul className="grid min-h-0 flex-1 auto-rows-[minmax(2.75rem,auto)] grid-cols-4 gap-1 overflow-y-auto p-1 overscroll-contain" data-roster-slot-count={slots.length}>
          {slots.map((entry, slotIndex) => {
            const seat = slotIndex + 1;
            if (!entry) {
              return (
                <li
                  key={`empty-${slotIndex}`}
                  aria-label={emptySeatLabel(seat)}
                  className="grid min-h-11 place-items-center rounded-lg border border-dashed border-line/70 px-1 text-[10px] text-muted/70"
                >
                  {seat}
                </li>
              );
            }
            const student = byId.get(entry.studentId);
            if (!student) return null;
            return (
              <StudentCard
                key={student.studentId}
                compact
                seatLabel={seatLabel(seat)}
                name={student.name}
                count={student.count}
                hand={student.hand}
                online={student.online}
                answerLabel={student.answerLabel}
                interactive={student.interactive}
                undoHint={undoHint}
                starTotalLabel={starTotalLabel(student.name, student.count)}
                awardStarLabel={awardStarLabel(student.name, student.count)}
                undoStarLabel={undoStarLabel(student.name, student.count)}
                onStar={() => onStar(student)}
                onUndo={() => onUndo(student)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
