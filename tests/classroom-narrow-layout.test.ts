import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD,
  classifyClassroomToolTrayGesture,
} from "@/features/classroom/live/classroom-tool-tray";
import { buildClassroomRosterSlots } from "@/features/classroom/live/ClassroomRosterGrid";
import type { SessionRosterEntry } from "@/features/classroom/types";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const rosterStudent = (seatPosition: number | null, index: number): SessionRosterEntry => ({
  studentId: `student-${index}`,
  name: `Student ${index}`,
  seatPosition,
  userId: null,
});

describe("narrow classroom layout", () => {
  it("trims fully empty trailing roster rows while preserving occupied seat rows", () => {
    expect(buildClassroomRosterSlots([])).toEqual([]);
    expect(buildClassroomRosterSlots(Array.from({ length: 8 }, (_, index) => rosterStudent(index, index)))).toHaveLength(8);
    expect(buildClassroomRosterSlots([
      rosterStudent(0, 0),
      rosterStudent(8, 1),
    ])).toHaveLength(12);
    expect(buildClassroomRosterSlots(Array.from({ length: 21 }, (_, index) => rosterStudent(index, index)))).toHaveLength(24);
  });

  it("leaves horizontal movement to native browsing and reserves vertical swipes for tray state", () => {
    expect(classifyClassroomToolTrayGesture(
      { x: 10, y: 10 },
      { x: 90, y: 22 },
    )).toBe("none");
    expect(classifyClassroomToolTrayGesture(
      { x: 10, y: 80 },
      { x: 14, y: 80 - CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD },
    )).toBe("expand");
    expect(classifyClassroomToolTrayGesture(
      { x: 10, y: 10 },
      { x: 14, y: 10 + CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD },
    )).toBe("collapse");
    expect(classifyClassroomToolTrayGesture(
      { x: 10, y: 50 },
      { x: 12, y: 40 },
    )).toBe("none");
  });

  it("keeps course information full-width through iPad and moves it into the right stack only on wide screens", () => {
    const shell = source("src/features/classroom/live/LiveShell.tsx");
    expect(shell).toContain("data-classroom-narrow-course-info");
    expect(shell).toContain('className="shrink-0 xl:hidden"');
    expect(shell).toContain("data-classroom-wide-course-info");
    expect(shell).toContain('className="hidden -translate-y-2 xl:block"');
    expect(shell).toContain("grid-rows-[minmax(7rem,1fr)_auto]");
    expect(shell).toContain("lg:grid-rows-[minmax(8rem,1fr)_auto]");
    expect(shell).toContain("xl:grid-rows-[2rem_minmax(8rem,1fr)_auto]");
    expect(shell).toContain("xl:grid-rows-[2rem_2.75rem_minmax(0,1fr)]");
    expect(shell).toContain('"grid min-h-[21rem] w-full flex-none gap-1 bg-transparent lg:min-h-0"');
  });

  it("ships a scrollbar-free horizontal tray with upward expansion and wrapped full tools", () => {
    const controlBar = source("src/features/classroom/live/TeacherClassroomControlBar.tsx");
    const toolbar = source("src/features/whiteboard/Toolbar.tsx");
    expect(controlBar).toContain('data-tool-tray-gesture="horizontal-browse-upward-expand"');
    expect(controlBar).toContain("overflow-x-auto overflow-y-hidden");
    expect(controlBar).toContain("bg-transparent shadow-none ring-0 backdrop-blur-none");
    expect(controlBar).toContain('data-classroom-tool-tray-surface={toolTrayExpanded ? "floating-glass" : "transparent"}');
    expect(controlBar).toContain("[scrollbar-width:none]");
    expect(controlBar).toContain("classifyClassroomToolTrayGesture");
    expect(controlBar).toContain('data-classroom-control-zone="pages"');
    expect(controlBar).toContain('data-classroom-control-zone="utility"');
    expect(controlBar).toContain('data-classroom-fixed-controls="compact-on-narrow"');
    expect(controlBar).toContain("[&_[data-classroom-rail-button]]:!size-9");
    expect(controlBar).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(controlBar).not.toContain("clamp(22rem,31vw,36rem)");
    expect(controlBar).toContain("fixed inset-x-0 bottom-0");
    expect(controlBar).toContain("rounded-none");
    expect(controlBar).toContain("lg:inset-x-3");
    expect(controlBar).toContain("lg:rounded-[1.4rem]");
    expect(toolbar).toContain('data-whiteboard-toolbar-layout={isRail && railExpanded ? "wrapped" : "row"}');
  });

  it("uses a dense mobile learning list while preserving the spatial seat grid from tablet upward", () => {
    const shell = source("src/features/classroom/live/LiveShell.tsx");
    const panel = source("src/features/school/SessionLearningCheckPanel.tsx");
    const fillRail = source("src/features/school/LearningFillRail.tsx");
    const roster = source("src/features/classroom/live/ClassroomRosterGrid.tsx");

    expect(shell).toContain('data-classroom-selection-policy="none-during-teaching"');
    expect(shell).toContain("[-webkit-touch-callout:none]");
    expect(panel).toContain('data-learning-responsive-layout="mobile-list-desktop-seats"');
    expect(panel).toContain("data-learning-mobile-list");
    expect(panel).toContain("data-learning-mobile-row");
    expect(panel).toContain('className="hidden min-h-8 shrink-0 px-2.5 text-xs sm:inline-flex"');
    expect(panel).toContain('"hidden min-h-0 min-w-0 flex-1 gap-0.5 sm:grid"');
    expect(fillRail).toContain('data-learning-fill-layout="mobile-row-desktop-rail"');
    expect(fillRail).toContain("sm:flex-col");
    expect(roster).toContain('data-roster-density="44px-rows-2px-gap"');
    expect(roster).toContain("auto-rows-[2.75rem] content-start gap-0.5");
    expect(roster).toContain("minimumSlots = 0");
    expect(roster).toContain("if (required === 0) return []");
    expect(roster).toContain("data-roster-visible-row-count={visibleRowCount}");
    expect(roster).toContain('style={{ height: `${rosterHeightRem}rem` }}');
  });
});
