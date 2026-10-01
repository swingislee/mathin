import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidConstructionState } from "../plane-construction/validation";
import { isConvexMaterial } from "./geometry";

export const RELATION_PARAMS = ["base", "fraction"] as const;
export const RELATION_FLAGS = ["height", "division", "parallel", "diagonals", "midpoints"] as const;
const objectKey = (key: string, prefixes: readonly string[]) => prefixes.some((prefix) => new RegExp(`^${prefix}\\.(0|[1-9]\\d{0,4})$`).test(key));

/** 仅剥离本领域明确命名的字段；未知键、孤立引用和动画参数继续由严格合同拒绝。 */
export function relationConstructionState(state: PlanarState): PlanarState {
  return { ...state, sceneId: "01-create",
    params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !objectKey(key, RELATION_PARAMS))),
    flags: Object.fromEntries(Object.entries(state.flags).filter(([key]) => !objectKey(key, RELATION_FLAGS))),
  };
}

export function isValidRelationsState(state: PlanarState): boolean {
  try {
    if (!state || state.sceneId !== "18-create" || !state.params || !state.flags || !isValidConstructionState(relationConstructionState(state))) return false;
    const objects = constructionObjects(state);
    const paramKeys = Object.keys(state.params).filter((key) => objectKey(key, RELATION_PARAMS));
    const flagKeys = Object.keys(state.flags).filter((key) => objectKey(key, RELATION_FLAGS));
    if (paramKeys.length !== objects.length * RELATION_PARAMS.length || flagKeys.length !== objects.length * RELATION_FLAGS.length
      || Object.keys(state.params).length > 256 || Object.keys(state.flags).length > 256) return false;
    return objects.every((object) => {
      const count = object.vertices.length, base = state.params[`base.${object.id}`], fraction = state.params[`fraction.${object.id}`];
      if (object.kind > 1 || object.life !== 0 || object.detail !== 0 || ![3, 4].includes(count) || !isConvexMaterial(object.vertices, true)
        || !Number.isInteger(base) || base < 0 || base >= count || !Number.isFinite(fraction) || fraction < 0.05 || fraction > 0.95
        || RELATION_FLAGS.some((key) => typeof state.flags[`${key}.${object.id}`] !== "boolean")) return false;
      return count === 3 ? !state.flags[`diagonals.${object.id}`]
        : !["parallel", "division", "midpoints"].some((key) => state.flags[`${key}.${object.id}`]);
    });
  } catch { return false; }
}
