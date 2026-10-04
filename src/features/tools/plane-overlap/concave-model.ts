import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { addConstruction, constructionObject, constructionObjects, createConstructionState, moveConstruction, parseConstructionTarget, removeConstruction, setConstructionField, worldVertices } from "../plane-construction/model";
import { concaveRegions, concaveRegionsArea, concaveSignedArea } from "./concave-geometry";
import { OVERLAP_MATERIALS, assignOverlap } from "./model";
import { isValidConcaveOverlapState } from "./concave-validation";

export const CONCAVE_OVERLAP_SCENE_ID = "33-concave";
export const CONCAVE_OVERLAP_MATERIALS = [
  ...OVERLAP_MATERIALS,
  { id: "l-paper", zh: "L 形凹纸片", en: "Concave L paper", points: [{ x: -140, y: -120 }, { x: 140, y: -120 }, { x: 140, y: -20 }, { x: -20, y: -20 }, { x: -20, y: 120 }, { x: -140, y: 120 }] },
  { id: "u-paper", zh: "U 形凹纸片", en: "Concave U paper", points: [{ x: -140, y: -120 }, { x: -50, y: -120 }, { x: -50, y: 40 }, { x: 50, y: 40 }, { x: 50, y: -120 }, { x: 140, y: -120 }, { x: 140, y: 120 }, { x: -140, y: 120 }] },
] as const;

export function settleConcaveOverlap(before: PlanarState, next: PlanarState): PlanarState {
  if (before === next) return before;
  const ids = new Set(constructionObjects(next).map((object) => object.id));
  const candidate = { ...next, params: { ...next.params,
    pairA: ids.has(next.params.pairA) ? next.params.pairA : -1,
    pairB: ids.has(next.params.pairB) ? next.params.pairB : -1,
  } };
  return isValidConcaveOverlapState(candidate) ? candidate : before;
}

export function createConcaveOverlapState(): PlanarState {
  const empty = removeConstruction(createConstructionState(CONCAVE_OVERLAP_SCENE_ID));
  const first = addConstruction(empty, "polygon", CONCAVE_OVERLAP_MATERIALS[3].points.map((point) => ({ x: point.x + 380, y: point.y + 340 })));
  const second = addConstruction(first, "rectangle", [{ x: 360, y: 290 }, { x: 620, y: 420 }]);
  const [a, b] = constructionObjects(second);
  return { ...second, params: { ...second.params, pairA: a.id, pairB: b.id, region: 0 } };
}

export function createConcaveOverlapGeometry(state: PlanarState, tool: string, points: readonly Point[]): PlanarState | null {
  if (tool !== "polygon" && tool !== "rectangle") return null;
  const candidate = settleConcaveOverlap(state, addConstruction(state, tool, points));
  return candidate === state ? null : candidate;
}

export function addConcaveOverlapMaterial(state: PlanarState, id: string): PlanarState {
  const material = CONCAVE_OVERLAP_MATERIALS.find((entry) => entry.id === id);
  if (!material) return state;
  const count = constructionObjects(state).length, center = { x: 400 + count % 3 * 55, y: 300 + count % 2 * 45 };
  return createConcaveOverlapGeometry(state, "polygon", material.points.map((point) => ({ x: point.x + center.x, y: point.y + center.y }))) ?? state;
}

export const assignConcaveOverlap = assignOverlap;
export function setConcaveOverlapField(state: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return state;
  if (key === "region") return { ...state, params: { ...state.params, region: Math.max(0, Math.min(3, Math.round(value))) } };
  return settleConcaveOverlap(state, setConstructionField(state, key, value));
}

export function dragConcaveOverlap(state: PlanarState, target: string, point: Point, delta: Point): PlanarState {
  const parsed = parseConstructionTarget(target);
  if (!state.flags.edit && parsed?.type === "edge") target = `object.${parsed.id}`;
  return settleConcaveOverlap(state, moveConstruction(state, target, point, delta));
}

function computeModel(state: PlanarState) {
  const first = constructionObject(state, state.params.pairA), second = constructionObject(state, state.params.pairB);
  // 翻面投影只表达运动，不把临时压扁形状显示为新的数学区域或面积。
  if (!first || !second || first.id === second.id || first.basis || second.basis) return null;
  const a = worldVertices(first), b = worldVertices(second), regions = concaveRegions(a, b);
  return regions ? { a, b, ...regions, areaA: Math.abs(concaveSignedArea(a)), areaB: Math.abs(concaveSignedArea(b)),
    intersectionArea: concaveRegionsArea(regions.intersection), unionArea: concaveRegionsArea(regions.union), differenceArea: concaveRegionsArea(regions.difference) } : null;
}
// 同一不可变状态的面板、舞台与摘要共用一次几何结果；拖动帧随状态自然释放。
const models = new WeakMap<PlanarState, ReturnType<typeof computeModel>>();
export function concaveOverlapModel(state: PlanarState) {
  if (!models.has(state)) models.set(state, computeModel(state));
  return models.get(state)!;
}
