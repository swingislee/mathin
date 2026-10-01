import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { add, clamp, distance, perpendicularFoot } from "../plane-geometry/model";
import { GRID_EPSILON, gridTriangles, isGridPolygon } from "./geometry";

export const GRID_SCALE = 40;
export const GRID_ORIGIN = { x: 120, y: 100 };
export const GRID_COLUMNS = 18;
export const GRID_ROWS = 12;
export const MAX_GRID_POLYGONS = 4;
export const MAX_GRID_VERTICES = 96;
export const MAX_UNIT_SQUARES = 100;
export const GRID_FLAGS = ["grid", "lattice", "boundary", "points", "measures", "relation", "units", "height", "triangles", "snap", "coverage"] as const;
export const GRID_GLOBAL_PARAMS = ["nextId", "active", "unit"] as const;
export const GRID_POLYGON_PARAMS = ["kind", "count", "base", "apex", "split"] as const;
export type GridSceneId = "34-create" | "11-create";
export interface GridPolygon { id: number; kind: 0; vertices: PlanarPoint[]; base: number; apex: number; split: boolean; offsets: PlanarPoint[] }
export interface UnitSquare { id: number; kind: 1; at: PlanarPoint }
export type GridMaterial = GridPolygon | UnitSquare;
export interface GridTarget { type: "object" | "tile" | "edge" | "vertex" | "part"; id: number; index?: number }

export const isGeoboard = (state: PlanarState) => state.sceneId === "34-create";
export const gridToStage = (point: PlanarPoint): PlanarPoint => ({ x: GRID_ORIGIN.x + point.x * GRID_SCALE, y: GRID_ORIGIN.y + point.y * GRID_SCALE });
export const stageToGrid = (point: PlanarPoint): PlanarPoint => ({ x: (point.x - GRID_ORIGIN.x) / GRID_SCALE, y: (point.y - GRID_ORIGIN.y) / GRID_SCALE });
const roundPoint = (point: PlanarPoint): PlanarPoint => ({ x: Math.round(point.x), y: Math.round(point.y) });
const clampVertex = (point: PlanarPoint): PlanarPoint => ({ x: clamp(point.x, 0, GRID_COLUMNS), y: clamp(point.y, 0, GRID_ROWS) });
const clampTile = (point: PlanarPoint): PlanarPoint => ({ x: clamp(point.x, -1, GRID_COLUMNS), y: clamp(point.y, -1, GRID_ROWS) });
const finitePoint = (point: PlanarPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const idPattern = "(0|[1-9]\\d{0,4})";

/** 让首点、草稿预览与闭合比较共用同一钉点；自由覆盖材料保持连续坐标。 */
export function projectGridPoint(point: PlanarPoint, state: PlanarState): PlanarPoint {
  return isGeoboard(state) || state.flags.snap ? gridToStage(roundPoint(stageToGrid(point))) : point;
}

export function parseGridTarget(target: string | null): GridTarget | null {
  if (!target) return null;
  const object = target.match(new RegExp(`^(object|tile)\\.${idPattern}$`));
  if (object) return { type: object[1] as GridTarget["type"], id: Number(object[2]) };
  const part = target.match(new RegExp(`^(edge|vertex|part)\\.${idPattern}\\.${idPattern}$`));
  return part ? { type: part[1] as GridTarget["type"], id: Number(part[2]), index: Number(part[3]) } : null;
}

export function gridMaterial(state: PlanarState, id = state.params.active): GridMaterial | null {
  const kind = state.params[`kind.${id}`];
  if (kind === 1) return state.points[`tile.${id}`] ? { id, kind, at: state.points[`tile.${id}`] } : null;
  if (kind !== 0) return null;
  const vertices = Array.from({ length: state.params[`count.${id}`] }, (_, i) => state.points[`v.${id}.${i}`]);
  const split = state.params[`split.${id}`] === 1;
  return { id, kind, vertices, base: state.params[`base.${id}`], apex: state.params[`apex.${id}`], split,
    offsets: split ? gridTriangles(vertices).map((_, i) => state.points[`part.${id}.${i}`] ?? { x: 0, y: 0 }) : [] };
}

export function gridMaterials(state: PlanarState): GridMaterial[] {
  return Object.keys(state.params).flatMap((key) => /^kind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(5))] : []).sort((a, b) => a - b).map((id) => gridMaterial(state, id)!).filter(Boolean);
}
export const gridPolygons = (state: PlanarState) => gridMaterials(state).filter((material): material is GridPolygon => material.kind === 0);
export const unitSquares = (state: PlanarState) => gridMaterials(state).filter((material): material is UnitSquare => material.kind === 1);
export const gridObjectTarget = (material: GridMaterial) => `${material.kind === 0 ? "object" : "tile"}.${material.id}`;

export function gridBounds(points: readonly PlanarPoint[]) {
  return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)) };
}
export const gridMaterialPoints = (material: GridMaterial) => material.kind === 0 ? material.vertices : [material.at, add(material.at, { x: 1, y: 0 }), add(material.at, { x: 1, y: 1 }), add(material.at, { x: 0, y: 1 })];

function farthestVertex(vertices: readonly PlanarPoint[], base: number): number {
  let best = (base + 2) % vertices.length, longest = -1;
  vertices.forEach((point, i) => {
    const height = perpendicularFoot(point, vertices[base], vertices[(base + 1) % vertices.length])?.distance ?? 0;
    if (height > longest) { longest = height; best = i; }
  });
  return best;
}

function writePolygon(state: PlanarState, polygon: GridPolygon): PlanarState {
  const params = { ...state.params, [`kind.${polygon.id}`]: 0, [`count.${polygon.id}`]: polygon.vertices.length, [`base.${polygon.id}`]: polygon.base, [`apex.${polygon.id}`]: polygon.apex, [`split.${polygon.id}`]: polygon.split ? 1 : 0 };
  const points = Object.fromEntries(Object.entries(state.points).filter(([key]) => !key.startsWith(`v.${polygon.id}.`) && !key.startsWith(`part.${polygon.id}.`)));
  polygon.vertices.forEach((point, i) => { points[`v.${polygon.id}.${i}`] = point; });
  if (polygon.split) polygon.offsets.forEach((point, i) => { points[`part.${polygon.id}.${i}`] = point; });
  return { ...state, params, points };
}

export function createGridMeasureState(sceneId: GridSceneId, empty = false): PlanarState {
  const state: PlanarState = { sceneId, params: { nextId: 1, active: -1, unit: sceneId === "34-create" ? 0 : 1 }, points: {},
    flags: Object.fromEntries(GRID_FLAGS.map((key) => [key, key === "lattice" || key === "snap"])), marks: [], phase: 0 };
  return empty ? state : addGridPolygon(state, [{ x: 3, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 7 }, { x: 3, y: 7 }]);
}

export function addGridPolygon(state: PlanarState, vertices: readonly PlanarPoint[]): PlanarState {
  const polygons = gridPolygons(state), id = state.params.nextId;
  if (id >= 99999 || polygons.length >= MAX_GRID_POLYGONS || polygons.reduce((total, polygon) => total + polygon.vertices.length, vertices.length) > MAX_GRID_VERTICES
    || vertices.some((point) => !finitePoint(point) || point.x < 0 || point.x > GRID_COLUMNS || point.y < 0 || point.y > GRID_ROWS || isGeoboard(state) && (!Number.isInteger(point.x) || !Number.isInteger(point.y))) || !isGridPolygon(vertices)) return state;
  return writePolygon({ ...state, params: { ...state.params, nextId: id + 1, active: id } }, { id, kind: 0, vertices: [...vertices], base: 0, apex: farthestVertex(vertices, 0), split: false, offsets: [] });
}

export function addUnitSquare(state: PlanarState, position?: PlanarPoint): PlanarState {
  const id = state.params.nextId, count = unitSquares(state).length, at = position ?? { x: 15 + count % 3, y: 1 + Math.floor(count / 3) % 8 };
  if (isGeoboard(state) || id >= 99999 || count >= MAX_UNIT_SQUARES || !finitePoint(at) || at.x < -1 || at.x > GRID_COLUMNS || at.y < -1 || at.y > GRID_ROWS) return state;
  return { ...state, params: { ...state.params, nextId: id + 1, active: id, [`kind.${id}`]: 1 }, points: { ...state.points, [`tile.${id}`]: { ...at } } };
}

export function addUnitRow(state: PlanarState): PlanarState {
  if (MAX_UNIT_SQUARES - unitSquares(state).length < 10 || state.params.nextId + 10 > 99999) return state;
  return Array.from({ length: 10 }, (_, i) => ({ x: 4 + i, y: 11 })).reduce((current, at) => addUnitSquare(current, at), state);
}

export function constructGridMaterial(state: PlanarState, tool: string, draft: readonly PlanarPoint[]): PlanarState {
  if (!draft.every(finitePoint)) return state;
  const points = draft.map((point) => stageToGrid(projectGridPoint(point, state)));
  if (tool === "unit-square") return points.length === 1 ? addUnitSquare(state, clampTile(points[0])) : state;
  if (tool === "rectangle" && points.length === 2) {
    const [a, b] = points.map(clampVertex);
    return addGridPolygon(state, [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]);
  }
  if (tool !== "polygon") return state;
  const vertices = points.map(clampVertex);
  if (vertices.length > 3 && distance(vertices[0], vertices[vertices.length - 1]) < GRID_EPSILON) vertices.pop();
  return addGridPolygon(state, vertices);
}

export function tapGridMaterial(state: PlanarState, target: string): PlanarState {
  const parsed = parseGridTarget(target), material = parsed && gridMaterial(state, parsed.id);
  if (!parsed || !material) return state;
  const selected = state.params.active === material.id ? state : { ...state, params: { ...state.params, active: material.id } };
  if (parsed.type === "edge" && material.kind === 0 && state.flags.height && parsed.index! < material.vertices.length) return writePolygon(selected, { ...material, base: parsed.index!, apex: farthestVertex(material.vertices, parsed.index!) });
  return selected;
}

function translatePolygon(polygon: GridPolygon, delta: PlanarPoint): GridPolygon {
  const bounds = gridBounds(polygon.vertices), shift = { x: clamp(delta.x, -bounds.minX, GRID_COLUMNS - bounds.maxX), y: clamp(delta.y, -bounds.minY, GRID_ROWS - bounds.maxY) };
  return { ...polygon, vertices: polygon.vertices.map((point) => add(point, shift)) };
}

/** 自由帧仅在宿主预览；格点多边形的松手终点由 snapGridMaterial 统一生成。 */
export function moveGridMaterial(state: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint, context?: { previous?: PlanarState }): PlanarState {
  const parsed = parseGridTarget(target), material = parsed && gridMaterial(state, parsed.id);
  if (!parsed || !material || !finitePoint(point) || !finitePoint(delta)) return state;
  const selected = { ...state, params: { ...state.params, active: material.id } }, shift = { x: delta.x / GRID_SCALE, y: delta.y / GRID_SCALE };
  if (material.kind === 1) return parsed.type === "tile" ? { ...selected, points: { ...state.points, [`tile.${material.id}`]: clampTile(add(material.at, shift)) } } : state;
  if (parsed.type === "part" && material.split && parsed.index! < material.offsets.length) {
    const index = parsed.index!, triangles = gridTriangles(material.vertices), bounds = gridBounds(triangles[index].map((at) => add(at, material.offsets[index])));
    const offset = add(material.offsets[index], { x: clamp(shift.x, -1 - bounds.minX, GRID_COLUMNS + 1 - bounds.maxX), y: clamp(shift.y, -1 - bounds.minY, GRID_ROWS + 1 - bounds.maxY) });
    return { ...selected, points: { ...state.points, [`part.${material.id}.${index}`]: offset } };
  }
  if (parsed.type === "object" || parsed.type === "edge") return writePolygon(selected, translatePolygon(material, shift));
  if (parsed.type !== "vertex" || material.split || parsed.index! >= material.vertices.length) return state;
  const vertices = material.vertices.map((at, i) => i === parsed.index ? clampVertex(stageToGrid(point)) : at);
  const landing = vertices.map((at, i) => isGeoboard(state) || i === parsed.index ? roundPoint(at) : at);
  if (!isGridPolygon(vertices) || (isGeoboard(state) || state.flags.snap) && !isGridPolygon(landing)) return context?.previous ?? state;
  return writePolygon(selected, { ...material, vertices });
}

export function snapGridMaterial(state: PlanarState, target: string): PlanarState | null {
  const parsed = parseGridTarget(target), material = parsed && gridMaterial(state, parsed.id);
  if (!parsed || !material || parsed.type === "part" || !isGeoboard(state) && !state.flags.snap) return null;
  if (material.kind === 1) return { ...state, points: { ...state.points, [`tile.${material.id}`]: roundPoint(material.at) } };
  const bounds = gridBounds(material.vertices), shift = { x: Math.round(bounds.minX) - bounds.minX, y: Math.round(bounds.minY) - bounds.minY };
  const vertices = isGeoboard(state) ? material.vertices.map(roundPoint) : parsed.type === "vertex"
    ? material.vertices.map((at, i) => i === parsed.index ? roundPoint(at) : at)
    : translatePolygon(material, shift).vertices;
  return isGridPolygon(vertices) ? writePolygon(state, { ...material, vertices }) : null;
}

export function duplicateGridMaterial(state: PlanarState): PlanarState {
  const material = gridMaterial(state);
  if (!material) return state;
  if (material.kind === 1) return addUnitSquare(state, clampTile(add(material.at, { x: material.at.x < GRID_COLUMNS ? 1 : -1, y: 0 })));
  const bounds = gridBounds(material.vertices), shift = { x: bounds.maxX < GRID_COLUMNS ? 1 : bounds.minX >= 1 ? -1 : 0, y: bounds.maxY < GRID_ROWS ? 1 : bounds.minY >= 1 ? -1 : 0 };
  return addGridPolygon(state, material.vertices.map((point) => add(point, shift)));
}

export function removeGridMaterial(state: PlanarState): PlanarState {
  const material = gridMaterial(state);
  if (!material) return state;
  const params = { ...state.params }, points = { ...state.points };
  (material.kind === 0 ? GRID_POLYGON_PARAMS : ["kind"]).forEach((key) => { delete params[`${key}.${material.id}`]; });
  Object.keys(points).forEach((key) => { if (key === `tile.${material.id}` || key.startsWith(`v.${material.id}.`) || key.startsWith(`part.${material.id}.`)) delete points[key]; });
  params.active = gridMaterials(state).filter((object) => object.id !== material.id).at(-1)?.id ?? -1;
  return { ...state, params, points };
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
export function insertGridVertex(state: PlanarState, target: string): PlanarState {
  const parsed = parseGridTarget(target), material = parsed && gridMaterial(state, parsed.id);
  if (!parsed || parsed.type !== "edge" || !material || material.kind !== 0 || material.split || parsed.index! >= material.vertices.length || material.vertices.length >= 32
    || gridPolygons(state).reduce((total, polygon) => total + polygon.vertices.length, 0) >= MAX_GRID_VERTICES) return state;
  const index = parsed.index!, a = material.vertices[index], b = material.vertices[(index + 1) % material.vertices.length];
  let fraction = 0.5;
  if (isGeoboard(state)) { const steps = gcd(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); if (steps < 2) return state; fraction = Math.floor(steps / 2) / steps; }
  const vertices = [...material.vertices]; vertices.splice(index + 1, 0, { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
  return writePolygon({ ...state, params: { ...state.params, active: material.id } }, { ...material, vertices, base: material.base > index ? material.base + 1 : material.base, apex: material.apex > index ? material.apex + 1 : material.apex });
}

export function removeGridVertex(state: PlanarState, target: string): PlanarState {
  const parsed = parseGridTarget(target), material = parsed && gridMaterial(state, parsed.id);
  if (!parsed || parsed.type !== "vertex" || !material || material.kind !== 0 || material.split || material.vertices.length <= 3 || parsed.index! >= material.vertices.length) return state;
  const index = parsed.index!, vertices = material.vertices.filter((_, i) => i !== index);
  if (!isGridPolygon(vertices)) return state;
  const base = Math.min(material.base > index ? material.base - 1 : material.base, vertices.length - 1);
  return writePolygon({ ...state, params: { ...state.params, active: material.id } }, { ...material, vertices, base, apex: farthestVertex(vertices, base) });
}

export function separateGridPolygon(state: PlanarState): PlanarState {
  const material = gridMaterial(state);
  if (!isGeoboard(state) || !material || material.kind !== 0) return state;
  const triangles = gridTriangles(material.vertices);
  if (!triangles.length) return state;
  const bounds = gridBounds(material.vertices), center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  return writePolygon(state, { ...material, split: !material.split, offsets: material.split ? [] : triangles.map((triangle) => {
    const at = { x: triangle.reduce((sum, point) => sum + point.x, 0) / 3, y: triangle.reduce((sum, point) => sum + point.y, 0) / 3 }, length = Math.hypot(at.x - center.x, at.y - center.y);
    return length < GRID_EPSILON ? { x: 0, y: 0 } : { x: (at.x - center.x) / length * 0.7, y: (at.y - center.y) / length * 0.7 };
  }) });
}

export function interpolateGridSeparation(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress >= 1) return to;
  const before = gridMaterial(from), after = before && gridMaterial(to, before.id);
  if (!before || !after || before.kind !== 0 || after.kind !== 0) return from;
  const triangles = gridTriangles(before.vertices), p = clamp(progress, 0, 1);
  return writePolygon(from, { ...before, split: true, offsets: triangles.map((_, i) => {
    const a = before.offsets[i] ?? { x: 0, y: 0 }, b = after.offsets[i] ?? { x: 0, y: 0 };
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  }) });
}

export function setGridFlag(state: PlanarState, key: string, value = !state.flags[key]): PlanarState {
  if (!(GRID_FLAGS as readonly string[]).includes(key) || key === "grid" || state.flags[key] === value) return state;
  return { ...state, flags: { ...state.flags, [key]: value } };
}

export function setGridField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "unit") return Number.isInteger(value) && value >= 0 && value <= 2 ? { ...state, params: { ...state.params, unit: value } } : state;
  const material = gridMaterial(state);
  if (!material) return state;
  if (key === "x" || key === "y") {
    const next = isGeoboard(state) || state.flags.snap ? Math.round(value) : value;
    if (material.kind === 1) return { ...state, points: { ...state.points, [`tile.${material.id}`]: clampTile({ ...material.at, [key]: next }) } };
    const bounds = gridBounds(material.vertices), delta = { x: key === "x" ? next - bounds.minX : 0, y: key === "y" ? next - bounds.minY : 0 };
    return writePolygon(state, translatePolygon(material, delta));
  }
  if (material.kind !== 0 || (key !== "base" && key !== "apex")) return state;
  const index = clamp(Math.round(value) - 1, 0, material.vertices.length - 1);
  return writePolygon(state, { ...material, [key]: index, ...(key === "base" ? { apex: farthestVertex(material.vertices, index) } : {}) });
}

/** 40 舞台单位始终对应同一格边；cm 与 dm 只换读数，不改变任何材料点位。 */
export function gridUnits(state: PlanarState) {
  const unit = state.params.unit;
  return { length: unit === 2 ? "dm" : unit === 1 ? "cm" : "u", area: unit === 2 ? "dm²" : unit === 1 ? "cm²" : "u²", factor: unit === 2 ? 0.1 : 1, areaFactor: unit === 2 ? 0.01 : 1 };
}
