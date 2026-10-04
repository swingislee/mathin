import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { rotatePoint, unwrapAngle } from "../plane-motion/model";
import {
  MAX_CONSTRUCTION_OBJECTS, appendConstructionBatch, constructionCorners, constructionFrameWithObject,
  constructionMatrix, constructionObject, constructionObjects, interpolateConstruction, isValidConstructionObject, moveConstruction,
  transformConstruction, worldVertices, type ConstructionObject,
} from "./model";

const degrees = (angle: number) => angle * Math.PI / 180;
const equivalent = (angle: number) => Math.abs(angle) <= 36000 ? angle : ((angle % 360) + 540) % 360 - 180;
const finitePoint = (point: PlanarPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const pose = (object: ConstructionObject, pivot: PlanarPoint, angle: number) => ({ ...object, center: rotatePoint(object.center, pivot, angle), angle: equivalent(object.angle + angle) });

export function parseConstructionMotionTarget(target: string | null) {
  const match = /^motion-(translate|rotate|reflect)\.(0|[1-9]\d{0,4})$/.exec(target ?? "");
  return match && Number(match[2]) <= 99998 ? { kind: match[1] as "translate" | "rotate" | "reflect", id: Number(match[2]) } : null;
}

/** 份数是本次完整一周的指令；存档仅保留既有转角及生成的真实材料。 */
export function constructionRepeatParts(state: PlanarState): number {
  const value = 360 / Math.abs(state.params.turn), integer = Math.round(value);
  return Number.isFinite(value) && Math.abs(value - integer) < 1e-9 && integer >= 2 && integer <= MAX_CONSTRUCTION_OBJECTS ? integer : 0;
}
export function setConstructionRepeatParts(state: PlanarState, parts: number): PlanarState {
  return Number.isInteger(parts) && parts >= 2 && parts <= MAX_CONSTRUCTION_OBJECTS
    ? { ...state, params: { ...state.params, turn: (state.params.turn < 0 ? -1 : 1) * 360 / parts } } : state;
}
export function repeatConstruction(state: PlanarState, parts = constructionRepeatParts(state)): PlanarState {
  const object = constructionObject(state);
  if (!object || !Number.isInteger(parts) || parts < 2 || parts > MAX_CONSTRUCTION_OBJECTS) return state;
  const step = (state.params.turn < 0 ? -1 : 1) * 360 / parts;
  const copies = Array.from({ length: parts - 1 }, (_, index) => pose(object, state.points.pivot, step * (index + 1)));
  const next = appendConstructionBatch(state, copies);
  return next === state ? state : { ...next, params: { ...next.params, active: object.id } };
}
/** 每一片沿真实圆弧展开；编号从准确终点读取，动画不另建持久组关系。 */
export function interpolateConstructionRepeat(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress <= 0 || from === to || !Number.isFinite(progress)) return from;
  if (progress >= 1) return to;
  const source = constructionObject(from), copies = constructionObjects(to).filter((object) => object.id >= from.params.nextId);
  if (!source || !copies.length) return from;
  const step = (from.params.turn < 0 ? -1 : 1) * 360 / (copies.length + 1), elapsed = progress * copies.length;
  const visible = copies.filter((_object, index) => index < elapsed);
  let frame: PlanarState = { ...from, params: { ...from.params, nextId: from.params.nextId + visible.length } };
  for (const [index, copy] of visible.entries()) {
    const part = Math.min(1, elapsed - index);
    frame = constructionFrameWithObject(frame, { ...pose(source, from.points.pivot, step * (index + 1) * part), id: copy.id });
  }
  return frame;
}

const frameKeys = ["frameA", "frameB", "frameC", "frameD", "frameOriginX", "frameOriginY", "frameOriginAngle", "frameMotion", "frameProgress", "frameTurn"] as const;
function clearFrame(state: PlanarState, id: number): PlanarState {
  const params = { ...state.params }; frameKeys.forEach((key) => { delete params[`${key}.${id}`]; });
  return { ...state, params };
}
function withOrigin(frame: PlanarState, source: ConstructionObject, kind: "translate" | "rotate" | "reflect", amount: number): PlanarState {
  return { ...frame, params: { ...frame.params,
    [`frameOriginX.${source.id}`]: source.center.x, [`frameOriginY.${source.id}`]: source.center.y,
    [`frameOriginAngle.${source.id}`]: source.angle, [`frameMotion.${source.id}`]: kind === "rotate" ? 0 : kind === "reflect" ? 1 : 2,
    [kind === "rotate" ? `frameTurn.${source.id}` : `frameProgress.${source.id}`]: amount,
  } };
}
/** 手势起点只存在不可保存的 frame* 中；90° 侧视也能准确找回起点。 */
export function constructionMotionOrigin(state: PlanarState): PlanarState | null {
  const entry = Object.keys(state.params).find((key) => /^frameMotion\.(0|[1-9]\d{0,4})$/.test(key));
  if (!entry) return null;
  const id = Number(entry.slice("frameMotion.".length)), current = constructionObject(state, id);
  const x = state.params[`frameOriginX.${id}`], y = state.params[`frameOriginY.${id}`], angle = state.params[`frameOriginAngle.${id}`];
  if (!current || ![x, y, angle].every(Number.isFinite)) return null;
  const clean = clearFrame(state, id);
  const source = { ...constructionObject(clean, id)!, center: { x, y }, angle };
  // 完整翻折帧已经翻转手性；起点的手性来自这次动作，而非当前投影。
  if (state.params[entry] === 1 && state.params[`frameProgress.${id}`] >= 1) source.flip *= -1;
  return constructionFrameWithObject(clean, source);
}

export function dragConstructionMotion(start: PlanarState, target: string, point: PlanarPoint, delta: PlanarPoint, previous?: PlanarState): PlanarState {
  const parsed = parseConstructionMotionTarget(target), source = parsed ? constructionObject(start, parsed.id) : null;
  if (start.sceneId !== "20-create" || !parsed || !source || !finitePoint(point) || !finitePoint(delta)) return start;
  const from = start.params.active === source.id ? start : { ...start, params: { ...start.params, active: source.id } };
  if (parsed.kind === "translate") return withOrigin(moveConstruction(from, `object.${source.id}`, point, delta), source, "translate", 0);
  const down = { x: point.x - delta.x, y: point.y - delta.y };
  if (parsed.kind === "rotate") {
    const pivot = start.points.pivot, a = { x: down.x - pivot.x, y: down.y - pivot.y }, b = { x: point.x - pivot.x, y: point.y - pivot.y };
    if (Math.hypot(a.x, a.y) < 2 || Math.hypot(b.x, b.y) < 2) return previous ?? start;
    const raw = (Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)) * 180 / Math.PI;
    const turn = unwrapAngle(raw, previous?.params[`frameTurn.${source.id}`] ?? 0), object = pose(source, pivot, turn);
    if (!isValidConstructionObject(object)) return previous ?? start;
    return withOrigin(constructionFrameWithObject(from, object), source, "rotate", turn);
  }
  const to = transformConstruction(from, "reflect");
  if (to === from) return start;
  const angle = degrees(start.params.axisAngle), normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const signed = (at: PlanarPoint) => (at.x - start.points.axis.x) * normal.x + (at.y - start.points.axis.y) * normal.y;
  let side = signed(down);
  if (Math.abs(side) < 12) side = signed(source.center);
  if (Math.abs(side) < 12) side = worldVertices(source).map(signed).sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? Math.max(source.rx, source.ry);
  const span = Math.max(48, Math.abs(side) * 2), displacement = delta.x * normal.x + delta.y * normal.y;
  const amount = Math.max(0, Math.min(1, -Math.sign(side || 1) * displacement / span));
  return withOrigin(interpolateConstruction(from, to, amount, "reflect"), source, "reflect", amount);
}

/** 松手只产生准确原位／镜像／刚体旋转终点；临时投影参数全部移除。 */
export function snapConstructionMotion(state: PlanarState, target: string): PlanarState | null {
  const parsed = parseConstructionMotionTarget(target);
  if (!parsed || state.params[`frameMotion.${parsed.id}`] === undefined) return null;
  if (parsed.kind !== "reflect") return clearFrame(state, parsed.id);
  const origin = constructionMotionOrigin(state);
  return origin ? state.params[`frameProgress.${parsed.id}`] >= 0.5 - 1e-9 ? transformConstruction(origin, "reflect") : origin : null;
}

export interface ConstructionCorrespondence { label: string; from: PlanarPoint; to: PlanarPoint }
function materialPoints(object: ConstructionObject) {
  if (object.kind < 2) return constructionCorners(object).map(({ point, index }, ordinal) => ({ label: `P${ordinal + 1}`, index, point }));
  const [a, b, c, d, x, y] = constructionMatrix(object);
  return [{ label: "O", index: 0, point: { x, y } }, { label: "P", index: 1, point: { x: x + a * object.rx, y: y + b * object.rx } }, { label: "Q", index: 2, point: { x: x + c * object.ry, y: y + d * object.ry } }];
}
/** 只配对同一真实材料的同一角点／参照点；形状被改写后不会猜测对应关系。 */
export function constructionCorrespondences(before: PlanarState, after: PlanarState, id: number): ConstructionCorrespondence[] {
  const a = constructionObject(before, id), b = constructionObject(after, id);
  if (!a || !b || a.kind !== b.kind || a.rx !== b.rx || a.ry !== b.ry || JSON.stringify(a.vertices) !== JSON.stringify(b.vertices)) return [];
  const first = materialPoints(a), last = materialPoints(b);
  if (first.every((point, index) => Math.hypot(point.point.x - last[index].point.x, point.point.y - last[index].point.y) < 1e-7)) return [];
  return first.map((point) => ({ label: point.label, from: point.point, to: last.find((entry) => entry.index === point.index)!.point }));
}
