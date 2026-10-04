import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { constructionCorners, constructionMatrix, constructionObject, isValidConstructionObject, parseConstructionTarget, type ConstructionObject } from "../plane-construction/model";
import { syncPerimeterGeometry, type PerimeterInvariant } from "./model";

// 与构造模型的共线／接触判定保持一致；根同时覆盖两侧阈值，避免越过极窄禁区。
const CONTACT_EPS = 1e-7;
const TAU = 2 * Math.PI;
const dot = (a: PlanarPoint, b: PlanarPoint) => a.x * b.x + a.y * b.y;
const minus = (a: PlanarPoint, b: PlanarPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const length = (point: PlanarPoint) => Math.hypot(point.x, point.y);
const finite = (point: PlanarPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const cross = (a: PlanarPoint, b: PlanarPoint) => a.x * b.y - a.y * b.x;
const signedDoubleArea = (vertices: readonly PlanarPoint[]) => vertices.reduce((sum, point, index) => sum + cross(point, vertices[(index + 1) % vertices.length]), 0);

type VertexLocus = {
  kind: "line"; origin: PlanarPoint; u: PlanarPoint;
} | {
  kind: "ellipse"; origin: PlanarPoint; u: PlanarPoint; v: PlanarPoint;
  major: number; minor: number; focal: number;
};

export function parsePerimeterVertexHandle(target: string) {
  const match = /^invariant-vertex\.(perimeter|area)\.(0|[1-9]\d{0,4})\.(0|[1-9]|[12]\d|3[01])$/.exec(target);
  return match && Number(match[2]) <= 99998 ? { invariant: match[1] as PerimeterInvariant, id: Number(match[2]), index: Number(match[3]) } : null;
}

export function perimeterVertexObject(state: PlanarState, id = state.params.active) {
  const object = constructionObject(state, id);
  return object && object.kind < 2 && isValidConstructionObject(object) ? object : null;
}

function vertexLocus(object: ConstructionObject, index: number, invariant: PerimeterInvariant): VertexLocus | null {
  const vertices = object.vertices, point = vertices[index];
  const a = vertices[(index + vertices.length - 1) % vertices.length], b = vertices[(index + 1) % vertices.length];
  const diagonal = minus(b, a), span = length(diagonal);
  if (!span) return null;
  const u = { x: diagonal.x / span, y: diagonal.y / span };
  if (invariant === "area") return { kind: "line", origin: point, u };
  const major = (length(minus(point, a)) + length(minus(point, b))) / 2, focal = span / 2;
  const minorSquared = (major - focal) * (major + focal);
  // 共线编辑点的两邻边长度和已达到最小值，只能在两邻点之间移动。
  if (minorSquared <= 0) return Math.abs(cross(diagonal, minus(point, a))) <= CONTACT_EPS ? { kind: "line", origin: point, u } : null;
  return { kind: "ellipse", origin: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, u, v: { x: -u.y, y: u.x }, major, minor: Math.sqrt(minorSquared), focal };
}

function at(locus: VertexLocus, parameter: number): PlanarPoint {
  if (locus.kind === "line") return { x: locus.origin.x + locus.u.x * parameter, y: locus.origin.y + locus.u.y * parameter };
  const x = locus.major * Math.cos(parameter), y = locus.minor * Math.sin(parameter);
  return { x: locus.origin.x + locus.u.x * x + locus.v.x * y, y: locus.origin.y + locus.u.y * x + locus.v.y * y };
}

function project(locus: VertexLocus, point: PlanarPoint, fallback: number): number {
  const delta = minus(point, locus.origin);
  if (locus.kind === "line") return dot(delta, locus.u);
  const x = dot(delta, locus.u) / locus.major, y = dot(delta, locus.v) / locus.minor;
  // 归一化后径向投影到真实椭圆；中心没有唯一方向，保留上一合法位置。
  return Math.hypot(x, y) < 1e-12 ? fallback : Math.atan2(y, x);
}

function eventParameters(locus: VertexLocus, object: ConstructionObject, index: number, from: number, to: number) {
  const low = Math.min(from, to), high = Math.max(from, to), events = [from, to];
  const add = (value: number) => { if (Number.isFinite(value) && value > low && value < high) events.push(value); };
  const addAngle = (value: number) => {
    for (let turn = Math.ceil((low - value) / TAU); turn <= Math.floor((high - value) / TAU); turn++) add(value + turn * TAU);
  };
  const linear = (normal: PlanarPoint, value: number) => {
    const constant = dot(normal, locus.origin), along = dot(normal, locus.u);
    if (locus.kind === "line") { if (along !== 0) add((value - constant) / along); return; }
    const x = along * locus.major, y = dot(normal, locus.v) * locus.minor, radius = Math.hypot(x, y);
    if (!radius) return;
    const ratio = (value - constant) / radius;
    if (ratio < -1 || ratio > 1) return;
    const phase = Math.atan2(y, x), offset = Math.acos(Math.max(-1, Math.min(1, ratio)));
    addAngle(phase - offset); addAngle(phase + offset);
  };
  const line = (a: PlanarPoint, b: PlanarPoint) => {
    const normal = { x: a.y - b.y, y: b.x - a.x }, value = dot(normal, a);
    for (const offset of [-CONTACT_EPS, 0, CONTACT_EPS]) linear(normal, value + offset);
  };
  const circleOnLine = (center: PlanarPoint, radius: number) => {
    if (locus.kind !== "line") return;
    const delta = minus(locus.origin, center), projection = dot(delta, locus.u);
    // 使用垂距避免大坐标下相减损失：根对应轨迹与限制圆的交点。
    const perpendicular = cross(delta, locus.u), discriminant = radius * radius - perpendicular * perpendicular;
    if (discriminant < 0) return;
    const offset = Math.sqrt(discriminant); add(-projection - offset); add(-projection + offset);
  };
  const vertices = object.vertices, count = vertices.length;
  const previousIndex = (index + count - 1) % count, nextIndex = (index + 1) % count;
  const a = vertices[previousIndex], b = vertices[nextIndex];
  for (const edge of ["x", "y"] as const) {
    const normal = edge === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 };
    linear(normal, -800); linear(normal, 800);
    // onSegment 的端点包围盒也带 EPS；它的真假只能在这些坐标事件处改变。
    vertices.forEach((vertex, ordinal) => { if (ordinal !== index) for (const offset of [-CONTACT_EPS, 0, CONTACT_EPS]) linear(normal, vertex[edge] + offset); });
  }
  line(a, b);
  vertices.forEach((c, edge) => {
    if (edge === index || edge === previousIndex) return;
    const d = vertices[(edge + 1) % count];
    // 两条移动边与每条固定边相交的四个方向判定中，所有含活动点的项。
    line(c, d); line(a, c); line(a, d); line(b, c); line(b, d);
  });
  const beforeA = vertices[(index + count - 2) % count], afterB = vertices[(index + 2) % count];
  const incoming = minus(a, beforeA), outgoing = minus(afterB, b);
  linear(incoming, dot(incoming, a)); linear(outgoing, dot(outgoing, b));
  if (locus.kind === "line") {
    circleOnLine(a, 1); circleOnLine(b, 1);
    circleOnLine({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, length(minus(b, a)) / 2);
  } else {
    // 到两焦点的距离分别为 major ± focal*cos(t)。
    for (const cosine of [(1 - locus.major) / locus.focal, (locus.major - 1) / locus.focal]) if (Math.abs(cosine) <= 1) {
      const angle = Math.acos(cosine); addAngle(angle); addAngle(-angle);
    }
    // 中间三点发生折返时的点积零点；其余两处点积为上面的线性事件。
    const square = 2 - (locus.major / locus.focal) ** 2;
    if (square >= 0 && square <= 1) for (const cosine of [-Math.sqrt(square), Math.sqrt(square)]) {
      const angle = Math.acos(cosine); addAngle(angle); addAngle(-angle);
    }
  }
  const areaNormal = { x: b.y - a.y, y: a.x - b.x };
  const area = signedDoubleArea(vertices), constantArea = area - dot(areaNormal, vertices[index]);
  linear(areaNormal, 2 * Math.sign(area) - constantArea);
  return events.sort((left, right) => from < to ? left - right : right - left);
}

/** 每个解析事件之间，全部几何谓词保持真假；同时检查事件本身，切点也不能穿越。 */
function reachableParameter(locus: VertexLocus, object: ConstructionObject, index: number, from: number, to: number) {
  const orientation = Math.sign(signedDoubleArea(object.vertices));
  const valid = (parameter: number) => {
    const vertices = object.vertices.map((point, ordinal) => ordinal === index ? at(locus, parameter) : point);
    return signedDoubleArea(vertices) * orientation > 2 && isValidConstructionObject({ ...object, kind: 0, life: 0, detail: 0, vertices });
  };
  if (from === to || !valid(from)) return from;
  let safe = from;
  for (const event of eventParameters(locus, object, index, from, to).slice(1)) {
    for (const probe of [(safe + event) / 2, event]) {
      if (valid(probe)) { safe = probe; continue; }
      let blocked = probe;
      for (let iteration = 0; iteration < 56; iteration++) {
        const middle = (safe + blocked) / 2;
        if (valid(middle)) safe = middle; else blocked = middle;
      }
      const speed = locus.kind === "line" ? 1 : locus.major;
      const inset = Math.min(Math.abs(safe - from), 1e-8 / speed);
      const result = safe - Math.sign(to - from) * inset;
      return valid(result) ? result : from;
    }
  }
  return safe;
}

function compatiblePrevious(object: ConstructionObject, previous: ConstructionObject | null, index: number, invariant: PerimeterInvariant) {
  if (!previous || !isValidConstructionObject(previous) || previous.vertices.length !== object.vertices.length
    || previous.angle !== object.angle || previous.flip !== object.flip || previous.center.x !== object.center.x || previous.center.y !== object.center.y
    || previous.vertices.some((point, ordinal) => ordinal !== index && (point.x !== object.vertices[ordinal].x || point.y !== object.vertices[ordinal].y))) return false;
  if (invariant === "area") return Math.abs(signedDoubleArea(previous.vertices) - signedDoubleArea(object.vertices)) < 1e-6;
  const a = object.vertices[(index + object.vertices.length - 1) % object.vertices.length], b = object.vertices[(index + 1) % object.vertices.length];
  const sum = (point: PlanarPoint) => length(minus(point, a)) + length(minus(point, b));
  return Math.abs(sum(previous.vertices[index]) - sum(object.vertices[index])) < 1e-7;
}

/** localTarget 只提供期望位置；量与固定点始终取自同一起拖几何，previous 只决定连续行进方向。 */
export function movePerimeterVertex(state: PlanarState, invariant: PerimeterInvariant, index: number, localTarget: PlanarPoint, id = state.params.active, previous?: PlanarState): PlanarState {
  if (!finite(localTarget) || !["area", "perimeter"].includes(invariant) || !Number.isInteger(index)) return state;
  const object = perimeterVertexObject(state, id);
  if (!object || index < 0 || index >= object.vertices.length) return state;
  const locus = vertexLocus(object, index, invariant);
  if (!locus) return state;
  const old = previous ? constructionObject(previous, id) : null;
  const anchor = compatiblePrevious(object, old, index, invariant) ? old!.vertices[index] : object.vertices[index];
  const original = project(locus, object.vertices[index], 0), from = project(locus, anchor, original);
  let target = project(locus, localTarget, from);
  if (!Number.isFinite(target)) return state;
  if (locus.kind === "ellipse") target = from + Math.atan2(Math.sin(target - from), Math.cos(target - from));
  const parameter = reachableParameter(locus, object, index, from, target), point = at(locus, parameter);
  if (length(minus(point, object.vertices[index])) < 1e-9) return state;
  const vertices = object.vertices.map((vertex, ordinal) => ordinal === index ? point : vertex);
  const candidate = { ...object, kind: 0 as const, life: 0, detail: 0, vertices };
  if (!isValidConstructionObject(candidate)) return state;
  const corners = new Set(constructionCorners(candidate).map((corner) => corner.index));
  return syncPerimeterGeometry(state, { ...state,
    params: { ...state.params, active: id, [`kind.${id}`]: 0, [`life.${id}`]: 0, [`detail.${id}`]: 0 },
    points: { ...state.points, [`vertex.${id}.${index}`]: point },
    marks: state.marks.filter((mark) => { const parsed = parseConstructionTarget(mark); return parsed?.type !== "vertex" || parsed.id !== id || corners.has(parsed.part!); }),
  });
}

/** 屏幕逆变换由共用宿主完成；这里只把舞台总位移转回已冻结的材料局部方向。 */
export function dragPerimeterVertex(state: PlanarState, target: string, delta: PlanarPoint, previous?: PlanarState): PlanarState {
  const parsed = parsePerimeterVertexHandle(target);
  if (!parsed || !finite(delta)) return state;
  const object = perimeterVertexObject(state, parsed.id), vertex = object?.vertices[parsed.index];
  if (!object || !vertex) return state;
  const [a, b, c, d] = constructionMatrix(object), determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-9) return state;
  return movePerimeterVertex(state, parsed.invariant, parsed.index, {
    x: vertex.x + (d * delta.x - c * delta.y) / determinant,
    y: vertex.y + (a * delta.y - b * delta.x) / determinant,
  }, parsed.id, previous);
}
