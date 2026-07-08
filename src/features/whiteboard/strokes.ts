import { getStroke } from "perfect-freehand";
import { newId } from "@/lib/uuid";
import type { ColorToken, StrokeItem } from "./types";

export const newStrokeId = newId;

const COLOR_VARS: Record<ColorToken, string> = {
  ink: "--ink",
  rose: "--rose",
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
  const pts = item.points.map(([xn, yn]) => [xn * w, yn * h]);
  const path = outlinePath(pts, Math.max(item.wNorm * basisW, 1));
  ctx.save();
  if (item.mode === "erase") ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = item.mode === "erase" ? "#000" : color;
  ctx.fill(path);
  ctx.restore();
}

/** 按序重放全部绘制项 = 当前画面。 */
export function renderAll(
  ctx: CanvasRenderingContext2D,
  items: StrokeItem[],
  w: number,
  h: number,
  colorEl: Element,
  basisW: number = w,
): void {
  ctx.clearRect(0, 0, w, h);
  for (const item of items) {
    drawItem(ctx, item, w, h, item.mode === "erase" ? "#000" : resolveColor(colorEl, item.color), basisW);
  }
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
  items: StrokeItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  thresholdPx: number,
  basisW: number = w,
): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.mode !== "ink") continue;
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

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;

/** 导出 PNG：离屏按逻辑 16:9 重放，底色用当前主题纸色。 */
export function exportPng(items: StrokeItem[], fileName: string, colorEl: Element): void {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = getComputedStyle(colorEl).getPropertyValue("--paper").trim() || "#fff";
  ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  for (const item of items) {
    drawItem(ctx, item, EXPORT_WIDTH, EXPORT_HEIGHT, item.mode === "erase" ? "#000" : resolveColor(colorEl, item.color));
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName || "whiteboard"}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
