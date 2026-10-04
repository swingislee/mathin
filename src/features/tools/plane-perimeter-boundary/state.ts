import type { PlanarState } from "../planar-kit/contract";
import { constructionObject, constructionObjects } from "../plane-construction/model";
import { createPerimeterState } from "../plane-perimeter/model";

export const PERIMETER_BOUNDARY_SCENE = "10-boundary";
export const BOUNDARY_FLAGS = ["unionBoundary", "unionSeams", "unionCovered", "unionHoles"] as const;
export const MAX_EDGE_OFFSET = 50000;

/** 旧材料与旧教学操作继续使用原合同；扩展只在边界层进出。 */
export function perimeterBaseState(state: PlanarState): PlanarState {
  return { ...state, sceneId: "10-create",
    params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !key.startsWith("unionMember.") && key !== "edgeSource" && key !== "edgeActive")),
    points: Object.fromEntries(Object.entries(state.points).filter(([key]) => !key.startsWith("edgeMove."))),
    flags: Object.fromEntries(Object.entries(state.flags).filter(([key]) => !BOUNDARY_FLAGS.includes(key as typeof BOUNDARY_FLAGS[number]))),
  };
}
const shapeSignature = (state: PlanarState, id: number) => { const object = constructionObject(state, id); return object ? JSON.stringify([object.kind, object.vertices.map((p) => [p.x, p.y])]) : ""; };
export function liftPerimeterState(before: PlanarState | null, base: PlanarState): PlanarState {
  const objects = constructionObjects(base), ids = new Set(objects.map((object) => object.id));
  const source = before && ids.has(before.params.edgeSource) ? before.params.edgeSource : -1, object = constructionObject(base, source), retained = before && source >= 0 && shapeSignature(before, source) === shapeSignature(base, source);
  const params: Record<string, number> = { ...base.params, edgeSource: source, edgeActive: object ? Math.max(0, Math.min(before?.params.edgeActive ?? 0, object.vertices.length - 1)) : -1 };
  for (const id of ids) params[`unionMember.${id}`] = before?.params[`unionMember.${id}`] ?? (before ? 0 : 1);
  const points = { ...base.points };
  object?.vertices.forEach((_, i) => { points[`edgeMove.${i}`] = retained && before.points[`edgeMove.${i}`] ? before.points[`edgeMove.${i}`] : { x: 0, y: 0 }; });
  return { ...base, sceneId: PERIMETER_BOUNDARY_SCENE, params, points, flags: { ...base.flags, ...Object.fromEntries(BOUNDARY_FLAGS.map((flag) => [flag, before?.flags[flag] ?? false])) } };
}
export const createPerimeterBoundaryState = (): PlanarState => liftPerimeterState(null, createPerimeterState());
