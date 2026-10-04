import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { addConstruction, createConstructionState, removeConstruction, setConstructionField, transformConstruction } from "../../src/features/tools/plane-construction/model";
import { dragConstructionMotion, repeatConstruction, setConstructionRepeatParts, snapConstructionMotion } from "../../src/features/tools/plane-construction/motion";

/** 新操作仍保存原 v2 材料；临时投影及未经验证的组关系由原严格合同拒绝。 */
export function planeConstructionMotionCases() {
  const entries: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true) => entries.push({ label, accepted, scene: { toolId: "plane-motion", contentVersion: "plane-motion-lesson-v2", payload: { title: "Repeated material and exact motion", initial: state } } });
  const initial = createConstructionState("20-create");
  for (const parts of [2, 3, 4, 7, 12, 16]) add(`repeat-${parts}-parts`, repeatConstruction(setConstructionRepeatParts(initial, parts)));
  add("counterclockwise-repeat", repeatConstruction(setConstructionRepeatParts(setConstructionField(initial, "turn", -90), 5)));
  const polygon = addConstruction(removeConstruction(initial), "polygon", [{ x: 300, y: 200 }, { x: 370, y: 205 }, { x: 325, y: 250 }, { x: 285, y: 230 }]);
  add("custom-concave-motif", repeatConstruction(setConstructionRepeatParts(polygon, 6)));
  add("reflected-motif-repeat", repeatConstruction(transformConstruction(initial, "reflect")));
  const rotated = dragConstructionMotion(initial, "motion-rotate.0", { x: 480, y: 460 }, { x: -100, y: 100 });
  add("rotation-preview", rotated, false); add("rotation-exact-landing", snapConstructionMotion(rotated, "motion-rotate.0")!);
  const half = dragConstructionMotion(initial, "motion-reflect.0", { x: 480, y: 340 }, { x: 100, y: 0 });
  add("edge-on-fold", half, false); add("edge-on-exact-landing", snapConstructionMotion(half, "motion-reflect.0")!);
  const full = dragConstructionMotion(initial, "motion-reflect.0", { x: 580, y: 340 }, { x: 200, y: 0 });
  add("completed-direct-preview-still-local", full, false); add("completed-direct-landing", snapConstructionMotion(full, "motion-reflect.0")!);
  add("correspondence-observation", { ...initial, flags: { ...initial.flags, ghost: true, vertices: true } });
  add("unknown-copies-cache", { ...initial, params: { ...initial.params, copies: 4 } }, false);
  add("unknown-group-relation", { ...initial, marks: ["group.0.1"] }, false);
  add("unknown-correspondence-cache", { ...initial, points: { ...initial.points, corresponding: { x: 0, y: 0 } } }, false);
  return entries;
}
