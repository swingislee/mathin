import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import {
  addConstruction, constructionCorners, constructionMeasurements, constructionObject, constructionObjects,
  createConstructionState, setConstructionField, type ConstructionObject,
} from "../plane-construction/model";
import { distance, polygonSegments, straightenBoundary, type Segment } from "../plane-geometry/model";

export const PERIMETER_SCENE_ID = "10-create";
/** 与共用构造网格对应；存档保留舞台坐标，教学读数使用 u。 */
export const PERIMETER_UNIT = 30;
export const MAX_PERIMETER_COMPARISONS = 2;
export type PerimeterProgress = "walk" | "straight";
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
  return syncPerimeterGeometry(state, setConstructionField(state, key, key === "width" || key === "height" ? value * PERIMETER_UNIT : value));
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
