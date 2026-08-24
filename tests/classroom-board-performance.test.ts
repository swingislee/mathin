import { describe, expect, it, vi } from "vitest";
import { BoardInputSink } from "@/features/whiteboard/board-input-sink";
import { ProgressStreamAssembler } from "@/features/whiteboard/progress-stream";
import {
  CLASSROOM_MAX_CANVAS_PIXELS,
  CLASSROOM_MAX_DPR,
  CLASSROOM_MAX_TOTAL_PIXELS,
  resolveClassroomDprs,
} from "@/features/whiteboard/render-profile";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import type { ProgressChunk, StrokeItem } from "@/features/whiteboard/types";

function chunk(seq: number, x: number): ProgressChunk {
  return { id: "stroke", mode: "ink", color: "ink", wNorm: 0.006, seq, points: [[x, 0]] };
}

describe("M2 board input batching", () => {
  it("coalesces a frame, resamples noise, and preserves the final endpoint", () => {
    let frame: FrameRequestCallback | null = null;
    const request = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const batches: Array<Array<[number, number]>> = [];
    const sink = new BoardInputSink((points) => batches.push(points), {
      minDistancePx: 0.75,
      scheduler: { request, cancel: vi.fn() },
    });

    expect(sink.begin(7, [0, 0])).toBe(true);
    sink.push(7, [[0.1, 0], [1, 0]]);
    sink.push(7, [[1.2, 0]]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(batches).toEqual([]);
    (frame as unknown as FrameRequestCallback)(0);
    expect(batches).toEqual([[[1, 0]]]);

    expect(sink.finish(99)).toBe(false);
    expect(sink.finish(7)).toBe(true);
    expect(batches).toEqual([[[1, 0]], [[1.2, 0]]]);
  });

  it("cancels a routed gesture without flushing its buffered tail", () => {
    const batches: Array<Array<[number, number]>> = [];
    const cancelFrame = vi.fn();
    const sink = new BoardInputSink((points) => batches.push(points), {
      scheduler: { request: () => 41, cancel: cancelFrame },
    });
    expect(sink.begin(8, [0, 0])).toBe(true);
    expect(sink.push(8, [[4, 4]])).toBe(true);
    expect(sink.cancel(9)).toBe(false);
    expect(sink.cancel(8)).toBe(true);
    expect(cancelFrame).toHaveBeenCalledWith(41);
    expect(batches).toEqual([]);
    expect(sink.begin(10, [1, 1])).toBe(true);
  });
});

describe("M2 progress stream convergence", () => {
  it("reorders numbered chunks, deduplicates transports, and rejects late tails", () => {
    const assembler = new ProgressStreamAssembler();
    expect(assembler.ingest(chunk(1, 2), false)).toBe(false);
    expect(assembler.ingest(chunk(0, 1), false)).toBe(true);
    expect(Array.from(assembler.strokes())[0].points).toEqual([[1, 0], [2, 0]]);
    expect(assembler.ingest(chunk(1, 2), false)).toBe(false);
    expect(assembler.ingest({ ...chunk(2, 3), done: true }, false)).toBe(true);
    expect(Array.from(assembler.strokes())).toEqual([]);
    expect(assembler.ingest(chunk(2, 3), false)).toBe(false);
  });
});

describe("M2 classroom render profile", () => {
  it("enforces DPR, per-canvas, and aggregate pixel guards together", () => {
    const entries = new Map([
      ["main", { width: 1920, height: 1080, deviceDpr: 2, canvasCount: 2 }],
      ["side", { width: 640, height: 900, deviceDpr: 2, canvasCount: 2 }],
    ]);
    const dprs = resolveClassroomDprs(entries);
    let total = 0;
    for (const [id, metrics] of entries) {
      const dpr = dprs.get(id)!;
      const oneCanvas = metrics.width * metrics.height * dpr * dpr;
      expect(dpr).toBeLessThanOrEqual(CLASSROOM_MAX_DPR);
      expect(oneCanvas).toBeLessThanOrEqual(CLASSROOM_MAX_CANVAS_PIXELS + 1);
      total += oneCanvas * metrics.canvasCount;
    }
    expect(total).toBeLessThanOrEqual(CLASSROOM_MAX_TOTAL_PIXELS + 1);
  });
});

describe("M2 base-layer mutation metadata", () => {
  const stroke = (id: string): StrokeItem => ({
    id,
    mode: "ink",
    color: "ink",
    wNorm: 0.006,
    points: [[0, 0], [0.1, 0.1]],
  });

  it("marks append-only commits and forces full redraw for destructive changes", () => {
    const store = createWhiteboardStore();
    store.getState().commitItem(stroke("local"));
    expect(store.getState().renderMutation).toMatchObject({ kind: "append", items: [{ id: "local" }] });
    expect(store.getState().localMutation).toMatchObject({ revision: 1, ops: [{ t: "commit", item: { id: "local" } }] });

    store.getState().applyRemote({ t: "commit", item: stroke("remote") });
    expect(store.getState().renderMutation).toMatchObject({ kind: "append", items: [{ id: "remote" }] });

    store.getState().eraseLine("local");
    expect(store.getState().renderMutation).toMatchObject({ kind: "full", items: [] });
    expect(store.getState().localMutation).toEqual({ revision: 2, ops: [{ t: "erase", id: "local" }] });
    store.getState().clear();
    expect(store.getState().renderMutation).toMatchObject({ kind: "full", items: [] });
    expect(store.getState().localMutation).toEqual({ revision: 3, ops: [{ t: "clear" }] });
  });
});
