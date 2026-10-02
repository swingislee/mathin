import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import {
  addConstruction, constructionCorners, constructionMatrix, constructionMeasurements, constructionObject, constructionObjects,
  createConstructionState, isConstructionRectangle, isValidConstructionObject, setConstructionField, type ConstructionObject,
} from "../plane-construction/model";
import { distance, polygonSegments, straightenBoundary, type Segment } from "../plane-geometry/model";

export const PERIMETER_SCENE_ID = "10-create";
/** 与共用构造网格对应；存档保留舞台坐标，教学读数使用 u。 */
export const PERIMETER_UNIT = 30;
export const MAX_PERIMETER_COMPARISONS = 2;
export type PerimeterProgress = "walk" | "straight";
export type PerimeterInvariant = "perimeter" | "area";
export type RectangleDimension = "width" | "height";
const MIN_RECTANGLE_SIDE = 1;
const MAX_RECTANGLE_SIDE = 1600;
const progressKey = /^(walk|straight)\./;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function shapeSignature(object: ConstructionObject) {
  return JSON.stringify([object.kind, object.vertices, object.rx, object.ry]);
}

/** 复用构造动作的同一终点；形状改变才重置该材料的演示，刚体搬动保留进度。 */
export function syncPerimeterGeometry(before: PlanarState | null, after: PlanarState): PlanarState {
  if (before === after) return after;
  const params = Object.fromEntries(Object.entries(after.params).filter(([key]) => !progressKey.test(key)));
  for (const object of constructionObjects(after)) {
    const previous = before ? constructionObject(before, object.id) : null;
    const preserved = previous && shapeSignature(previous) === shapeSignature(object);
    for (const kind of ["walk", "straight"] as const) {
      params[`${kind}.${object.id}`] = preserved ? before!.params[`${kind}.${object.id}`] : 0;
    }
  }
  return { ...after, params };
}

export function createPerimeterState(): PlanarState {
  let state = createConstructionState(PERIMETER_SCENE_ID);
  state = setConstructionField(state, "width", 180);
  state = setConstructionField(state, "height", 120);
  state = setConstructionField(state, "centerY", 270);
  return syncPerimeterGeometry(null, state);
}

export function setPerimeterProgress(state: PlanarState, kind: PerimeterProgress, value: number): PlanarState {
  const object = constructionObject(state);
  if (!object || !Number.isFinite(value)) return state;
  const key = `${kind}.${object.id}`, next = clamp(value);
  return state.params[key] === next ? state : { ...state, params: { ...state.params, [key]: next } };
}

export function setPerimeterField(state: PlanarState, key: string, value: number): PlanarState {
  if (key === "walk" || key === "straight") return setPerimeterProgress(state, key, value / 100);
  const invariantField = /^(perimeter|area)-(width|height)$/.exec(key);
  if (invariantField) return deformPerimeterRectangle(state, invariantField[1] as PerimeterInvariant, invariantField[2] as RectangleDimension, value * PERIMETER_UNIT);
  return syncPerimeterGeometry(state, setConstructionField(state, key, key === "width" || key === "height" ? value * PERIMETER_UNIT : value));
}

/** 约束针对实际矩形的两条边，包含旋转过或以多边形绘制的矩形。 */
export function perimeterRectangle(state: PlanarState, id = state.params.active) {
  const object = constructionObject(state, id);
  if (!object || object.kind > 1 || object.basis || !isConstructionRectangle(object.vertices)) return null;
  const [a, b, c, d] = object.vertices;
  const width = distance(a, b), height = distance(a, d);
  const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  const u = { x: (b.x - a.x) / width, y: (b.y - a.y) / width };
  const v = { x: (d.x - a.x) / height, y: (d.y - a.y) / height };
  return { object, width, height, center, u, v };
}

/** 同时求解两条边再原子替换几何；网格与数值舍入不改变指定的不变量。 */
export function deformPerimeterRectangle(state: PlanarState, invariant: PerimeterInvariant, dimension: RectangleDimension, value: number, id = state.params.active): PlanarState {
  const rectangle = perimeterRectangle(state, id);
  if (!rectangle || !Number.isFinite(value) || !["perimeter", "area"].includes(invariant) || !["width", "height"].includes(dimension)) return state;
  const { object, width, height, center, u, v } = rectangle;
  const amount = invariant === "perimeter" ? width + height : width * height;
  const low = invariant === "perimeter" ? Math.max(MIN_RECTANGLE_SIDE, amount - MAX_RECTANGLE_SIDE) : Math.max(MIN_RECTANGLE_SIDE, amount / MAX_RECTANGLE_SIDE);
  const high = invariant === "perimeter" ? Math.min(MAX_RECTANGLE_SIDE, amount - MIN_RECTANGLE_SIDE) : Math.min(MAX_RECTANGLE_SIDE, amount / MIN_RECTANGLE_SIDE);
  if (low > high) return state;
  const chosen = Math.max(low, Math.min(high, value));
  const other = invariant === "perimeter" ? amount - chosen : amount / chosen;
  const nextWidth = dimension === "width" ? chosen : other, nextHeight = dimension === "height" ? chosen : other;
  if (Math.abs(nextWidth - width) < 1e-9 && Math.abs(nextHeight - height) < 1e-9) return state;
  const vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
    x: center.x + x * u.x * nextWidth / 2 + y * v.x * nextHeight / 2,
    y: center.y + x * u.y * nextWidth / 2 + y * v.y * nextHeight / 2,
  }));
  if (!isValidConstructionObject({ ...object, vertices })) return state;
  const points = { ...state.points };
  vertices.forEach((point, index) => { points[`vertex.${id}.${index}`] = point; });
  return syncPerimeterGeometry(state, { ...state, params: { ...state.params, active: id }, points });
}

export function squarePerimeterRectangle(state: PlanarState, invariant: PerimeterInvariant): PlanarState {
  const rectangle = perimeterRectangle(state);
  return rectangle ? deformPerimeterRectangle(state, invariant, "width", invariant === "perimeter"
    ? (rectangle.width + rectangle.height) / 2 : Math.sqrt(rectangle.width * rectangle.height)) : state;
}

/** 定面积过程不能线性插值两条边：每一帧从同一不变量重新求解。 */
export function interpolatePerimeterInvariant(from: PlanarState, to: PlanarState, progress: number, invariant: PerimeterInvariant): PlanarState {
  if (progress >= 1) return to;
  if (progress <= 0) return from;
  const before = perimeterRectangle(from), after = before ? perimeterRectangle(to, before.object.id) : null;
  return before && after ? deformPerimeterRectangle(from, invariant, "width", before.width + (after.width - before.width) * progress) : from;
}

export function parsePerimeterHandle(target: string) {
  const match = /^invariant\.(perimeter|area)\.(width|height)\.(0|[1-9]\d{0,4})$/.exec(target);
  return match && Number(match[3]) <= 99998 ? { invariant: match[1] as PerimeterInvariant, dimension: match[2] as RectangleDimension, id: Number(match[3]) } : null;
}

export function perimeterInvariantHandle(state: PlanarState, dimension: RectangleDimension, id = state.params.active) {
  const rectangle = perimeterRectangle(state, id);
  if (!rectangle) return null;
  const { object, center } = rectangle, direction = dimension === "width" ? rectangle.u : rectangle.v;
  const local = { x: center.x + direction.x * rectangle[dimension] / 2, y: center.y + direction.y * rectangle[dimension] / 2 };
  const [a, b, c, d, x, y] = constructionMatrix(object);
  return { at: { x: a * local.x + c * local.y + x, y: b * local.x + d * local.y + y }, direction: { x: a * direction.x + c * direction.y, y: b * direction.x + d * direction.y } };
}

/** 起拖矩形和方向冻结；柄沿真实边方向变化，矩形中心保持不动。 */
export function dragPerimeterInvariant(state: PlanarState, target: string, delta: PlanarPoint): PlanarState {
  const parsed = parsePerimeterHandle(target);
  if (!parsed || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return state;
  const rectangle = perimeterRectangle(state, parsed.id), handle = perimeterInvariantHandle(state, parsed.dimension, parsed.id);
  return rectangle && handle ? deformPerimeterRectangle(state, parsed.invariant, parsed.dimension,
    rectangle[parsed.dimension] + 2 * (delta.x * handle.direction.x + delta.y * handle.direction.y), parsed.id) : state;
}

export function createPerimeterGeometry(state: PlanarState, tool: string, points: readonly PlanarPoint[]): PlanarState | null {
  if (tool !== "rectangle" && tool !== "polygon") return null;
  const next = addConstruction(state, tool, points);
  return next === state ? null : syncPerimeterGeometry(state, next);
}

/** 共线编辑点不拆出新的数学边；真实转角、长度与方向沿用材料。 */
export function perimeterVertices(object: ConstructionObject): PlanarPoint[] {
  return constructionCorners(object).map((corner) => corner.point);
}

export function perimeterLength(object: ConstructionObject): number {
  return constructionMeasurements(object).perimeter;
}

export function walkPerimeter(object: ConstructionObject, progress: number) {
  const vertices = perimeterVertices(object), boundary = polygonSegments(vertices);
  const total = perimeterLength(object), length = clamp(progress) * total;
  let remaining = length, cursor = vertices[0];
  const segments: Segment[] = [];
  for (const edge of boundary) {
    const edgeLength = distance(edge.a, edge.b), covered = Math.min(edgeLength, Math.max(0, remaining));
    if (covered > 0) {
      cursor = { x: edge.a.x + (edge.b.x - edge.a.x) * covered / edgeLength, y: edge.a.y + (edge.b.y - edge.a.y) * covered / edgeLength };
      segments.push({ a: edge.a, b: cursor });
    }
    remaining -= edgeLength;
  }
  return { segments, cursor, length, total };
}

function copyVertices(object: ConstructionObject): PlanarPoint[] {
  const vertices = perimeterVertices(object);
  const minX = Math.min(...vertices.map((point) => point.x)), minY = Math.min(...vertices.map((point) => point.y));
  return vertices.map((point) => ({ x: point.x - minX, y: point.y - minY }));
}

/** 比较区只搬运边界副本，任一中间帧仍是相同长度的刚性线段。 */
export function straightenPerimeter(object: ConstructionObject, progress: number): Segment[] {
  const vertices = copyVertices(object), bottom = Math.max(...vertices.map((point) => point.y));
  return straightenBoundary(vertices, { x: 0, y: bottom }, progress);
}

/** 最多显示当前材料和另一份已开启的边界；其他材料及进度继续保存。 */
export function perimeterComparison(state: PlanarState, includeActive = false) {
  const all = constructionObjects(state), started = all.filter((object) => state.params[`straight.${object.id}`] > 0);
  const active = constructionObject(state);
  const candidates = active && (includeActive || started.length > 0)
    ? [active, ...started.filter((object) => object.id !== active.id)] : started;
  const objects = candidates.slice(0, MAX_PERIMETER_COMPARISONS);
  if (!objects.length) return null;
  // 此范围仅用于表现层排版；同一比例尺覆盖所有材料及整个搬边过程，不逐帧或逐对象 fit。
  const samples = 64, bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let longestEdge = 0;
  for (const object of objects) {
    longestEdge = Math.max(longestEdge, ...polygonSegments(perimeterVertices(object)).map((edge) => distance(edge.a, edge.b)));
    for (let index = 0; index <= samples; index++) for (const segment of straightenPerimeter(object, index / samples)) {
      for (const point of [segment.a, segment.b]) {
        bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
      }
    }
  }
  // 端点的二阶导数上界为 Lπ²；采样之间极值的误差界为该值 / (8N²)。
  const margin = 1 + longestEdge * Math.PI ** 2 / (8 * samples ** 2);
  bounds.minX -= margin; bounds.maxX += margin; bounds.minY -= margin; bounds.maxY += margin;
  const rowHeight = 190 / objects.length;
  const scale = Math.min(1, 700 / (bounds.maxX - bounds.minX), (rowHeight - 26) / (bounds.maxY - bounds.minY));
  return {
    bounds, scale, rowHeight, hiddenCount: candidates.length - objects.length,
    entries: objects.map((object) => ({ object, vertices: copyVertices(object), segments: straightenPerimeter(object, state.params[`straight.${object.id}`]) })),
  };
}
