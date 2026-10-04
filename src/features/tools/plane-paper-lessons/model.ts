import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import {
  addConstruction, constructionArea, constructionObject, constructionObjects, isValidConstructionObject,
  parseConstructionTarget, removeConstruction, setConstructionField, type ConstructionObject,
} from "../plane-construction/model";
import { createPaperGeometry, createPaperState } from "../plane-paper/model";
import { isValidPaperState } from "../plane-paper/validation";
import { concaveRegions, concaveRegionsArea } from "../plane-overlap/concave-geometry";
import {
  AREA_LESSON_KINDS, add, bounds, defaultLesson, groupLocalVector, groupWorld, lessonFromObject, lessonRecipe,
  lessonTargets, mean, pieceWorld, rotate, scale, subtract, type AreaLessonGroup, type AreaLessonKind, type LessonArrangement, type LessonPose,
} from "./geometry";

export const AREA_LESSON_SCENE = "14-lessons";
export const MAX_AREA_LESSON_GROUPS = 4;
export const AREA_LESSON_UNIT = 30;
const fields = ["kind", "base", "height", "top", "shear", "fraction", "notch", "axis", "locked", "fill", "cuts", "angle", "flip"] as const;
const globalKeys = ["lessonNextId", "lessonActive", "lessonPiece"];
const flagKeys = ["lessonGuides", "lessonValues"];
const key = (field: string, id: number) => `lesson${field[0].toUpperCase()}${field.slice(1)}.${id}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((entry) => Object.hasOwn(value, entry));
const numeric = (value: unknown, min: number, max: number, integer = false): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const equals = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const boundedAngle = (value: number) => Math.abs(value) <= 36000 ? value : ((value % 360) + 540) % 360 - 180;
const clonePose = (pose: LessonPose): LessonPose => ({ offset: { ...pose.offset }, angle: pose.angle });

export function freePaperState(state: PlanarState): PlanarState {
  const free = <T,>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).filter(([name]) => !name.startsWith("lesson")));
  return { ...state, sceneId: "14-create", params: free(state.params), points: free(state.points), flags: free(state.flags) };
}
export function areaLessonIds(state: PlanarState): number[] {
  return Object.keys(state.params).flatMap((name) => /^lessonKind\.(0|[1-9]\d{0,4})$/.test(name) ? [Number(name.slice(11))] : []).sort((a, b) => a - b);
}
function pieceCount(kind: number, cuts: number, fill: number): number {
  const count = kind === 14 || kind === 15 || kind === 16 ? cuts + 1 : kind === 17 ? (cuts ? 2 : 1) + fill : kind === 46 ? cuts ? 3 : 1 : kind === 58 ? 4 : 0;
  return Number.isInteger(count) && count >= 1 && count <= 16 ? count : 0;
}
export function areaLessonGroup(state: PlanarState, id = state.params.lessonActive): AreaLessonGroup | null {
  if (!Number.isInteger(id) || id < 0 || !Object.hasOwn(state.params, key("kind", id))) return null;
  const values = Object.fromEntries(fields.map((field) => [field, state.params[key(field, id)]])) as Omit<AreaLessonGroup, "id" | "origin" | "poses">;
  return { id, ...values, origin: state.points[`lessonOrigin.${id}`], poses: Array.from({ length: pieceCount(values.kind, values.cuts, values.fill) }, (_, index) => ({ offset: state.points[`lessonOffset.${id}.${index}`], angle: state.params[`lessonTurn.${id}.${index}`] })) };
}
export const areaLessonGroups = (state: PlanarState) => areaLessonIds(state).map((id) => areaLessonGroup(state, id)!);
export function lessonPieceObject(group: AreaLessonGroup, index: number, id = index): ConstructionObject {
  const polygon = pieceWorld(group, lessonRecipe(group).pieces[index], index), box = bounds(polygon), center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  return { id, kind: 0, center, vertices: polygon.map((point) => subtract(point, center)), angle: 0, rx: 0, ry: 0, life: 0, detail: 0, flip: 1 };
}

/** 新字段只属于 v3；自由纸片与派生教学片一起受相同真实材料预算约束。 */
export function isValidAreaLessonState(state: PlanarState): boolean {
  try {
    if (!record(state) || !exactKeys(state, ["sceneId", "params", "points", "flags", "marks", "phase"]) || state.sceneId !== AREA_LESSON_SCENE || state.phase !== 0
      || !record(state.params) || !record(state.points) || !record(state.flags)) return false;
    const free = freePaperState(state);
    if (!isValidPaperState(free) || Object.keys(state.params).length > 256 || Object.keys(state.points).length > 256) return false;
    const p = state.params, ids = areaLessonIds(state);
    if (ids.length > MAX_AREA_LESSON_GROUPS || !numeric(p.lessonNextId, 1, 99999, true) || !numeric(p.lessonActive, -1, 99998, true)
      || !numeric(p.lessonPiece, -1, 15, true) || ids.some((id) => id >= p.lessonNextId || id > 99998)
      || (p.lessonActive !== -1 && !ids.includes(p.lessonActive)) || (p.lessonActive === -1 && p.lessonPiece !== -1)
      || (p.lessonActive !== -1 && p.active !== -1)) return false;
    if (!exactKeys(state.flags, [...Object.keys(free.flags), ...flagKeys]) || flagKeys.some((name) => typeof state.flags[name] !== "boolean")) return false;
    const paramKeys = [...Object.keys(free.params), ...globalKeys], pointKeys = [...Object.keys(free.points)];
    const objects = constructionObjects(free);
    for (const id of ids) {
      const value = (name: string) => p[key(name, id)], kind = value("kind");
      if (!(AREA_LESSON_KINDS as readonly number[]).includes(kind) || !numeric(value("base"), 12, 700) || !numeric(value("height"), 12, 600)
        || !numeric(value("top"), kind === 16 ? 12 : 0, kind === 16 ? 700 : 0) || !numeric(value("shear"), [14, 15, 16].includes(kind) ? -700 : 0, [14, 15, 16].includes(kind) ? 700 : 0)
        || !numeric(value("fraction"), kind === 17 || kind === 46 ? 0.01 : 0, kind === 17 || kind === 46 ? 0.99 : 0)
        || !numeric(value("notch"), kind === 17 ? 0.01 : 0, kind === 17 ? 0.99 : 0)
        || !numeric(value("axis"), 0, kind === 17 ? 1 : 0, true) || !numeric(value("locked"), 0, kind === 46 ? 1 : 0, true)
        || !numeric(value("fill"), 0, kind === 17 ? 1 : 0, true) || !numeric(value("cuts"), kind === 58 ? 1 : 0, kind === 14 ? 15 : 1, true)
        || !numeric(value("angle"), -36000, 36000) || ![-1, 1].includes(value("flip"))
        || kind === 46 && value("locked") === 1 && value("fraction") !== 1 / 3) return false;
      const group = areaLessonGroup(state, id)!, recipe = lessonRecipe(group);
      if (kind === 14 && (recipe.requiredCuts > 15 || group.cuts > recipe.requiredCuts)) return false;
      if (!record(group.origin) || !exactKeys(group.origin, ["x", "y"]) || !numeric(group.origin.x, -1000, 2000) || !numeric(group.origin.y, -1000, 1720)) return false;
      paramKeys.push(...fields.map((field) => key(field, id))); pointKeys.push(`lessonOrigin.${id}`);
      if (!group.poses.length || group.poses.length !== recipe.pieces.length || p.lessonActive === id && (p.lessonPiece < 0 || p.lessonPiece >= group.poses.length)) return false;
      for (let index = 0; index < group.poses.length; index++) {
        const pose = group.poses[index]; paramKeys.push(`lessonTurn.${id}.${index}`); pointKeys.push(`lessonOffset.${id}.${index}`);
        if (!numeric(pose.angle, -36000, 36000) || !record(pose.offset) || !exactKeys(pose.offset, ["x", "y"])
          || !numeric(pose.offset.x, -1600, 1600) || !numeric(pose.offset.y, -1600, 1600)) return false;
        const object = lessonPieceObject(group, index);
        if (!isValidConstructionObject(object)) return false;
        objects.push(object);
      }
    }
    return exactKeys(p, paramKeys) && exactKeys(state.points, pointKeys) && objects.length <= 16 && objects.reduce((sum, object) => sum + object.vertices.length, 0) <= 192;
  } catch { return false; }
}

function writeGroup(state: PlanarState, group: AreaLessonGroup): PlanarState {
  const params = { ...state.params }, points = { ...state.points }, id = group.id;
  Object.keys(params).filter((name) => name.startsWith(`lessonTurn.${id}.`)).forEach((name) => { delete params[name]; });
  Object.keys(points).filter((name) => name.startsWith(`lessonOffset.${id}.`)).forEach((name) => { delete points[name]; });
  for (const field of fields) params[key(field, id)] = group[field];
  points[`lessonOrigin.${id}`] = { ...group.origin };
  group.poses.forEach((pose, index) => { params[`lessonTurn.${id}.${index}`] = pose.angle; points[`lessonOffset.${id}.${index}`] = { ...pose.offset }; });
  return { ...state, params, points };
}
const settle = (before: PlanarState, next: PlanarState) => isValidAreaLessonState(next) && !equals(before, next) ? next : before;
function focusGroup(state: PlanarState, id: number, piece = 0): PlanarState {
  return { ...state, params: { ...state.params, active: -1, lessonActive: id, lessonPiece: piece } };
}
function joinFree(state: PlanarState, free: PlanarState, keepLessonFocus = false): PlanarState {
  const extra = <T,>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).filter(([name]) => name.startsWith("lesson")));
  return { ...free, sceneId: AREA_LESSON_SCENE, params: { ...free.params, ...extra(state.params),
    ...(keepLessonFocus ? {} : { lessonActive: -1, lessonPiece: -1 }) }, points: { ...free.points, ...extra(state.points) }, flags: { ...free.flags, ...extra(state.flags) } };
}
export function changeFreePaper(state: PlanarState, change: (free: PlanarState) => PlanarState, keepLessonFocus = false): PlanarState {
  return settle(state, joinFree(state, change(freePaperState(state)), keepLessonFocus));
}
/** 只用于绘制的投影保留教学组；精确状态入口仍使用 changeFreePaper。 */
export function freePaperFrame(state: PlanarState, free: PlanarState, progress: number): PlanarState {
  const frame = joinFree(state, free, true);
  return { ...frame, params: { ...frame.params, lessonFrame: progress } };
}
export function setAreaLessonFlag(state: PlanarState, name: string, value = !state.flags[name]): PlanarState {
  return flagKeys.includes(name) ? settle(state, { ...state, flags: { ...state.flags, [name]: value } }) : state;
}
export function createAreaLessonState(): PlanarState {
  const state = createPaperState();
  return { ...state, sceneId: AREA_LESSON_SCENE, params: { ...state.params, lessonNextId: 1, lessonActive: -1, lessonPiece: -1 }, flags: { ...state.flags, lessonGuides: false, lessonValues: false } };
}
export function createAreaLessonGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  const next = createPaperGeometry(freePaperState(state), tool, points);
  if (!next) return null;
  const merged = settle(state, joinFree(state, next)); return merged === state ? null : merged;
}
export function addAreaLesson(state: PlanarState, kind: AreaLessonKind): PlanarState {
  const id = state.params.lessonNextId, group = defaultLesson(kind, id);
  const offset = areaLessonIds(state).length * 30; group.origin = add(group.origin, { x: offset, y: offset });
  const next = writeGroup(focusGroup({ ...state, params: { ...state.params, lessonNextId: id + 1 } }, id), group);
  return settle(state, next);
}
export function startAreaLesson(state: PlanarState, kind: AreaLessonKind, selected?: string | null): PlanarState {
  const object = constructionObject(state); if (!object) return state;
  const target = selected ? parseConstructionTarget(selected) : null;
  const group = lessonFromObject(object, kind, target?.type === "edge" && target.id === object.id ? target.part : undefined);
  if (!group) return state;
  group.id = state.params.lessonNextId;
  const free = removeConstruction(freePaperState(state)), joined = joinFree(state, free);
  const next = writeGroup(focusGroup({ ...joined, params: { ...joined.params, lessonNextId: group.id + 1 } }, group.id), group);
  return settle(state, next);
}
export function removeAreaLesson(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group) return state;
  const params = { ...state.params }, points = { ...state.points };
  for (const field of fields) delete params[key(field, group.id)];
  Object.keys(params).filter((name) => name.startsWith(`lessonTurn.${group.id}.`)).forEach((name) => { delete params[name]; });
  Object.keys(points).filter((name) => name === `lessonOrigin.${group.id}` || name.startsWith(`lessonOffset.${group.id}.`)).forEach((name) => { delete points[name]; });
  params.lessonActive = -1; params.lessonPiece = -1;
  return settle(state, { ...state, params, points });
}
export function duplicateAreaLesson(state: PlanarState): PlanarState {
  const source = areaLessonGroup(state); if (!source) return state;
  const id = state.params.lessonNextId, group = { ...source, id, origin: add(source.origin, { x: 45, y: 45 }), poses: source.poses.map(clonePose) };
  return settle(state, writeGroup(focusGroup({ ...state, params: { ...state.params, lessonNextId: id + 1 } }, id), group));
}
/** 解组保留每片当前真实位置；之后复用原剪刀、顶点编辑和镜像，不留失效的教学关联。 */
export function releaseAreaLesson(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group) return state;
  let next = removeAreaLesson(state);
  let free: PlanarState = { ...freePaperState(next), flags: { ...freePaperState(next).flags, snap: false } };
  for (const [index, piece] of lessonRecipe(group).pieces.entries()) {
    const changed = addConstruction(free, "polygon", pieceWorld(group, piece, index));
    if (changed === free) return state; free = changed;
  }
  free = { ...free, flags: freePaperState(state).flags }; next = joinFree(next, free);
  return settle(state, next);
}
export function cutAreaLesson(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group || group.kind === 58) return state;
  const recipe = lessonRecipe(group); if (group.cuts >= recipe.requiredCuts) return state;
  const next = { ...group, cuts: group.cuts + 1, poses: [] as LessonPose[] };
  if (group.kind === 14) next.poses = [...group.poses.slice(0, -1).map(clonePose), clonePose(group.poses.at(-1)!), clonePose(group.poses.at(-1)!)];
  else if (group.kind === 15 || group.kind === 16) next.poses = [clonePose(group.poses[0]), { angle: group.poses[0].angle, offset: add(group.poses[0].offset, { x: 36, y: 36 }) }];
  else {
    next.poses = lessonRecipe(next).pieces.map((piece) => clonePose(piece.added ? group.poses.at(-1)! : group.poses[0]));
  }
  return settle(state, writeGroup(state, next));
}
export function arrangeAreaLesson(state: PlanarState, arrangement: LessonArrangement): PlanarState {
  const group = areaLessonGroup(state); if (!group) return state;
  if ((arrangement === "arrange" || arrangement === "separate") && group.cuts !== lessonRecipe(group).requiredCuts) return state;
  return settle(state, writeGroup(state, { ...group, poses: lessonTargets(group, arrangement) }));
}
export function resetAreaLesson(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group) return state;
  const next = { ...group, cuts: group.kind === 58 ? 1 : 0 };
  return settle(state, writeGroup(focusGroup(state, group.id), { ...next, poses: lessonTargets(next, "origin") }));
}
export function alternateAreaLessonBase(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group || group.kind !== 14 || group.cuts) return state;
  const candidate = lessonFromObject(lessonPieceObject(group, 0), 14, 1); if (!candidate) return state;
  return settle(state, writeGroup(state, { ...candidate, id: group.id }));
}
export function toggleAreaLessonFill(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group || group.kind !== 17) return state;
  const fill = 1 - group.fill, poses = fill ? [...group.poses.map(clonePose), { offset: { x: 0, y: 0 }, angle: 0 }] : group.poses.slice(0, -1).map(clonePose);
  const next = writeGroup(state, { ...group, fill, poses });
  return settle(state, focusGroup(next, group.id, Math.min(state.params.lessonPiece, poses.length - 1)));
}
export function toggleAreaLessonLock(state: PlanarState): PlanarState {
  const group = areaLessonGroup(state); if (!group || group.kind !== 46) return state;
  const next = { ...group, locked: 1 - group.locked, fraction: group.locked ? group.fraction : 1 / 3 };
  if (next.locked) next.poses = lessonTargets(next, "origin");
  return settle(state, writeGroup(state, next));
}

export function parseAreaLessonTarget(target: string) {
  const match = /^(lesson|lesson-group|lesson-cut|lesson-notch)\.(0|[1-9]\d{0,4})(?:\.(0|[1-9]|1[0-5]))?$/.exec(target);
  return match ? { type: match[1], id: Number(match[2]), piece: match[3] === undefined ? 0 : Number(match[3]) } : null;
}
export function tapAreaLesson(state: PlanarState, target: string): PlanarState {
  const parsed = parseAreaLessonTarget(target), group = parsed ? areaLessonGroup(state, parsed.id) : null;
  return parsed && group && parsed.piece < group.poses.length ? focusGroup(state, group.id, parsed.piece) : state;
}
export function setAreaLessonField(state: PlanarState, field: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  const group = areaLessonGroup(state);
  if (!field.startsWith("lesson")) return changeFreePaper(state, (free) => setConstructionField(free, field, value), !!group);
  if (!group) return state;
  let next = { ...group, poses: group.poses.map(clonePose) };
  const fieldName = field.slice(6); const name = fieldName[0]?.toLowerCase() + fieldName.slice(1);
  if (["base", "height", "top", "shear", "fraction", "notch", "axis"].includes(name)) {
    if (name === "fraction" && group.kind === 46 && group.locked) return state;
    next = { ...next, [name]: value, cuts: group.kind === 14 ? 0 : group.cuts };
    next.poses = lessonTargets(next, "origin");
  } else if (field === "lessonOriginX" || field === "lessonOriginY") next.origin = { ...group.origin, [field === "lessonOriginX" ? "x" : "y"]: value };
  else if (field === "lessonAngle") next.angle = value;
  else if (["lessonPieceX", "lessonPieceY", "lessonPieceAngle"].includes(field)) {
    const index = state.params.lessonPiece, piece = lessonRecipe(group).pieces[index]; if (!piece) return state;
    const center = mean(pieceWorld(group, piece, index)), pose = next.poses[index];
    if (field === "lessonPieceAngle") {
      const angle = (value - group.angle) * group.flip, localCenter = mean(piece.points), currentCenter = add(rotate(localCenter, pose.angle), pose.offset);
      pose.offset = subtract(currentCenter, rotate(localCenter, angle)); pose.angle = angle;
    } else pose.offset = add(pose.offset, groupLocalVector(group, field === "lessonPieceX" ? { x: value - center.x, y: 0 } : { x: 0, y: value - center.y }));
  } else return state;
  return settle(state, writeGroup(focusGroup(state, group.id, Math.min(state.params.lessonPiece, next.poses.length - 1)), next));
}
export function dragAreaLesson(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  const parsed = parseAreaLessonTarget(target), group = parsed ? areaLessonGroup(state, parsed.id) : null;
  if (!parsed || !group || parsed.piece >= group.poses.length) return state;
  const focused = focusGroup(state, group.id, parsed.piece), localDelta = groupLocalVector(group, delta);
  if (parsed.type === "lesson-cut" && group.kind === 46 && !group.locked) return setAreaLessonField(focused, "lessonFraction", Math.max(0.01, Math.min(0.99, group.fraction - localDelta.x / group.base)));
  if (parsed.type === "lesson-notch" && group.kind === 17) {
    const fraction = Math.max(0.01, Math.min(0.99, group.fraction + localDelta.x / group.base)), notch = Math.max(0.01, Math.min(0.99, group.notch + localDelta.y / group.height));
    const next = { ...group, fraction, notch }; next.poses = lessonTargets(next, "origin");
    return settle(state, writeGroup(focused, next));
  }
  if (parsed.type === "lesson-group") return settle(state, writeGroup(focused, { ...group, origin: add(group.origin, delta) }));
  if (parsed.type !== "lesson") return state;
  const poses = group.poses.map(clonePose); poses[parsed.piece].offset = add(poses[parsed.piece].offset, localDelta);
  return settle(state, writeGroup(focused, { ...group, poses }));
}
export function transformAreaLessonPiece(state: PlanarState, operation: "translate" | "rotate"): PlanarState {
  const group = areaLessonGroup(state), index = state.params.lessonPiece;
  if (!group || !group.poses[index]) return state;
  const poses = group.poses.map(clonePose), pose = poses[index];
  if (operation === "translate") pose.offset = add(pose.offset, groupLocalVector(group, { x: state.params.dx, y: state.params.dy }));
  else {
    const origin = groupWorld(group, pose.offset), pivot = state.points.pivot;
    const moved = add(pivot, rotate(subtract(origin, pivot), state.params.turn));
    pose.offset = groupLocalVector(group, subtract(moved, group.origin)); pose.angle = boundedAngle(pose.angle + group.flip * state.params.turn);
  }
  return settle(state, writeGroup(state, { ...group, poses }));
}

/** 切线推进是表现帧；分片直到整刀结束才入数学状态。所有搬片帧均做姿态插值，不插值顶点。 */
export function interpolateAreaLesson(from: PlanarState, to: PlanarState, progress: number, cutting = false, sequential = false): PlanarState {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const before = areaLessonGroup(from), after = before ? areaLessonGroup(to, before.id) : null;
  if (!before || !after) return from;
  if (cutting && ![15, 16].includes(before.kind)) return { ...from, params: { ...from.params, lessonFrame: progress, lessonCutFrame: progress } };
  const poses = after.poses.map((pose, index) => {
    const start = before.poses[index] ?? before.poses[0], t = sequential ? Math.max(0, Math.min(1, progress * after.poses.length - index)) : progress;
    return { offset: add(start.offset, scale(subtract(pose.offset, start.offset), t)), angle: start.angle + (pose.angle - start.angle) * t };
  });
  const frame = writeGroup(to, { ...after, poses });
  return { ...frame, params: { ...frame.params, lessonFrame: progress } };
}
export function interpolateAreaLessonTransform(from: PlanarState, to: PlanarState, progress: number, operation: "translate" | "rotate"): PlanarState {
  if (operation === "translate") return interpolateAreaLesson(from, to, progress);
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const before = areaLessonGroup(from), index = from.params.lessonPiece;
  if (!before || !before.poses[index]) return from;
  const poses = before.poses.map(clonePose), pose = poses[index];
  const pivot = groupLocalVector(before, subtract(from.points.pivot, before.origin)), angle = from.params.turn * before.flip * progress;
  pose.offset = add(pivot, rotate(subtract(pose.offset, pivot), angle)); pose.angle += angle;
  const frame = writeGroup(from, { ...before, poses });
  return { ...frame, params: { ...frame.params, lessonFrame: progress } };
}
export function areaLessonMeasures(group: AreaLessonGroup) {
  const recipe = lessonRecipe(group), source = constructionArea(recipe.source), areas = recipe.pieces.map((piece) => constructionArea(piece.points));
  const added = recipe.pieces.reduce((sum, piece, index) => sum + (piece.added ? areas[index] : 0), 0);
  let remainingRegions: Point[][] = [];
  if (group.kind === 58) {
    remainingRegions = [recipe.frame.map((point) => groupWorld(group, point))];
    recipe.pieces.forEach((piece, index) => {
      const polygon = pieceWorld(group, piece, index);
      remainingRegions = remainingRegions.flatMap((region) => concaveRegions(region, polygon)?.difference ?? []);
    });
  }
  return { source, areas, total: areas.reduce((sum, area) => sum + area, 0), added, frame: constructionArea(recipe.frame), remaining: concaveRegionsArea(remainingRegions), remainingRegions };
}
export function areaLessonSelection(before: PlanarState, after: PlanarState, selected: string | null) {
  const group = areaLessonGroup(after);
  if (group && (before.params.lessonActive !== after.params.lessonActive || before.params.lessonPiece !== after.params.lessonPiece || !selected?.startsWith("lesson"))) return `lesson.${group.id}.${after.params.lessonPiece}`;
  const parsed = selected ? parseAreaLessonTarget(selected) : null;
  if (parsed) return group && parsed.piece < group.poses.length ? selected : after.params.active >= 0 ? `object.${after.params.active}` : null;
  return after.params.active >= 0 && before.params.active !== after.params.active ? `object.${after.params.active}` : after.params.active === -1 && !group ? null : selected;
}
