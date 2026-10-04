import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { constructionObject, constructionObjects } from "../plane-construction/model";
import { applyInteriorBase, createInteriorState } from "./interior-model";
import { createRelationGeometry, relationFlag, relationModel } from "./model";
import { STRIPS_SCENE_ID, isValidStripsState, stripsBaseState } from "./strips-validation";

export const STRIP_LEVELS = [4, 8, 16, 32, 48] as const;

function extend(before: PlanarState | null, base: PlanarState, copyFrom?: number): PlanarState {
  const params = { ...base.params }, flags = { ...base.flags };
  for (const object of constructionObjects(base)) {
    const source = before && constructionObject(before, object.id) ? object.id : copyFrom;
    params[`stripCount.${object.id}`] = source === undefined ? 16 : before?.params[`stripCount.${source}`] ?? 16;
    flags[`strips.${object.id}`] = object.vertices.length === 3 && source !== undefined && !!before?.flags[`strips.${source}`];
  }
  return { ...base, sceneId: STRIPS_SCENE_ID, params, flags };
}

export const createStripsState = () => extend(null, createInteriorState());

/** 所有原动作先交给 v3，随后按实际材料 ID 恢复本版元数据。 */
export function applyStripsBase(state: PlanarState, run: (base: PlanarState) => PlanarState, copyFrom?: number): PlanarState {
  const base = stripsBaseState(state), result = run(base);
  if (result === base) return state;
  const candidate = extend(state, result, copyFrom);
  return isValidStripsState(candidate) ? candidate : state;
}

export interface SquareStrip { row: number; count: number; points: Point[]; area: number }

/** 以真实底边为横轴。中高处的条宽向下取整成正方形；阶梯轮廓是近似而非内覆盖。 */
export function squareStripModel(state: PlanarState, id = state.params.active) {
  const model = relationModel(state, id), divisions = state.params[`stripCount.${id}`];
  if (state.sceneId !== STRIPS_SCENE_ID || !model || model.points.length !== 3 || !Number.isInteger(divisions) || divisions < 4 || divisions > 48) return null;
  const c = model.heights[0].vertex, height = model.heights[0].amount;
  if (height <= 0 || model.length <= 0) return null;
  const u = { x: (model.b.x - model.a.x) / model.length, y: (model.b.y - model.a.y) / model.length };
  const ac = { x: c.x - model.a.x, y: c.y - model.a.y }, sign = Math.sign(u.x * ac.y - u.y * ac.x);
  const v = { x: -u.y * sign, y: u.x * sign }, shear = ac.x * u.x + ac.y * u.y;
  const size = Math.max(model.length, height) / divisions;
  const world = (x: number, y: number): Point => ({ x: model.a.x + u.x * x + v.x * y, y: model.a.y + u.y * x + v.y * y });
  const strips: SquareStrip[] = [];
  for (let row = 0; row < Math.floor(height / size + 1e-8); row++) {
    const fraction = (row + 0.5) * size / height, width = model.length * (1 - fraction);
    const count = Math.floor(width / size + 1e-8);
    if (!count) continue;
    const start = shear * fraction + (width - count * size) / 2, x2 = start + count * size, y = row * size;
    strips.push({ row, count, points: [world(start, y), world(x2, y), world(x2, y + size), world(start, y + size)], area: count * size * size });
  }
  return { ...model, c, height, u, v, size, divisions, strips,
    squareCount: strips.reduce((sum, strip) => sum + strip.count, 0),
    approximateArea: strips.reduce((sum, strip) => sum + strip.area, 0) };
}

export function setStripCount(state: PlanarState, value: number): PlanarState {
  const model = squareStripModel(state);
  if (!model || !Number.isInteger(value) || value < 4 || value > 48 || model.divisions === value) return state;
  return { ...state, params: { ...state.params, [`stripCount.${model.object.id}`]: value } };
}

export function toggleStrips(state: PlanarState): PlanarState {
  const model = squareStripModel(state);
  return model ? { ...state, flags: { ...state.flags, [`strips.${model.object.id}`]: !relationFlag(state, "strips") } } : state;
}

export function refineStrips(state: PlanarState): PlanarState {
  const model = squareStripModel(state), next = model && STRIP_LEVELS.find((level) => level > model.divisions);
  if (!next) return state;
  const changed = setStripCount(state, next);
  return { ...changed, flags: { ...changed.flags, [`strips.${state.params.active}`]: true } };
}

/** 一条复制为一张独立矩形，原三角形与观察保留；整组超限时不留下半组材料。 */
export function copySquareStrips(state: PlanarState): PlanarState {
  const model = squareStripModel(state);
  if (!model?.strips.length || !relationFlag(state, "strips") || constructionObjects(state).length + model.strips.length > 16) return state;
  const offset = { x: -model.v.x * (model.height + 36), y: -model.v.y * (model.height + 36) };
  let next: PlanarState = { ...state, flags: { ...state.flags, snap: false } };
  for (const strip of model.strips) {
    const points = strip.points.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
    const added = applyStripsBase(next, (base) => applyInteriorBase(base, (relation) => createRelationGeometry(relation, "polygon", points) ?? relation));
    if (added === next) return state;
    next = added;
  }
  const candidate = { ...next, params: { ...next.params, active: state.params.nextId }, flags: { ...next.flags, snap: state.flags.snap } };
  return isValidStripsState(candidate) ? candidate : state;
}
