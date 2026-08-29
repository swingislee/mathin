import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLASSROOM_TOOL_TRAY_SWIPE_THRESHOLD,
  classifyClassroomToolTrayGesture,
} from "@/features/classroom/live/classroom-tool-tray";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("narrow classroom layout", () => {
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

  it("places course information first on narrow screens and keeps the wide right-stack placement", () => {
    const shell = source("src/features/classroom/live/LiveShell.tsx");
    expect(shell).toContain("data-classroom-narrow-course-info");
    expect(shell).toContain('className="shrink-0 lg:hidden"');
    expect(shell).toContain("data-classroom-wide-course-info");
    expect(shell).toContain('className="hidden lg:block"');
    expect(shell).toContain("grid-rows-[minmax(7rem,1fr)_13rem]");
    expect(shell).toContain("lg:grid-rows-[2.5rem_minmax(8rem,1fr)_17.5rem]");
  });

  it("ships a scrollbar-free horizontal tray with upward expansion and wrapped full tools", () => {
    const controlBar = source("src/features/classroom/live/TeacherClassroomControlBar.tsx");
    const toolbar = source("src/features/whiteboard/Toolbar.tsx");
    expect(controlBar).toContain('data-tool-tray-gesture="horizontal-browse-upward-expand"');
    expect(controlBar).toContain("overflow-x-auto overflow-y-hidden");
    expect(controlBar).toContain("[scrollbar-width:none]");
    expect(controlBar).toContain("classifyClassroomToolTrayGesture");
    expect(controlBar).toContain('data-classroom-control-zone="pages"');
    expect(controlBar).toContain('data-classroom-control-zone="utility"');
    expect(toolbar).toContain('data-whiteboard-toolbar-layout={isRail && railExpanded ? "wrapped" : "row"}');
  });
});
