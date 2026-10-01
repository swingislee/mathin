import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { addConstruction, constructionArea, constructionObject, constructionObjects, createConstructionState, moveConstruction, parseConstructionTarget, setConstructionField, worldVertices } from "../plane-construction/model";
import { convexRegions, regionsArea } from "../plane-relations/geometry";
import { isValidOverlapState } from "./validation";

export const OVERLAP_SCENE_ID = "33-create";

/** 删除时仅解除缺失的比较对象；新建、复制和其它纸片移动保持 A/B 不变。 */
export function settleOverlap(before: PlanarState, next: PlanarState): PlanarState {
  if (before === next) return before;
  const ids = new Set(constructionObjects(next).map((object) => object.id));
  const candidate = { ...next, params: { ...next.params,
    pairA: ids.has(next.params.pairA) ? next.params.pairA : -1,
    pairB: ids.has(next.params.pairB) ? next.params.pairB : -1,
  } };
  return isValidOverlapState(candidate) ? candidate : before;
}

export function createOverlapState(): PlanarState {
  const first = createConstructionState(OVERLAP_SCENE_ID);
  const state = addConstruction(first, "polygon", [{ x: 430, y: 205 }, { x: 665, y: 360 }, { x: 475, y: 475 }]);
  const [a, b] = constructionObjects(state);
  return { ...state, params: { ...state.params, pairA: a.id, pairB: b.id, region: 0 } };
}

export function createOverlapGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  if (tool !== "polygon" && tool !== "rectangle") return null;
  const candidate = settleOverlap(state, addConstruction(state, tool, points));
  return candidate === state ? null : candidate;
}

export const OVERLAP_MATERIALS = [
  { id: "triangle", zh: "三角形纸片", en: "Triangle", points: [{ x: -145, y: 90 }, { x: 145, y: 90 }, { x: -15, y: -110 }] },
  { id: "rectangle", zh: "长方形纸片", en: "Rectangle", points: [{ x: -125, y: -75 }, { x: 125, y: -75 }, { x: 125, y: 75 }, { x: -125, y: 75 }] },
  { id: "pentagon", zh: "五边形纸片", en: "Pentagon", points: [{ x: 0, y: -130 }, { x: 124, y: -40 }, { x: 76, y: 105 }, { x: -76, y: 105 }, { x: -124, y: -40 }] },
] as const;

export function addOverlapMaterial(state: PlanarState, id: string): PlanarState {
  const material = OVERLAP_MATERIALS.find((entry) => entry.id === id);
  if (!material) return state;
  const count = constructionObjects(state).length, center = { x: 400 + count % 3 * 55, y: 300 + count % 2 * 45 };
  return createOverlapGeometry(state, "polygon", material.points.map((point) => ({ x: point.x + center.x, y: point.y + center.y }))) ?? state;
}

export function assignOverlap(state: PlanarState, slot: "pairA" | "pairB"): PlanarState {
  const id = state.params.active, other = slot === "pairA" ? "pairB" : "pairA";
  if (!constructionObject(state) || id === state.params[other] || id === state.params[slot]) return state;
  return { ...state, params: { ...state.params, [slot]: id } };
}

export function setOverlapField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "region") return { ...state, params: { ...state.params, region: Math.max(0, Math.min(3, Math.round(value))) } };
  return settleOverlap(state, setConstructionField(state, key, value));
}

export function dragOverlap(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  const parsed = parseConstructionTarget(target);
  if (!state.flags.edit && parsed?.type === "edge") target = `object.${parsed.id}`;
  return settleOverlap(state, moveConstruction(state, target, point, delta));
}

export function overlapModel(state: PlanarState) {
  const first = constructionObject(state, state.params.pairA), second = constructionObject(state, state.params.pairB);
  if (!first || !second || first.id === second.id) return null;
  const a = worldVertices(first), b = worldVertices(second), regions = convexRegions(a, b);
  return { a, b, ...regions, areaA: constructionArea(a), areaB: constructionArea(b),
    intersectionArea: constructionArea(regions.intersection), unionArea: regionsArea(regions.union), differenceArea: regionsArea(regions.difference) };
}
