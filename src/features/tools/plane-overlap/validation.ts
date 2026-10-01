import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidConstructionState } from "../plane-construction/validation";
import { isConvexMaterial } from "../plane-relations/geometry";

export const OVERLAP_PARAMS = ["pairA", "pairB", "region"] as const;
export function overlapConstructionState(state: PlanarState): PlanarState {
  return { ...state, sceneId: "01-create", params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !(OVERLAP_PARAMS as readonly string[]).includes(key))) };
}

export function isValidOverlapState(state: PlanarState): boolean {
  try {
    if (!state || state.sceneId !== "33-create" || !state.params || !isValidConstructionState(overlapConstructionState(state)) || Object.keys(state.params).length > 256) return false;
    const objects = constructionObjects(state), ids = new Set(objects.map((object) => object.id));
    const { pairA, pairB, region } = state.params;
    if (![pairA, pairB].every((id) => Number.isInteger(id) && (id === -1 || ids.has(id))) || pairA >= 0 && pairA === pairB
      || !Number.isInteger(region) || region < 0 || region > 3) return false;
    return objects.every((object) => object.kind < 2 && object.life === 0 && object.detail === 0 && isConvexMaterial(object.vertices));
  } catch { return false; }
}
