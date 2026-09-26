import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { SHAPE_KINDS, shapeOutline } from "../plane-shapes/model";

export const MAX_CONSTRUCTION_OBJECTS = 16;
export const MAX_CONSTRUCTION_VERTICES = 192;
export const MAX_OBJECT_VERTICES = 32;
export const CONSTRUCTION_GRID = 30;
export const CONSTRUCTION_PRESETS = SHAPE_KINDS;
export type ConstructionTool = "rectangle" | "circle" | "ellipse" | "polygon";
export type ConstructionOperation = "translate" | "rotate" | "reflect";
export type ConstructionMatrix = [number, number, number, number, number, number];
export interface ConstructionObject {
  id: number;
  kind: 0 | 1 | 2 | 3;
  center: PlanarPoint;
  vertices: PlanarPoint[];
  angle: number;
  rx: number;
  ry: number;
  life: number;
  detail: number;
  flip: number;
  /** 仅连续变换的表现帧使用；保存校验拒绝对应 frame* 参数。 */
  basis?: [number, number, number, number];
}
export interface ConstructionTarget {
  type: "object" | "edge" | "vertex" | "boundary" | "pivot" | "axis" | "axis-handle" | "radius-x" | "radius-y";
  id?: number;
  part?: number;
}
export interface ConstructionBounds { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }

const EPS = 1e-7;
const PARAMS = ["kind", "count", "angle", "rx", "ry", "life", "detail", "flip"] as const;
const FLAG_KEYS = ["grid", "measures", "edges", "vertices", "names", "counts", "ghost", "edit", "snap"] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const radians = (angle: number) => angle * Math.PI / 180;
const finite = (value: number) => Number.isFinite(value);
const pointFinite = (point: PlanarPoint) => !!point && finite(point.x) && finite(point.y);
const distance = (a: PlanarPoint, b: PlanarPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: PlanarPoint, b: PlanarPoint, c: PlanarPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const add = (a: PlanarPoint, b: PlanarPoint) => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a: PlanarPoint, b: PlanarPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const midpoint = (a: PlanarPoint, b: PlanarPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const boundedCenter = (point: PlanarPoint) => ({ x: clamp(point.x, -1000, 2000), y: clamp(point.y, -1000, 1720) });
const inCenterRange = (point: PlanarPoint) => pointFinite(point) && point.x >= -1000 && point.x <= 2000 && point.y >= -1000 && point.y <= 1720;

export function constructionArea(vertices: readonly PlanarPoint[]): number {
  return Math.abs(vertices.reduce((sum, a, i) => { const b = vertices[(i + 1) % vertices.length]; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
}
function onSegment(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint) {
  return Math.abs(cross(a, b, point)) <= EPS && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS;
}
function segmentsMeet(a: PlanarPoint, b: PlanarPoint, c: PlanarPoint, d: PlanarPoint) {
  const first = cross(a, b, c), second = cross(a, b, d), third = cross(c, d, a), fourth = cross(c, d, b);
  return ((first > EPS && second < -EPS || first < -EPS && second > EPS) && (third > EPS && fourth < -EPS || third < -EPS && fourth > EPS))
    || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}

/** 共线中点可作为编辑控制点；重合、折返、穿越及退化轮廓都不成为合法材料。 */
export function isSimpleConstructionPolygon(vertices: readonly PlanarPoint[]): boolean {
  if (vertices.length < 3 || vertices.length > MAX_OBJECT_VERTICES || !vertices.every(pointFinite) || constructionArea(vertices) <= 1) return false;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], c = vertices[(i + 2) % vertices.length];
    if (distance(a, b) < 1) return false;
    if (Math.abs(cross(a, b, c)) <= EPS && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) return false;
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || i === 0 && j === vertices.length - 1) continue;
      if (segmentsMeet(a, b, vertices[j], vertices[(j + 1) % vertices.length])) return false;
    }
  }
  return true;
}

export function isConstructionRectangle(vertices: readonly PlanarPoint[]): boolean {
  if (vertices.length !== 4 || !isSimpleConstructionPolygon(vertices)) return false;
  const sides = vertices.map((point, i) => subtract(vertices[(i + 1) % 4], point));
  return sides.every((a, i) => {
    const b = sides[(i + 1) % 4];
    return Math.abs(a.x * b.x + a.y * b.y) <= 1e-6 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  }) && Math.hypot(sides[0].x + sides[2].x, sides[0].y + sides[2].y) <= 1e-6
    && Math.hypot(sides[1].x + sides[3].x, sides[1].y + sides[3].y) <= 1e-6;
}

export function isValidConstructionObject(object: ConstructionObject): boolean {
  if (!Number.isInteger(object.id) || object.id < 0 || object.id > 99998 || !Number.isInteger(object.kind) || object.kind < 0 || object.kind > 3 || !inCenterRange(object.center)) return false;
  if (!finite(object.angle) || Math.abs(object.angle) > 36000 || ![1, -1].includes(object.flip) || object.basis) return false;
  if (!Number.isInteger(object.life) || object.life < 0 || object.life > 5 || !finite(object.detail) || object.detail < 0 || object.detail > 1 || object.life === 0 && object.detail !== 0) return false;
  if (object.life === 1 && (object.kind !== 0 || object.vertices.length !== 3)
    || [2, 3].includes(object.life) && object.kind !== 1 || object.life === 4 && object.kind !== 2 || object.life === 5 && object.kind !== 3) return false;
  if (object.kind < 2) {
    return object.rx === 0 && object.ry === 0 && object.vertices.every((point) => pointFinite(point) && Math.abs(point.x) <= 800 && Math.abs(point.y) <= 800)
      && (object.kind === 1 ? isConstructionRectangle(object.vertices) : isSimpleConstructionPolygon(object.vertices));
  }
  return object.vertices.length === 0 && finite(object.rx) && finite(object.ry) && object.rx >= 6 && object.rx <= 350 && object.ry >= 6 && object.ry <= 350 && (object.kind !== 2 || object.rx === object.ry);
}

export function constructionObjects(state: PlanarState): ConstructionObject[] {
  return Object.keys(state.params).flatMap((key) => /^kind\.(0|[1-9]\d{0,4})$/.test(key) ? [Number(key.slice(5))] : []).sort((a, b) => a - b).map((id) => constructionObject(state, id)!).filter(Boolean);
}
export function constructionObject(state: PlanarState, id = state.params.active): ConstructionObject | null {
  const kind = state.params[`kind.${id}`];
  if (!Number.isInteger(id) || id < 0 || id > 99998 || kind === undefined) return null;
  const count = state.params[`count.${id}`], first = state.params[`frameA.${id}`];
  return { id, kind: kind as ConstructionObject["kind"], center: state.points[`center.${id}`],
    vertices: Array.from({ length: Number.isInteger(count) && count >= 0 && count <= MAX_OBJECT_VERTICES ? count : 0 }, (_, index) => state.points[`vertex.${id}.${index}`]),
    angle: state.params[`angle.${id}`], rx: state.params[`rx.${id}`], ry: state.params[`ry.${id}`], life: state.params[`life.${id}`], detail: state.params[`detail.${id}`], flip: state.params[`flip.${id}`],
    ...(first === undefined ? {} : { basis: [first, state.params[`frameB.${id}`], state.params[`frameC.${id}`], state.params[`frameD.${id}`]] as [number, number, number, number] }),
  };
}

export function constructionMatrix(object: ConstructionObject): ConstructionMatrix {
  const cos = Math.cos(radians(object.angle)), sin = Math.sin(radians(object.angle));
  const [a, b, c, d] = object.basis ?? [cos * object.flip, sin * object.flip, -sin, cos];
  return [a, b, c, d, object.center.x, object.center.y];
}
function applyMatrix(matrix: ConstructionMatrix, point: PlanarPoint): PlanarPoint {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}
export function worldVertices(object: ConstructionObject): PlanarPoint[] {
  const matrix = constructionMatrix(object);
  return object.vertices.map((point) => applyMatrix(matrix, point));
}
/** 边上加点是编辑控制点；只有真实转角才计作数学顶点，身份不随观察投影改变。 */
export function constructionCorners(object: ConstructionObject): { point: PlanarPoint; index: number }[] {
  const world = worldVertices(object), count = object.vertices.length;
  return object.vertices.flatMap((point, index) => Math.abs(cross(object.vertices[(index + count - 1) % count], point, object.vertices[(index + 1) % count])) > EPS ? [{ point: world[index], index }] : []);
}
function toLocal(object: ConstructionObject, point: PlanarPoint): PlanarPoint | null {
  const [a, b, c, d, x, y] = constructionMatrix(object), det = a * d - b * c;
  return Math.abs(det) < 1e-9 ? null : { x: (d * (point.x - x) - c * (point.y - y)) / det, y: (-b * (point.x - x) + a * (point.y - y)) / det };
}
function boundsOf(vertices: readonly PlanarPoint[]): ConstructionBounds {
  const minX = Math.min(...vertices.map((point) => point.x)), maxX = Math.max(...vertices.map((point) => point.x));
  const minY = Math.min(...vertices.map((point) => point.y)), maxY = Math.max(...vertices.map((point) => point.y));
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
export function constructionBounds(object: ConstructionObject): ConstructionBounds {
  if (object.kind < 2) return boundsOf(worldVertices(object));
  const [a, b, c, d] = constructionMatrix(object);
  const x = Math.hypot(a * object.rx, c * object.ry), y = Math.hypot(b * object.rx, d * object.ry);
  return { minX: object.center.x - x, maxX: object.center.x + x, minY: object.center.y - y, maxY: object.center.y + y, width: 2 * x, height: 2 * y };
}
export function constructionDimensions(object: ConstructionObject) {
  if (object.kind >= 2) return { width: 2 * object.rx, height: 2 * object.ry };
  if (object.kind === 1) return { width: distance(object.vertices[0], object.vertices[1]), height: distance(object.vertices[1], object.vertices[2]) };
  const { width, height } = boundsOf(object.vertices); return { width, height };
}
export function constructionMeasurements(object: ConstructionObject) {
  // 反射时的压扁是纸片的视角投影，材料本身的周长和面积不随投影改变。
  const material = { ...object, basis: undefined };
  const vertices = worldVertices(material), [a, b, c, d] = constructionMatrix(material);
  if (object.kind < 2) return { area: constructionArea(vertices), perimeter: vertices.reduce((sum, point, i) => sum + distance(point, vertices[(i + 1) % vertices.length]), 0), perimeterApproximate: false, straightEdges: constructionCorners(object).length, vertices: constructionCorners(object).length, curvedBoundary: false };
  const xx = (a * object.rx) ** 2 + (c * object.ry) ** 2, yy = (b * object.rx) ** 2 + (d * object.ry) ** 2, xy = a * b * object.rx ** 2 + c * d * object.ry ** 2;
  const root = Math.hypot(xx - yy, 2 * xy), rx = Math.sqrt(Math.max(0, (xx + yy + root) / 2)), ry = Math.sqrt(Math.max(0, (xx + yy - root) / 2));
  const same = Math.abs(rx - ry) < 1e-8, h = rx + ry ? ((rx - ry) / (rx + ry)) ** 2 : 0;
  const perimeter = same ? 2 * Math.PI * rx : ry < 1e-8 ? 4 * rx : Math.PI * (rx + ry) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
  return { area: Math.PI * object.rx * object.ry * Math.abs(a * d - b * c), perimeter, perimeterApproximate: !same, straightEdges: 0, vertices: 0, curvedBoundary: true };
}

/** 生活细节使用自己的规范坐标；缩放与反射后仍严格贴在同一轮廓里。 */
export function constructionLifeMatrix(object: ConstructionObject): ConstructionMatrix {
  const world = constructionMatrix(object);
  if (!object.life) return world;
  let local: ConstructionMatrix;
  if (object.kind >= 2) {
    const source = shapeOutline(object.life + 6);
    if (source.type === "polygon") return world;
    local = [object.rx / source.rx, 0, 0, object.ry / source.ry, 0, 0];
  } else {
    const source = shapeOutline(object.life + 6);
    if (source.type !== "polygon") return world;
    const ids = object.life === 1 ? [0, 1, 2] : [0, 1, 3];
    const [p, q, r] = ids.map((id) => source.vertices[id]), [u, v, w] = ids.map((id) => object.vertices[id]);
    const sx = q.x - p.x, sy = q.y - p.y, tx = r.x - p.x, ty = r.y - p.y, det = sx * ty - tx * sy;
    const ux = v.x - u.x, uy = v.y - u.y, vx = w.x - u.x, vy = w.y - u.y;
    const a = (ux * ty - vx * sy) / det, b = (uy * ty - vy * sy) / det, c = (-ux * tx + vx * sx) / det, d = (-uy * tx + vy * sx) / det;
    local = [a, b, c, d, u.x - a * p.x - c * p.y, u.y - b * p.x - d * p.y];
  }
  return [world[0] * local[0] + world[2] * local[1], world[1] * local[0] + world[3] * local[1], world[0] * local[2] + world[2] * local[3], world[1] * local[2] + world[3] * local[3], world[0] * local[4] + world[2] * local[5] + world[4], world[1] * local[4] + world[3] * local[5] + world[5]];
}

export function parseConstructionTarget(target: string): ConstructionTarget | null {
  if (["pivot", "axis", "axis-handle"].includes(target)) return { type: target as "pivot" | "axis" | "axis-handle" };
  const match = /^(object|boundary|radius-x|radius-y)\.(0|[1-9]\d{0,4})$|^(edge|vertex)\.(0|[1-9]\d{0,4})\.(0|[1-9]|[12]\d|3[01])$/.exec(target);
  if (!match) return null;
  const id = Number(match[2] ?? match[4]);
  if (id > 99998) return null;
  return match[1] ? { type: match[1] as ConstructionTarget["type"], id } : { type: match[3] as "edge" | "vertex", id, part: Number(match[5]) };
}

function writeObject(state: PlanarState, object: ConstructionObject): PlanarState {
  const points = { ...state.points };
  for (const key of Object.keys(points)) if (key.startsWith(`vertex.${object.id}.`)) delete points[key];
  points[`center.${object.id}`] = { ...object.center };
  object.vertices.forEach((point, index) => { points[`vertex.${object.id}.${index}`] = { ...point }; });
  return { ...state, points, params: { ...state.params,
    [`kind.${object.id}`]: object.kind, [`count.${object.id}`]: object.vertices.length, [`angle.${object.id}`]: object.angle,
    [`rx.${object.id}`]: object.rx, [`ry.${object.id}`]: object.ry, [`life.${object.id}`]: object.life, [`detail.${object.id}`]: object.detail, [`flip.${object.id}`]: object.flip,
  } };
}
function replaceObject(state: PlanarState, object: ConstructionObject): PlanarState {
  return isValidConstructionObject(object) && constructionObjects(state).filter((entry) => entry.id !== object.id).reduce((sum, entry) => sum + entry.vertices.length, object.vertices.length) <= MAX_CONSTRUCTION_VERTICES ? cleanVertexMarks(writeObject(state, object), object.id) : state;
}
function cleanVertexMarks(state: PlanarState, id: number): PlanarState {
  const object = constructionObject(state, id);
  if (!object) return state;
  const corners = new Set(constructionCorners(object).map((corner) => corner.index));
  return { ...state, marks: state.marks.filter((mark) => {
    const target = parseConstructionTarget(mark);
    return target?.type !== "vertex" || target.id !== id || corners.has(target.part!);
  }) };
}
function appendObject(state: PlanarState, object: Omit<ConstructionObject, "id">): PlanarState {
  const objects = constructionObjects(state), id = state.params.nextId;
  if (objects.length >= MAX_CONSTRUCTION_OBJECTS || id >= 99999 || objects.reduce((sum, entry) => sum + entry.vertices.length, object.vertices.length) > MAX_CONSTRUCTION_VERTICES || !isValidConstructionObject({ ...object, id })) return state;
  return writeObject({ ...state, params: { ...state.params, nextId: id + 1, active: id } }, { ...object, id });
}

export function createConstructionState(sceneId: "01-create" | "20-create"): PlanarState {
  const initial: PlanarState = { sceneId, params: { nextId: 1, active: 0, dx: 180, dy: 0, turn: 90, axisAngle: 90 }, points: { pivot: { x: 480, y: 360 }, axis: { x: 480, y: 360 } }, flags: Object.fromEntries(FLAG_KEYS.map((key) => [key, sceneId === "20-create" && key === "ghost"])), marks: [], phase: 0 };
  return writeObject(initial, { id: 0, kind: 1, center: { x: 380, y: 340 }, vertices: [{ x: -130, y: -84 }, { x: 130, y: -84 }, { x: 130, y: 84 }, { x: -130, y: 84 }], angle: 0, rx: 0, ry: 0, life: 0, detail: 0, flip: 1 });
}

function snapPoint(state: PlanarState, point: PlanarPoint): PlanarPoint {
  return state.flags.snap ? { x: Math.round(point.x / CONSTRUCTION_GRID) * CONSTRUCTION_GRID, y: Math.round(point.y / CONSTRUCTION_GRID) * CONSTRUCTION_GRID } : point;
}

/** 圆从圆心拖向圆周；矩形/椭圆由对角点定包围框；多边形按真实边界顺序闭合。 */
export function addConstruction(state: PlanarState, tool: ConstructionTool, input: readonly PlanarPoint[]): PlanarState {
  if (!input.every(pointFinite)) return state;
  let points = input.map((point) => snapPoint(state, point));
  if (tool === "polygon" && points.length > 3 && distance(points[0], points[points.length - 1]) < EPS) points = points.slice(0, -1);
  const base = { angle: 0, life: 0, detail: 0, flip: 1 };
  if (tool === "polygon") {
    if (!isSimpleConstructionPolygon(points)) return state;
    const bounds = boundsOf(points), center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    return appendObject(state, { ...base, kind: 0, center, vertices: points.map((point) => subtract(point, center)), rx: 0, ry: 0 });
  }
  if (points.length !== 2) return state;
  const [a, b] = points, center = midpoint(a, b), width = Math.abs(a.x - b.x), height = Math.abs(a.y - b.y);
  if (tool === "circle") {
    const radius = distance(a, b);
    return radius < 6 ? state : appendObject(state, { ...base, kind: 2, center: a, vertices: [], rx: Math.min(350, radius), ry: Math.min(350, radius) });
  }
  if (tool === "ellipse") return width < 12 || height < 12 ? state : appendObject(state, { ...base, kind: 3, center, vertices: [], rx: Math.min(350, width / 2), ry: Math.min(350, height / 2) });
  if (tool !== "rectangle") return state;
  return appendObject(state, { ...base, kind: 1, center, vertices: [{ x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 }, { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 }], rx: 0, ry: 0 });
}

export function addPreset(state: PlanarState, preset: number): PlanarState {
  if (!Number.isInteger(preset) || !CONSTRUCTION_PRESETS[preset]) return state;
  const outline = shapeOutline(preset), index = constructionObjects(state).length;
  const center = { x: 450 + (index % 3 - 1) * 95, y: 315 + (Math.floor(index / 3) % 3 - 1) * 80 };
  const life = preset >= 7 ? preset - 6 : 0;
  const base = { center, angle: 0, life, detail: life ? 1 : 0, flip: 1 };
  if (outline.type !== "polygon") return appendObject(state, { ...base, kind: outline.type === "circle" ? 2 : 3, vertices: [], rx: outline.rx, ry: outline.ry });
  return appendObject(state, { ...base, kind: [1, 2, 8, 9].includes(preset) ? 1 : 0, vertices: outline.vertices.map((point) => ({ ...point })), rx: 0, ry: 0 });
}

function targetObject(state: PlanarState, target: ConstructionTarget): ConstructionObject | null {
  if (target.id === undefined) return null;
  const object = constructionObject(state, target.id);
  if (!object) return null;
  if (["edge", "vertex"].includes(target.type) && (object.kind >= 2 || target.part === undefined || target.part >= object.vertices.length)) return null;
  if (["boundary", "radius-x", "radius-y"].includes(target.type) && object.kind < 2) return null;
  return object;
}

export function moveConstruction(state: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint): PlanarState {
  const parsed = parseConstructionTarget(target);
  if (!parsed || !pointFinite(point) || !pointFinite(delta)) return state;
  if (parsed.type === "pivot" || parsed.type === "axis") return { ...state, points: { ...state.points, [parsed.type]: boundedCenter(snapPoint(state, add(state.points[parsed.type], delta))) } };
  if (parsed.type === "axis-handle") {
    const direction = subtract(point, state.points.axis);
    return Math.hypot(direction.x, direction.y) < 1 ? state : { ...state, params: { ...state.params, axisAngle: Math.atan2(direction.y, direction.x) * 180 / Math.PI } };
  }
  const object = targetObject(state, parsed);
  if (!object) return state;
  const selected = { ...state, params: { ...state.params, active: object.id } };
  if (parsed.type === "object") return replaceObject(selected, { ...object, center: boundedCenter(snapPoint(state, add(object.center, delta))) });
  if (!state.flags.edit) return state;
  if (parsed.type === "vertex") {
    const local = toLocal(object, snapPoint(state, add(worldVertices(object)[parsed.part!], delta)));
    if (!local) return state;
    const vertices = object.vertices.map((vertex, index) => index === parsed.part ? { x: clamp(local.x, -800, 800), y: clamp(local.y, -800, 800) } : vertex);
    const candidate = { ...object, kind: 0 as const, life: 0, detail: 0, vertices };
    return isValidConstructionObject(candidate) ? replaceObject(selected, candidate) : state;
  }
  if (parsed.type === "radius-x" || parsed.type === "radius-y") {
    const localHandle = parsed.type === "radius-x" ? { x: object.rx, y: 0 } : { x: 0, y: object.ry };
    const local = toLocal(object, snapPoint(state, add(applyMatrix(constructionMatrix(object), localHandle), delta)));
    if (!local) return state;
    const radius = clamp(Math.abs(parsed.type === "radius-x" ? local.x : local.y), 6, 350);
    const candidate = object.kind === 2 ? { ...object, rx: radius, ry: radius } : { ...object, [parsed.type === "radius-x" ? "rx" : "ry"]: radius };
    return replaceObject(selected, candidate);
  }
  return state;
}

export function tapConstruction(state: PlanarState, target: string): PlanarState {
  const parsed = parseConstructionTarget(target);
  if (!parsed) return state;
  const object = targetObject(state, parsed);
  if (!object) return state;
  const selected = state.params.active === object.id ? state : { ...state, params: { ...state.params, active: object.id } };
  if (parsed.type === "vertex" && !constructionCorners(object).some((corner) => corner.index === parsed.part)) return selected;
  const observes = parsed.type === "vertex" ? state.flags.vertices : (parsed.type === "edge" || parsed.type === "boundary") && state.flags.edges;
  if (!observes) return selected;
  if (state.marks.includes(target)) return { ...selected, marks: state.marks.filter((mark) => mark !== target) };
  return state.marks.length >= 128 ? selected : { ...selected, marks: [...state.marks, target] };
}

function resizeConstruction(object: ConstructionObject, key: "width" | "height", value: number): ConstructionObject {
  if (object.kind >= 2) {
    const radius = clamp(value / 2, 6, 350);
    return object.kind === 2 ? { ...object, rx: radius, ry: radius } : { ...object, [key === "width" ? "rx" : "ry"]: radius };
  }
  const current = constructionDimensions(object), ratio = clamp(value, 1, 1600) / current[key];
  if (object.kind === 1) {
    const center = midpoint(object.vertices[0], object.vertices[2]), edge = key === "width" ? subtract(object.vertices[1], object.vertices[0]) : subtract(object.vertices[3], object.vertices[0]);
    const length = Math.hypot(edge.x, edge.y), ux = edge.x / length, uy = edge.y / length;
    return { ...object, vertices: object.vertices.map((point) => {
      const along = (point.x - center.x) * ux + (point.y - center.y) * uy;
      return { x: point.x + ux * along * (ratio - 1), y: point.y + uy * along * (ratio - 1) };
    }) };
  }
  const bounds = boundsOf(object.vertices), center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  return { ...object, vertices: object.vertices.map((point) => key === "width" ? { x: center.x + (point.x - center.x) * ratio, y: point.y } : { x: point.x, y: center.y + (point.y - center.y) * ratio }) };
}

export function setConstructionField(state: PlanarState, key: string, value: number): PlanarState {
  if (!finite(value)) return state;
  const ranges: Record<string, [number, number]> = { dx: [-600, 600], dy: [-600, 600], turn: [-360, 360], axisAngle: [-180, 180] };
  if (ranges[key]) return { ...state, params: { ...state.params, [key]: clamp(value, ...ranges[key]) } };
  const auxiliary = /^(pivot|axis)(X|Y)$/.exec(key);
  if (auxiliary) {
    const coordinate = auxiliary[2] === "X" ? "x" : "y";
    return { ...state, points: { ...state.points, [auxiliary[1]]: { ...state.points[auxiliary[1]], [coordinate]: clamp(value, -1000, coordinate === "x" ? 2000 : 1720) } } };
  }
  const object = constructionObject(state);
  if (!object) return state;
  if (key === "width" || key === "height") return replaceObject(state, resizeConstruction(object, key, value));
  if (key === "rx" || key === "ry") return object.kind < 2 ? state : replaceObject(state, resizeConstruction(object, key === "rx" ? "width" : "height", value * 2));
  if (key === "angle") return replaceObject(state, { ...object, angle: clamp(value, -36000, 36000) });
  if (key === "detail") return object.life ? replaceObject(state, { ...object, detail: clamp(value, 0, 1) }) : state;
  if (key === "centerX" || key === "centerY") return replaceObject(state, { ...object, center: { ...object.center, [key === "centerX" ? "x" : "y"]: clamp(value, -1000, key === "centerX" ? 2000 : 1720) } });
  return state;
}

export function toggleConstructionFlag(state: PlanarState, key: string, value = !state.flags[key]): PlanarState {
  return (FLAG_KEYS as readonly string[]).includes(key) ? { ...state, flags: { ...state.flags, [key]: value } } : state;
}

export function duplicateConstruction(state: PlanarState): PlanarState {
  const object = constructionObject(state);
  if (!object) return state;
  let center = boundedCenter(add(object.center, { x: 45, y: 45 }));
  if (distance(center, object.center) < 20) center = boundedCenter(add(object.center, { x: -45, y: -45 }));
  return appendObject(state, { ...object, center });
}

export function removeConstruction(state: PlanarState): PlanarState {
  const object = constructionObject(state);
  if (!object) return state;
  const params = { ...state.params }, points = { ...state.points };
  PARAMS.forEach((key) => { delete params[`${key}.${object.id}`]; });
  Object.keys(points).forEach((key) => { if (key === `center.${object.id}` || key.startsWith(`vertex.${object.id}.`)) delete points[key]; });
  params.active = constructionObjects(state).find((candidate) => candidate.id !== object.id)?.id ?? -1;
  return { ...state, params, points, marks: state.marks.filter((mark) => parseConstructionTarget(mark)?.id !== object.id) };
}

export function insertConstructionVertex(state: PlanarState, target: string): PlanarState {
  const parsed = parseConstructionTarget(target);
  if (!state.flags.edit || !parsed || parsed.type !== "edge") return state;
  const object = targetObject(state, parsed);
  if (!object || object.vertices.length >= MAX_OBJECT_VERTICES) return state;
  const index = parsed.part!, vertices = [...object.vertices];
  vertices.splice(index + 1, 0, midpoint(vertices[index], vertices[(index + 1) % vertices.length]));
  const next = replaceObject(state, { ...object, kind: 0, life: 0, detail: 0, vertices });
  if (next === state) return state;
  const marks = state.marks.flatMap((mark) => {
    const part = parseConstructionTarget(mark)!;
    if (part.id !== object.id || part.part === undefined) return [mark];
    if (part.type === "edge" && part.part === index) return [`edge.${object.id}.${index}`, `edge.${object.id}.${index + 1}`];
    return [`${part.type}.${object.id}.${part.part > index ? part.part + 1 : part.part}`];
  });
  return cleanVertexMarks({ ...next, params: { ...next.params, active: object.id }, marks: [...new Set(marks)].slice(0, 128) }, object.id);
}

export function removeConstructionVertex(state: PlanarState, target: string): PlanarState {
  const parsed = parseConstructionTarget(target);
  if (!state.flags.edit || !parsed || parsed.type !== "vertex") return state;
  const object = targetObject(state, parsed);
  if (!object || object.vertices.length <= 3) return state;
  const index = parsed.part!, previous = (index + object.vertices.length - 1) % object.vertices.length;
  const vertices = object.vertices.filter((_, i) => i !== index);
  const next = replaceObject(state, { ...object, kind: 0, life: 0, detail: 0, vertices });
  if (next === state) return state;
  return cleanVertexMarks({ ...next, params: { ...next.params, active: object.id }, marks: state.marks.flatMap((mark) => {
    const part = parseConstructionTarget(mark)!;
    if (part.id !== object.id || part.part === undefined) return [mark];
    if (part.type === "vertex" && part.part === index || part.type === "edge" && (part.part === index || part.part === previous)) return [];
    return [`${part.type}.${object.id}.${part.part > index ? part.part - 1 : part.part}`];
  }) }, object.id);
}

function rotatePoint(point: PlanarPoint, pivot: PlanarPoint, angle: number): PlanarPoint {
  const cos = Math.cos(radians(angle)), sin = Math.sin(radians(angle)), x = point.x - pivot.x, y = point.y - pivot.y;
  return { x: pivot.x + x * cos - y * sin, y: pivot.y + x * sin + y * cos };
}
function projectionBasis(angle: number, factor: number): [number, number, number, number] {
  const ux = Math.cos(radians(angle)), uy = Math.sin(radians(angle));
  return [ux * ux + factor * uy * uy, (1 - factor) * ux * uy, (1 - factor) * ux * uy, uy * uy + factor * ux * ux];
}
function projectPoint(point: PlanarPoint, axis: PlanarPoint, angle: number, factor: number): PlanarPoint {
  const [a, b, c, d] = projectionBasis(angle, factor), p = subtract(point, axis);
  return { x: axis.x + a * p.x + c * p.y, y: axis.y + b * p.x + d * p.y };
}
const boundedEquivalentAngle = (angle: number) => Math.abs(angle) <= 36000 ? angle : ((angle % 360) + 540) % 360 - 180;

export function transformConstruction(state: PlanarState, operation: ConstructionOperation): PlanarState {
  const object = constructionObject(state);
  if (!object) return state;
  if (operation === "translate") return replaceObject(state, { ...object, center: add(object.center, { x: state.params.dx, y: state.params.dy }) });
  if (operation === "rotate") return replaceObject(state, { ...object, center: rotatePoint(object.center, state.points.pivot, state.params.turn), angle: boundedEquivalentAngle(object.angle + state.params.turn) });
  if (operation === "reflect") return replaceObject(state, { ...object, center: projectPoint(object.center, state.points.axis, state.params.axisAngle, -1), angle: boundedEquivalentAngle(2 * state.params.axisAngle - object.angle + 180), flip: -object.flip });
  return state;
}

/** 旋转沿圆弧；反射沿真实轴的法向投影。frame* 基只在中间帧，准确终点始终是合法对象。 */
export function interpolateConstruction(from: PlanarState, to: PlanarState, progress: number, operation: ConstructionOperation): PlanarState {
  const t = finite(progress) ? clamp(progress, 0, 1) : 0;
  if (t <= 0 || from === to) return from;
  if (t >= 1) return to;
  const before = constructionObject(from), after = before ? constructionObject(to, before.id) : null;
  if (!before || !after) return t < 1 ? from : to;
  if (JSON.stringify(before) === JSON.stringify(after)) return from;
  if (operation === "translate") return writeObject(from, { ...before, center: { x: lerp(before.center.x, after.center.x, t), y: lerp(before.center.y, after.center.y, t) } });
  if (operation === "rotate") return writeObject(from, { ...before, center: rotatePoint(before.center, from.points.pivot, from.params.turn * t), angle: before.angle + from.params.turn * t });
  if (operation !== "reflect") return from;
  const factor = Math.cos(Math.PI * t), center = projectPoint(before.center, from.points.axis, from.params.axisAngle, factor);
  const [pa, pb, pc, pd] = projectionBasis(from.params.axisAngle, factor), [a, b, c, d] = constructionMatrix(before);
  const frame = writeObject(from, { ...before, center });
  return { ...frame, params: { ...frame.params, [`frameA.${before.id}`]: pa * a + pc * b, [`frameB.${before.id}`]: pb * a + pd * b, [`frameC.${before.id}`]: pa * c + pc * d, [`frameD.${before.id}`]: pb * c + pd * d } };
}
