import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { constructionArea, constructionObjects, worldVertices } from "../plane-construction/model";
import { between, crossAt } from "./geometry";
import { applyInteriorBase } from "./interior-model";
import { INTERIOR_SCENE_ID, isValidInteriorState } from "./interior-validation";
import { createRelationGeometry, relationFlag, relationModel } from "./model";

export type AngleMode = "independent" | "similar";
export type AngleSide = "a" | "b";
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

/** O 是所选底边的对顶点；长度、角和面积直接来自当前材料，不另存参数副本。 */
export function angleTriangle(state: PlanarState, id = state.params.active) {
  if (state.sceneId !== INTERIOR_SCENE_ID) return null;
  const model = relationModel(state, id);
  if (!model || model.points.length !== 3) return null;
  const aIndex = state.params[`base.${id}`], bIndex = (aIndex + 1) % 3, originIndex = (aIndex + 2) % 3;
  const origin = model.points[originIndex], aLength = distance(origin, model.a), bLength = distance(origin, model.b);
  const cosine = ((model.a.x - origin.x) * (model.b.x - origin.x) + (model.a.y - origin.y) * (model.b.y - origin.y)) / (aLength * bLength);
  return { ...model, origin, aIndex, bIndex, originIndex, aLength, bLength,
    degrees: Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI };
}

export const canAdjustAngle = (state: PlanarState, id = state.params.active) => !!angleTriangle(state, id) && !relationFlag(state, "parallel", id);

function resizeRays(state: PlanarState, id: number, aScale: number, bScale: number): PlanarState {
  const model = angleTriangle(state, id);
  if (!model || !canAdjustAngle(state, id) || ![aScale, bScale].every((value) => Number.isFinite(value) && value > 0)
    || close(aScale, 1) && close(bScale, 1)) return state;
  const origin = model.object.vertices[model.originIndex], points = { ...state.points };
  // 在本地刚体基中伸缩，O、旋转、镜像、其他材料和已有观察均保持。
  points[`vertex.${id}.${model.aIndex}`] = between(origin, model.object.vertices[model.aIndex], aScale);
  points[`vertex.${id}.${model.bIndex}`] = between(origin, model.object.vertices[model.bIndex], bScale);
  const candidate = { ...state, points, params: { ...state.params, active: id } };
  return isValidInteriorState(candidate) ? candidate : state;
}

export function setAngleLength(state: PlanarState, mode: AngleMode, side: AngleSide, length: number, id = state.params.active): PlanarState {
  const model = angleTriangle(state, id);
  if (!model || !Number.isFinite(length) || length < 1 || length > 1600) return state;
  const scale = length / (side === "a" ? model.aLength : model.bLength);
  return resizeRays(state, id, mode === "similar" || side === "a" ? scale : 1, mode === "similar" || side === "b" ? scale : 1);
}

export function scaleAngleTriangle(state: PlanarState, scale: number): PlanarState {
  return resizeRays(state, state.params.active, scale, scale);
}

export function parseAngleHandle(target: string) {
  const match = /^angle\.(independent|similar)\.(a|b)\.(0|[1-9]\d{0,4})$/.exec(target);
  return match && Number(match[3]) <= 99998 ? { mode: match[1] as AngleMode, side: match[2] as AngleSide, id: Number(match[3]) } : null;
}

export function dragAngle(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  const handle = parseAngleHandle(target), model = handle && angleTriangle(state, handle.id);
  if (!handle || !model || ![point.x, point.y, delta.x, delta.y].every(Number.isFinite)) return state;
  const end = model[handle.side], length = handle.side === "a" ? model.aLength : model.bLength;
  const change = (delta.x * (end.x - model.origin.x) + delta.y * (end.y - model.origin.y)) / length;
  return setAngleLength(state, handle.mode, handle.side, Math.max(1, Math.min(1600, length + change)), handle.id);
}

/** 副本是独立真实三角形；负比例同时反向两条射线，形成对顶角沙漏。 */
export function copyAngleTriangle(state: PlanarState, opposite = false): PlanarState {
  const model = angleTriangle(state);
  if (!model) return state;
  const scale = opposite ? -0.6 : 0.6, points = model.points.map((point) => between(model.origin, point, scale));
  const input = { ...state, flags: { ...state.flags, snap: false } };
  const next = applyInteriorBase(input, (base) => createRelationGeometry(base, "polygon", points) ?? base);
  if (next === input) return state;
  const candidate = { ...next, params: { ...next.params, [`base.${next.params.active}`]: model.aIndex }, flags: { ...next.flags, snap: state.flags.snap } };
  return isValidInteriorState(candidate) ? candidate : state;
}

function rayScale(origin: Point, point: Point, reference: Point): number | null {
  const dx = reference.x - origin.x, dy = reference.y - origin.y, length = Math.hypot(dx, dy);
  if (Math.abs(crossAt(origin, reference, point)) > 1e-8 * length * distance(origin, point)) return null;
  return ((point.x - origin.x) * dx + (point.y - origin.y) * dy) / (length * length);
}

/** 按真实几何认出参照，不建立绑定；多候选时取面积最大者，面积相同按 ID。 */
export function angleComparison(state: PlanarState, id = state.params.active) {
  const model = angleTriangle(state, id);
  if (!model) return null;
  const candidates = constructionObjects(state).flatMap((object) => {
    if (object.id === id || object.vertices.length !== 3) return [];
    const points = worldVertices(object), originIndex = points.findIndex((point) => distance(point, model.origin) <= 1e-6);
    if (originIndex < 0) return [];
    const endpoints = points.filter((_, index) => index !== originIndex);
    for (const [a, b] of [endpoints, [...endpoints].reverse()]) {
      const aScale = rayScale(model.origin, model.a, a), bScale = rayScale(model.origin, model.b, b);
      if (aScale === null || bScale === null || aScale * bScale <= 0) continue;
      const aRatio = Math.abs(aScale), bRatio = Math.abs(bScale), area = constructionArea(points);
      return [{ reference: object, a, b, area, aRatio, bRatio, areaRatio: model.area / area,
        opposite: aScale < 0, parallel: close(aRatio, bRatio) }];
    }
    return [];
  });
  return candidates.sort((a, b) => b.area - a.area || a.reference.id - b.reference.id)[0] ?? null;
}

/** OA 保持，沿 OB 调整至两边比例相同，使两张材料的对应底边平行。 */
export function alignAngleTriangle(state: PlanarState): PlanarState {
  const model = angleTriangle(state), comparison = angleComparison(state);
  return model && comparison && !comparison.parallel
    ? resizeRays(state, model.object.id, 1, comparison.aRatio / comparison.bRatio) : state;
}

export function interpolateAngleGeometry(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (!Number.isFinite(progress) || progress <= 0) return from;
  if (progress >= 1 || from === to) return to;
  const model = angleTriangle(from), result = model && angleTriangle(to, model.object.id);
  if (!model || !result) return from;
  const points = { ...to.points };
  for (let index = 0; index < 3; index++) points[`vertex.${model.object.id}.${index}`] = between(model.object.vertices[index], result.object.vertices[index], progress);
  const candidate = { ...to, points };
  return isValidInteriorState(candidate) ? candidate : from;
}
