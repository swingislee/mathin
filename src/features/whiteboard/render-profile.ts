export type WhiteboardRenderProfile = "default" | "classroom";

export const CLASSROOM_MAX_DPR = 1.5;
export const CLASSROOM_MAX_CANVAS_PIXELS = 8_000_000;
export const CLASSROOM_MAX_TOTAL_PIXELS = 24_000_000;

export interface RenderSurfaceMetrics {
  width: number;
  height: number;
  deviceDpr: number;
  canvasCount: number;
}

export function resolveClassroomDprs(entries: ReadonlyMap<string, RenderSurfaceMetrics>): Map<string, number> {
  const totalCssPixels = Array.from(entries.values()).reduce(
    (sum, entry) => sum + Math.max(1, entry.width) * Math.max(1, entry.height) * Math.max(1, entry.canvasCount),
    0,
  );
  const totalCap = Math.sqrt(CLASSROOM_MAX_TOTAL_PIXELS / Math.max(1, totalCssPixels));
  return new Map(Array.from(entries, ([id, entry]) => {
    const area = Math.max(1, entry.width) * Math.max(1, entry.height);
    const singleCap = Math.sqrt(CLASSROOM_MAX_CANVAS_PIXELS / area);
    return [id, Math.max(0.5, Math.min(entry.deviceDpr || 1, CLASSROOM_MAX_DPR, singleCap, totalCap))];
  }));
}

type DprListener = (dpr: number) => void;

class ClassroomPixelBudget {
  private metrics = new Map<string, RenderSurfaceMetrics>();
  private listeners = new Map<string, DprListener>();

  register(id: string, listener: DprListener): () => void {
    this.listeners.set(id, listener);
    return () => {
      this.listeners.delete(id);
      this.metrics.delete(id);
      this.recalculate();
    };
  }

  update(id: string, metrics: RenderSurfaceMetrics): void {
    this.metrics.set(id, metrics);
    this.recalculate();
  }

  private recalculate(): void {
    const dprs = resolveClassroomDprs(this.metrics);
    for (const [id, dpr] of dprs) this.listeners.get(id)?.(dpr);
  }
}

export const classroomPixelBudget = new ClassroomPixelBudget();
