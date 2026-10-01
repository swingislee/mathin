import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import {
  addConstruction, constructionArea, constructionObject, constructionObjects, createConstructionState,
  moveConstruction, parseConstructionTarget, removeConstruction, setConstructionField, tapConstruction, worldVertices,
} from "../plane-construction/model";
import { between, crossAt, isConvexMaterial } from "./geometry";
import { isValidRelationsState, RELATION_FLAGS, RELATION_PARAMS } from "./validation";

export const RELATIONS_SCENE_ID = "18-create";
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const objectSuffix = (key: string, prefixes: readonly string[]) => prefixes.some((prefix) => key.startsWith(`${prefix}.`));
export const relationFlag = (state: PlanarState, key: string, id = state.params.active) => !!state.flags[`${key}.${id}`];

/** 新材料使用独立观察参数；复制当前材料只复制数值，不保留对原件的依赖。 */
export function syncRelations(before: PlanarState, next: PlanarState, copyFrom?: number): PlanarState {
  if (before === next) return before;
  const params = Object.fromEntries(Object.entries(next.params).filter(([key]) => !objectSuffix(key, RELATION_PARAMS)));
  const flags = Object.fromEntries(Object.entries(next.flags).filter(([key]) => !objectSuffix(key, RELATION_FLAGS)));
  for (const object of constructionObjects(next)) {
    const source = constructionObject(before, object.id) ? object.id : copyFrom;
    params[`base.${object.id}`] = source === undefined ? 0 : before.params[`base.${source}`] ?? 0;
    params[`fraction.${object.id}`] = source === undefined ? 0.5 : before.params[`fraction.${source}`] ?? 0.5;
    for (const key of RELATION_FLAGS) flags[`${key}.${object.id}`] = source === undefined ? false : !!before.flags[`${key}.${source}`];
  }
  const candidate = { ...next, params, flags };
  return isValidRelationsState(candidate) ? candidate : before;
}

export function createRelationsState(): PlanarState {
  const empty = removeConstruction(createConstructionState(RELATIONS_SCENE_ID));
  return syncRelations(empty, addConstruction(empty, "polygon", [{ x: 220, y: 470 }, { x: 620, y: 470 }, { x: 350, y: 220 }]));
}

export function createRelationGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  if (tool !== "polygon" && tool !== "rectangle") return null;
  const candidate = syncRelations(state, addConstruction(state, tool, points));
  return candidate === state ? null : candidate;
}

export const RELATION_MATERIALS = [
  { id: "triangle", zh: "三角形", en: "Triangle", points: [{ x: -155, y: 100 }, { x: 155, y: 100 }, { x: -45, y: -100 }] },
  { id: "quadrilateral", zh: "凸四边形", en: "Convex quadrilateral", points: [{ x: -145, y: 85 }, { x: 145, y: 85 }, { x: 80, y: -95 }, { x: -85, y: -65 }] },
  { id: "rectangle", zh: "长方形", en: "Rectangle", points: [{ x: -140, y: -90 }, { x: 140, y: -90 }, { x: 140, y: 90 }, { x: -140, y: 90 }] },
] as const;

export function addRelationMaterial(state: PlanarState, id: string): PlanarState {
  const material = RELATION_MATERIALS.find((entry) => entry.id === id);
  if (!material) return state;
  const count = constructionObjects(state).length, center = { x: 390 + count % 3 * 70, y: 300 + count % 2 * 55 };
  const points = material.points.map((point) => ({ x: point.x + center.x, y: point.y + center.y }));
  return createRelationGeometry(state, "polygon", points) ?? state;
}

export function relationModel(state: PlanarState, id = state.params.active) {
  const object = constructionObject(state, id);
  if (!object || object.kind > 1 || ![3, 4].includes(object.vertices.length)) return null;
  const points = worldVertices(object), count = points.length, edge = state.params[`base.${id}`] ?? 0;
  const a = points[edge], b = points[(edge + 1) % count], opposite = points.filter((_, index) => index !== edge && index !== (edge + 1) % count);
  if (!a || !b) return null;
  const fraction = state.params[`fraction.${id}`] ?? 0.5, division = between(a, b, fraction);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const heights = opposite.map((vertex) => ({ vertex, baseA: a, baseB: b, amount: Math.abs(crossAt(a, b, vertex)) / length }));
  let intersection: Point | null = null;
  if (count === 4) {
    const [p, q, r, s] = points, ux = r.x - p.x, uy = r.y - p.y, vx = s.x - q.x, vy = s.y - q.y;
    const denominator = ux * vy - uy * vx;
    if (Math.abs(denominator) > 1e-7) intersection = between(p, r, ((q.x - p.x) * vy - (q.y - p.y) * vx) / denominator);
  }
  const parts = count === 3 && relationFlag(state, "division", id) ? [[a, division, opposite[0]], [division, b, opposite[0]]]
    : intersection && relationFlag(state, "diagonals", id) ? points.map((point, index) => [point, points[(index + 1) % count], intersection!]) : [];
  const inner = count === 3 ? points.map((point, index) => between(point, points[(index + 1) % count], 0.5)) : [];
  return { object, points, a, b, division, fraction, length, heights, parts, inner, intersection, area: constructionArea(points) };
}

export function setRelationFlag(state: PlanarState, key: typeof RELATION_FLAGS[number], value = !relationFlag(state, key)): PlanarState {
  if (!constructionObject(state)) return state;
  const candidate = { ...state, flags: { ...state.flags, [`${key}.${state.params.active}`]: value } };
  return isValidRelationsState(candidate) ? candidate : state;
}

export function setRelationField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  const object = constructionObject(state);
  if (key === "heightLock") return object?.vertices.length === 3 ? setRelationFlag(state, "parallel", value >= 0.5) : state;
  if (key === "divisionRatio") {
    if (object?.vertices.length !== 3) return state;
    return { ...state, params: { ...state.params, [`fraction.${object.id}`]: clamp(value, 0.05, 0.95) } };
  }
  if ((key === "width" || key === "height") && relationFlag(state, "parallel")) return state;
  return syncRelations(state, setConstructionField(state, key, value));
}

export function tapRelation(state: PlanarState, target: string): PlanarState {
  const division = /^division\.(0|[1-9]\d{0,4})$/.exec(target);
  if (division) {
    const id = Number(division[1]);
    return constructionObject(state, id)?.vertices.length === 3 ? { ...state, params: { ...state.params, active: id } } : state;
  }
  const parsed = parseConstructionTarget(target), next = tapConstruction(state, target);
  if (parsed?.type !== "edge" || parsed.id === undefined || parsed.part === undefined) return next;
  const object = constructionObject(state, parsed.id);
  if (!object || parsed.part >= object.vertices.length) return state;
  return { ...next, params: { ...next.params, [`base.${object.id}`]: parsed.part }, flags: { ...next.flags, [`height.${object.id}`]: true } };
}

export function dragRelation(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  if (![point.x, point.y, delta.x, delta.y].every(Number.isFinite)) return state;
  const division = /^division\.(0|[1-9]\d{0,4})$/.exec(target);
  if (division) {
    const id = Number(division[1]), model = relationModel(state, id);
    if (!model || model.points.length !== 3 || !relationFlag(state, "division", id)) return state;
    const dx = model.b.x - model.a.x, dy = model.b.y - model.a.y;
    const fraction = clamp(model.fraction + (delta.x * dx + delta.y * dy) / (dx * dx + dy * dy), 0.05, 0.95);
    return { ...state, params: { ...state.params, active: id, [`fraction.${id}`]: fraction } };
  }
  const parsed = parseConstructionTarget(target);
  if (parsed?.type === "edge" && !state.flags.edit) target = `object.${parsed.id}`;
  if (parsed?.type === "vertex" && parsed.id !== undefined && relationFlag(state, "parallel", parsed.id)) {
    const model = relationModel(state, parsed.id);
    if (!model || model.points.length !== 3) return state;
    const dx = model.b.x - model.a.x, dy = model.b.y - model.a.y, t = (delta.x * dx + delta.y * dy) / (dx * dx + dy * dy);
    // 网格吸附不能把锁定高的顶点拉离真实平行线。
    const free = { ...state, flags: { ...state.flags, snap: false } };
    const moved = moveConstruction(free, target, point, { x: dx * t, y: dy * t });
    if (moved === free) return state;
    return syncRelations(state, { ...moved, flags: { ...moved.flags, snap: state.flags.snap } });
  }
  return syncRelations(state, moveConstruction(state, target, point, delta));
}

export function copyMidpointTriangle(state: PlanarState): PlanarState {
  const model = relationModel(state);
  if (!model || model.points.length !== 3 || !relationFlag(state, "midpoints") || !isConvexMaterial(model.inner, true)) return state;
  const points = model.inner.map((point) => ({ x: point.x + 65, y: point.y + 65 }));
  return createRelationGeometry(state, "polygon", points) ?? state;
}
