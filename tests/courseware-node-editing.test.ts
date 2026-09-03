import { describe, expect, it } from "vitest";
import { coursewareNodeTransformGeometry } from "@/features/courseware-doc/CoursewareNodeEditing";

const origin = { x: 105, y: 44, width: 317, height: 169 };

describe("shared courseware node editing geometry", () => {
  it("uses the same 12 by 9 snap calculation for every stage adapter", () => {
    expect(coursewareNodeTransformGeometry({
      mode: "move",
      origin,
      deltaX: 42,
      deltaY: 31,
      snapToGrid: true,
      gridStep: { x: 100, y: 100 },
    })).toEqual({ ...origin, x: 100, y: 100 });
  });

  it("keeps free movement pixel-accurate when grid snapping is disabled", () => {
    expect(coursewareNodeTransformGeometry({
      mode: "move",
      origin,
      deltaX: 42.5,
      deltaY: -11.25,
      snapToGrid: false,
      gridStep: { x: 100, y: 100 },
    })).toEqual({ ...origin, x: 147.5, y: 32.75 });
  });

  it("shares resize snapping and the minimum geometry guard", () => {
    expect(coursewareNodeTransformGeometry({
      mode: "resize",
      origin,
      deltaX: -1_000,
      deltaY: -1_000,
      snapToGrid: false,
      gridStep: { x: 100, y: 100 },
    })).toEqual({ ...origin, width: 8, height: 8 });
  });
});
