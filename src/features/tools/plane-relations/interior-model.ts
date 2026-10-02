import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { constructionObject, constructionObjects } from "../plane-construction/model";
import { between, crossAt } from "./geometry";
import { createRelationGeometry, createRelationsState, dragRelation, relationFlag, relationModel, setRelationField, tapRelation } from "./model";
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
  return applyInteriorBase(state, (base) => tapRelation(base, target));
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
