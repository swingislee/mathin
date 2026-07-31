import type { BoardItem, FormulaItem, ShapeItem, ShapeKind, StrokeItem } from "./types";
import { isFormulaItem, isShapeItem, isStrokeItem } from "./types";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function rectFromPoints(a: [number, number], b: [number, number]): NormalizedRect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
}

export function createShapeFromDrag(
  id: string,
  shape: ShapeKind,
  a: [number, number],
  b: [number, number],
  color: ShapeItem["color"],
  fill: ShapeItem["fill"],
  strokeWidthNorm: number,
  heightOverWidth = 1,
): ShapeItem {
  const rect = rectFromPoints(a, b);
  const lineLike = shape === "line" || shape === "arrow";
  const width = Math.max(rect.width, 0.012);
  const height = Math.max(rect.height, lineLike ? 0.002 : 0.012);
  const displayDx = b[0] - a[0];
  const displayDy = (b[1] - a[1]) * heightOverWidth;
  const rotation = lineLike
    ? Math.atan2(displayDy, displayDx) * 180 / Math.PI
    : 0;
  return {
    id,
    kind: "shape",
    shape,
    color,
    fill: lineLike ? null : fill,
    strokeWidthNorm,
    x: (a[0] + b[0]) / 2,
    y: (a[1] + b[1]) / 2,
    width: lineLike ? Math.max(Math.hypot(displayDx, displayDy), 0.012) : width,
    height,
    rotation,
  };
}

export function shapePolygonPoints(shape: ShapeKind): Array<[number, number]> {
  switch (shape) {
    case "triangle":
      return [[0.5, 0], [1, 1], [0, 1]];
    case "rightTriangle":
      return [[0, 0], [1, 1], [0, 1]];
    case "diamond":
      return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    case "pentagon":
      return regularPolygonPoints(5, -90);
    case "hexagon":
      return regularPolygonPoints(6, 0);
    case "star":
      return starPoints(5);
    default:
      return [];
  }
}

function regularPolygonPoints(count: number, startDegrees: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, index) => {
    const angle = (startDegrees + index * 360 / count) * Math.PI / 180;
    return [0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5] as [number, number];
  });
}

function starPoints(points: number): Array<[number, number]> {
  return Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 0.5 : 0.22;
    const angle = (-90 + index * 180 / points) * Math.PI / 180;
    return [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius] as [number, number];
  });
}

export function itemBounds(item: BoardItem): NormalizedRect {
  if (isStrokeItem(item)) {
    const xs = item.points.map((point) => point[0]);
    const ys = item.points.map((point) => point[1]);
    const pad = Math.max(item.wNorm, 0.003);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return {
      x,
      y,
      width: Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 0.006),
      height: Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 0.006),
    };
  }
  return {
    x: item.x - item.width / 2,
    y: item.y - item.height / 2,
    width: item.width,
    height: item.height,
  };
}

export function boundsForItems(items: BoardItem[]): NormalizedRect | null {
  if (items.length === 0) return null;
  const bounds = items.map(itemBounds);
  const left = Math.min(...bounds.map((rect) => rect.x));
  const top = Math.min(...bounds.map((rect) => rect.y));
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectsIntersect(a: NormalizedRect, b: NormalizedRect): boolean {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

export function inkStrokesInRect(items: BoardItem[], rect: NormalizedRect): StrokeItem[] {
  return items.filter((item): item is StrokeItem => (
    isStrokeItem(item) && item.mode === "ink" && rectsIntersect(itemBounds(item), rect)
  ));
}

export function cloneBoardItem(item: BoardItem, id: string, offset = 0.025): BoardItem {
  if (isStrokeItem(item)) {
    return {
      ...item,
      id,
      points: item.points.map(([x, y]) => [clamp(x + offset, -0.5, 1.5), clamp(y + offset, -0.5, 1.5)]),
    };
  }
  return { ...item, id, x: clamp(item.x + offset), y: clamp(item.y + offset) };
}

export function translateItem(item: BoardItem, dx: number, dy: number): BoardItem {
  if (isStrokeItem(item)) {
    return { ...item, points: item.points.map(([x, y]) => [x + dx, y + dy]) };
  }
  return { ...item, x: clamp(item.x + dx), y: clamp(item.y + dy) };
}

export function resizeObject(item: ShapeItem | FormulaItem, width: number, height: number): ShapeItem | FormulaItem {
  return {
    ...item,
    width: clamp(Math.abs(width), 0.02, 1.5),
    height: clamp(Math.abs(height), 0.018, 1.5),
  };
}

export function objectWithRotation(item: ShapeItem | FormulaItem, rotation: number): ShapeItem | FormulaItem {
  return { ...item, rotation: normalizeDegrees(rotation) };
}

export function sanitizeLatex(value: string): string {
  return value
    .trim()
    .replace(/^\$\$?/, "")
    .replace(/\$\$?$/, "")
    .replace(/^\\\[/, "")
    .replace(/\\\]$/, "")
    .trim()
    .slice(0, 4000);
}

export function isEditableObject(item: BoardItem): item is ShapeItem | FormulaItem {
  return isShapeItem(item) || isFormulaItem(item);
}
