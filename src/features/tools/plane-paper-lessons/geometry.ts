import type { PlanarPoint as Point } from "../planar-kit/contract";
import { constructionCorners, type ConstructionObject } from "../plane-construction/model";

export const AREA_LESSON_KINDS = [14, 15, 16, 17, 46, 58] as const;
export type AreaLessonKind = (typeof AREA_LESSON_KINDS)[number];
export interface LessonPose { offset: Point; angle: number }
export interface AreaLessonGroup {
  id: number; kind: AreaLessonKind; origin: Point; angle: number; flip: number;
  base: number; height: number; top: number; shear: number; fraction: number; notch: number;
  axis: number; locked: number; fill: number; cuts: number; poses: LessonPose[];
}
export interface LessonPiece { points: Point[]; added: boolean; band: number }
export interface LessonRecipe { source: Point[]; pieces: LessonPiece[]; requiredCuts: number; cuttingLines: [Point, Point][]; frame: Point[] }

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, amount: number): Point => ({ x: a.x * amount, y: a.y * amount });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const length = (a: Point) => Math.hypot(a.x, a.y);
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const rotate = (point: Point, angle: number): Point => {
  const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  return { x: cosine * point.x - sine * point.y, y: sine * point.x + cosine * point.y };
};
export const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];
export const mean = (points: readonly Point[]): Point => scale(points.reduce(add, { x: 0, y: 0 }), 1 / points.length);
export function bounds(points: readonly Point[]) {
  const minX = Math.min(...points.map((point) => point.x)), maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y)), maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function groupWorld(group: AreaLessonGroup, point: Point): Point {
  return add(group.origin, rotate({ x: point.x, y: point.y * group.flip }, group.angle));
}
export function groupLocalVector(group: AreaLessonGroup, vector: Point): Point {
  const local = rotate(vector, -group.angle);
  return { x: local.x, y: local.y * group.flip };
}
export function pieceWorld(group: AreaLessonGroup, piece: LessonPiece, index: number): Point[] {
  const pose = group.poses[index];
  return piece.points.map((point) => groupWorld(group, add(rotate(point, pose.angle), pose.offset)));
}

/** 直边剖分保留解析交点；只去除重复点与同向共线点，几何门仍由材料合同统一执行。 */
function clean(points: Point[]): Point[] {
  let result = points.filter((point, index) => length(subtract(point, points[(index + 1) % points.length])) > 1e-7);
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    result = result.filter((point, index) => {
      const before = result[(index + result.length - 1) % result.length], after = result[(index + 1) % result.length];
      if (Math.abs(cross(subtract(point, before), subtract(after, point))) <= 1e-7 && dot(subtract(point, before), subtract(after, point)) >= 0) { changed = true; return false; }
      return true;
    });
  }
  return result;
}
function clipX(points: readonly Point[], x: number, sign: number): Point[] {
  const output: Point[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length], da = (a.x - x) * sign, db = (b.x - x) * sign;
    if (da >= 0) output.push({ ...a });
    if (da > 0 && db < 0 || da < 0 && db > 0) {
      const t = da / (da - db); output.push({ x, y: a.y + (b.y - a.y) * t });
    }
  }
  return clean(output);
}
const paper = (points: Point[], added = false, band = 0): LessonPiece => ({ points, added, band });

export function lessonRecipe(group: AreaLessonGroup): LessonRecipe {
  const { kind, base: b, height: h, top, shear: s, fraction, notch, cuts } = group;
  const recipe: LessonRecipe = { source: [], pieces: [], requiredCuts: 1, cuttingLines: [], frame: [] };
  if (kind === 14) {
    recipe.source = [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b + s, y: h }, { x: s, y: h }];
    recipe.requiredCuts = Math.ceil(Math.abs(s) / b);
    const firstBand = s < 0 ? -recipe.requiredCuts : 0;
    for (let index = 0; index < recipe.requiredCuts; index++) {
      const x = (firstBand + index + 1) * b;
      const low = Math.max(0, Math.min(h, (x - b) * h / s)), high = Math.max(0, Math.min(h, x * h / s));
      recipe.cuttingLines.push([{ x, y: Math.min(low, high) }, { x, y: Math.max(low, high) }]);
    }
    for (let index = 0; index <= cuts; index++) {
      const band = firstBand + index;
      let polygon = index ? clipX(recipe.source, band * b, 1) : recipe.source.map((point) => ({ ...point }));
      if (index < cuts) polygon = clipX(polygon, (band + 1) * b, -1);
      recipe.pieces.push(paper(polygon, false, band));
    }
    recipe.frame = rectangle(0, 0, b, h);
  } else if (kind === 15 || kind === 16) {
    recipe.source = kind === 15 ? [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: s, y: h }]
      : [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: s + top, y: h }, { x: s, y: h }];
    recipe.pieces = Array.from({ length: cuts + 1 }, () => paper(recipe.source.map((point) => ({ ...point }))));
    const combinedBase = kind === 15 ? b : b + top;
    recipe.frame = [{ x: 0, y: 0 }, { x: combinedBase, y: 0 }, { x: combinedBase + s, y: h }, { x: s, y: h }];
  } else if (kind === 17) {
    const x = b * fraction, y = h * notch;
    recipe.source = [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b, y }, { x, y }, { x, y: h }, { x: 0, y: h }];
    recipe.pieces = !cuts ? [paper(recipe.source)] : group.axis === 0
      ? [paper(rectangle(0, 0, b, y)), paper(rectangle(0, y, x, h - y))]
      : [paper(rectangle(0, 0, x, h)), paper(rectangle(x, 0, b - x, y))];
    if (group.fill) recipe.pieces.push(paper(rectangle(x, y, b - x, h - y), true));
    recipe.cuttingLines = group.axis === 0 ? [[{ x: 0, y }, { x, y }]] : [[{ x, y: 0 }, { x, y }]];
    recipe.frame = rectangle(0, 0, b, h);
  } else if (kind === 46) {
    const x = b * (1 - fraction), ratio = (Math.sqrt(5) - 1) / 2, y = h * ratio, intersection = x * (1 - ratio);
    recipe.source = rectangle(0, 0, b, h);
    // 一片三角形与两片不全等梯形；ratio² + ratio = 1 保证锁定时三片等面积。
    recipe.pieces = !cuts ? [paper(recipe.source)] : [paper([{ x: 0, y: 0 }, { x, y: 0 }, { x: 0, y: h }]),
      paper([{ x, y: 0 }, { x: b, y: 0 }, { x: b, y }, { x: intersection, y }]),
      paper([{ x: intersection, y }, { x: b, y }, { x: b, y: h }, { x: 0, y: h }])];
    recipe.cuttingLines = [[{ x, y: 0 }, { x: 0, y: h }], [{ x: intersection, y }, { x: b, y }]];
    recipe.frame = recipe.source;
  } else {
    recipe.source = [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: 0, y: h }];
    recipe.pieces = Array.from({ length: 4 }, () => paper(recipe.source.map((point) => ({ ...point }))));
    recipe.frame = rectangle(0, 0, b + h, b + h);
  }
  return recipe;
}

export type LessonArrangement = "origin" | "arrange" | "separate" | "central" | "two-squares";
export function lessonTargets(group: AreaLessonGroup, arrangement: LessonArrangement): LessonPose[] {
  const recipe = lessonRecipe(group), { base: b, height: h, top, shear: s } = group;
  if (group.kind === 58) {
    const size = b + h;
    const values = arrangement === "two-squares" ? [[0, 0, 0], [b, h, 180], [size, h, 90], [b, size, 270]]
      : [[0, 0, 0], [size, 0, 90], [size, size, 180], [0, size, 270]];
    return values.map(([x, y, angle]) => ({ offset: { x, y }, angle }));
  }
  return recipe.pieces.map((piece, index) => {
    if (arrangement === "arrange" && group.kind === 14) return { offset: { x: -piece.band * b, y: 0 }, angle: 0 };
    if (arrangement === "arrange" && (group.kind === 15 || group.kind === 16) && index === 1) return { offset: { x: b + s + (group.kind === 16 ? top : 0), y: h }, angle: 180 };
    if (arrangement === "separate") return { offset: { x: (index - (recipe.pieces.length - 1) / 2) * 70, y: index % 2 ? -30 : 30 }, angle: 0 };
    return { offset: { x: index && (group.kind === 15 || group.kind === 16) ? 36 : 0, y: index && (group.kind === 15 || group.kind === 16) ? 36 : 0 }, angle: 0 };
  });
}

const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const samePoint = (a: Point, b: Point) => near(a.x, b.x) && near(a.y, b.y);
export function defaultLesson(kind: AreaLessonKind, id = 0): AreaLessonGroup {
  const group: AreaLessonGroup = { id, kind, origin: { x: 260, y: 230 }, angle: 0, flip: 1,
    base: kind === 58 ? 90 : 240, height: kind === 58 ? 120 : 180, top: kind === 16 ? 120 : 0,
    shear: [14, 15, 16].includes(kind) ? 75 : 0, fraction: kind === 46 ? 1 / 3 : kind === 17 ? 0.55 : 0,
    notch: kind === 17 ? 0.5 : 0, axis: 0, locked: kind === 46 ? 1 : 0, fill: 0, cuts: kind === 58 ? 1 : 0, poses: [] };
  group.poses = lessonTargets(group, "origin"); return group;
}

/** 从老师的真实轮廓识别教学所需的数学类；编辑控制点不改变所选边与真实轮廓。 */
export function lessonFromObject(object: ConstructionObject, kind: AreaLessonKind, edge?: number): AreaLessonGroup | null {
  if (object.kind >= 2 || object.basis) return null;
  const corners = constructionCorners(object), vertices = corners.map((corner) => corner.point);
  if (edge !== undefined && (!Number.isInteger(edge) || edge < 0 || edge >= object.vertices.length)) return null;
  const group = defaultLesson(kind), edgeOrder = edge === undefined ? vertices.map((_, index) => index)
    : [corners.findIndex((corner, index) => {
      const next = corners[(index + 1) % corners.length].index;
      return corner.index < next ? edge >= corner.index && edge < next : edge >= corner.index || edge < next;
    })];
  if (kind === 58) {
    if (vertices.length !== 3) return null;
    for (let index = 0; index < 3; index++) {
      const origin = vertices[index], u = subtract(vertices[(index + 1) % 3], origin), v = subtract(vertices[(index + 2) % 3], origin);
      if (Math.abs(dot(u, v)) > 1e-6 * length(u) * length(v)) continue;
      return { ...group, origin, base: length(u), height: length(v), angle: Math.atan2(u.y, u.x) * 180 / Math.PI, flip: Math.sign(cross(u, v)), poses: lessonTargets({ ...group, base: length(u), height: length(v) }, "origin") };
    }
    return null;
  }
  if (kind === 17) {
    if (vertices.length !== 6) return null;
    for (const index of edgeOrder) for (const flip of [1, -1]) {
      const anchor = vertices[index], edgeVector = subtract(vertices[(index + 1) % vertices.length], anchor), angle = Math.atan2(edgeVector.y, edgeVector.x) * 180 / Math.PI;
      const frame = { ...group, origin: anchor, angle, flip }, local = vertices.map((point) => groupLocalVector(frame, subtract(point, anchor))), box = bounds(local);
      const normalized = local.map((point) => subtract(point, { x: box.minX, y: box.minY }));
      const interior = normalized.find((point) => point.x > 1e-6 && point.x < box.width - 1e-6 && point.y > 1e-6 && point.y < box.height - 1e-6);
      if (!interior) continue;
      const candidate = { ...frame, origin: groupWorld(frame, { x: box.minX, y: box.minY }), base: box.width, height: box.height, fraction: interior.x / box.width, notch: interior.y / box.height };
      const expected = lessonRecipe(candidate).source;
      if (normalized.every((point) => expected.some((other) => samePoint(point, other)))) return candidate;
    }
    return null;
  }
  if (vertices.length !== (kind === 15 ? 3 : 4)) return null;
  for (const index of edgeOrder) {
    const origin = vertices[index], next = vertices[(index + 1) % vertices.length], opposite = vertices[(index + vertices.length - 1) % vertices.length];
    const u = subtract(next, origin), b = length(u), direction = scale(u, 1 / b), displacement = subtract(opposite, origin), signedHeight = cross(direction, displacement);
    if (Math.abs(signedHeight) < 1e-7) continue;
    const s = dot(direction, displacement), h = Math.abs(signedHeight), angle = Math.atan2(u.y, u.x) * 180 / Math.PI, flip = Math.sign(signedHeight);
    const candidate = { ...group, origin, angle, flip, base: b, height: h, shear: Math.abs(s) < 1e-7 ? 0 : s };
    if (kind === 15) return candidate;
    const third = groupLocalVector(candidate, subtract(vertices[(index + 2) % 4], origin));
    if (!near(third.y, h)) continue;
    const top = third.x - s;
    if (top <= 0) continue;
    if (kind === 16) return { ...candidate, top };
    if (!near(top, b)) continue;
    if (kind === 14) return candidate;
    if (near(s, 0)) return { ...candidate, shear: 0 };
  }
  return null;
}
