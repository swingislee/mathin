import { sameInputPoint, type InputPoint } from "./ink-input";
export type { InputPoint } from "./ink-input";

interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

interface BoardInputSinkOptions {
  /** CSS pixel distance. Smaller movement is retained as the final endpoint. */
  minDistancePx?: number;
  scheduler?: FrameScheduler;
  /** 小位移尾点只更新本地预览，稳定点继续按距离筛选并用于同步。 */
  onPreview?: (point: InputPoint | null) => void;
}

const browserScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

/**
 * Owns one pointer stream and emits at most one point batch per animation frame.
 * Coordinates stay in CSS pixels here; CanvasSurface normalizes only after the
 * points have been coalesced and lightly resampled.
 */
export class BoardInputSink {
  private readonly minDistancePx: number;
  private readonly scheduler: FrameScheduler;
  private readonly onBatch: (points: InputPoint[]) => void;
  private readonly onPreview?: (point: InputPoint | null) => void;
  private activePointerId: number | null = null;
  private lastDelivered: InputPoint | null = null;
  private pending: InputPoint[] = [];
  private frame: number | null = null;

  constructor(onBatch: (points: InputPoint[]) => void, options: BoardInputSinkOptions = {}) {
    this.onBatch = onBatch;
    this.minDistancePx = Math.max(0, options.minDistancePx ?? 0.75);
    this.scheduler = options.scheduler ?? browserScheduler;
    this.onPreview = options.onPreview;
  }

  get pointerId(): number | null {
    return this.activePointerId;
  }

  begin(pointerId: number, origin: InputPoint): boolean {
    if (this.activePointerId !== null) return false;
    this.activePointerId = pointerId;
    this.lastDelivered = origin;
    this.pending = [];
    return true;
  }

  push(pointerId: number, points: InputPoint[]): boolean {
    if (pointerId !== this.activePointerId || points.length === 0) return false;
    for (const point of points) {
      const previous = this.pending.at(-1) ?? this.lastDelivered;
      if (!previous || !sameInputPoint(previous, point)) this.pending.push(point);
    }
    if (!this.pending.length) return true;
    if (this.frame === null) {
      this.frame = this.scheduler.request(() => {
        this.frame = null;
        this.flush(false);
      });
    }
    return true;
  }

  finish(pointerId: number, points: InputPoint[] = []): boolean {
    if (pointerId !== this.activePointerId) return false;
    if (points.length) this.pending.push(...points);
    this.cancelFrame();
    this.flush(true);
    this.activePointerId = null;
    this.lastDelivered = null;
    return true;
  }

  /** Drops an active pointer without delivering its buffered tail. */
  cancel(pointerId: number): boolean {
    if (pointerId !== this.activePointerId) return false;
    this.cancelFrame();
    this.pending = [];
    this.activePointerId = null;
    this.lastDelivered = null;
    return true;
  }

  /** Flushes the active pointer when page lifecycle events have no PointerEvent. */
  drain(): number | null {
    const pointerId = this.activePointerId;
    if (pointerId === null) return null;
    this.cancelFrame();
    this.flush(true);
    this.activePointerId = null;
    this.lastDelivered = null;
    return pointerId;
  }

  dispose(): void {
    this.cancelFrame();
    this.pending = [];
    this.activePointerId = null;
    this.lastDelivered = null;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.scheduler.cancel(this.frame);
    this.frame = null;
  }

  private flush(final: boolean): void {
    if (this.pending.length === 0) return;
    const accepted: InputPoint[] = [];
    let last = this.lastDelivered;
    let retained: InputPoint | null = null;

    for (const point of this.pending) {
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= this.minDistancePx
        || (point[2]?.pressure != null && Math.abs(point[2].pressure - (last[2]?.pressure ?? 0.5)) >= 0.02)) {
        accepted.push(point);
        last = point;
        retained = null;
      } else {
        retained = point;
      }
    }

    this.pending = [];
    if (retained && final && (!last || !sameInputPoint(retained, last))) {
      accepted.push(retained);
      last = retained;
    } else if (retained && !final) {
      this.pending.push(retained);
    }

    this.onPreview?.(final ? null : retained);
    if (accepted.length || (this.onPreview && retained && !final)) {
      this.lastDelivered = last;
      this.onBatch(accepted);
    }
  }
}
