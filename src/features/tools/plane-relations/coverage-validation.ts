import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidStripsState, STRIPS_SCENE_ID } from "./strips-validation";

export const COVERAGE_SCENE_ID = "18-coverage";
const countKey = /^coverCount\.(0|[1-9]\d{0,4})$/;
const flagKey = /^coverCells\.(0|[1-9]\d{0,4})$/;

/** v5 只增加逐材料覆盖设置；旧条带、内点与真实材料保持各自的严格合同。 */
export function coverageBaseState(state: PlanarState): PlanarState {
  return { ...state, sceneId: STRIPS_SCENE_ID,
    params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !countKey.test(key))),
    flags: Object.fromEntries(Object.entries(state.flags).filter(([key]) => !flagKey.test(key))),
  };
}

export function isValidCoverageState(state: PlanarState): boolean {
  try {
    if (state?.sceneId !== COVERAGE_SCENE_ID || !isValidStripsState(coverageBaseState(state))) return false;
    const objects = constructionObjects(state);
    if (Object.keys(state.params).length > 256 || Object.keys(state.flags).length > 256
      || Object.keys(state.params).filter((key) => countKey.test(key)).length !== objects.length
      || Object.keys(state.flags).filter((key) => flagKey.test(key)).length !== objects.length) return false;
    return objects.every((object) => {
      const count = state.params[`coverCount.${object.id}`], enabled = state.flags[`coverCells.${object.id}`];
      return Number.isInteger(count) && count >= 4 && count <= 48 && typeof enabled === "boolean"
        && (object.vertices.length === 3 || !enabled);
    });
  } catch { return false; }
}
