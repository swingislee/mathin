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

  it("aligns the docked roster with its slot and leaves only the arrow tab on collapse", () => {
    for (const [width, height] of [[320, 568], [390, 844], [1024, 768], [1920, 1080]]) {
      const dock = classroomFocusToolsLayout(width, height, true);
      const roster = classroomFocusToolsRosterLayout(width, height, 5, dock.rosterPosition, true);
      expect(roster.anchorLeft).toBeCloseTo(dock.left + 4);
      expect(roster.anchorTop + 44).toBeCloseTo(dock.top + dock.height - 4);
      expect(dock.top + dock.height).toBeLessThanOrEqual(height - 80);
      const hiddenLeft = dock.left + dock.hiddenOffset;
      expect(hiddenLeft).toBe(width);
      expect(hiddenLeft - 24).toBe(width - 24);
      const withoutRoster = classroomFocusToolsLayout(width, height, false);
      expect(withoutRoster.left).toBe(dock.left);
      expect(withoutRoster.top + withoutRoster.height).toBe(dock.top + dock.height);
    }
  });

  it("opens a docked roster inside the screen with space for the collapse tab", () => {
    for (const [width, height] of [[320, 568], [1024, 768], [1920, 1080]]) {
      const dock = classroomFocusToolsLayout(width, height, true);
      const roster = classroomFocusToolsRosterLayout(width, height, 60, dock.rosterPosition, true);
      expect(roster.left).toBeGreaterThanOrEqual(0);
      expect(roster.left + roster.width).toBeLessThanOrEqual(dock.left - 24);
      expect(roster.top).toBeGreaterThanOrEqual(0);
      expect(roster.top + roster.height).toBeLessThanOrEqual(height - 80);
    }
  });

  it("snaps a dragged roster back only when released near its dock slot", () => {
    const width = 1280, height = 720;
    const target = classroomFocusToolsLayout(width, height, true).rosterPosition;
    expect(classroomFocusRosterNearDock(width, height, { ...target, x: target.x - 27 / (width - 44) })).toBe(true);
    expect(classroomFocusRosterNearDock(width, height, { ...target, x: target.x - 40 / (width - 44) })).toBe(false);
    for (const x of [0, 1]) for (const y of [0, 1]) {
      const roster = classroomFocusToolsRosterLayout(width, height, 20, { x, y }, false);
      expect(roster.anchorLeft).toBe(x === 0 ? 0 : width - 44);
      expect(roster.expandUp).toBe(y === 1);
    }
  });
});
