import { describe, expect, it } from "vitest";
import { classroomFocusRosterNearDock, classroomFocusToolsLayout, classroomFocusToolsRosterLayout, parseClassroomFocusToolsPreferences } from "@/features/classroom/live/classroom-focus-tools";

describe("focus mode tool dock", () => {
  it("starts with closed panels and preserves the user's collapsed or detached state", () => {
    const defaults = { x: 1, y: 1, docked: true, rosterOpen: false, hidden: false };
    expect(parseClassroomFocusToolsPreferences(null)).toEqual(defaults);
    expect(parseClassroomFocusToolsPreferences("invalid")).toEqual(defaults);
    const saved = { x: 0, y: 0.4, docked: false, rosterOpen: false, hidden: true };
    expect(parseClassroomFocusToolsPreferences(JSON.stringify(saved))).toEqual(saved);
    expect(parseClassroomFocusToolsPreferences('{"x":-2,"y":9,"hidden":"true"}')).toEqual({ ...defaults, x: 0 });
  });

  it("keeps the roster above the view tools and collapses only the lower group", () => {
    for (const [width, height] of [[320, 568], [390, 844], [1024, 768], [1920, 1080]]) {
      const dock = classroomFocusToolsLayout(width, height);
      const roster = classroomFocusToolsRosterLayout(width, height, 5, dock.rosterPosition, true);
      expect(roster.anchorLeft).toBeCloseTo(dock.left + 4);
      expect(roster.anchorTop + 44 + 32).toBeCloseTo(dock.top);
      expect(dock.top + dock.height).toBeLessThanOrEqual(height - 80);
      const hiddenLeft = dock.left + dock.hiddenOffset;
      expect(hiddenLeft).toBe(width);
      expect(roster.anchorLeft + 44).toBeLessThan(width);
    }
  });

  it("opens the roster at its default position with space for the lower collapse tab", () => {
    for (const [width, height] of [[320, 568], [1024, 768], [1920, 1080]]) {
      const dock = classroomFocusToolsLayout(width, height);
      const roster = classroomFocusToolsRosterLayout(width, height, 60, dock.rosterPosition, true);
      expect(roster.left).toBeGreaterThanOrEqual(0);
      expect(roster.left + roster.width).toBeLessThanOrEqual(dock.left - 24);
      expect(roster.top).toBeGreaterThanOrEqual(0);
      expect(roster.top + roster.height).toBeLessThanOrEqual(height - 80);
    }
  });

  it("aligns a dragged roster only when released near its independent default position", () => {
    const width = 1280, height = 720;
    const target = classroomFocusToolsLayout(width, height).rosterPosition;
    expect(classroomFocusRosterNearDock(width, height, { ...target, x: target.x - 27 / (width - 44) })).toBe(true);
    expect(classroomFocusRosterNearDock(width, height, { ...target, x: target.x - 40 / (width - 44) })).toBe(false);
    for (const x of [0, 1]) for (const y of [0, 1]) {
      const roster = classroomFocusToolsRosterLayout(width, height, 20, { x, y }, false);
      expect(roster.anchorLeft).toBe(x === 0 ? 0 : width - 44);
      expect(roster.expandUp).toBe(y === 1);
    }
  });
});
