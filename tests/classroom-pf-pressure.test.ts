import { describe, expect, it, vi } from "vitest";
import { classroomInkOutline, classroomPressureOutline } from "@/features/whiteboard/strokes";
import { appendStrokeInput, pointerInkMetadata, previewStroke, strokeSample, type InputPoint } from "@/features/whiteboard/ink-input";
import { BoardInputSink } from "@/features/whiteboard/board-input-sink";
import { buildBoardCheckpoint } from "@/features/classroom/checkpoint/codec";
import { flattenCheckpointChunks } from "@/features/classroom/checkpoint/parse";
import { ProgressStreamAssembler } from "@/features/whiteboard/progress-stream";
import { annotationContentSchema } from "@/features/school/teacher-preparation-contract";
import { parseSolutionBoardItems } from "@/features/school/solution-board-items";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import { translateItem } from "@/features/whiteboard/geometry";
import { CLASSROOM_BOARD_BRUSH_SYNC_PROVIDERS } from "@/features/classroom/sync/interaction-audit";
import { parseH5PointerFrameMessage } from "@/features/courseware-doc/h5-pointer-protocol";
import type { StrokeItem, StrokeSample } from "@/features/whiteboard/types";

const makeStroke = (): StrokeItem => ({ id: "11111111-1111-4111-8111-111111111111", brush: "freehand-v2", mode: "ink", color: "ink", wNorm: 0.006, points: [], samples: [] });
function widthAt(outline: number[][], x: number): number {
  const ys = outline.flatMap((a, index) => {
    const b = outline[(index + 1) % outline.length];
    return (a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x) ? [a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])] : [];
  });
  return Math.max(...ys) - Math.min(...ys);
}

describe("PF pressure and live input", () => {
  it("responds to pressure at a constant speed while preserving the simulated fallback", () => {
    const points = Array.from({ length: 100 }, (_, i) => [i * 3, 50]);
    const samples: StrokeSample[] = points.map((_, i) => [i * 8, i < 35 || i > 70 ? 0.9 : 0.15]);
    const outline = classroomPressureOutline(points, samples, 12);
    expect(widthAt(outline, 60)).toBeGreaterThan(widthAt(outline, 150) * 2);
    expect(widthAt(outline, 260)).toBeGreaterThan(widthAt(outline, 150) * 2);
    expect(widthAt(outline, 297)).toBeGreaterThan(0);
    for (const pressure of [null, 0.5]) {
      expect(classroomPressureOutline(points, points.map((_, i) => [i * 8, pressure]), 12)).toEqual(classroomInkOutline(points, 12));
    }
  });

  it("keeps individual sample times, ignores mouse pressure, and carries contact pressure across pointerup", () => {
    const origin = pointerInkMetadata({ pointerType: "pen", pressure: 0.2, timeStamp: 100, buttons: 1 });
    const stroke = makeStroke();
    appendStrokeInput(stroke, [[0.1, 0.2, origin], [0.2, 0.2, { timeStamp: 108, pressure: 0.8 }],
      [0.3, 0.2, pointerInkMetadata({ pointerType: "pen", pressure: 0, timeStamp: 120, buttons: 0 })]], 100);
    expect(stroke.samples).toEqual([[0, 0.2], [8, 0.8], [20, 0.8]]);
    expect(pointerInkMetadata({ pointerType: "mouse", pressure: 0.9, timeStamp: 200, buttons: 1 }).pressure).toBeNull();
    expect(pointerInkMetadata({ pointerType: "pen", pressure: 0, timeStamp: 200, buttons: 1 }).pressure).toBe(0);
    expect(strokeSample([0, 0, { timeStamp: 104, pressure: 0.3 }], 100, [8, 0.2])).toEqual([8, 0.3]);
  });

  it("previews a sub-threshold endpoint in the current frame without adding it to stable storage", () => {
    let frame: FrameRequestCallback | null = null;
    let tail: InputPoint | null = null;
    const stroke = makeStroke();
    appendStrokeInput(stroke, [[0, 0, { timeStamp: 10, pressure: 0.4 }]], 10);
    const previews: StrokeItem[] = [];
    const sink = new BoardInputSink((points) => {
      appendStrokeInput(stroke, points, 10);
      previews.push(previewStroke(stroke, tail, 10));
    }, { scheduler: { request: (callback) => { frame = callback; return 1; }, cancel: vi.fn() },
      onPreview: (point) => { tail = point; } });
    sink.begin(7, [0, 0, { timeStamp: 10, pressure: 0.4 }]);
    sink.push(7, [[0.4, 0, { timeStamp: 18, pressure: 0.4 }]]);
    (frame as unknown as FrameRequestCallback)(20);
    expect(stroke.points).toEqual([[0, 0]]);
    expect(previews.at(-1)?.points.at(-1)).toEqual([0.4, 0]);
    expect(previews.at(-1)?.samples?.at(-1)).toEqual([8, 0.4]);
    sink.finish(7);
    expect(stroke.points.at(-1)).toEqual([0.4, 0]);
    expect(stroke.samples).toHaveLength(stroke.points.length);
  });

  it("avoids scheduling stationary duplicate samples while retaining a pressure change", () => {
    const request = vi.fn(() => 1);
    const sink = new BoardInputSink(vi.fn(), { scheduler: { request, cancel: vi.fn() } });
    sink.begin(7, [10, 20, { timeStamp: 100, pressure: 0.2 }]);
    sink.push(7, [[10, 20, { timeStamp: 108, pressure: 0.2 }]]);
    expect(request).not.toHaveBeenCalled();
    sink.push(7, [[10, 20, { timeStamp: 116, pressure: 0.8 }]]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("preserves pressure, brush and timing through progress, checkpoint, archive, moving and undo", () => {
    const stroke = makeStroke();
    appendStrokeInput(stroke, [[0.1, 0.2, { timeStamp: 100, pressure: 0.2 }], [0.2, 0.3, { timeStamp: 108, pressure: 0.8 }],
      [0.3, 0.4, { timeStamp: 116, pressure: 0.3 }]], 100);
    const stream = new ProgressStreamAssembler();
    stream.ingest({ ...stroke, seq: 1, points: stroke.points.slice(1), samples: stroke.samples!.slice(1) }, false);
    stream.ingest({ ...stroke, seq: 0, points: stroke.points.slice(0, 1), samples: stroke.samples!.slice(0, 1) }, false);
    expect([...stream.strokes()]).toEqual([stroke]);
    const checkpoint = buildBoardCheckpoint([stroke]);
    const saved = flattenCheckpointChunks(JSON.parse(JSON.stringify(checkpoint.chunks)), 1);
    expect(saved).toEqual([stroke]);
    expect(parseSolutionBoardItems(saved)).toEqual(saved);
    expect(annotationContentSchema.parse(saved)).toEqual(saved);
    expect(translateItem(stroke, 0.1, 0.1)).toMatchObject({ samples: stroke.samples });
    const store = createWhiteboardStore();
    store.getState().commitItem(stroke); store.getState().removeItems([stroke.id]); store.getState().undo();
    expect(store.getState().items).toEqual([stroke]);
    expect(CLASSROOM_BOARD_BRUSH_SYNC_PROVIDERS["freehand-v2"].protocol).toBe("board-checkpoint-v2");
  });

  it("keeps 4000 compact samples without resampling and rejects malformed timing or pressure alignment", () => {
    const stroke = makeStroke();
    appendStrokeInput(stroke, Array.from({ length: 4000 }, (_, i): InputPoint => [i / 3999, 0.2 + Math.sin(i / 100) * 0.1,
      { timeStamp: i * 8, pressure: 0.2 + (i % 100) / 200 }]), 0);
    const checkpoint = buildBoardCheckpoint([stroke]);
    expect(checkpoint.resampled).toBe(false);
    expect(flattenCheckpointChunks(checkpoint.chunks, 1)).toEqual([stroke]);
    const short = { ...stroke, points: stroke.points.slice(0, 2) };
    for (const samples of [[[0, 0.3]], [[0, 0.3], [-1, 0.4]], [[0, 2], [1, 0.4]], [[0, 0.3], [Number.NaN, 0.4]]]) {
      expect(() => flattenCheckpointChunks([[{ ...short, samples }]], 1)).toThrow("CHECKPOINT_ITEMS_INVALID");
    }
  });

  it("preserves optional H5 pressure and timestamps while reading earlier x/y messages", () => {
    const base = { source: "mathin-h5-pointer", schema: "mathin-h5-pointer", version: 1, frameId: "frame", channelToken: "token",
      type: "pointer_move", pointerId: 7, gestureToken: "gesture", chunkSeq: 1 };
    const point = { x: 0.2, y: 0.3, pressure: 0.7, timeStamp: 16 };
    expect(parseH5PointerFrameMessage({ ...base, points: [point] })).toMatchObject({ points: [point] });
    expect(parseH5PointerFrameMessage({ ...base, points: [{ x: 0.2, y: 0.3 }] })).toMatchObject({ points: [{ x: 0.2, y: 0.3 }] });
    for (const invalid of [{ ...point, pressure: 2 }, { ...point, timeStamp: -1 }]) {
      expect(parseH5PointerFrameMessage({ ...base, points: [invalid] })).toBeNull();
    }
  });
});
