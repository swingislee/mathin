import type { PlanarPoint } from "../planar-kit/contract";
import { polygonArea } from "../planar-interaction/geometry";
import { simplePolygon, triangulatePolygon, type Rectangle } from "../plane-geometry/model";

export const GRID_EPSILON = 1e-8;
export const gridCross = (a: PlanarPoint, b: PlanarPoint, c: PlanarPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** 共线控制点可以保留；相邻边折返重叠与自交都不构成可围出的材料。 */
export function isGridPolygon(vertices: readonly PlanarPoint[]): boolean {
  if (vertices.length < 3 || vertices.length > 32 || !vertices.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) || !simplePolygon(vertices)) return false;
  return vertices.every((at, i) => {
    const before = vertices[(i + vertices.length - 1) % vertices.length], after = vertices[(i + 1) % vertices.length];
    return Math.abs(gridCross(before, at, after)) > GRID_EPSILON
      || (before.x - at.x) * (after.x - at.x) + (before.y - at.y) * (after.y - at.y) <= GRID_EPSILON;
  });
}

/** 耳切使用数学角点，共线编辑点继续留在原多边形里。 */
export function gridPolygonCorners(vertices: readonly PlanarPoint[]): PlanarPoint[] {
  return vertices.filter((at, i) => Math.abs(gridCross(vertices[(i + vertices.length - 1) % vertices.length], at, vertices[(i + 1) % vertices.length])) > GRID_EPSILON);
}

export function gridTriangles(vertices: readonly PlanarPoint[]): PlanarPoint[][] {
  if (!isGridPolygon(vertices)) return [];
  return triangulatePolygon(gridPolygonCorners(vertices));
}

/** 将方格并集分成互不重叠的竖条矩形，重复铺放只占同一块平面。 */
export function unitSquareUnion(squares: readonly PlanarPoint[]): Rectangle[] {
  const xs = [...new Set(squares.flatMap((square) => [square.x, square.x + 1]))].sort((a, b) => a - b);
  const cells: Rectangle[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x = xs[i], width = xs[i + 1] - x;
    if (width <= GRID_EPSILON) continue;
    const middle = x + width / 2;
    const intervals = squares.filter((square) => middle > square.x && middle < square.x + 1).map((square) => [square.y, square.y + 1]).sort((a, b) => a[0] - b[0]);
    let start = 0, end = 0, open = false;
    for (const interval of intervals) {
      if (!open) { [start, end] = interval; open = true; }
      else if (interval[0] <= end) end = Math.max(end, interval[1]);
      else { cells.push({ x, y: start, width, height: end - start }); [start, end] = interval; }
    }
    if (open) cells.push({ x, y: start, width, height: end - start });
  }
  return cells;
}

/** 三角形与轴对齐方格条带的准确半平面裁剪，凹目标先做真实耳切。 */
export function clipGridPolygon(vertices: readonly PlanarPoint[], rectangle: Rectangle): PlanarPoint[] {
  let result = [...vertices];
  const boundaries = [
    { axis: "x" as const, value: rectangle.x, direction: 1 },
    { axis: "x" as const, value: rectangle.x + rectangle.width, direction: -1 },
    { axis: "y" as const, value: rectangle.y, direction: 1 },
    { axis: "y" as const, value: rectangle.y + rectangle.height, direction: -1 },
  ];
  for (const { axis, value, direction } of boundaries) {
    const input = result; result = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], da = direction * (a[axis] - value), db = direction * (b[axis] - value);
      const insideA = da >= 0, insideB = db >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = da / (da - db);
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, [axis]: value });
      }
    }
    if (!result.length) break;
  }
  return result;
}

export function gridCoverage(vertices: readonly PlanarPoint[], cells: readonly Rectangle[]) {
  const triangles = gridTriangles(vertices), pieces: PlanarPoint[][] = [];
  let covered = 0;
  for (const triangle of triangles) {
    const xs = triangle.map((point) => point.x), ys = triangle.map((point) => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    for (const cell of cells) {
      if (cell.x >= maxX || cell.x + cell.width <= minX || cell.y >= maxY || cell.y + cell.height <= minY) continue;
      const piece = clipGridPolygon(triangle, cell), area = polygonArea(piece);
      if (area > GRID_EPSILON) { covered += area; pieces.push(piece); }
    }
  }
  const area = polygonArea(vertices), union = cells.reduce((total, cell) => total + cell.width * cell.height, 0);
  return { area, covered: Math.min(area, covered), uncovered: Math.max(0, area - covered), outside: Math.max(0, union - covered), pieces };
}
