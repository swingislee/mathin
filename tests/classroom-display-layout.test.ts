import { describe, expect, it } from "vitest";
import {
  CLASSROOM_DISPLAY_ASPECT,
  CLASSROOM_DISPLAY_GAP,
  CLASSROOM_DISPLAY_SIDE_MIN,
  classroomDisplayBounds,
  clampClassroomDisplayPercent,
  parseClassroomDisplayPreferences,
} from "@/features/classroom/live/classroom-display-layout";

describe("classroom display geometry", () => {
  it("fits an entire 4:3 stage into widescreen without stretching or cropping", () => {
    const bounds = classroomDisplayBounds(1920, 1080, true);
    expect(bounds.maxPercent).toBe(75);
    expect(bounds.maxWidth).toBe(1440);
    expect(bounds.maxWidth / CLASSROOM_DISPLAY_ASPECT).toBe(1080);
    expect(clampClassroomDisplayPercent(95, bounds)).toBe(75);
  });

  it.each([[1024, 700], [1280, 650], [1920, 1020], [5120, 1380]])(
    "keeps the full stage and usable right column in %i × %i split layouts",
    (width, height) => {
      const bounds = classroomDisplayBounds(width, height, false);
      for (const requested of [20, 40, 60, 80, 100]) {
        const stageWidth = width * clampClassroomDisplayPercent(requested, bounds) / 100;
        expect(stageWidth / CLASSROOM_DISPLAY_ASPECT).toBeLessThanOrEqual(height);
        expect(width - stageWidth - CLASSROOM_DISPLAY_GAP).toBeGreaterThanOrEqual(CLASSROOM_DISPLAY_SIDE_MIN);
      }
    },
  );

  it("adapts saved desktop sizes to portrait focus without changing their stored values", () => {
    const saved = parseClassroomDisplayPreferences('{"splitPercent":68,"focusPercent":75}');
    const bounds = classroomDisplayBounds(390, 844, true);
    expect(bounds.maxPercent).toBe(100);
    expect(clampClassroomDisplayPercent(saved.focusPercent!, bounds)).toBe(75);
    expect(saved.splitPercent).toBe(68);
  });

  it("falls back to the original layout when stored preferences are missing or malformed", () => {
    for (const raw of [null, "broken", "null", "[]", '{"splitPercent":500,"focusPercent":"70"}']) {
      expect(parseClassroomDisplayPreferences(raw)).toEqual({ splitPercent: null, focusPercent: null });
    }
    expect(parseClassroomDisplayPreferences('{"splitPercent":55,"focusPercent":70}')).toEqual({ splitPercent: 55, focusPercent: 70 });
  });
});
