import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidConstructionState } from "../plane-construction/validation";
import { overlapConstructionState } from "./validation";

/** v3 扩展直边简单凹形；旧 v2 的凸性与版本守卫继续独立保留。 */
export function isValidConcaveOverlapState(state: PlanarState): boolean {
  try {
    if (!state || state.sceneId !== "33-concave" || !state.params || Object.keys(state.params).length > 256
      || !isValidConstructionState(overlapConstructionState(state))) return false;
    const objects = constructionObjects(state), ids = new Set(objects.map((object) => object.id));
    const { pairA, pairB, region } = state.params;
    if (![pairA, pairB].every((id) => Number.isInteger(id) && (id === -1 || ids.has(id))) || pairA >= 0 && pairA === pairB
      || !Number.isInteger(region) || region < 0 || region > 3) return false;
    return objects.every((object) => object.kind < 2 && object.life === 0 && object.detail === 0);
  } catch { return false; }
}
