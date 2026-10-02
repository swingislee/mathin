import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidRelationsState } from "./validation";

export const INTERIOR_SCENE_ID = "18-interior";
export const INTERIOR_PARAMS = ["innerBase", "innerHeight"] as const;
export const INTERIOR_FLAGS = ["interior", "collinear"] as const;
const ownedKey = (key: string, prefixes: readonly string[]) => prefixes.some((prefix) => new RegExp(`^${prefix}\\.(0|[1-9]\\d{0,4})$`).test(key));

/** v3 只扩展内点元数据，基础材料仍执行原 v2 的严格校验。 */
export function interiorBaseState(state: PlanarState): PlanarState {
  return { ...state, sceneId: "18-create",
    params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !ownedKey(key, INTERIOR_PARAMS))),
    flags: Object.fromEntries(Object.entries(state.flags).filter(([key]) => !ownedKey(key, INTERIOR_FLAGS))),
  };
}

export function isValidInteriorState(state: PlanarState): boolean {
  try {
    if (state?.sceneId !== INTERIOR_SCENE_ID || !isValidRelationsState(interiorBaseState(state))) return false;
    const objects = constructionObjects(state);
    if (Object.keys(state.params).length > 256 || Object.keys(state.flags).length > 256
      || Object.keys(state.params).filter((key) => ownedKey(key, INTERIOR_PARAMS)).length !== objects.length * 2
      || Object.keys(state.flags).filter((key) => ownedKey(key, INTERIOR_FLAGS)).length !== objects.length * 2) return false;
    return objects.every((object) => INTERIOR_PARAMS.every((key) => {
      const value = state.params[`${key}.${object.id}`];
      return Number.isFinite(value) && value >= 0.05 && value <= 0.95;
    }) && INTERIOR_FLAGS.every((key) => typeof state.flags[`${key}.${object.id}`] === "boolean")
      && (object.vertices.length === 3 || INTERIOR_FLAGS.every((key) => !state.flags[`${key}.${object.id}`]))
      && (!state.flags[`collinear.${object.id}`] || state.params[`innerBase.${object.id}`] === state.params[`fraction.${object.id}`]));
  } catch { return false; }
}
