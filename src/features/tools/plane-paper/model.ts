import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import {
  MAX_CONSTRUCTION_OBJECTS, MAX_CONSTRUCTION_VERTICES, MAX_OBJECT_VERTICES,
  addConstruction, constructionArea, constructionObject, constructionObjects, createConstructionState,
  isSimpleConstructionPolygon, parseConstructionTarget, removeConstruction, tapConstruction, worldVertices,
} from "../plane-construction/model";
import { isValidPaperState } from "./validation";

export const PAPER_SCENE_ID = "14-create";
const EPS = 1e-7;
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, value: number): Point => ({ x: a.x * value, y: a.y * value });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (point: Point) => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
const signedArea = (points: readonly Point[]) => points.reduce((sum, a, index) => sum + cross(a, points[(index + 1) % points.length]), 0) / 2;
const sign = (value: number) => value > EPS ? 1 : value < -EPS ? -1 : 0;
function onSegment(point: Point, a: Point, b: Point) {
  return Math.abs(cross(subtract(b, a), subtract(point, a))) <= EPS
    && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
    && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS;
}
function strictlyInside(point: Point, polygon: readonly Point[]) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (onSegment(point, a, b)) return false;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function simplify(polygon: readonly Point[]) {
  let points = polygon.filter((point, index) => distance(point, polygon[(index + 1) % polygon.length]) > EPS);
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    points = points.filter((b, index) => {
      const a = points[(index + points.length - 1) % points.length], c = points[(index + 1) % points.length];
      if (onSegment(b, a, c)) { changed = true; return false; }
      return true;
    });
  }
  return points;
}

interface Segment { a: Point; b: Point }
/** 按有向边界逐个追踪连通片；凹图形一侧可有多片，不用跨空白的连线粘成一张。 */
function boundaryLoops(segments: readonly Segment[], orientation: number): Point[][] | null {
  const nodes: Point[] = [], edges: { from: number; to: number }[] = [];
  const node = (point: Point) => {
    const index = nodes.findIndex((entry) => distance(entry, point) <= EPS);
    if (index >= 0) return index;
    nodes.push({ ...point }); return nodes.length - 1;
  };
  for (const segment of segments) {
    const from = node(segment.a), to = node(segment.b);
    if (from !== to && !edges.some((edge) => edge.from === from && edge.to === to)) edges.push({ from, to });
  }
  const used = new Set<number>(), loops: Point[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used.has(start)) continue;
    const first = edges[start].from, points: Point[] = [];
    let current = start, closed = false;
    for (let step = 0; step <= edges.length; step++) {
      if (used.has(current)) return null;
      const edge = edges[current]; used.add(current); points.push(nodes[edge.from]);
      if (edge.to === first) { closed = true; break; }
      const candidates = edges.flatMap((candidate, index) => candidate.from === edge.to && !used.has(index) ? [index] : []);
      if (!candidates.length) return null;
      const reverse = Math.atan2(nodes[edge.from].y - nodes[edge.to].y, nodes[edge.from].x - nodes[edge.to].x);
      const turn = (index: number) => {
        const end = nodes[edges[index].to], from = nodes[edge.to], angle = Math.atan2(end.y - from.y, end.x - from.x);
        return ((orientation > 0 ? reverse - angle : angle - reverse) + Math.PI * 4) % (Math.PI * 2);
      };
      current = candidates.sort((a, b) => turn(a) - turn(b))[0];
    }
    if (!closed) return null;
    const polygon = simplify(points);
    if (!isSimpleConstructionPolygon(polygon)) return null;
    loops.push(polygon);
  }
  return loops;
}

/** 直线裁切，返回全部真实连通纸片；无穿越、退化碎片或数值不守恒时整刀不提交。 */
export function splitPaperPolygon(polygon: readonly Point[], lineA: Point, lineB: Point): Point[][] | null {
  if (!isSimpleConstructionPolygon(polygon) || !finite(lineA) || !finite(lineB) || distance(lineA, lineB) < 1) return null;
  const direction = scale(subtract(lineB, lineA), 1 / distance(lineA, lineB)), orientation = Math.sign(signedArea(polygon));
  const side = (point: Point) => cross(direction, subtract(point, lineA));
  const halves: Record<"positive" | "negative", Segment[]> = { positive: [], negative: [] }, crossings: Point[] = [];
  const remember = (point: Point) => { if (!crossings.some((entry) => distance(point, entry) <= EPS)) crossings.push(point); };
  const append = (a: Point, b: Point, which: number) => {
    if (distance(a, b) > EPS) halves[which > 0 ? "positive" : "negative"].push({ a, b });
  };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = side(a), db = side(b), sa = sign(da), sb = sign(db);
    if (!sa) remember(a); if (!sb) remember(b);
    if (sa * sb < 0) {
      const intersection = add(a, scale(subtract(b, a), da / (da - db)));
      remember(intersection); append(a, intersection, sa); append(intersection, b, sb);
    } else if (sa || sb) append(a, b, sa || sb);
    else {
      const edge = subtract(b, a), inward = scale({ x: -edge.y, y: edge.x }, orientation);
      append(a, b, cross(direction, inward));
    }
  }
  crossings.sort((a, b) => dot(subtract(a, lineA), direction) - dot(subtract(b, lineA), direction));
  let seams = 0;
  for (let i = 0; i < crossings.length - 1; i++) {
    const a = crossings[i], b = crossings[i + 1];
    if (!strictlyInside(scale(add(a, b), 0.5), polygon)) continue;
    seams++;
    append(orientation > 0 ? a : b, orientation > 0 ? b : a, 1);
    append(orientation > 0 ? b : a, orientation > 0 ? a : b, -1);
  }
  if (!seams) return null;
  const positive = boundaryLoops(halves.positive, orientation), negative = boundaryLoops(halves.negative, orientation);
  if (!positive?.length || !negative?.length) return null;
  const pieces = [...positive, ...negative], area = constructionArea(polygon), total = pieces.reduce((sum, piece) => sum + constructionArea(piece), 0);
  if (pieces.length < 2 || pieces.some((piece) => piece.length > MAX_OBJECT_VERTICES) || Math.abs(total - area) > Math.max(1e-6, area * 1e-9)) return null;
  return pieces.sort((a, b) => constructionArea(b) - constructionArea(a) || Math.min(...a.map((p) => p.y)) - Math.min(...b.map((p) => p.y)) || Math.min(...a.map((p) => p.x)) - Math.min(...b.map((p) => p.x)));
}

export function cutPaper(state: PlanarState, lineA: Point, lineB: Point): PlanarState | null {
  const object = constructionObject(state);
  if (!object || object.kind >= 2 || !isValidPaperState(state)) return null;
  const pieces = splitPaperPolygon(worldVertices(object), lineA, lineB), objects = constructionObjects(state);
  if (!pieces || objects.length - 1 + pieces.length > MAX_CONSTRUCTION_OBJECTS || state.params.nextId + pieces.length > 99999
    || objects.filter((entry) => entry.id !== object.id).reduce((sum, entry) => sum + entry.vertices.length, 0) + pieces.reduce((sum, piece) => sum + piece.length, 0) > MAX_CONSTRUCTION_VERTICES) return null;
  const firstId = state.params.nextId;
  let result = removeConstruction(state);
  // 切点是数学交点，不能被“画图吸附”挪到格点；整刀成功后恢复老师原来的开关。
  result = { ...result, flags: { ...result.flags, snap: false } };
  for (const piece of pieces) {
    const next = addConstruction(result, "polygon", piece);
    if (next === result) return null;
    result = next;
  }
  result = { ...result, params: { ...result.params, active: firstId }, flags: { ...state.flags } };
  return isValidPaperState(result) ? result : null;
}

export interface PaperMaterial { id: string; zh: string; en: string; polygons: readonly (readonly Point[])[] }
const triangle = [{ x: -100, y: 90 }, { x: 100, y: 90 }, { x: -30, y: -90 }];
const trapezoid = [{ x: -130, y: 85 }, { x: 130, y: 85 }, { x: 65, y: -85 }, { x: -65, y: -85 }];
const rightTriangle = [{ x: -90, y: -120 }, { x: 90, y: -120 }, { x: -90, y: 120 }];
export const PAPER_MATERIALS: readonly PaperMaterial[] = [
  { id: "parallelogram", zh: "平行四边形", en: "Parallelogram", polygons: [[{ x: -155, y: 90 }, { x: 85, y: 90 }, { x: 155, y: -90 }, { x: -85, y: -90 }]] },
  { id: "steep-parallelogram", zh: "大倾斜平行四边形", en: "A strongly sheared parallelogram", polygons: [[{ x: -220, y: 90 }, { x: -40, y: 90 }, { x: 220, y: -90 }, { x: 40, y: -90 }]] },
  { id: "triangle", zh: "三角形", en: "Triangle", polygons: [triangle] },
  { id: "trapezoid", zh: "梯形", en: "Trapezoid", polygons: [trapezoid] },
  { id: "notch", zh: "凹口图形", en: "A notched shape", polygons: [[{ x: -140, y: -100 }, { x: 140, y: -100 }, { x: 140, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 100 }, { x: -140, y: 100 }]] },
  { id: "triangle-pair", zh: "两张全等三角形", en: "Two congruent triangles", polygons: [triangle, triangle] },
  { id: "trapezoid-pair", zh: "两张全等梯形", en: "Two congruent trapezoids", polygons: [trapezoid, trapezoid] },
  { id: "right-triangles", zh: "四张全等直角三角形", en: "Four congruent right triangles", polygons: [rightTriangle, rightTriangle, rightTriangle, rightTriangle] },
];
export function addPaperMaterial(state: PlanarState, id: string): PlanarState {
  const material = PAPER_MATERIALS.find((entry) => entry.id === id);
  if (!material) return state;
  let result: PlanarState = { ...state, flags: { ...state.flags, snap: false } };
  const existing = constructionObjects(state).length, columns = material.polygons.length > 1 ? 2 : 1;
  for (let i = 0; i < material.polygons.length; i++) {
    const center = { x: (columns === 2 ? 285 + (i % 2) * 360 : 420) + (existing % 3) * 22, y: 290 + Math.floor(i / 2) * 275 + (existing % 2) * 18 };
    const next = addConstruction(result, "polygon", material.polygons[i].map((point) => add(center, point)));
    if (next === result) return state;
    result = next;
  }
  result = { ...result, flags: { ...state.flags } };
  return isValidPaperState(result) ? result : state;
}
export function createPaperState(): PlanarState {
  const blank = removeConstruction({ ...createConstructionState("01-create"), sceneId: PAPER_SCENE_ID });
  return addPaperMaterial(blank, "parallelogram");
}
export function createPaperGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  if (tool === "cut-line") return points.length === 2 && distance(points[0], points[1]) >= 12 ? cutPaper(state, points[0], points[1]) : null;
  if (tool !== "polygon" && tool !== "rectangle") return null;
  const next = addConstruction(state, tool, points);
  return next !== state && isValidPaperState(next) ? next : null;
}
export function tapPaper(state: PlanarState, target: string): PlanarState {
  if (!target.startsWith("edge.")) return tapConstruction(state, target);
  const tapped = tapConstruction({ ...state, flags: { ...state.flags, edges: true } }, target);
  return { ...tapped, flags: { ...state.flags } };
}
export function paperAltitude(state: PlanarState, selected?: string | null) {
  const object = constructionObject(state); if (!object || object.kind >= 2) return null;
  const targets = [selected, ...state.marks.toReversed()].filter((value): value is string => !!value);
  const target = targets.map(parseConstructionTarget).find((entry) => entry?.type === "edge" && entry.id === object.id && entry.part !== undefined && entry.part < object.vertices.length);
  if (!target || target.part === undefined) return null;
  const vertices = worldVertices(object), baseA = vertices[target.part], baseB = vertices[(target.part + 1) % vertices.length], edge = subtract(baseB, baseA), length2 = dot(edge, edge);
  const candidates = vertices.map((vertex, index) => {
    const t = dot(subtract(vertex, baseA), edge) / length2, foot = add(baseA, scale(edge, t));
    return { vertex, foot, baseA, baseB, height: distance(vertex, foot), within: t >= -EPS && t <= 1 + EPS, index };
  }).filter((entry) => entry.height > EPS);
  candidates.sort((a, b) => Math.abs(a.height - b.height) > EPS ? b.height - a.height : Number(b.within) - Number(a.within) || a.index - b.index);
  const highest = candidates[0];
  if (!highest) return null;
  // 平行对边有多个等高顶点时，优先选能真正穿过纸片的一条高。
  // 大倾斜纸片的垂足都可能在底边延长线上，不能误选仅擦过最外侧顶点的切线。
  return candidates.find((entry) => Math.abs(entry.height - highest.height) <= EPS && splitPaperPolygon(vertices, entry.vertex, entry.foot)) ?? highest;
}
export function cutAlongPaperAltitude(state: PlanarState, selected?: string | null) {
  const altitude = paperAltitude(state, selected);
  return altitude ? cutPaper(state, altitude.vertex, altitude.foot) : null;
}
export function paperArea(state: PlanarState) {
  // 镜像动画中的压扁是纸片的投影；材料本身仍保留同一面积。
  return constructionObjects(state).reduce((sum, object) => sum + constructionArea(worldVertices({ ...object, basis: undefined })), 0);
}
