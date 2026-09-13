import { describe, expect, it } from "vitest";
import { getStroke } from "perfect-freehand";
import { classroomInkOutline } from "@/features/whiteboard/strokes";
import type { StrokeItem } from "@/features/whiteboard/types";
import { buildBoardCheckpoint } from "@/features/classroom/checkpoint/codec";
import { flattenCheckpointChunks } from "@/features/classroom/checkpoint/parse";
import { ProgressStreamAssembler } from "@/features/whiteboard/progress-stream";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import { parseSolutionBoardItems } from "@/features/school/solution-board-items";
import { CLASSROOM_BOARD_BRUSH_SYNC_PROVIDERS } from "@/features/classroom/sync/interaction-audit";

function intersections(outline: number[][], x: number): number[] {
  return outline.flatMap((a, index) => {
    const b = outline[(index + 1) % outline.length];
    if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
      return [a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
    }
    return [];
  });
}

describe("natural classroom handwriting", () => {
  it("retains broad, fine and broad transitions from simulated pressure within one stroke", () => {
    const points = Array.from({ length: 60 }, (_, i) => [i < 20 ? i * 2 : i < 40 ? 38 + (i - 19) * 10 : 238 + (i - 39) * 2, 50]);
    const outline = classroomInkOutline(points, 12);
    const widths = [20, 180, 270].map((x) => {
      const hits = intersections(outline, x);
      return Math.max(...hits) - Math.min(...hits);
    });
    expect(widths[0]).toBeGreaterThan(widths[1] * 1.4);
    expect(widths[2]).toBeGreaterThan(widths[1] * 1.4);
    expect(widths.every((width) => width > 2 && width < 20)).toBe(true);
  });

  it("covers the newest input point at slow and fast speeds while keeping a natural outline", () => {
    for (const step of [2, 10, 20]) {
      const points = Array.from({ length: 40 }, (_, i) => [i * step, 50]);
      const tip = points.at(-1)!;
      const ys = intersections(classroomInkOutline(points, 12), tip[0]);
      expect(Math.min(...ys)).toBeLessThan(tip[1]);
      expect(Math.max(...ys)).toBeGreaterThan(tip[1]);
      if (step === 20) {
        const legacy = getStroke(points, { size: 12, thinning: 0.7, smoothing: 0.6, streamline: 0.5 });
        expect(Math.max(...legacy.map(([x]) => x))).toBeLessThan(tip[0] - 10);
      }
    }
  });

  it("keeps taps, short strokes and sharp turns finite without mutating the sampled points", () => {
    const samples = [[[30, 40]], [[30, 40], [31, 40]], [[30, 40], [30, 40]],
      [[30, 40], [120, 40], [30, 40], [30, 120]]];
    for (const points of samples) {
      const before = structuredClone(points);
      const outline = classroomInkOutline(points, 6);
      expect(outline.length).toBeGreaterThan(3);
      expect(outline.flat().every(Number.isFinite)).toBe(true);
      expect(points).toEqual(before);
      expect(classroomInkOutline(points, 6)).toEqual(outline);
    }
  });

  it("preserves the brush and points through checkpoint, reordered progress, archive and undo", () => {
    const ink: StrokeItem = { id: "natural-stroke", brush: "freehand-v1", mode: "ink", color: "blue", wNorm: 0.006,
      points: [[0.1, 0.2], [0.3, 0.2], [0.5, 0.4]] };
    const round: StrokeItem = { ...ink, id: "existing-round", brush: "round-v1" };
    const legacy = { ...ink, id: "legacy" }; delete legacy.brush;
    const original = [legacy, round, ink];
    const checkpoint = buildBoardCheckpoint(original);
    const saved = flattenCheckpointChunks(JSON.parse(JSON.stringify(checkpoint.chunks)), 3);
    expect(saved).toEqual(original);
    expect(parseSolutionBoardItems(saved)).toEqual(original);
    const progress = new ProgressStreamAssembler();
    progress.ingest({ ...ink, seq: 1, points: ink.points.slice(1) }, false);
    progress.ingest({ ...ink, seq: 0, points: ink.points.slice(0, 1) }, false);
    expect([...progress.strokes()]).toEqual([ink]);
    const store = createWhiteboardStore();
    store.getState().replaceItems(saved);
    store.getState().removeItems([ink.id]); store.getState().undo();
    expect(store.getState().items).toEqual(original);
    const provider = CLASSROOM_BOARD_BRUSH_SYNC_PROVIDERS[ink.brush!];
    expect(checkpoint.chunks.length).toBeLessThanOrEqual(provider.maxChunks);
    expect(() => flattenCheckpointChunks([[{ ...ink, brush: "freehand-v999" }]], 1)).toThrow("CHECKPOINT_ITEMS_INVALID");
  });
});
