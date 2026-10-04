import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { INTERIOR_SCENE_ID, isValidInteriorState } from "./interior-validation";

export const STRIPS_SCENE_ID = "18-strips";
const countKey = /^stripCount\.(0|[1-9]\d{0,4})$/;
const flagKey = /^strips\.(0|[1-9]\d{0,4})$/;

/** v4 只增加逐材料的观察设置，原 v3 几何和内点继续执行其严格合同。 */
export function stripsBaseState(state: PlanarState): PlanarState {
  return { ...state, sceneId: INTERIOR_SCENE_ID,
    params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !countKey.test(key))),
    flags: Object.fromEntries(Object.entries(state.flags).filter(([key]) => !flagKey.test(key))),
  };
}

export function isValidStripsState(state: PlanarState): boolean {
  try {
    if (state?.sceneId !== STRIPS_SCENE_ID || !isValidInteriorState(stripsBaseState(state))) return false;
    const objects = constructionObjects(state);
    if (Object.keys(state.params).length > 256 || Object.keys(state.flags).length > 256
      || Object.keys(state.params).filter((key) => countKey.test(key)).length !== objects.length
      || Object.keys(state.flags).filter((key) => flagKey.test(key)).length !== objects.length) return false;
    return objects.every((object) => {
      const count = state.params[`stripCount.${object.id}`], enabled = state.flags[`strips.${object.id}`];
      return Number.isInteger(count) && count >= 4 && count <= 48 && typeof enabled === "boolean"
        && (object.vertices.length === 3 || !enabled);
    });
  } catch { return false; }
}
