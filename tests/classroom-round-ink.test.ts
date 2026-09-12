import { afterEach, describe, expect, it, vi } from "vitest";
import { getStroke } from "perfect-freehand";
import { drawItem, hitSweptStrokeIds } from "@/features/whiteboard/strokes";
import type { StrokeItem } from "@/features/whiteboard/types";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import { ProgressStreamAssembler } from "@/features/whiteboard/progress-stream";
import { buildBoardCheckpoint } from "@/features/classroom/checkpoint/codec";
import { flattenCheckpointChunks } from "@/features/classroom/checkpoint/parse";
import { parseSolutionBoardItems } from "@/features/school/solution-board-items";
import { CLASSROOM_BOARD_BRUSH_SYNC_PROVIDERS } from "@/features/classroom/sync/interaction-audit";

vi.mock("perfect-freehand", async (original) => {
  const actual = await original<typeof import("perfect-freehand")>();
  return { ...actual, getStroke: vi.fn(actual.getStroke) };
});

const stroke: StrokeItem = { id: "11111111-1111-4111-8111-111111111111", mode: "ink", color: "blue", wNorm: 0.012,
  brush: "round-v1", points: [[0.1, 0.2], [0.4, 0.2], [0.6, 0.5]] };
function context() {
  return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), lineWidth: 0, lineCap: "", lineJoin: "", fillStyle: "", strokeStyle: "", globalCompositeOperation: "source-over" };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("classroom round brush compatibility and geometry", () => {
  it("keeps the exact endpoint and selected width for slow and fast strokes on either board", () => {
    for (const width of [400, 1000]) for (const step of [0.005, 0.02]) {
      const ctx = context();
      const points: StrokeItem["points"] = Array.from({ length: 40 }, (_, i) => [0.1 + i * step, 0.3]);
      drawItem(ctx as unknown as CanvasRenderingContext2D, { ...stroke, points }, width, 750, "#123", 1000);
      expect(ctx.lineTo).toHaveBeenLastCalledWith(points.at(-1)![0] * width, 225);
      expect(ctx).toMatchObject({ lineWidth: 12, lineCap: "round", lineJoin: "round", strokeStyle: "#123" });
    }
    expect(getStroke).not.toHaveBeenCalled();
  });

  it("uses the same swept radius for a palm dot, moving erase and persisted replay", () => {
    const ctx = context();
    const erase: StrokeItem = { ...stroke, mode: "erase", wNorm: 0.1 };
    drawItem(ctx as unknown as CanvasRenderingContext2D, { ...erase, points: [[0.1, 0.2]] }, 400, 300, "#abc", 1000);
    expect(ctx.arc).toHaveBeenCalledWith(40, 60, 50, 0, Math.PI * 2);
    drawItem(ctx as unknown as CanvasRenderingContext2D, erase, 400, 300, "#abc", 1000);
    expect(ctx).toMatchObject({ globalCompositeOperation: "destination-out", lineWidth: 100, strokeStyle: "#000" });
    expect(ctx.lineTo).toHaveBeenLastCalledWith(240, 150);
  });

  it("replays unversioned historical ink and erasing with their original brush options", () => {
    vi.stubGlobal("Path2D", class {});
    for (const mode of ["ink", "erase"] as const) {
      const ctx = context();
      const legacy = { ...stroke };
      delete legacy.brush;
      drawItem(ctx as unknown as CanvasRenderingContext2D, { ...legacy, mode }, 1000, 750, "#123");
      expect(getStroke).toHaveBeenLastCalledWith([[100, 150], [400, 150], [600, 375]], { size: 12, thinning: 0.7, smoothing: 0.6, streamline: 0.5 });
      expect(ctx.fill).toHaveBeenCalledOnce();
      expect(ctx.stroke).not.toHaveBeenCalled();
    }
  });

  it("preserves brush versions through checkpoint serialization, progress ordering, undo and archives", () => {
    const provider = CLASSROOM_BOARD_BRUSH_SYNC_PROVIDERS[stroke.brush!];
    const items = [stroke, { ...stroke, id: "erase", mode: "erase" as const }];
    const prepared = buildBoardCheckpoint(items);
    expect(provider.protocol).toBe("board-checkpoint-v2");
    expect(prepared.chunks.length).toBeLessThanOrEqual(provider.maxChunks);
    expect(prepared.contentBytes).toBeLessThanOrEqual(provider.maxChunkBytes);
    const saved = flattenCheckpointChunks(JSON.parse(JSON.stringify(prepared.chunks)), 2);
    expect(saved).toEqual(items);
    expect(parseSolutionBoardItems(saved)).toEqual(items);
    const stream = new ProgressStreamAssembler();
    stream.ingest({ ...stroke, seq: 1, points: stroke.points.slice(1) }, false);
    stream.ingest({ ...stroke, seq: 0, points: stroke.points.slice(0, 1) }, false);
    expect([...stream.strokes()]).toEqual([stroke]);
    const store = createWhiteboardStore();
    store.getState().replaceItems(saved);
    store.getState().removeItems([stroke.id]); store.getState().undo();
    expect(store.getState().items).toEqual(items);
    expect(() => flattenCheckpointChunks([[{ ...stroke, brush: "round-v999" }]], 1)).toThrow("CHECKPOINT_ITEMS_INVALID");
    expect(parseSolutionBoardItems([{ ...stroke, brush: "round-v999" }])).toBeNull();
  });

  it("continues to read long legacy archive strokes and remembers the eraser after switching back to pen", () => {
    const legacy = { ...stroke };
    delete legacy.brush;
    const items = [{ ...legacy, points: Array.from({ length: 4500 }, (): [number, number] => [0.5, 0.5]) }];
    expect(parseSolutionBoardItems(items)).toEqual(items);
    const store = createWhiteboardStore();
    expect(store.getState().lastEraser).toBe("strokeEraser");
    store.getState().setTool("eraserL"); store.getState().setTool("pen");
    expect(store.getState().lastEraser).toBe("eraserL");
    store.getState().hydrate("page-2", []);
    expect(store.getState().lastEraser).toBe("eraserL");
  });

  it("hits crossing segments, tangent dots and overlaps while excluding distant ink and erase paths", () => {
    const make = (id: string, points: StrokeItem["points"]): StrokeItem => ({ ...stroke, id, wNorm: 0.002, points });
    const items = [make("cross", [[0.5, 0], [0.5, 1]]), make("dot", [[0.5, 0.51]]),
      make("overlap", [[0.3, 0.5], [0.7, 0.5]]), make("far", [[0.5, 0.6]]),
      { ...make("erase", [[0.5, 0.5]]), mode: "erase" as const }];
    expect(hitSweptStrokeIds(items, [100, 500], [900, 500], 1000, 1000, 9)).toEqual(["cross", "dot", "overlap"]);
    expect(hitSweptStrokeIds(items, [500, 500], [500, 500], 1000, 1000, 9)).toEqual(["cross", "dot", "overlap"]);
  });
});
