import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { constructionObject, constructionObjects, removeConstruction } from "../plane-construction/model";
import { between, crossAt } from "./geometry";
import { createRelationGeometry, createRelationsState, dragRelation, relationFlag, relationModel, setRelationField, syncRelations, tapRelation } from "./model";
import { INTERIOR_FLAGS, INTERIOR_PARAMS, INTERIOR_SCENE_ID, interiorBaseState, isValidInteriorState } from "./interior-validation";

const clamp = (value: number) => Math.max(0.05, Math.min(0.95, value));

function extend(before: PlanarState | null, base: PlanarState, copyFrom?: number): PlanarState {
  const params = { ...base.params }, flags = { ...base.flags };
  for (const object of constructionObjects(base)) {
    const source = before && constructionObject(before, object.id) ? object.id : copyFrom;
    for (const key of INTERIOR_PARAMS) params[`${key}.${object.id}`] = source === undefined ? (key === "innerBase" ? 0.5 : 0.4) : before?.params[`${key}.${source}`] ?? 0.5;
    for (const key of INTERIOR_FLAGS) flags[`${key}.${object.id}`] = object.vertices.length === 3 && source !== undefined && !!before?.flags[`${key}.${source}`];
    if (flags[`collinear.${object.id}`]) params[`innerBase.${object.id}`] = params[`fraction.${object.id}`];
  }
  return { ...base, sceneId: INTERIOR_SCENE_ID, params, flags };
}

export const createInteriorState = () => extend(null, createRelationsState());

/** v2 数学终点不接收新字段；v3 元数据按材料归属恢复，复制只复制数值。 */
export function applyInteriorBase(state: PlanarState, run: (base: PlanarState) => PlanarState, copyFrom?: number): PlanarState {
  const base = interiorBaseState(state), result = run(base);
  if (result === base) return state;
  const candidate = extend(state, result, copyFrom);
  return isValidInteriorState(candidate) ? candidate : state;
}

export function interiorModel(state: PlanarState, id = state.params.active) {
  const model = relationModel(state, id);
  if (!model || model.points.length !== 3 || state.sceneId !== INTERIOR_SCENE_ID) return null;
  const u = state.params[`innerBase.${id}`], v = state.params[`innerHeight.${id}`];
  const c = model.heights[0].vertex, footOnBase = between(model.a, model.b, u), point = between(footOnBase, c, v);
  const parts = [[model.a, model.division, point], [model.division, model.b, point], [model.b, c, point], [c, model.a, point]];
  return { ...model, c, point, u, v, parts, common: [model.a, model.b, point], collinear: relationFlag(state, "collinear", id) };
}

export function setInteriorField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (!["innerBase", "innerHeight", "innerConstraint"].includes(key)) return applyInteriorBase(state, (base) => setRelationField(base, key, value));
  const model = interiorModel(state);
  if (!model || key === "innerBase" && model.collinear) return state;
  const id = model.object.id;
  const candidate = key === "innerConstraint"
    ? { ...state, params: { ...state.params, [`innerBase.${id}`]: value >= 0.5 ? model.fraction : model.u }, flags: { ...state.flags, [`collinear.${id}`]: value >= 0.5 } }
    : { ...state, params: { ...state.params, [`${key}.${id}`]: clamp(value) } };
  return isValidInteriorState(candidate) ? candidate : state;
}

export function toggleInterior(state: PlanarState): PlanarState {
  const model = interiorModel(state);
  return model ? { ...state, flags: { ...state.flags, [`interior.${model.object.id}`]: !relationFlag(state, "interior") } } : state;
}

export function tapInterior(state: PlanarState, target: string): PlanarState {
  const match = /^interior\.(0|[1-9]\d{0,4})$/.exec(target);
  if (match) return interiorModel(state, Number(match[1])) ? { ...state, params: { ...state.params, active: Number(match[1]) } } : state;
  const next = applyInteriorBase(state, (base) => tapRelation(base, target)), id = next.params.active;
  const before = interiorModel(state, id), after = interiorModel(next, id);
  if (!before || !after || state.params[`base.${id}`] === next.params[`base.${id}`]) return next;
  const selected = state.params.active === id ? state : { ...state, params: { ...state.params, active: id } };
  // 换底只改变观察基准；按原 P 重算比例，共线时同步新底上的 D。
  const v = crossAt(after.a, after.b, before.point) / crossAt(after.a, after.b, after.c);
  const basePoint = { x: (before.point.x - v * after.c.x) / (1 - v), y: (before.point.y - v * after.c.y) / (1 - v) };
  const dx = after.b.x - after.a.x, dy = after.b.y - after.a.y;
  const u = ((basePoint.x - after.a.x) * dx + (basePoint.y - after.a.y) * dy) / (dx * dx + dy * dy);
  // 新基准超出合法域时保留底与点位，但仍选择被点击材料；仅吸收浮点舍入误差。
  if (![u, v].every((value) => Number.isFinite(value) && value >= 0.05 - 1e-10 && value <= 0.95 + 1e-10)) return selected;
  const params = { ...next.params, [`innerBase.${id}`]: clamp(u), [`innerHeight.${id}`]: clamp(v) };
  if (before.collinear) params[`fraction.${id}`] = clamp(u);
  const candidate = { ...next, params };
  return isValidInteriorState(candidate) ? candidate : selected;
}

export function dragInterior(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  if (![point.x, point.y, delta.x, delta.y].every(Number.isFinite)) return state;
  const match = /^interior\.(0|[1-9]\d{0,4})$/.exec(target);
  if (!match) {
    // 内点分区也使用 D；分点旧观察未打开时，临时启用其数学动作后恢复原开关。
    const division = /^division\.(0|[1-9]\d{0,4})$/.exec(target), id = division ? Number(division[1]) : -1;
    return applyInteriorBase(state, (base) => {
      const showing = relationFlag(state, "interior", id), enabled = relationFlag(base, "division", id);
      const input = showing && !enabled ? { ...base, flags: { ...base.flags, [`division.${id}`]: true } } : base;
      const result = dragRelation(input, target, point, delta);
      return result === input ? base : showing && !enabled ? { ...result, flags: { ...result.flags, [`division.${id}`]: false } } : result;
    });
  }
  const id = Number(match[1]), model = interiorModel(state, id);
  if (!model || !relationFlag(state, "interior", id)) return state;
  const candidatePoint = { x: model.point.x + delta.x, y: model.point.y + delta.y };
  let u = model.u, v: number;
  if (model.collinear) {
    const dx = model.c.x - model.division.x, dy = model.c.y - model.division.y;
    v = clamp(model.v + (delta.x * dx + delta.y * dy) / (dx * dx + dy * dy));
  } else {
    v = clamp(crossAt(model.a, model.b, candidatePoint) / crossAt(model.a, model.b, model.c));
    const basePoint = { x: (candidatePoint.x - v * model.c.x) / (1 - v), y: (candidatePoint.y - v * model.c.y) / (1 - v) };
    const dx = model.b.x - model.a.x, dy = model.b.y - model.a.y;
    u = clamp(((basePoint.x - model.a.x) * dx + (basePoint.y - model.a.y) * dy) / (dx * dx + dy * dy));
  }
  const candidate = { ...state, params: { ...state.params, active: id, [`innerBase.${id}`]: u, [`innerHeight.${id}`]: v } };
  return isValidInteriorState(candidate) ? candidate : state;
}

export function copyInteriorParts(state: PlanarState): PlanarState {
  const model = interiorModel(state);
  if (!model || !relationFlag(state, "interior")) return state;
  let next: PlanarState = { ...state, flags: { ...state.flags, snap: false } };
  for (const part of model.parts) {
    const before = next;
    next = applyInteriorBase(next, (base) => createRelationGeometry(base, "polygon", part.map((point) => ({ x: point.x + 65, y: point.y + 65 }))) ?? base);
    if (next === before) return state;
  }
  return { ...next, flags: { ...next.flags, snap: state.flags.snap } };
}

export type InteriorSplit = "pieces" | "separate" | "wings";

function commonOffset(model: NonNullable<ReturnType<typeof interiorModel>>): Point {
  const sign = Math.sign(crossAt(model.a, model.b, model.c));
  const distance = model.heights[0].amount * model.v + 36;
  return { x: sign * (model.b.y - model.a.y) / model.length * distance, y: -sign * (model.b.x - model.a.x) / model.length * distance };
}

/** 当前整片换成真实余片；先释放原片容量，全部材料合法后才交给共用历史。 */
export function splitInteriorMaterial(state: PlanarState, mode: InteriorSplit): PlanarState {
  const model = interiorModel(state);
  if (!model || !relationFlag(state, "interior")) return state;
  const pieces = mode === "wings" ? model.parts.slice(2) : [model.common, ...model.parts.slice(2)];
  const firstId = state.params.nextId;
  let next = applyInteriorBase(state, (base) => syncRelations(base, removeConstruction(base)));
  if (next === state) return state;
  next = { ...next, flags: { ...next.flags, snap: false } };
  for (const points of pieces) {
    const added = applyInteriorBase(next, (base) => createRelationGeometry(base, "polygon", points) ?? base);
    if (added === next) return state;
    next = added;
  }
  if (mode === "separate") {
    const offset = commonOffset(model), center = next.points[`center.${firstId}`];
    next = { ...next, points: { ...next.points, [`center.${firstId}`]: { x: center.x + offset.x, y: center.y + offset.y } } };
  }
  const candidate = { ...next, params: { ...next.params, active: firstId }, flags: { ...next.flags, snap: state.flags.snap } };
  return isValidInteriorState(candidate) ? candidate : state;
}

/** 只平移已经拆出的共同片；两翼原位，过程帧与终点都使用同一份准确几何。 */
export function interpolateInteriorSeparation(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (!Number.isFinite(progress) || progress <= 0) return from;
  if (progress >= 1 || from === to) return to;
  const model = interiorModel(from), common = constructionObject(to, from.params.nextId);
  if (!model || !common) return from;
  const offset = commonOffset(model);
  const candidate = { ...to, points: { ...to.points, [`center.${common.id}`]: {
    x: common.center.x - offset.x * (1 - progress), y: common.center.y - offset.y * (1 - progress),
  } } };
  return isValidInteriorState(candidate) ? candidate : from;
}
