import { describe, expect, it } from "vitest";
import { beginViewportGesture, moveViewportGesture, compareViewport, parseClassroomViewport, viewportCenter, viewportPosition } from "@/features/classroom/live/classroom-viewport";
import { classroomDisplayBounds, classroomFocusDockLayout } from "@/features/classroom/live/classroom-display-layout";
import { CLASSROOM_VIEWPORT_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";

describe("classroom viewport geometry and bounded snapshot", () => {
  it("keeps the touched vertical point under the fingers while pinching and moving", () => {
    const points = [{ x: 800, y: 540, clientY: 540 }, { x: 1000, y: 540, clientY: 540 }];
    const start = beginViewportGesture(points, 75, { top: 0, height: 1080 });
    const bounds = classroomDisplayBounds(1920, 1080, true);
    const result = moveViewportGesture(start, [{ ...points[0], x: 700, y: 600 }, { ...points[1], x: 1100, y: 600 }], { top: 0, width: 1920, height: 1080 }, bounds.minPercent, bounds.maxPercent);
    expect(result.percent).toBe(100);
    const height = 1920 * result.percent / 100 * 3 / 4;
    const top = 540 - result.centerY * height;
    expect(top + start.anchorY * height).toBeCloseTo(600);
    expect(moveViewportGesture(start, [{ ...points[0], x: 899 }, { ...points[1], x: 901 }], { top: 0, width: 1920, height: 1080 }, 40, 100).percent).toBe(40);
  });

  it("uses page coordinates across displays with different aspect ratios", () => {
    const center = viewportCenter(1440, 1080, 100);
    expect(center).toBe(0.625);
    expect(viewportPosition(1440, 1080, center)).toBe(100);
    expect(viewportPosition(1200, 900, center)).toBe(100);
    expect(viewportPosition(720, 1080, center)).toBe(50);
    expect(viewportPosition(1440, 1080, 0)).toBe(0);
    expect(viewportPosition(1440, 1080, 1)).toBe(100);
  });

  it("rejects malformed or unbounded views and orders duplicate/delayed packets", () => {
    const view = { action: "viewport", version: 1, focused: true, zoom: 4 / 3, centerY: 0.5, revision: 12, writer: "teacher-window" };
    const parsed = parseClassroomViewport(view)!;
    expect(parsed).toEqual(view);
    expect(classroomInteractionPayloadWithinBudget(CLASSROOM_VIEWPORT_SYNC_V1, parsed)).toBe(true);
    for (const change of [{ version: 2 }, { zoom: NaN }, { zoom: Infinity }, { zoom: 101 }, { zoom: 0 }, { centerY: -1 }, { focused: "true" }, { revision: 0 }, { revision: 1.5 }, { writer: "x".repeat(129) }, { privateData: "extra" }]) {
      expect(parseClassroomViewport({ ...view, ...change })).toBeNull();
    }
    expect(compareViewport(parsed, parsed)).toBe(0);
    expect(compareViewport({ ...parsed, revision: 11 }, parsed)).toBeLessThan(0);
    expect(compareViewport({ ...parsed, writer: "z-window" }, parsed)).toBeGreaterThan(0);
  });

  it("keeps a compact scrollable roster inside the viewport at all four edges", () => {
    const desktop = classroomFocusDockLayout(1920, 1080, 30, { x: 1, y: 0 });
    expect(desktop.columns).toBe(3);
    expect(desktop.height).toBeLessThanOrEqual(336);
    expect(desktop.height).toBeLessThan(10 * 44);
    for (const [width, height] of [[390, 844], [1024, 768], [1920, 1080]]) {
      for (const x of [0, 1]) for (const y of [0, 0.5, 1]) {
        const dock = classroomFocusDockLayout(width, height, 60, { x, y });
        expect(dock.left).toBeGreaterThanOrEqual(0);
        expect(dock.left + dock.width).toBeLessThanOrEqual(width);
        expect(dock.top).toBeGreaterThanOrEqual(0);
        expect(dock.top + dock.height).toBeLessThanOrEqual(height - 80);
        expect(dock.anchorLeft).toBe(x === 0 ? 0 : width - 44);
        expect(dock.left).toBe(x === 0 ? 0 : width - dock.width);
      }
    }
  });

  it("opens downward in the upper half and upward in the lower half around a stable button", () => {
    for (const y of [0.1, 0.9]) {
      const small = classroomFocusDockLayout(1280, 720, 2, { x: 0.7, y });
      const large = classroomFocusDockLayout(1280, 720, 30, { x: 0.7, y });
      expect(small.anchorLeft).toBe(large.anchorLeft);
      expect(small.anchorTop).toBe(large.anchorTop);
      expect(large.expandUp).toBe(y > 0.5);
      if (large.expandUp) expect(large.top + large.height).toBeLessThan(large.anchorTop);
      else expect(large.top).toBeGreaterThan(large.anchorTop + 44);
    }
  });
});
