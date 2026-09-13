import type { StrokeItem, StrokeSample } from "./types";

export interface InkInputMetadata {
  /** 浏览器样本时间；跨 iframe 只比较同一笔内的相对时间。 */
  timeStamp: number;
  /** 仅保留接触中的 pen 压力；null 表示此次输入没有可用压力。 */
  pressure: number | null;
}

export type InputPoint = [x: number, y: number, metadata?: InkInputMetadata];

export function pointerInkMetadata(event: Pick<PointerEvent, "pointerType" | "pressure" | "timeStamp" | "buttons">): InkInputMetadata {
  return {
    timeStamp: Number.isFinite(event.timeStamp) ? event.timeStamp : 0,
    pressure: event.pointerType === "pen" && event.buttons !== 0
      && Number.isFinite(event.pressure) && event.pressure >= 0 && event.pressure <= 1 ? event.pressure : null,
  };
}

export function sameInputPoint(a: InputPoint, b: InputPoint): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2]?.pressure === b[2]?.pressure;
}

/** 收笔的零压力不是接触压力；沿用最后一个接触值，避免收笔时整笔突然变形。 */
export function strokeSample(point: InputPoint, originTime: number, previous?: StrokeSample): StrokeSample {
  const elapsed = Math.max(previous?.[0] ?? 0, (point[2]?.timeStamp ?? originTime) - originTime);
  const pressure = point[2]?.pressure ?? previous?.[1] ?? null;
  return [Math.round(elapsed * 10) / 10, pressure === null ? null : Math.round(pressure * 1000) / 1000];
}

export function appendStrokeInput(stroke: StrokeItem, points: readonly InputPoint[], originTime: number): void {
  for (const point of points) {
    stroke.points.push(stroke.brush === "freehand-v2" || stroke.brush === "freehand-v3"
      ? [Math.round(point[0] * 1e6) / 1e6, Math.round(point[1] * 1e6) / 1e6] : [point[0], point[1]]);
    if (stroke.samples) stroke.samples.push(strokeSample(point, originTime, stroke.samples.at(-1)));
  }
}

export function previewStroke(stroke: StrokeItem, point: InputPoint | null, originTime: number): StrokeItem {
  if (!point) return stroke;
  const position: [number, number] = stroke.brush === "freehand-v2" || stroke.brush === "freehand-v3"
    ? [Math.round(point[0] * 1e6) / 1e6, Math.round(point[1] * 1e6) / 1e6] : [point[0], point[1]];
  return { ...stroke, points: [...stroke.points, position],
    ...(stroke.samples ? { samples: [...stroke.samples, strokeSample(point, originTime, stroke.samples.at(-1))] } : {}) };
}
