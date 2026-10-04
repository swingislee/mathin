import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { constructionObject, constructionObjects } from "../plane-construction/model";
import { relationFlag, relationModel } from "./model";
import { createStripsState } from "./strips-model";
import { COVERAGE_SCENE_ID, coverageBaseState, isValidCoverageState } from "./coverage-validation";

export const COVERAGE_LEVELS = [4, 8, 16, 32, 48] as const;

function extend(before: PlanarState | null, base: PlanarState, copyFrom?: number): PlanarState {
  const params = { ...base.params }, flags = { ...base.flags };
  for (const object of constructionObjects(base)) {
    const source = before && constructionObject(before, object.id) ? object.id : copyFrom;
    params[`coverCount.${object.id}`] = source === undefined ? 16 : before?.params[`coverCount.${source}`] ?? 16;
    flags[`coverCells.${object.id}`] = object.vertices.length === 3 && source !== undefined && !!before?.flags[`coverCells.${source}`];
  }
  return { ...base, sceneId: COVERAGE_SCENE_ID, params, flags };
}

export const createCoverageState = () => extend(null, createStripsState());

/** 所有旧动作通过 v4 执行；材料删除、复制与新增按真实 ID 恢复覆盖设置。 */
export function applyCoverageBase(state: PlanarState, run: (base: PlanarState) => PlanarState, copyFrom?: number): PlanarState {
  const base = coverageBaseState(state), result = run(base);
  if (result === base) return state;
  const candidate = extend(state, result, copyFrom);
  return isValidCoverageState(candidate) ? candidate : state;
}

/** 只含有限的单材料几何，供按钮与参数禁用态读取，不提前扫描方格。 */
function coverageGeometry(state: PlanarState, id = state.params.active) {
  const model = relationModel(state, id), divisions = state.params[`coverCount.${id}`];
  if (state.sceneId !== COVERAGE_SCENE_ID || !model || model.points.length !== 3 || model.object.basis
    || !Number.isInteger(divisions) || divisions < 4 || divisions > 48) return null;
  const edge = state.params[`base.${id}`], vertices = model.object.vertices;
  const a = vertices[edge], b = vertices[(edge + 1) % 3], c = vertices[(edge + 2) % 3];
  if (!a || !b || !c) return null;
  const dx = b.x - a.x, dy = b.y - a.y, acx = c.x - a.x, acy = c.y - a.y;
  const length = Math.hypot(dx, dy), lengthScaled = dx * dx + dy * dy;
  const shearScaled = dx * acx + dy * acy, heightScaled = Math.abs(dx * acy - dy * acx);
  const minScaled = Math.min(0, shearScaled), maxScaled = Math.max(lengthScaled, shearScaled);
  const extentScaled = Math.max(maxScaled - minScaled, heightScaled);
  const shear = shearScaled / length, height = heightScaled / length;
  const minX = minScaled / length, maxX = maxScaled / length, width = (maxScaled - minScaled) / length;
  const size = extentScaled / length / divisions;
  if (![length, shear, height, size].every(Number.isFinite) || height <= 0 || size <= 0) return null;
  // 刚体变换不改变本地投影几何；世界坐标仅负责把同一组真实方格送到舞台。
  const u = { x: (model.b.x - model.a.x) / model.length, y: (model.b.y - model.a.y) / model.length };
  const opposite = model.heights[0].vertex;
  const side = Math.sign(u.x * (opposite.y - model.a.y) - u.y * (opposite.x - model.a.x));
  const v = { x: -u.y * side, y: u.x * side };
  const world = (x: number, y: number): Point => ({
    x: model.a.x + u.x * (minX + x * size) + v.x * y * size,
    y: model.a.y + u.y * (minX + x * size) + v.y * y * size,
  });
  // 分类先保留除法前的点积／叉积坐标，避免斜底的无理长度和网格分数制造假交片。
  const classificationTriangle = [{ x: -minScaled * divisions, y: 0 },
    { x: (lengthScaled - minScaled) * divisions, y: 0 },
    { x: (shearScaled - minScaled) * divisions, y: heightScaled * divisions }];
  const triangle = classificationTriangle.map((point) => ({ x: point.x / extentScaled, y: point.y / extentScaled }));
  const columns = Math.min(divisions, Math.ceil((maxScaled - minScaled) * divisions / extentScaled));
  const rows = Math.min(divisions, Math.ceil(heightScaled * divisions / extentScaled));
  return { ...model, area: heightScaled / 2, length, height, width, minX, maxX, u, v, size, divisions, columns, rows,
    triangle, classificationTriangle, extentScaled, world };
}

// 近乎共线时只提升符号判定的精度，不用固定面积阈值吞掉微小正面积边界片。
type Dyadic = { n: bigint; e: number };
const bits = new DataView(new ArrayBuffer(8));
const zero = BigInt(0), one = BigInt(1), fractionBits = BigInt(52);
function dyadic(value: number): Dyadic {
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0), exponent = Number(raw >> fractionBits & BigInt(2047)), fraction = raw & ((one << fractionBits) - one);
  return { n: (raw >> BigInt(63) ? -one : one) * (exponent ? fraction + (one << fractionBits) : fraction), e: exponent ? exponent - 1075 : -1074 };
}
function difference(a: Dyadic, b: Dyadic): Dyadic {
  const e = Math.min(a.e, b.e);
  return { n: (a.n << BigInt(a.e - e)) - (b.n << BigInt(b.e - e)), e };
}
const product = (a: Dyadic, b: Dyadic): Dyadic => ({ n: a.n * b.n, e: a.e + b.e });
function turnSign(a: Point, b: Point, p: Point): number {
  const left = (b.x - a.x) * (p.y - a.y), right = (b.y - a.y) * (p.x - a.x), determinant = left - right;
  if (Math.abs(determinant) > Number.EPSILON * 8 * (Math.abs(left) + Math.abs(right))) return Math.sign(determinant);
  const exact = difference(
    product(difference(dyadic(b.x), dyadic(a.x)), difference(dyadic(p.y), dyadic(a.y))),
    product(difference(dyadic(b.y), dyadic(a.y)), difference(dyadic(p.x), dyadic(a.x))),
  ).n;
  return exact > zero ? 1 : exact < zero ? -1 : 0;
}

/** 对裁切线精确写入该轴坐标；其余坐标来自真实线段参数，不做像素或中心点估算。 */
function clipAxis(points: readonly Point[], axis: "x" | "y", edge: number, side: number): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i], previous = points[(i + points.length - 1) % points.length];
    const distance = side * (current[axis] - edge), previousDistance = side * (previous[axis] - edge);
    if ((distance >= 0) !== (previousDistance >= 0)) {
      const t = previousDistance / (previousDistance - distance);
      result.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t, [axis]: edge });
    }
    if (distance >= 0) result.push(current);
  }
  return result;
}
function clippedCell(triangle: readonly Point[], column: number, row: number): Point[] {
  let points = triangle.map((point) => ({ x: point.x - column, y: point.y - row }));
  for (const [axis, edge, side] of [["x", 0, 1], ["x", 1, -1], ["y", 0, 1], ["y", 1, -1]] as const) points = clipAxis(points, axis, edge, side);
  return points;
}
function localArea(points: readonly Point[]): number {
  const origin = points[0];
  if (!origin) return 0;
  let twice = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    twice += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  }
  return Math.abs(twice) / 2;
}

export interface CoverageCell {
  column: number; row: number; kind: "full" | "boundary";
  points: Point[]; intersection: Point[]; intersectionArea: number;
}

/** 投影包围框左下角是网格起点。每轴至多 divisions 格，与钝角的外伸程度无关。 */
export function cellCoverageModel(state: PlanarState, id = state.params.active) {
  const geometry = coverageGeometry(state, id);
  if (!geometry) return null;
  const { triangle, classificationTriangle, extentScaled, rows, columns, size, world, ...model } = geometry, cells: CoverageCell[] = [];
  const maxX = Math.max(...classificationTriangle.map((point) => point.x)), maxY = classificationTriangle[2].y;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    if (column * extentScaled >= maxX || row * extentScaled >= maxY) continue;
    const square = [{ x: column, y: row }, { x: column + 1, y: row }, { x: column + 1, y: row + 1 }, { x: column, y: row + 1 }];
    const classificationSquare = square.map((point) => ({ x: point.x * extentScaled, y: point.y * extentScaled }));
    const signs = classificationTriangle.map((point, i) => classificationSquare.map((corner) => turnSign(point, classificationTriangle[(i + 1) % 3], corner)));
    // 严格分离轴检查：任一边只接触或分离即没有正面积，其他极小交集仍计入边界格。
    if (signs.some((edge) => edge.every((sign) => sign <= 0))) continue;
    const full = signs.every((edge) => edge.every((sign) => sign >= 0));
    const intersection = clippedCell(triangle, column, row);
    const intersectionArea = full ? size * size : Math.min(1, localArea(intersection)) * size * size;
    cells.push({ column, row, kind: full ? "full" : "boundary", points: square.map((point) => world(point.x, point.y)),
      intersection: intersection.map((point) => world(column + point.x, row + point.y)), intersectionArea });
  }
  const fullCount = cells.filter((cell) => cell.kind === "full").length, boundaryCount = cells.length - fullCount;
  const innerArea = fullCount * size * size, outerArea = cells.length * size * size;
  return { ...model, size, rows, columns, cells, fullCount, boundaryCount, intersectingCount: cells.length,
    innerArea, outerArea, gapArea: outerArea - innerArea, scannedCount: rows * columns };
}

export const canCoverCells = (state: PlanarState) => !!coverageGeometry(state);
export function setCoverCount(state: PlanarState, value: number): PlanarState {
  const model = coverageGeometry(state);
  if (!model || !Number.isInteger(value) || value < 4 || value > 48 || model.divisions === value) return state;
  return { ...state, params: { ...state.params, [`coverCount.${model.object.id}`]: value } };
}
export function toggleCoverCells(state: PlanarState): PlanarState {
  return canCoverCells(state) ? { ...state, flags: { ...state.flags, [`coverCells.${state.params.active}`]: !relationFlag(state, "coverCells") } } : state;
}
export function refineCoverCells(state: PlanarState): PlanarState {
  const model = coverageGeometry(state), next = model && COVERAGE_LEVELS.find((level) => level > model.divisions);
  if (!next) return state;
  const changed = setCoverCount(state, next);
  return { ...changed, flags: { ...changed.flags, [`coverCells.${state.params.active}`]: true } };
}
