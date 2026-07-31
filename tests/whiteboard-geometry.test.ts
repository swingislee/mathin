import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cloneBoardItem,
  createShapeFromDrag,
  ellipseArcPath,
  inkStrokesInRect,
  normalizeDegrees,
  sanitizeLatex,
  shortestAngleDelta,
} from "@/features/whiteboard/geometry";
import { extractPix2TextLatex } from "@/features/whiteboard/formula-service";
import type { BoardItem, StrokeItem } from "@/features/whiteboard/types";

const inkStroke: StrokeItem = {
  id: "stroke-1",
  mode: "ink",
  color: "ink",
  wNorm: 0.006,
  points: [[0.2, 0.2], [0.4, 0.4]],
};

describe("whiteboard geometry objects", () => {
  it("creates a rotated normalized line from a drag", () => {
    const line = createShapeFromDrag("shape-1", "line", [0.1, 0.2], [0.4, 0.6], "rose", "moon", 0.006, 0.5625);

    expect(line).toMatchObject({ kind: "shape", shape: "line", fill: null, x: 0.25, y: 0.4 });
    expect(line.width).toBeCloseTo(0.375);
    expect(line.rotation).toBeCloseTo(36.87, 2);
  });

  it("selects only intersecting ink for formula recognition", () => {
    const eraser: StrokeItem = { ...inkStroke, id: "eraser", mode: "erase" };
    const far: StrokeItem = { ...inkStroke, id: "far", points: [[0.8, 0.8], [0.9, 0.9]] };
    const items: BoardItem[] = [inkStroke, eraser, far];

    expect(inkStrokesInRect(items, { x: 0.15, y: 0.15, width: 0.3, height: 0.3 }).map((item) => item.id)).toEqual(["stroke-1"]);
  });

  it("duplicates strokes without sharing point arrays", () => {
    const copy = cloneBoardItem(inkStroke, "stroke-copy") as StrokeItem;

    expect(copy.id).toBe("stroke-copy");
    expect(copy.points[0]).toEqual([0.225, 0.225]);
    expect(copy.points[1]?.[0]).toBeCloseTo(0.425);
    expect(copy.points[1]?.[1]).toBeCloseTo(0.425);
    expect(copy.points).not.toBe(inkStroke.points);
  });

  it("reads both Pix2Text formula response variants", () => {
    expect(extractPix2TextLatex({ results: "$$x+1$$" })).toBe("x+1");
    expect(extractPix2TextLatex({ results: [{ text: "x" }, { text: "+1" }] })).toBe("x +1");
    expect(extractPix2TextLatex({ results: null })).toBe("");
  });

  it("normalizes angles and strips common math delimiters", () => {
    expect(normalizeDegrees(-30)).toBe(330);
    expect(shortestAngleDelta(179, -179)).toBe(2);
    expect(shortestAngleDelta(-179, 179)).toBe(-2);
    expect(sanitizeLatex("  $$x^2+y^2=r^2$$  ")).toBe("x^2+y^2=r^2");
    expect(sanitizeLatex("\\[\\frac{1}{2}\\]")).toBe("\\frac{1}{2}");
  });

  it("renders compass previews and saved full turns with the same segmented arc path", () => {
    const quarter = ellipseArcPath(200, 200, 0, 90);
    const fullTurn = ellipseArcPath(200, 200, 0, 360);

    expect(quarter.match(/\bA\b/g)).toHaveLength(1);
    expect(fullTurn.match(/\bA\b/g)).toHaveLength(3);
    expect(fullTurn).not.toContain("NaN");
  });

  it("keeps compass feedback and construction tools wired to their dedicated UI contracts", () => {
    const instrumentLayer = readFileSync("src/features/whiteboard/InstrumentLayer.tsx", "utf8");
    const toolbar = readFileSync("src/features/whiteboard/Toolbar.tsx", "utf8");
    const store = readFileSync("src/features/whiteboard/store.ts", "utf8");

    expect(instrumentLayer).toContain("shortestAngleDelta(previous, current)");
    expect(instrumentLayer).toContain("ellipseArcPath(preview.width * width");
    expect(instrumentLayer).toContain('r={22} fill="transparent"');
    expect(instrumentLayer).toContain('r={24} fill="transparent"');
    expect(toolbar).toContain('data-tool-group="construction"');
    expect(instrumentLayer).toContain("compassRadiusNorm(item, width)");
    expect(instrumentLayer).toContain("beginCompassControl(event, item)");
    expect(toolbar).toContain('data-tool-group="drawing"');
    expect(instrumentLayer).toContain("absolute inset-0 z-40");
    expect(toolbar.indexOf('data-tool-group="construction"')).toBeLessThan(toolbar.indexOf('data-tool-group="drawing"'));
    expect(store).toContain('kind, x: 0.5, y: 0.32, width: 0.24');
    expect(store).not.toContain('kind, x: 0.5, y: 0.5, width: 0.24');
  });
});
