import { classroomInkOutline, classroomPressureOutline, classroomTimedOutline, drawItem, inkOutlinePath } from "./strokes";
import { InkPressureCache } from "./ink-pressure";
import type { StrokeItem } from "./types";

interface Bounds { x: number; y: number; right: number; bottom: number }
interface Prepared {
  stroke: StrokeItem;
  count: number;
  last: StrokeItem["points"][number] | undefined;
  sample: StrokeItem["samples"];
  bounds: Bounds;
  path: Path2D | null;
  color: string;
  pressure?: InkPressureCache;
}

function union(a: Bounds | null, b: Bounds): Bounds {
  return a ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) } : b;
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.right && a.right >= b.x && a.y <= b.bottom && a.bottom >= b.y;
}

/** 活动 PF 保留整笔状态；只清除变更范围，未变化的远端轮廓直接复用。 */
export class InkDraftRenderer {
  private prepared = new Map<string, Prepared>();
  private dimensions = "";

  invalidate(): void {
    this.dimensions = "";
  }

  render(ctx: CanvasRenderingContext2D, strokes: readonly StrokeItem[], w: number, h: number, basisW: number,
    resolve: (stroke: StrokeItem) => string): void {
    const dimensions = `${w}:${h}:${basisW}`;
    const reset = this.dimensions !== dimensions;
    this.dimensions = dimensions;
    let dirty: Bounds | null = reset ? { x: 0, y: 0, right: w, bottom: h } : null;
    const next = new Map<string, Prepared>();
    for (const stroke of strokes) {
      if (stroke.mode !== "ink" || !stroke.points.length) continue;
      const previous = this.prepared.get(stroke.id);
      const count = stroke.points.length;
      const last = stroke.points[count - 1];
      const color = resolve(stroke);
      if (!reset && previous?.stroke === stroke && previous.count === count && previous.last === last
        && previous.sample === stroke.samples && previous.color === color) {
        next.set(stroke.id, previous);
        continue;
      }
      const size = Math.max(stroke.wNorm * basisW, 1);
      const pressure = stroke.brush === "freehand-v3" ? previous?.pressure ?? new InkPressureCache() : undefined;
      const points = pressure ? pressure.update(stroke.points, stroke.samples, w, h, size) : stroke.points.map(([x, y]) => [x * w, y * h]);
      const outline = stroke.brush === "freehand-v3" ? classroomTimedOutline(points, size)
        : stroke.brush === "freehand-v2" ? classroomPressureOutline(points, stroke.samples, size)
        : stroke.brush === "freehand-v1" ? classroomInkOutline(points, size) : null;
      const geometry = outline ?? points;
      let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
      const path = outline ? inkOutlinePath(outline, stroke.brush === "freehand-v3") : null;
      for (let index = 0; index < geometry.length; index++) {
        const [px, py] = geometry[index];
        x = Math.min(x, px); y = Math.min(y, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
      }
      // 轮廓本身包含端帽；额外像素覆盖抗锯齿。旧笔刷按保守半径界定范围。
      const padding = outline ? 2 : size * 2 + 2;
      const bounds = { x: Math.floor(x - padding), y: Math.floor(y - padding), right: Math.ceil(right + padding), bottom: Math.ceil(bottom + padding) };
      const prepared = { stroke, count, last, sample: stroke.samples, bounds, path, color, pressure };
      next.set(stroke.id, prepared);
      dirty = union(dirty, bounds);
      if (previous) dirty = union(dirty, previous.bounds);
    }
    for (const [id, previous] of this.prepared) if (!next.has(id)) dirty = union(dirty, previous.bounds);
    this.prepared = next;
    if (!dirty) return;
    const x = Math.max(0, dirty.x), y = Math.max(0, dirty.y);
    const width = Math.min(w, dirty.right) - x, height = Math.min(h, dirty.bottom) - y;
    if (width <= 0 || height <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    ctx.clearRect(x, y, width, height);
    for (const entry of next.values()) {
      if (!intersects(dirty, entry.bounds)) continue;
      if (entry.path) { ctx.fillStyle = entry.color; ctx.fill(entry.path); }
      else drawItem(ctx, entry.stroke, w, h, entry.color, basisW);
    }
    ctx.restore();
  }
}
