"use client";

import { useTranslations } from "next-intl";
import {
  LEARNING_SEAT_COLUMNS,
  type LearningCheckStatus,
} from "@/features/school/session-learning-contract";
import type { SessionRosterEntry } from "../types";
import { StudentCard } from "./LivePanels";

export interface ClassroomRosterStudent extends SessionRosterEntry {
  count: number;
  hand: boolean;
  online: boolean;
  answerLabel: string | null;
  learningStatus: LearningCheckStatus | null;
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
  const slotCount = Math.max(
    LEARNING_SEAT_COLUMNS,
    Math.ceil(required / LEARNING_SEAT_COLUMNS) * LEARNING_SEAT_COLUMNS,
  );
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
    if (nextFree === slots.length) {
      slots.push(...new Array<SessionRosterEntry | null>(LEARNING_SEAT_COLUMNS).fill(null));
    }
    slots[nextFree] = student;
  }

  return slots;
}

export function ClassroomRosterGrid({
  students,
  rosterLabel,
  emptySeatLabel,
  starTotalLabel,
  awardStarLabel,
  undoStarLabel,
  undoHint,
  onStar,
  onUndo,
}: {
  students: readonly ClassroomRosterStudent[];
  rosterLabel: string;
  emptySeatLabel: (seat: number) => string;
  starTotalLabel: (name: string, count: number) => string;
  awardStarLabel: (name: string, count: number) => string;
  undoStarLabel: (name: string, count: number) => string;
  undoHint: string;
  onStar: (student: ClassroomRosterStudent) => void;
  onUndo: (student: ClassroomRosterStudent) => void;
}) {
  const t = useTranslations("school.session");
  const slots = buildClassroomRosterSlots(students);
  const byId = new Map(students.map((student) => [student.studentId, student]));

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden"
      aria-label={rosterLabel}
      data-classroom-roster-grid
      data-roster-surface="cards-only"
      data-roster-gap-surface="classroom-backdrop"
      data-roster-scroll={slots.length > 20 ? "internal" : "none"}
    >
      <ul
        className="grid min-h-0 flex-1 auto-rows-[2.75rem] content-start gap-0.5 overflow-y-auto overscroll-contain"
        style={{ gridTemplateColumns: `repeat(${LEARNING_SEAT_COLUMNS}, minmax(0, 1fr))` }}
        data-roster-density="44px-rows-2px-gap"
        data-roster-column-count={LEARNING_SEAT_COLUMNS}
        data-roster-slot-count={slots.length}
      >
        {slots.map((entry, slotIndex) => {
          const seat = slotIndex + 1;
          if (!entry) {
            return (
              <li
                key={`empty-${slotIndex}`}
                aria-label={emptySeatLabel(seat)}
                className="min-h-11 rounded-lg border border-dashed border-line/70"
              />
            );
          }
          const student = byId.get(entry.studentId);
          if (!student) return null;
          return (
            <StudentCard
              key={student.studentId}
              compact
              name={student.name}
              count={student.count}
              hand={student.hand}
              online={student.online}
              answerLabel={student.answerLabel}
              learningStatus={student.learningStatus}
              learningStatusLabel={student.learningStatus ? t("learningStatusShort_" + student.learningStatus) : undefined}
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
    </section>
  );
}
