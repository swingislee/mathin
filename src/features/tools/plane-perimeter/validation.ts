import type { PlanarState } from "../planar-kit/contract";
import { constructionObjects } from "../plane-construction/model";
import { isValidConstructionState } from "../plane-construction/validation";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const progressKey = /^(walk|straight)\.(0|[1-9]\d{0,4})$/;

/** 独立 v2 合同：严格剥离演示键后复用构造合同，旧 v1 与其它构造现场不扩权。 */
export function isValidPerimeterState(state: PlanarState): boolean {
  if (!record(state) || state.sceneId !== "10-create" || !record(state.params)) return false;
  const params: Record<string, number> = {}, progress: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.params)) {
    if (progressKey.test(key)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return false;
      progress[key] = value;
    } else params[key] = value;
  }
  const base = { ...state, sceneId: "01-create", params };
  if (!isValidConstructionState(base)) return false;
  const objects = constructionObjects(base);
  if (Object.keys(progress).length !== objects.length * 2) return false;
  return objects.every((object) => object.kind < 2 && object.life === 0 && object.detail === 0
    && Object.hasOwn(progress, `walk.${object.id}`) && Object.hasOwn(progress, `straight.${object.id}`));
}
