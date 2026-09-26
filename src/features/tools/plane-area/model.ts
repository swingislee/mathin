import { emptyPlanarState, type PlanarPoint as Point, type PlanarState } from "../planar-kit/contract";
import { polygonArea } from "../planar-interaction/geometry";

export const AREA_SCENES = ["14", "15", "16", "17", "18", "27", "33", "37", "38", "39", "40", "41", "42", "44", "45", "46", "58", "59"] as const;
export type AreaSceneId = (typeof AREA_SCENES)[number];
export interface Pose { x: number; y: number; angle: number }
export interface AreaPiece { id: string; points?: Point[]; path?: string; area: number; tone: number; pose: Pose; original: Pose; target: Pose; label?: string; added?: boolean; outline?: boolean; fillRule?: "evenodd" }
export interface AreaGuide { a: Point; b: Point; kind?: "height" | "cut" | "parallel" | "line"; amount?: number }
export interface AreaHandle { id: string; point: Point; label: string }
export interface AreaHeight { vertex: Point; baseA: Point; baseB: Point; label: string }
export interface AreaModel {
  pieces: AreaPiece[]; guides: AreaGuide[]; handles: AreaHandle[]; heights: AreaHeight[];
  outlines: Point[][]; values: Record<string, number>; cells?: { points: Point[]; inside: boolean; row?: number }[];
  rightAngles?: { vertex: Point; along: Point; toward: Point }[];
}
export const AREA_SCALE = 50;
export const AREA_ORIGIN = { x: 160, y: 530 };
export const toScreen = (p: Point): Point => ({ x: AREA_ORIGIN.x + p.x * AREA_SCALE, y: AREA_ORIGIN.y - p.y * AREA_SCALE });
export const fromScreen = (p: Point): Point => ({ x: (p.x - AREA_ORIGIN.x) / AREA_SCALE, y: (AREA_ORIGIN.y - p.y) / AREA_SCALE });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (p: Point, n: number): Point => ({ x: p.x * n, y: p.y * n });
export const mix = (a: Point, b: Point, t: number): Point => add(a, scale(sub(b, a), t));
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const point = (x: number, y: number): Point => ({ x, y });
const identity: Pose = { x: 0, y: 0, angle: 0 };
const rectangle = (x: number, y: number, width: number, height: number) => [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
export function applyPose(p: Point, pose: Pose): Point {
  const a = pose.angle * Math.PI / 180;
  return { x: pose.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: pose.y + p.x * Math.sin(a) + p.y * Math.cos(a) };
}
export const piecePoints = (piece: AreaPiece) => (piece.points ?? []).map((p) => applyPose(p, piece.pose));
export function poseBetween(from: Pose, to: Pose, t: number): Pose {
  let angle = to.angle - from.angle;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, angle: from.angle + angle * t };
}
export function signedArea(points: readonly Point[]) {
  return points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2;
}
export function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const ab = sub(b, a), cd = sub(d, c), denominator = cross(ab, cd);
  return Math.abs(denominator) < 1e-9 ? null : add(a, scale(ab, cross(sub(c, a), cd) / denominator));
}
/** 凸纸片交集：同一算法同时用于阴影和细格覆盖，面积读数不以 SVG 像素估算。 */
export function intersectConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output = [...subject];
  const orientation = signedArea(clip) < 0 ? -1 : 1;
  for (let i = 0; i < clip.length && output.length; i += 1) {
    const a = clip[i], b = clip[(i + 1) % clip.length], input = output;
    output = [];
    const inside = (p: Point) => orientation * cross(sub(b, a), sub(p, a)) >= -1e-8;
    input.forEach((current, index) => {
      const previous = input[(index + input.length - 1) % input.length];
      if (inside(current) !== inside(previous)) {
        const hit = lineIntersection(previous, current, a, b);
        if (hit) output.push(hit);
      }
      if (inside(current)) output.push(current);
    });
  }
  return output.filter((p, i) => i === 0 || Math.hypot(p.x - output[i - 1].x, p.y - output[i - 1].y) > 1e-8);
}
export function projectOnLine(p: Point, a: Point, b: Point, segment = false): Point {
  const ab = sub(b, a), length2 = dot(ab, ab);
  if (length2 < 1e-10) return a;
  let t = dot(sub(p, a), ab) / length2;
  if (segment) t = clamp(t, 0.04, 0.96);
  return add(a, scale(ab, t));
}
export function withinTriangle(p: Point, a: Point, b: Point, c: Point): Point {
  const v0 = sub(b, a), v1 = sub(c, a), denominator = cross(v0, v1);
  if (Math.abs(denominator) < 1e-8) return a;
  let u = cross(sub(p, a), v1) / denominator, v = cross(v0, sub(p, a)) / denominator;
  u = Math.max(0.03, u); v = Math.max(0.03, v);
  if (u + v > 0.97) { const sum = u + v; u *= 0.97 / sum; v *= 0.97 / sum; }
  return add(a, add(scale(v0, u), scale(v1, v)));
}
export function createAreaState(id: AreaSceneId): PlanarState {
  const state = emptyPlanarState(id);
  state.params = { base: 6, height: 3.5, slant: 1.8, top: 3, fraction: 0.45, secondary: 0.55, count: 16, layers: 2, radius: 2.3, cuts: 0, angle: 0 };
  state.flags = { ...state.flags, constraint: true, original: true, areas: false, strips: false, complement: false, alternate: false, snap: true };
  state.points = { A: point(0, 0), B: point(6, 0), C: point(1.8, 3.5), P: point(2.7, 1.5), D: point(0, 0) };
  if (id === "14") state.params = { ...state.params, base: 5, height: 3, slant: 1.5 };
  if (id === "33") { state.params.base = 3.5; state.points.P = point(2, 1.25); }
  if (id === "40") state.points = { A: point(1, 3.8), B: point(4.5, 3.8), C: point(6, 0), D: point(0, 0) };
  if (id === "58") { state.params.base = 3; state.params.height = 4; }
  if (id === "46") state.params.fraction = 1 / 3;
  if (id === "59") state.params.secondary = state.params.fraction;
  return state;
}
export const param = (s: PlanarState, key: string, fallback = 0) => Number.isFinite(s.params[key]) ? s.params[key] : fallback;
export const vertex = (s: PlanarState, key: string, fallback: Point) => s.points[key] ?? fallback;
/** 持久现场与课堂回放先收敛到数学模型边界，异常参数不会扩大细分循环或产生无穷坐标。 */
export function normalizeAreaState(state: PlanarState): PlanarState {
  if (!(AREA_SCENES as readonly string[]).includes(state.sceneId)) return state;
  const fallback = createAreaState(state.sceneId as AreaSceneId), ranges: Record<string, [number, number]> = {
    base: [0.01, 20], height: [0.01, 20], slant: [-20, 20], top: [0.5, 5], fraction: [0.05, 0.95], secondary: [0.05, 0.95], count: [4, 64], layers: [1, 5], radius: [0.5, 3], cuts: [0, 10], angle: [-180, 180],
  };
  const params = { ...state.params };
  for (const [key, range] of Object.entries(ranges)) params[key] = clamp(param(state, key, fallback.params[key]), ...range);
  const points = Object.fromEntries(Object.entries({ ...fallback.points, ...state.points }).map(([key, p]) => [key, { x: clamp(Number.isFinite(p.x) ? p.x : 0, -20, 20), y: clamp(Number.isFinite(p.y) ? p.y : 0, -12, 12) }]));
  return { ...state, params, points, phase: clamp(Number.isFinite(state.phase) ? state.phase : 0, 0, 1) };
}
const emptyModel = (): AreaModel => ({ pieces: [], guides: [], handles: [], heights: [], outlines: [], values: {} });
function makePiece(s: PlanarState, id: string, points: Point[], tone: number, from: Pose = identity, to: Pose = from, label?: string): AreaPiece {
  const pose = poseBetween(from, to, s.phase), offset = s.points[`piece.${id}`] ?? point(0, 0);
  const pivot = points.length ? scale(points.reduce((sum, p) => add(sum, p), point(0, 0)), 1 / points.length) : point(0, 0);
  const anchor = applyPose(pivot, pose), turnedPivot = applyPose(pivot, { x: 0, y: 0, angle: pose.angle + param(s, `turn.${id}`) });
  return { id, points, area: polygonArea(points), tone, original: from, target: to, pose: { x: anchor.x - turnedPivot.x + offset.x, y: anchor.y - turnedPivot.y + offset.y, angle: pose.angle + param(s, `turn.${id}`) }, label };
}
function pathPiece(s: PlanarState, id: string, path: string, area: number, tone: number, from = identity, to = from): AreaPiece {
  return { ...makePiece(s, id, [], tone, from, to), points: undefined, path, area };
}
/** 每层最多一张独立副本；几何快照沿用 v1 的 piece.* 点位，不随母三角形更新。 */
export function midpointCopyPoints(s: PlanarState, layer: number): Point[] | null {
  if (s.sceneId !== "42" || !Number.isInteger(layer) || layer < 1 || layer > 5 || !s.flags[`detached.level${layer}`]) return null;
  const points = ["A", "B", "C"].map((key) => s.points[`piece.copy.level${layer}.${key}`]);
  if (points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) || polygonArea(points) < 1e-10) return null;
  return points;
}
export function selectedMidpointLayer(s: PlanarState, target: string | null): number | null {
  if (s.sceneId !== "42") return null;
  const match = /^piece\.level([1-5])$/.exec(target ?? ""), layer = match ? Number(match[1]) : 0;
  return layer > 0 && layer <= Math.round(param(s, "layers", 2)) ? layer : null;
}
export function duplicateMidpointTriangle(s: PlanarState, target: string | null): PlanarState {
  const layer = selectedMidpointLayer(s, target);
  if (layer === null || midpointCopyPoints(s, layer)) return s;
  const source = buildAreaModel(s).pieces.find((piece) => piece.id === `level${layer}`);
  if (!source?.points) return s;
  const triangle = piecePoints(source), center = scale(triangle.reduce(add, point(0, 0)), 1 / 3);
  const minX = Math.min(...triangle.map((p) => p.x)), maxX = Math.max(...triangle.map((p) => p.x));
  const minY = Math.min(...triangle.map((p) => p.y)), maxY = Math.max(...triangle.map((p) => p.y));
  const offset = point(clamp(9.5 - center.x, Math.max(-16, -1.5 - minX), Math.min(16, 12.5 - maxX)), clamp(6.2 - (layer - 1) * 1.6 - center.y, Math.max(-10, -1.8 - minY), Math.min(10, 8 - maxY)));
  const id = `copy.level${layer}`;
  return { ...s, flags: { ...s.flags, [`detached.level${layer}`]: true }, params: { ...s.params, [`turn.${id}`]: 0 }, points: { ...s.points,
    ...Object.fromEntries(triangle.map((p, index) => [`piece.${id}.${"ABC"[index]}`, { ...p }])), [`piece.${id}`]: offset,
  } };
}
export function parallelogramFrame(s: PlanarState) {
  const base = clamp(param(s, "base", 5), 2, 8), h = clamp(param(s, "height", 3), 1, 6), slant = clamp(param(s, "slant", 1.5), 0.2, 12);
  if (!s.flags.alternate) return { base, height: h, shear: slant, u: point(1, 0), v: point(0, 1) };
  const side = Math.hypot(slant, h);
  return { base: side, height: base * h / side, shear: base * slant / side, u: point(slant / side, h / side), v: point(h / side, -slant / side) };
}
export const requiredAreaCuts = (s: PlanarState) => Math.ceil(parallelogramFrame(s).shear / parallelogramFrame(s).base - 1e-9);
function parallelogram(s: PlanarState): AreaModel {
  const model = emptyModel(), frame = parallelogramFrame(s), { base: b, height: h, shear: d } = frame;
  const world = (p: Point) => add(scale(frame.u, p.x), scale(frame.v, p.y));
  const whole = [point(0, 0), point(b, 0), point(b + d, h), point(d, h)];
  const required = requiredAreaCuts(s), cuts = clamp(Math.floor(param(s, "cuts")), 0, required);
  model.outlines.push(whole.map(world));
  for (let i = 0; i <= cuts; i += 1) {
    const right = i === cuts ? b + d + 1 : (i + 1) * b;
    const polygon = intersectConvex(whole, rectangle(i * b, -1, right - i * b, h + 2));
    if (polygonArea(polygon) < 1e-8) continue;
    const displacement = scale(frame.u, -i * b);
    model.pieces.push(makePiece({ ...s, phase: cuts === required ? s.phase : 0 }, `p${i}`, polygon.map(world), i, identity, { ...displacement, angle: 0 }, String(i + 1)));
  }
  for (let i = 1; i <= required; i += 1) {
    const y0 = Math.max(0, (i * b - b) * h / d), y1 = Math.min(h, i * b * h / d);
    model.guides.push({ a: world(point(i * b, y0)), b: world(point(i * b, y1)), kind: "cut", amount: clamp(param(s, "cuts") - i + 1, 0, 1) });
  }
  model.heights.push({ vertex: world(point(d, h)), baseA: world(point(0, 0)), baseB: world(point(b, 0)), label: `h = ${h.toFixed(2)}` });
  model.values = { area: b * h, cuts: required, base: b, height: h };
  return model;
}
/** 以正方形细格给出内、外面积界；边界格明确区别于完整覆盖格。 */
export function triangleSquares(triangle: Point[], divisions: number) {
  const minX = Math.min(...triangle.map((p) => p.x)), maxX = Math.max(...triangle.map((p) => p.x));
  const minY = Math.min(...triangle.map((p) => p.y)), maxY = Math.max(...triangle.map((p) => p.y));
  const size = Math.max(maxX - minX, maxY - minY) / clamp(Math.round(divisions), 4, 48);
  const cells: { points: Point[]; inside: boolean }[] = [];
  let insideCount = 0;
  if (size < 1e-8) return { cells, lower: 0, upper: 0, size: 0 };
  for (let y = minY; y < maxY - 1e-8; y += size) for (let x = minX; x < maxX - 1e-8; x += size) {
    const cell = rectangle(x, y, size, size), area = polygonArea(intersectConvex(cell, triangle));
    if (area < 1e-9) continue;
    const inside = area >= size * size - 1e-8;
    if (inside) insideCount += 1;
    cells.push({ points: cell, inside });
  }
  return { cells, lower: insideCount * size * size, upper: cells.length * size * size, size };
}
/** 等高时每条只平移、方格数不变。阶梯边界是近似轮廓，不冒充完全包含于三角形的覆盖。 */
export function triangleStripSquares(triangle: Point[], divisions: number) {
  const [a, b, c] = triangle, ab = sub(b, a), length = Math.hypot(ab.x, ab.y);
  if (length < 1e-8) return { cells: [] as { points: Point[]; inside: boolean; row: number }[], area: 0, size: 0 };
  const u = scale(ab, 1 / length), ac = sub(c, a), signedHeight = cross(u, ac), height = Math.abs(signedHeight), v = scale(point(-u.y, u.x), Math.sign(signedHeight) || 1);
  const shear = dot(ac, u), size = Math.max(length, height) / clamp(Math.round(divisions), 4, 48), rows = Math.floor(height / size + 1e-8);
  const cells: { points: Point[]; inside: boolean; row: number }[] = [];
  const world = (x: number, y: number) => add(a, add(scale(u, x), scale(v, y)));
  for (let row = 0; row < rows; row += 1) {
    const fraction = ((row + 0.5) * size) / height, width = length * (1 - fraction), count = Math.floor(width / size + 1e-8);
    const start = shear * fraction + (width - count * size) / 2;
    for (let cell = 0; cell < count; cell += 1) {
      const x = start + cell * size, y = row * size;
      cells.push({ points: [world(x, y), world(x + size, y), world(x + size, y + size), world(x, y + size)], inside: true, row });
    }
  }
  return { cells, area: cells.length * size * size, size };
}
function triangleRelations(s: PlanarState): AreaModel {
  const model = emptyModel(), a = vertex(s, "A", point(0, 0)), b = vertex(s, "B", point(6, 0)), c = vertex(s, "C", point(1.8, 3.5));
  const fraction = clamp(param(s, "fraction", 0.45), 0.05, 0.95), secondary = clamp(param(s, "secondary", 0.55), 0.05, 0.95);
  const triangle = [a, b, c], total = polygonArea(triangle);
  const addPart = (id: string, points: Point[], tone: number, from = identity, to = from) => model.pieces.push(makePiece(s, id, points, tone, from, to, id));
  model.outlines.push(triangle); model.values.area = total;
  model.heights.push({ vertex: c, baseA: a, baseB: b, label: "h" });
  if (s.sceneId === "18") {
    addPart("ABC", triangle, 0);
    model.handles.push(...[a, b, c].map((p, i) => ({ id: "ABC"[i], point: p, label: "ABC"[i] })));
    const base = sub(b, a), along = scale(base, 2);
    model.guides.push({ a: sub(a, along), b: add(b, along), kind: "parallel" }, { a: sub(c, along), b: add(c, along), kind: "parallel" });
    if (s.flags.strips) {
      if (s.flags.cover) { const squares = triangleSquares(triangle, param(s, "count", 16)); model.cells = squares.cells; model.values.lower = squares.lower; model.values.upper = squares.upper; }
      else { const strips = triangleStripSquares(triangle, param(s, "count", 16)); model.cells = strips.cells; model.values.stripArea = strips.area; model.values.squareSize = strips.size; }
    }
  } else if (s.sceneId === "37") {
    const d = mix(a, b, fraction);
    addPart("S1", [a, d, c], 0); addPart("S2", [d, b, c], 1);
    model.handles.push({ id: "D", point: d, label: "D" }, { id: "C", point: c, label: "C" });
    model.values.S1 = total * fraction; model.values.S2 = total * (1 - fraction);
  } else if (s.sceneId === "38") {
    const d = mix(a, b, fraction), e = mix(a, c, secondary);
    addPart("ABC", triangle, 1); model.pieces[0].outline = true;
    addPart("ADE", [a, d, e], 0); model.guides.push({ a: b, b: e });
    model.handles.push({ id: "D", point: d, label: "D" }, { id: "E", point: e, label: "E" });
    model.values.small = total * fraction * secondary; model.values.ratio = fraction * secondary;
  } else if (s.sceneId === "39") {
    const d = mix(a, b, fraction), p = s.flags.constraint ? mix(c, d, secondary) : withinTriangle(vertex(s, "P", mix(c, d, secondary)), a, b, c);
    addPart("S1", [c, a, p], 0); addPart("S2", [c, p, b], 1); addPart("S3", [a, d, p], 2); addPart("S4", [d, b, p], 3);
    model.guides.push({ a: c, b: d, kind: "line" });
    model.handles.push({ id: "D", point: d, label: "D" }, { id: "P", point: p, label: "P" });
    model.pieces.forEach((piece) => { model.values[piece.id] = piece.area; });
  } else if (s.sceneId === "41") {
    const p = s.flags.constraint ? mix(c, mix(a, b, 0.5), secondary) : withinTriangle(vertex(s, "P", point(2.7, 1.5)), a, b, c);
    addPart("S1", [c, a, p], 0); addPart("S2", [c, p, b], 1); addPart("common", [a, b, p], 2, identity, { x: 6.5, y: 0, angle: 0 });
    model.handles.push({ id: "P", point: p, label: "P" });
    model.heights.push({ vertex: p, baseA: a, baseB: b, label: "h₂" });
    model.values.common = polygonArea([a, b, p]); model.values.remainder = total - model.values.common;
  } else if (s.sceneId === "42") {
    addPart("ABC", triangle, 0);
    let current = triangle;
    const layers = clamp(Math.round(param(s, "layers", 2)), 1, 5);
    for (let i = 1; i <= layers; i += 1) {
      current = current.map((p, index) => mix(p, current[(index + 1) % 3], 0.5));
      model.pieces.push(makePiece(s, `level${i}`, current, i, identity, identity, `S${i}`)); model.values[`S${i}`] = polygonArea(current);
    }
    // 减少嵌套层数只收起母图的层线，已明确拆出的纸片保留在现场。
    for (let i = 1; i <= 5; i += 1) {
      const copied = midpointCopyPoints(s, i);
      if (copied) model.pieces.push(makePiece(s, `copy.level${i}`, copied, i, identity, identity, `S${i}′`));
    }
    model.handles.push(...[a, b, c].map((p, i) => ({ id: "ABC"[i], point: p, label: "ABC"[i] })));
  }
  return model;
}
function butterfly(s: PlanarState): AreaModel {
  const model = emptyModel(), a = vertex(s, "A", point(1, 3.8)), b = vertex(s, "B", point(4.5, 3.8)), c = vertex(s, "C", point(6, 0)), d = vertex(s, "D", point(0, 0));
  const intersection = lineIntersection(a, c, b, d) ?? mix(a, c, 0.5), vertices = [a, b, c, d];
  model.outlines.push(vertices);
  vertices.forEach((p, i) => { model.pieces.push(makePiece(s, `S${i + 1}`, [p, vertices[(i + 1) % 4], intersection], i, identity, identity, `S${i + 1}`)); model.handles.push({ id: "ABCD"[i], point: p, label: "ABCD"[i] }); });
  model.guides.push({ a, b: c }, { a: b, b: d });
  model.pieces.forEach((p) => { model.values[p.id] = p.area; });
  model.values.area = polygonArea(vertices);
  return model;
}
function duplication(s: PlanarState): AreaModel {
  const model = emptyModel(), b = param(s, "base", 6), h = param(s, "height", 3.5), shift = param(s, "slant", 1.8), top = param(s, "top", 3);
  const polygon = s.sceneId === "15" ? [point(0, 0), point(b, 0), point(shift, h)] : [point(0, 0), point(b, 0), point(shift + top, h), point(shift, h)];
  model.pieces.push(makePiece(s, "original", polygon, 0));
  const final = { x: s.sceneId === "15" ? b + shift : b + shift + top, y: h, angle: 180 };
  if (s.flags.duplicate) model.pieces.push(makePiece(s, "copy", polygon, 1, { x: 1, y: -1.5, angle: 0 }, final));
  model.outlines.push(polygon); model.heights.push({ vertex: point(shift, h), baseA: point(0, 0), baseB: point(b, 0), label: `h = ${h}` });
  model.values.single = polygonArea(polygon); model.values.total = model.values.single * (s.flags.duplicate ? 2 : 1);
  return model;
}
function composite(s: PlanarState): AreaModel {
  const model = emptyModel(), b = param(s, "base", 6), h = param(s, "height", 3.5), x = b * clamp(param(s, "fraction", 0.55), 0.2, 0.8), y = h * clamp(param(s, "secondary", 0.5), 0.2, 0.8);
  const whole = [point(0, 0), point(b, 0), point(b, y), point(x, y), point(x, h), point(0, h)];
  model.outlines.push(whole);
  const parts = s.flags.alternate ? [rectangle(0, 0, x, h), rectangle(x, 0, b - x, y)] : [rectangle(0, 0, b, y), rectangle(0, y, x, h - y)];
  parts.forEach((p, i) => model.pieces.push(makePiece(s, `p${i}`, p, i, identity, { x: i ? 0.6 : -0.6, y: i ? 0.4 : -0.4, angle: 0 })));
  if (s.flags.complement) { const filler = makePiece(s, "added", rectangle(x, y, b - x, h - y), 3); filler.added = true; model.pieces.push(filler); }
  model.values.area = polygonArea(whole); model.values.added = (b - x) * (h - y); model.handles.push({ id: "notch", point: point(x, y), label: "D" });
  return model;
}
export function sectorPath(radius: number, angle: number) {
  const end = point(radius * Math.cos(angle), radius * Math.sin(angle));
  return `M 0 0 L ${radius} 0 A ${radius} ${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${end.x} ${end.y} Z`;
}
function circleDissection(s: PlanarState): AreaModel {
  const model = emptyModel(), radius = param(s, "radius", 2.3), requested = param(s, "count", 16), count = requested < 12 ? 8 : requested < 24 ? 16 : requested < 48 ? 32 : 64;
  const angle = Math.PI * 2 / count, edge = 2 * radius * Math.sin(angle / 2), half = count / 2;
  for (let i = 0; i < count; i += 1) {
    const from = { x: 3.5, y: 2.5, angle: 360 * i / count };
    const top = i >= half, index = i % half;
    const to = { x: 0.5 + index * edge + (top ? edge / 2 : 0), y: top ? 1.1 + radius * Math.cos(angle / 2) : 1.1, angle: top ? 270 - 180 / count : 90 - 180 / count };
    const localPhase = clamp(s.phase * 1.4 - (i / Math.max(1, count - 1)) * 0.4, 0, 1);
    model.pieces.push(pathPiece({ ...s, phase: localPhase }, `sector${i}`, sectorPath(radius, angle), Math.PI * radius * radius / count, i % 2, from, to));
  }
  model.values.area = Math.PI * radius * radius; model.values.halfCircumference = Math.PI * radius; model.values.radius = radius; model.values.count = count;
  return model;
}
function overlap(s: PlanarState): AreaModel {
  const model = emptyModel(), size = param(s, "base", 3.5), offset = vertex(s, "P", point(2, 1.25));
  const a = rectangle(0, 0, size, size), canonical = rectangle(-size / 2, -size / 2, size, size);
  const pose = { x: offset.x + size / 2, y: offset.y + size / 2, angle: param(s, "angle") }, b = canonical.map((p) => applyPose(p, pose));
  const intersection = intersectConvex(a, b);
  model.pieces.push(makePiece(s, "A", a, 0), makePiece(s, "B", b, 2));
  const region = s.flags.union || s.flags.difference || s.flags.intersection;
  if (region) model.pieces.forEach((piece) => { piece.outline = true; });
  const polygonPath = (points: Point[]) => points.length ? `M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : "";
  if (s.flags.union) model.pieces.push(pathPiece(s, "union", `${polygonPath(a)} ${polygonPath(b)}`, size * size * 2 - polygonArea(intersection), 0));
  else if (s.flags.difference) {
    const remaining = pathPiece(s, "difference", `${polygonPath(a)} ${polygonPath(intersection)}`, size * size - polygonArea(intersection), 1);
    remaining.fillRule = "evenodd"; model.pieces.push(remaining);
  } else if (s.flags.intersection && intersection.length >= 3) model.pieces.push(makePiece(s, "overlap", intersection, 1));
  model.handles.push({ id: "P", point: pose, label: "B" });
  model.values.intersection = polygonArea(intersection); model.values.union = size * size * 2 - model.values.intersection; model.values.difference = size * size - model.values.intersection;
  return model;
}
function leaf(s: PlanarState): AreaModel {
  const model = emptyModel(), r = param(s, "radius", 2.3) * 1.7;
  const paths = [`M 0 0 A ${r} ${r} 0 0 1 ${r} ${r} Z`, `M ${r} ${r} A ${r} ${r} 0 0 1 0 0 Z`];
  paths.forEach((path, index) => model.pieces.push(pathPiece(s, `segment${index}`, path, r * r * (Math.PI / 4 - 0.5), index, identity, { x: index ? -0.9 : 0.9, y: index ? 0.9 : -0.9, angle: 0 })));
  model.outlines.push(rectangle(0, 0, r, r)); model.guides.push({ a: point(0, 0), b: point(r, r) }, { a: point(0, r), b: point(0, 0) }, { a: point(0, r), b: point(r, r) }, { a: point(r, 0), b: point(0, 0) }, { a: point(r, 0), b: point(r, r) });
  model.rightAngles = [{ vertex: point(0, r), along: point(r, r), toward: point(0, 0) }];
  model.values.leaf = r * r * (Math.PI / 2 - 1); model.values.segment = model.values.leaf / 2;
  return model;
}
function circleSquare(s: PlanarState): AreaModel {
  const model = emptyModel(), r = param(s, "radius", 2.3), shift = 2 * r + 1;
  const circle = `M ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 Z`;
  model.pieces.push(pathPiece(s, "circleLeft", circle, Math.PI * r * r, 0, { x: r, y: r, angle: 0 }));
  // 右图是内接正方形加四片弓形；移开弓形后不能在底下再留一张完整圆。
  model.pieces.push(makePiece(s, "squareRight", [point(r, 0), point(0, r), point(-r, 0), point(0, -r)], 0, { x: shift + r, y: r, angle: 0 }));
  model.outlines.push(rectangle(0, 0, 2 * r, 2 * r), [point(shift + r, 0), point(shift + 2 * r, r), point(shift + r, 2 * r), point(shift, r)]);
  for (let i = 0; i < 4; i += 1) {
    const corner = `M ${r} 0 L ${r} ${r} L 0 ${r} A ${r} ${r} 0 0 0 ${r} 0 Z`;
    model.pieces.push(pathPiece(s, `corner${i}`, corner, r * r * (1 - Math.PI / 4), 1, { x: r, y: r, angle: i * 90 }, { x: r + Math.cos((i * 90 + 45) * Math.PI / 180), y: r + Math.sin((i * 90 + 45) * Math.PI / 180), angle: i * 90 }));
    const segment = `M ${r} 0 A ${r} ${r} 0 0 1 0 ${r} Z`;
    model.pieces.push(pathPiece(s, `arc${i}`, segment, r * r * (Math.PI / 4 - 0.5), 2, { x: shift + r, y: r, angle: i * 90 }, { x: shift + r + Math.cos((i * 90 + 45) * Math.PI / 180), y: r + Math.sin((i * 90 + 45) * Math.PI / 180), angle: i * 90 }));
  }
  model.values.outerDifference = (4 - Math.PI) * r * r; model.values.innerDifference = (Math.PI - 2) * r * r;
  return model;
}
function equalParts(s: PlanarState): AreaModel {
  const model = emptyModel(), b = param(s, "base", 6), h = param(s, "height", 3.5), fraction = s.flags.constraint ? 1 / 3 : clamp(param(s, "fraction", 1 / 3), 0.1, 0.9), x = b * fraction;
  const parts = [rectangle(0, 0, x, h), [point(x, 0), point(b, 0), point(b, h)], [point(x, 0), point(b, h), point(x, h)]];
  parts.forEach((p, i) => { model.pieces.push(makePiece(s, `p${i}`, p, i, identity, { x: (i - 1) * 0.7, y: i === 2 ? 0.8 : -0.5, angle: 0 }, `S${i + 1}`)); model.values[`S${i + 1}`] = polygonArea(p); });
  model.handles.push({ id: "cut", point: point(x, h), label: "D" }); model.outlines.push(rectangle(0, 0, b, h));
  return model;
}
function pythagoras(s: PlanarState): AreaModel {
  const model = emptyModel(), a = param(s, "base", 3), b = param(s, "height", 4), size = a + b, triangle = [point(0, 0), point(a, 0), point(0, b)];
  const before = [{ x: 0, y: 0, angle: 0 }, { x: size, y: 0, angle: 90 }, { x: size, y: size, angle: 180 }, { x: 0, y: size, angle: 270 }];
  // 同一组四片只作刚性平移、旋转；不以顶点线性插值偷换成翻面或变形。
  const after = [{ x: 0, y: 0, angle: 0 }, { x: a, y: b, angle: 180 }, { x: size, y: b, angle: 90 }, { x: a, y: size, angle: 270 }];
  before.forEach((pose, i) => model.pieces.push(makePiece(s, `p${i}`, triangle, i, pose, after[i], String(i + 1))));
  model.outlines.push(rectangle(0, 0, size, size)); model.rightAngles = [{ vertex: point(0, 0), along: point(a, 0), toward: point(0, b) }];
  model.values.outer = size * size; model.values.fourPieces = 2 * a * b; model.values.remaining = a * a + b * b;
  return model;
}
function similar(s: PlanarState): AreaModel {
  const model = emptyModel(), t = clamp(param(s, "fraction", 0.5), 0.15, 0.85), other = s.flags.constraint ? t : clamp(param(s, "secondary", 0.55), 0.15, 0.85);
  const a = point(8, 5.5), b = point(5.5, 0), c = point(11, 0), d = mix(a, b, t), e = mix(a, c, other);
  const center = point(1.7, 2.4), left = point(0.4, 4.5), right = point(3.4, 4.5), ratio = 0.4 + t * 1.3;
  const lowerLeft = add(center, scale(sub(right, center), -ratio)), lowerRight = add(center, scale(sub(left, center), -(s.flags.constraint ? ratio : 0.4 + other * 1.3)));
  model.pieces.push(makePiece(s, "upper", [left, right, center], 0), makePiece(s, "lower", [center, lowerLeft, lowerRight], 1), makePiece(s, "whole", [a, b, c], 2), makePiece(s, "small", [a, d, e], 1));
  model.pieces[2].outline = true;
  model.guides.push({ a: left, b: lowerRight }, { a: right, b: lowerLeft }, { a: d, b: e, kind: "parallel" });
  model.handles.push({ id: "D", point: d, label: "D" }, { id: "E", point: e, label: "E" });
  model.values.lengthRatio = t; model.values.areaRatio = polygonArea([a, d, e]) / polygonArea([a, b, c]); model.values.sandglassRatio = polygonArea([center, lowerLeft, lowerRight]) / polygonArea([left, right, center]);
  return model;
}
export function buildAreaModel(s: PlanarState): AreaModel {
  s = normalizeAreaState(s);
  switch (s.sceneId) {
    case "14": return parallelogram(s);
    case "15": case "16": return duplication(s);
    case "17": return composite(s);
    case "18": case "37": case "38": case "39": case "41": case "42": return triangleRelations(s);
    case "27": return circleDissection(s);
    case "33": return overlap(s);
    case "40": return butterfly(s);
    case "44": return leaf(s);
    case "45": return circleSquare(s);
    case "46": return equalParts(s);
    case "58": return pythagoras(s);
    case "59": return similar(s);
    default: return emptyModel();
  }
}

export function movableAreaPiece(s: PlanarState, id: string) {
  if (id.startsWith("comparison")) return false;
  if (s.sceneId === "14") return param(s, "cuts") > 0;
  if (["15", "16", "17", "27", "46", "58"].includes(s.sceneId)) return true;
  if (s.sceneId === "41") return id === "common";
  if (s.sceneId === "42") {
    const match = /^copy\.level([1-5])$/.exec(id);
    return !!match && !!midpointCopyPoints(s, Number(match[1]));
  }
  if (s.sceneId === "44") return true;
  if (s.sceneId === "45") return id.startsWith("arc") || id.startsWith("corner");
  return false;
}
function withPoint(s: PlanarState, key: string, p: Point): PlanarState {
  const next = { ...s, points: { ...s.points, [key]: p } };
  if (["18", "37"].includes(s.sceneId) && ["A", "B", "C"].includes(key)) {
    const a = next.points.A, b = next.points.B, c = next.points.C, ab = sub(b, a), ac = sub(c, a), length = Math.hypot(ab.x, ab.y);
    if (length > 1e-8) next.params = { ...next.params, base: length, height: Math.abs(cross(ab, ac)) / length, slant: dot(ab, ac) / length };
  }
  return next;
}
function withParam(s: PlanarState, key: string, value: number): PlanarState {
  if (s.sceneId === "59" && s.flags.constraint && ["fraction", "secondary"].includes(key)) return { ...s, params: { ...s.params, fraction: value, secondary: value } };
  return { ...s, params: { ...s.params, [key]: value } };
}
const lineFraction = (p: Point, a: Point, b: Point) => clamp(dot(sub(p, a), sub(b, a)) / Math.max(1e-8, dot(sub(b, a), sub(b, a))), 0.05, 0.95);
const safePoint = (p: Point) => point(clamp(p.x, -1.5, 12.5), clamp(p.y, -1.8, 8));
/** 所有目标都从起拖快照求终点；拖动回执不累计上一个预览帧。 */
export function dragAreaState(start: PlanarState, target: string, screenPoint: Point, screenDelta: Point): PlanarState {
  const p = safePoint(fromScreen(screenPoint)), key = target.replace(/^handle\./, ""), delta = point(screenDelta.x / AREA_SCALE, -screenDelta.y / AREA_SCALE);
  const a = vertex(start, "A", point(0, 0)), b = vertex(start, "B", point(6, 0)), c = vertex(start, "C", point(1.8, 3.5));
  if (start.sceneId === "33" && (key === "P" || target === "piece.B")) {
    const old = vertex(start, "P", point(2, 1.25));
    const position = add(old, delta), side = param(start, "base", 3.5);
    return withPoint(start, "P", point(clamp(position.x, -1.5, 12 - side), clamp(position.y, -1.5, 8 - side)));
  }
  if (target.startsWith("piece.")) {
    const id = target.slice(6);
    if (!movableAreaPiece(start, id)) return start;
    const position = add(vertex(start, target, point(0, 0)), delta);
    return withPoint(start, target, point(clamp(position.x, -16, 16), clamp(position.y, -10, 10)));
  }
  if (["18", "42"].includes(start.sceneId) && "ABC".includes(key) && key.length === 1) {
    let next = p;
    if (start.sceneId === "18" && start.flags.constraint) next = key === "C" ? projectOnLine(p, c, add(c, sub(b, a))) : projectOnLine(p, a, b);
    const changed = withPoint(start, key, next);
    return polygonArea([vertex(changed, "A", a), vertex(changed, "B", b), vertex(changed, "C", c)]) > 0.15 ? changed : start;
  }
  if (["37", "38", "39"].includes(start.sceneId) && key === "D") return withParam(start, "fraction", lineFraction(p, a, b));
  if (start.sceneId === "37" && key === "C") return withPoint(start, "C", point(p.x, Math.max(a.y + 0.4, p.y)));
  if (start.sceneId === "38" && key === "E") return withParam(start, "secondary", lineFraction(p, a, c));
  if (["39", "41"].includes(start.sceneId) && key === "P") {
    const base = mix(a, b, start.sceneId === "39" ? param(start, "fraction", 0.45) : 0.5);
    return start.flags.constraint ? withParam(start, "secondary", lineFraction(p, c, base)) : withPoint(start, "P", withinTriangle(p, a, b, c));
  }
  if (start.sceneId === "40" && "ABCD".includes(key) && key.length === 1) {
    let result = withPoint(start, key, p);
    if (start.flags.constraint) {
      const partner = { A: "B", B: "A", C: "D", D: "C" }[key as "A"];
      result = withPoint(result, partner, { ...start.points[partner], y: p.y });
    }
    const v = [result.points.A, result.points.B, result.points.C, result.points.D];
    const turns = v.map((q, i) => cross(sub(v[(i + 1) % 4], q), sub(v[(i + 2) % 4], v[(i + 1) % 4])));
    return turns.every((n) => n > 0.1) || turns.every((n) => n < -0.1) ? result : start;
  }
  if (start.sceneId === "17" && key === "notch") return { ...start, params: { ...start.params, fraction: clamp(p.x / param(start, "base", 6), 0.2, 0.8), secondary: clamp(p.y / param(start, "height", 3.5), 0.2, 0.8) } };
  if (start.sceneId === "46" && key === "cut" && !start.flags.constraint) return withParam(start, "fraction", clamp(p.x / param(start, "base", 6), 0.1, 0.9));
  if (start.sceneId === "59" && ["D", "E"].includes(key)) {
    const apex = point(8, 5.5), end = key === "D" ? point(5.5, 0) : point(11, 0);
    return withParam(start, key === "D" || start.flags.constraint ? "fraction" : "secondary", clamp(lineFraction(p, apex, end), 0.15, 0.85));
  }
  return start;
}
export function snapAreaState(s: PlanarState, target: string): PlanarState | null {
  if (!s.flags.snap || !target.startsWith("piece.")) return null;
  const id = target.slice(6), piece = buildAreaModel(s).pieces.find((entry) => entry.id === id);
  if (!piece || !movableAreaPiece(s, id)) return null;
  const offset = vertex(s, target, point(0, 0)), base = sub(piece.pose, offset);
  const matchesAngle = (angle: number) => Math.abs(((piece.pose.angle - angle + 540) % 360) - 180) < 1e-7;
  const candidates = [point(0, 0), ...(matchesAngle(piece.target.angle) ? [sub(piece.target, base)] : []), ...(matchesAngle(piece.original.angle) ? [sub(piece.original, base)] : [])];
  const nearest = candidates.sort((a, b) => Math.hypot(a.x - offset.x, a.y - offset.y) - Math.hypot(b.x - offset.x, b.y - offset.y))[0];
  return Math.hypot(nearest.x - offset.x, nearest.y - offset.y) < 0.25 ? withPoint(s, target, { x: nearest.x || 0, y: nearest.y || 0 }) : null;
}

/** 拆开已移动的纸片时，两个新片继承同一刚性姿态，切口不会把纸片拉回原地。 */
export function cutNextAreaPaper(s: PlanarState): PlanarState {
  const oldCuts = Math.floor(param(s, "cuts"));
  if (oldCuts >= requiredAreaCuts(s)) return s;
  const previous = buildAreaModel(s).pieces.find((piece) => piece.id === `p${oldCuts}`);
  let next: PlanarState = { ...s, phase: 0, params: { ...s.params, cuts: oldCuts + 1 } };
  if (!previous) return next;
  const ids = [`p${oldCuts}`, `p${oldCuts + 1}`];
  for (const id of ids) next = { ...next, params: { ...next.params, [`turn.${id}`]: previous.pose.angle }, points: { ...next.points, [`piece.${id}`]: point(0, 0) } };
  const newModel = buildAreaModel(next);
  for (const id of ids) {
    const paper = newModel.pieces.find((piece) => piece.id === id);
    if (paper) next = { ...next, points: { ...next.points, [`piece.${id}`]: sub(previous.pose, paper.pose) } };
  }
  return next;
}
