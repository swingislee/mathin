import { afterEach, describe, expect, it, vi } from "vitest";
import { InkPressureCache } from "@/features/whiteboard/ink-pressure";
import { classroomPressureOutline, classroomTimedOutline, drawItem, inkOutlinePath } from "@/features/whiteboard/strokes";
import { InkDraftRenderer } from "@/features/whiteboard/ink-draft-renderer";
import { appendStrokeInput, previewStroke, type InputPoint } from "@/features/whiteboard/ink-input";
import { BoardInputSink } from "@/features/whiteboard/board-input-sink";
import type { StrokeItem, StrokeSample } from "@/features/whiteboard/types";

const size = 4.548;
const pressurePoints = (positions: number[][], samples?: StrokeSample[], nib = size) => new InkPressureCache().update(positions, samples, 1, 1, nib);
const span = (values: number[]) => Math.max(...values) - Math.min(...values);
function widthAt(outline: number[][], x: number): number {
  const ys = outline.flatMap((a, index) => {
    const b = outline[(index + 1) % outline.length];
    return (a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x) ? [a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])] : [];
  });
  return span(ys);
}

function mouseLine(step: (time: number) => number, quantized = false, rafHz = 60) {
  const stroke: StrokeItem = { id: "mouse", mode: "ink", brush: "freehand-v3", color: "ink", wNorm: size, points: [], samples: [] };
  const scheduled: { callback: FrameRequestCallback | null } = { callback: null };
  let nextFrame = 1000 / rafHz;
  const point = (t: number): InputPoint => [quantized ? Math.round(t / 6) : t / 6, 50, { timeStamp: t, pressure: null }];
  appendStrokeInput(stroke, [point(0)], 0);
  const sink = new BoardInputSink((points) => appendStrokeInput(stroke, points, 0), {
    scheduler: { request: (callback) => { scheduled.callback = callback; return 1; }, cancel: () => { scheduled.callback = null; } },
  });
  sink.begin(1, point(0));
  for (let t = 0; t < 1500;) {
    t = Math.min(1500, t + step(t));
    if (t >= nextFrame) { const callback = scheduled.callback; scheduled.callback = null; callback?.(nextFrame); nextFrame = (Math.floor(t * rafHz / 1000) + 1) * 1000 / rafHz; }
    sink.push(1, [point(t)]);
  }
  sink.finish(1);
  return stroke;
}

class RecordedPath {
  commands: Array<[string, ...number[]]> = [];
  moveTo(...xy: [number, number]) { this.commands.push(["M", ...xy]); }
  lineTo(...xy: [number, number]) { this.commands.push(["L", ...xy]); }
  quadraticCurveTo(...xy: [number, number, number, number]) { this.commands.push(["Q", ...xy]); }
  closePath() { this.commands.push(["Z"]); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("time-based PF handwriting", () => {
  it("keeps constant-speed width stable with irregular events, resampling and slower RAF", () => {
    const widths: number[] = [];
    for (const step of [() => 8, () => 16, (t: number) => Math.floor(t / 100) % 2 ? 16 : 4]) {
      const ink = mouseLine(step);
      expect(mouseLine(step, false, 30)).toEqual(ink);
      const outline = classroomTimedOutline(pressurePoints(ink.points, ink.samples), size);
      const mid = Array.from({ length: 161 }, (_, i) => widthAt(outline, i + 50.25));
      expect(span(mid)).toBeLessThan(0.02);
      widths.push(mid[80]);
    }
    expect(span(widths)).toBeLessThan(0.02);
  });

  it("attenuates integer mouse coordinate width noise and retains intentional speed contrast", () => {
    const ink = mouseLine(() => 8, true);
    const before = classroomPressureOutline(ink.points, ink.samples, size);
    const after = classroomTimedOutline(pressurePoints(ink.points, ink.samples), size);
    const sections = Array.from({ length: 161 }, (_, i) => i + 50.25);
    expect(span(sections.map((x) => widthAt(after, x)))).toBeLessThan(span(sections.map((x) => widthAt(before, x))) * 0.45);
    const points = Array.from({ length: 100 }, (_, i) => [i * 3, 50]);
    const fast = classroomTimedOutline(pressurePoints(points, points.map((_, i) => [i * 3, null])), size);
    const slow = classroomTimedOutline(pressurePoints(points, points.map((_, i) => [i * 18, null])), size);
    expect(widthAt(slow, 200)).toBeGreaterThan(widthAt(fast, 200) * 1.6);
  });

  it("smooths noisy device pressure, preserves deliberate light/heavy strokes and never rewrites earlier pressure on detection", () => {
    const points = Array.from({ length: 120 }, (_, i) => [i * 2, 50]);
    const noisy: StrokeSample[] = points.map((_, i) => [i * 4, i % 2 ? 0.7 : 0.5]);
    const result = pressurePoints(points, noisy);
    expect(span(result.slice(40).map((p) => p[2]))).toBeLessThan(0.04);
    const expressive: StrokeSample[] = points.map((_, i) => [i * 8, i < 40 || i > 80 ? 0.9 : 0.1]);
    const outline = classroomTimedOutline(pressurePoints(points, expressive), size);
    expect(widthAt(outline, 50)).toBeGreaterThan(widthAt(outline, 120) * 2.5);
    expect(widthAt(outline, 215)).toBeGreaterThan(widthAt(outline, 120) * 2.5);
    const provisional: StrokeSample[] = points.map((_, i) => [i * 8, i < 60 ? 0.5 : 0.2]);
    const prefix = pressurePoints(points.slice(0, 60), provisional.slice(0, 60));
    expect(pressurePoints(points, provisional).slice(0, 60)).toEqual(prefix);
  });

  it("keeps missing/repeated times finite and avoids a mouse blob after a stationary pause", () => {
    const points = [[0, 0], [3, 0], [6, 0], [6, 0], [6.1, 0]];
    for (const times of [undefined, [0, 0, 0, 0, 0], [0, 8, 16, 1016, 1024]]) {
      const samples: StrokeSample[] | undefined = times?.map((t) => [t, null]);
      const result = pressurePoints(points, samples);
      expect(result.flat().every(Number.isFinite)).toBe(true);
      expect(result[3][2]).toBe(result[2][2]);
      expect(Math.abs(result[4][2] - result[3][2]) * 1.4 * size).toBeLessThan(0.02);
      expect(classroomTimedOutline(result, size).flat().every(Number.isFinite)).toBe(true);
    }
  });

  it("retains real pressure in two-point strokes and centers taps at the actual contact point", () => {
    const points = [[30, 40], [80, 40]];
    const light = classroomTimedOutline(pressurePoints(points, [[0, 0.1], [8, 0.1]]), size);
    const heavy = classroomTimedOutline(pressurePoints(points, [[0, 0.9], [8, 0.9]]), size);
    expect(widthAt(heavy, 60)).toBeGreaterThan(widthAt(light, 60) * 3);
    const tap = classroomTimedOutline(pressurePoints([[30, 40]], [[0, 0.6]]), size);
    expect((Math.min(...tap.map(([x]) => x)) + Math.max(...tap.map(([x]) => x))) / 2).toBeCloseTo(30, 1);
    expect((Math.min(...tap.map(([, y]) => y)) + Math.max(...tap.map(([, y]) => y))) / 2).toBeCloseTo(40, 1);
  });

  it("keeps the latest tip covered at short lengths, fast speeds and turns, including after curve conversion", () => {
    vi.stubGlobal("Path2D", RecordedPath);
    for (const points of [[[30, 40], [30.1, 40]], [[30, 40], [120, 40]], [[30, 40], [120, 40], [30, 40], [30, 120]]]) {
      const prepared = pressurePoints(points, points.map((_, i) => [i * 8, null]));
      expect(prepared.map(([x, y]) => [x, y])).toEqual(points);
      const outline = classroomTimedOutline(prepared, size);
      const path = inkOutlinePath(outline, true) as unknown as RecordedPath;
      const polygon: number[][] = [];
      for (const [op, ...args] of path.commands) {
        if (op === "M") polygon.push(args);
        else if (op === "Q") {
          const from = polygon.at(-1)!;
          for (let i = 1; i <= 16; i++) {
            const t = i / 16, s = 1 - t;
            polygon.push([s * s * from[0] + 2 * s * t * args[0] + t * t * args[2], s * s * from[1] + 2 * s * t * args[1] + t * t * args[3]]);
          }
        }
      }
      const [x, y] = points.at(-1)!;
      let winding = 0;
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
        if (a[1] <= y && b[1] > y && cross > 0) winding++;
        if (a[1] > y && b[1] <= y && cross < 0) winding--;
      });
      expect(winding).not.toBe(0);
    }
  });

  it("reuses stable pressure calculations and rolls back a replaced preview or edited prefix", () => {
    const ink = mouseLine(() => 8);
    const cache = new InkPressureCache();
    const original = [...cache.update(ink.points, ink.samples, 1, 1, size)];
    const tail: InputPoint = [250.4, 50, { timeStamp: 1508, pressure: null }];
    const preview = previewStroke(ink, tail, 0);
    const exp = vi.spyOn(Math, "exp");
    const next = cache.update(preview.points, preview.samples, 1, 1, size);
    expect(exp.mock.calls.length).toBeLessThanOrEqual(2);
    expect(next[50]).toBe(original[50]);
    appendStrokeInput(ink, [[251, 50, { timeStamp: 1516, pressure: null }]], 0);
    expect(cache.update(ink.points, ink.samples, 1, 1, size)).toEqual(pressurePoints(ink.points, ink.samples));
    ink.points[40] = [ink.points[40][0], 50.8];
    expect(cache.update(ink.points, ink.samples, 1, 1, size)).toEqual(pressurePoints(ink.points, ink.samples));
  });

  it("preserves pressure under uniform scaling and uses the same curved path for preview and stored ink", () => {
    const ink = mouseLine(() => 8);
    const before = pressurePoints(ink.points, ink.samples);
    const after = new InkPressureCache().update(ink.points, ink.samples, 2, 2, size * 2);
    after.forEach(([x, y, p], i) => expect([x / 2, y / 2, p]).toEqual(before[i]));
    vi.stubGlobal("Path2D", RecordedPath);
    const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), clearRect: vi.fn(), fill: vi.fn(), fillStyle: "" };
    const context = ctx as unknown as CanvasRenderingContext2D;
    const normalized: StrokeItem = { ...ink, wNorm: size / 300, points: ink.points.map(([x, y]) => [x / 300, y / 100]) };
    new InkDraftRenderer().render(context, [normalized], 300, 100, 300, () => "#123");
    const draft = ctx.fill.mock.lastCall![0] as RecordedPath;
    drawItem(context, normalized, 300, 100, "#123");
    expect(ctx.fill.mock.lastCall![0]).toEqual(draft);
    expect(draft.commands.some(([op]) => op === "Q")).toBe(true);
    drawItem(context, { ...normalized, brush: "freehand-v2" }, 300, 100, "#123");
    const legacy = ctx.fill.mock.lastCall![0] as RecordedPath;
    expect(legacy.commands.some(([op]) => op === "Q")).toBe(false);
  });
});
