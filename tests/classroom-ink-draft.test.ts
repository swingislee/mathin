import { afterEach, describe, expect, it, vi } from "vitest";
import { getStroke } from "perfect-freehand";
import { InkDraftRenderer } from "@/features/whiteboard/ink-draft-renderer";
import type { StrokeItem } from "@/features/whiteboard/types";

vi.mock("perfect-freehand", async (original) => {
  const actual = await original<typeof import("perfect-freehand")>();
  return { ...actual, getStroke: vi.fn(actual.getStroke) };
});
const stroke = (id: string, x = 0.1): StrokeItem => ({ id, mode: "ink", color: "ink", wNorm: 0.006, brush: "freehand-v2",
  points: [[x, 0.2], [x + 0.04, 0.22]], samples: [[0, 0.2], [8, 0.8]] });
function context() {
  vi.stubGlobal("Path2D", class { moveTo() {} lineTo() {} closePath() {} });
  return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), clearRect: vi.fn(), fill: vi.fn(), fillStyle: "" };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("PF draft drawing cost and layer correctness", () => {
  it("clears only the changing stroke area and reuses unchanged remote outlines", () => {
    const ctx = context();
    const renderer = new InkDraftRenderer();
    const local = stroke("local"), remote = stroke("remote", 0.7);
    const paint = () => renderer.render(ctx as unknown as CanvasRenderingContext2D, [local, remote], 1920, 1080, 1920, () => "#123");
    paint();
    vi.clearAllMocks();
    local.points.push([0.17, 0.23]); local.samples!.push([16, 0.6]);
    paint();
    expect(getStroke).toHaveBeenCalledOnce();
    expect(ctx.fill).toHaveBeenCalledOnce();
    const [, , width, height] = ctx.clearRect.mock.calls[0];
    expect(width * height).toBeLessThan(1920 * 1080 * 0.02);
    paint();
    expect(getStroke).toHaveBeenCalledOnce();
    expect(ctx.clearRect).toHaveBeenCalledOnce();
  });

  it("repaints overlapping ink within the clip and clears the old region when a stroke completes", () => {
    const ctx = context();
    const renderer = new InkDraftRenderer();
    const local = stroke("local"), remote = stroke("remote");
    const paint = (items: StrokeItem[]) => renderer.render(ctx as unknown as CanvasRenderingContext2D, items, 1000, 750, 1000, () => "#123");
    paint([local, remote]);
    vi.clearAllMocks();
    local.points.push([0.15, 0.23]); local.samples!.push([16, 0.5]);
    paint([local, remote]);
    expect(getStroke).toHaveBeenCalledOnce();
    expect(ctx.fill).toHaveBeenCalledTimes(2);
    expect(ctx.clip).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    paint([remote]);
    expect(getStroke).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledOnce();
    expect(ctx.fill).toHaveBeenCalledOnce();
  });

  it("rebuilds after canvas reset or scaling and clears all remaining preview pixels", () => {
    const ctx = context();
    const renderer = new InkDraftRenderer();
    const local = stroke("local");
    const paint = (items: StrokeItem[], w = 1000) => renderer.render(ctx as unknown as CanvasRenderingContext2D, items, w, 750, w, () => "#123");
    paint([local]);
    vi.clearAllMocks(); renderer.invalidate(); paint([local]);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1000, 750);
    expect(getStroke).toHaveBeenCalledOnce();
    vi.clearAllMocks(); paint([local], 500);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 500, 750);
    expect(getStroke).toHaveBeenCalledOnce();
    vi.clearAllMocks(); paint([], 500);
    expect(ctx.clearRect).toHaveBeenCalledOnce();
    expect(ctx.fill).not.toHaveBeenCalled();
  });
});
