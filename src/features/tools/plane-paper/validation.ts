import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidConstructionState } from "../plane-construction/validation";

/** 剪拼沿用真实材料合同；纸片只包含直边轮廓，旧模板场景不改写成新版。 */
export function isValidPaperState(state: PlanarState): boolean {
  if (!state || state.sceneId !== "14-create" || !isValidConstructionState({ ...state, sceneId: "01-create" })) return false;
  return constructionObjects(state).every((object) => object.kind < 2 && object.life === 0 && object.detail === 0);
}
