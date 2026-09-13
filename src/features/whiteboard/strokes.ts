import { getStroke } from "perfect-freehand";
import { newId } from "@/lib/uuid";
import { shapePolygonPoints } from "./geometry";
import { InkPressureCache } from "./ink-pressure";
import {
  isShapeItem,
  isStrokeItem,
  type BoardItem,
  type ColorToken,
  type ShapeItem,
  type StrokeItem,
  type StrokeSample,
} from "./types";

export const newStrokeId = newId;

const COLOR_VARS: Record<ColorToken, string> = {
  ink: "--ink",
  rose: "--rose",
  blue: "--blue",
  leaf: "--leaf-deep",
  crater: "--crater",
  cheek: "--cheek",
  moon: "--moon",
};

/** 解析 token 在当前主题下的实际色值；el 用于取生效的级联作用域。 */
export function resolveColor(el: Element, token: ColorToken): string {
  const value = getComputedStyle(el).getPropertyValue(COLOR_VARS[token] ?? "--ink").trim();
  return value || "#888";
}

export function colorVar(token: ColorToken): string {
  return `var(${COLOR_VARS[token] ?? "--ink"})`;
}

function outlinePath(pointsPx: number[][], sizePx: number): Path2D {
  const outline = getStroke(pointsPx, { size: sizePx, thinning: 0.7, smoothing: 0.6, streamline: 0.5 });
  let d = "";
  for (let i = 0; i < outline.length; i++) {
    d += `${i ? "L" : "M"}${outline[i][0]} ${outline[i][1]} `;
  }
  return new Path2D(d + "Z");
}

/** 当前整笔的自然轮廓：保留模拟压力，减少轨迹惯性，末点对齐当前笔尖。 */
export function classroomInkOutline(pointsPx: number[][], sizePx: number): number[][] {
  return getStroke(pointsPx, {
    size: sizePx,
    thinning: 0.7,
    smoothing: 0.6,
    streamline: 0.1,
    simulatePressure: true,
    // 每次提供当前完整点列；预览与收笔都以其末点封口，保持同一轮廓规则。
    last: true,
  });
}

/** PF v2 使用笔设备的非默认压力；没有压力或始终为默认 0.5 时保留模拟粗细。 */
export function classroomPressureOutline(pointsPx: number[][], samples: readonly StrokeSample[] | undefined, sizePx: number): number[][] {
  // PF 会为孤立点补一段偏移轨迹；重复同一落点使起笔与同位置收笔使用稳定的点形。
  const positions = pointsPx.length === 1 ? [pointsPx[0], pointsPx[0]] : pointsPx;
  const hasPressure = samples?.some(([, pressure]) => pressure !== null && pressure >= 0 && pressure <= 1 && Math.abs(pressure - 0.5) > 0.001);
  if (!hasPressure) return classroomInkOutline(positions, sizePx);
  let previous = 0.5;
  const points = positions.map(([x, y], index) => {
    const pressure = samples?.[index]?.[1];
    if (pressure != null && pressure >= 0 && pressure <= 1) previous = pressure;
    return [x, y, previous];
  });
  return getStroke(points, { size: sizePx, thinning: 0.7, smoothing: 0.6, streamline: 0.1, simulatePressure: false, last: true });
}

/** v3 接收按采样时间处理的压力；短笔画显式保留压力，绕开 PF 两点补点时的默认值。 */
export function classroomTimedOutline(points: number[][], size: number): number[][] {
  let input = points;
  if (points.length && points.every(([x, y]) => x === points[0][0] && y === points[0][1])) {
    input = [points[points.length - 1], points[points.length - 1]];
  } else if (points.length === 2) {
    const [a, b] = points;
    input = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b];
  }
  return getStroke(input, { size, thinning: 0.7, smoothing: 0.6, streamline: 0.1, simulatePressure: false, last: true });
}

/** 活动层、落笔底图和导出共用轮廓连接方式；二次曲线始终位于轮廓点的凸包内。 */
export function inkOutlinePath(outline: number[][], curved = false): Path2D {
  const path = new Path2D();
  if (curved && outline.length > 2) {
    const first = outline[0], last = outline[outline.length - 1];
    path.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (let index = 0; index < outline.length; index++) {
      const point = outline[index], next = outline[(index + 1) % outline.length];
      path.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
    }
  } else {
    outline.forEach(([x, y], index) => { if (index === 0) path.moveTo(x, y); else path.lineTo(x, y); });
  }
  path.closePath();
  return path;
}

/**
 * 画一条绘制项；erase 项以 destination-out 挖除底下的墨迹。
 * `basisW` 是线宽换算的参照宽度，默认等于 `w`（点坐标的归一化基准）；
 * 课堂场景主/副板书物理宽度悬殊，传入统一的 basisW（主板书宽度）
 * 让同一支笔在同屏两块板上像素粗细一致（点位置仍各自按自身宽度归一化）。
 */
export function drawItem(
  ctx: CanvasRenderingContext2D,
  item: StrokeItem,
  w: number,
  h: number,
  color: string,
  basisW: number = w,
): void {
  if (item.points.length === 0) return;
  const pts = item.brush === "freehand-v3" ? [] : item.points.map(([xn, yn]) => [xn * w, yn * h]);
  const size = Math.max(item.wNorm * basisW, 1);
  ctx.save();
  if (item.mode === "erase") ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = item.mode === "erase" ? "#000" : color;
  if (item.brush === "round-v1") {
    // 与采样点重合的等宽圆头线段；分批追加与整笔重放使用同一个轮廓。
    ctx.beginPath();
    if (pts.every(([x, y]) => x === pts[0][0] && y === pts[0][1])) {
      ctx.arc(pts[0][0], pts[0][1], size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = ctx.fillStyle;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let index = 1; index < pts.length; index++) ctx.lineTo(pts[index][0], pts[index][1]);
      ctx.stroke();
    }
  } else if (item.brush === "freehand-v3") {
    const pressure = new InkPressureCache().update(item.points, item.samples, w, h, size);
    ctx.fill(inkOutlinePath(classroomTimedOutline(pressure, size), true));
  } else if (item.brush === "freehand-v1" || item.brush === "freehand-v2") {
    const outline = item.brush === "freehand-v2" ? classroomPressureOutline(pts, item.samples, size) : classroomInkOutline(pts, size);
    ctx.fill(inkOutlinePath(outline));
  } else {
    ctx.fill(outlinePath(pts, size));
  }
  ctx.restore();
}

/** 按序重放笔迹；几何对象由 SVG 对象层绘制。 */
export function renderAll(
  ctx: CanvasRenderingContext2D,
  items: BoardItem[],
  w: number,
  h: number,
  colorEl: Element,
  basisW: number = w,
): void {
  ctx.clearRect(0, 0, w, h);
  const colors = new Map<ColorToken, string>();
  for (const item of items) {
    if (!isStrokeItem(item)) continue;
    if (item.mode === "ink" && !colors.has(item.color)) colors.set(item.color, resolveColor(colorEl, item.color));
    drawItem(ctx, item, w, h, colors.get(item.color) ?? "#000", basisW);
  }
}

/** 擦除轨迹是一段带半径的扫掠区，快速移动时也能命中两个采样点之间的笔迹。 */
export function hitSweptStrokeIds(
  items: BoardItem[], from: readonly [number, number], to: readonly [number, number],
  w: number, h: number, thresholdPx: number, basisW: number = w,
): string[] {
  const [ax, ay] = from, [bx, by] = to;
  return items.filter((item) => {
    if (!isStrokeItem(item) || item.mode !== "ink") return false;
    const radius = thresholdPx + item.wNorm * basisW / 2;
    return item.points.some(([xn, yn], index, points) => {
      const [nextX, nextY] = points[index + 1] ?? points[index];
      const cx = xn * w, cy = yn * h, dx = nextX * w, dy = nextY * h;
      const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx;
      const determinant = cross(bx - ax, by - ay, dx - cx, dy - cy);
      if (determinant !== 0) {
        const t = cross(cx - ax, cy - ay, dx - cx, dy - cy) / determinant;
        const u = cross(cx - ax, cy - ay, bx - ax, by - ay) / determinant;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
      }
      return Math.min(
        segmentDistance(ax, ay, cx, cy, dx, dy), segmentDistance(bx, by, cx, cy, dx, dy),
        segmentDistance(cx, cy, ax, ay, bx, by), segmentDistance(dx, dy, ax, ay, bx, by),
      ) <= radius;
    });
  }).map((item) => item.id);
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 整线擦命中：自最上层向下找第一条距离在阈值内的 ink 笔迹（像素空间计算，避免 16:9 归一化的轴向失真）。 */
export function hitStrokeId(
  items: BoardItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  thresholdPx: number,
  basisW: number = w,
): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!isStrokeItem(item) || item.mode !== "ink") continue;
    const radius = thresholdPx + (item.wNorm * basisW) / 2;
    const pts = item.points;
    if (pts.length === 1) {
      if (Math.hypot(pts[0][0] * w - x, pts[0][1] * h - y) <= radius) return item.id;
      continue;
    }
    for (let j = 0; j < pts.length - 1; j++) {
      if (segmentDistance(x, y, pts[j][0] * w, pts[j][1] * h, pts[j + 1][0] * w, pts[j + 1][1] * h) <= radius) {
        return item.id;
      }
    }
  }
  return null;
}

function drawShapeCanvas(
  ctx: CanvasRenderingContext2D,
  item: ShapeItem,
  canvasWidth: number,
  canvasHeight: number,
  colorEl: Element,
): void {
  const width = item.width * canvasWidth;
  const height = item.height * canvasHeight;
  const stroke = resolveColor(colorEl, item.color);
  const fill = item.fill ? resolveColor(colorEl, item.fill) : null;
  ctx.save();
  ctx.translate(item.x * canvasWidth, item.y * canvasHeight);
  ctx.rotate(item.rotation * Math.PI / 180);
  ctx.lineWidth = Math.max(item.strokeWidthNorm * canvasWidth, 1);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill ?? "transparent";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (item.shape === "line" || item.shape === "arrow") {
    ctx.moveTo(-width / 2, 0);
    ctx.lineTo(width / 2, 0);
    if (item.shape === "arrow") {
      const head = Math.min(Math.max(width * 0.12, 8), 28);
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2 - head, -head * 0.55);
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2 - head, head * 0.55);
    }
  } else if (item.shape === "rectangle") {
    ctx.rect(-width / 2, -height / 2, width, height);
  } else if (item.shape === "ellipse") {
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (item.shape === "arc") {
    const start = (item.startAngle ?? 0) * Math.PI / 180;
    const end = start + (item.sweepAngle ?? 360) * Math.PI / 180;
    ctx.ellipse(0, 0, width / 2, height / 2, 0, start, end, (item.sweepAngle ?? 0) < 0);
  } else {
    const points = shapePolygonPoints(item.shape);
    points.forEach(([x, y], index) => {
      const px = (x - 0.5) * width;
      const py = (y - 0.5) * height;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
  if (fill && !["line", "arrow", "arc"].includes(item.shape)) ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;

async function exportRaster(
  items: BoardItem[],
  fileName: string,
  colorEl: Element,
  mimeType: "image/png" | "image/webp",
  extension: "png" | "webp",
  quality?: number,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = getComputedStyle(colorEl).getPropertyValue("--paper").trim() || "#fff";
  ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  for (const item of items) {
    if (isStrokeItem(item)) {
      drawItem(ctx, item, EXPORT_WIDTH, EXPORT_HEIGHT, item.mode === "erase" ? "#000" : resolveColor(colorEl, item.color));
    } else if (isShapeItem(item)) {
      drawShapeCanvas(ctx, item, EXPORT_WIDTH, EXPORT_HEIGHT, colorEl);
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName || "whiteboard"}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

/** 导出 PNG：离屏按逻辑 16:9 重放，底色用当前主题纸色。 */
export function exportPng(items: BoardItem[], fileName: string, colorEl: Element): Promise<void> {
  return exportRaster(items, fileName, colorEl, "image/png", "png");
}
