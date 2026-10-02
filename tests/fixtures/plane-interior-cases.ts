import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { addRelationMaterial, createRelationsState } from "../../src/features/tools/plane-relations/model";
import { applyInteriorBase, copyInteriorParts, createInteriorState, setInteriorField, toggleInterior } from "../../src/features/tools/plane-relations/interior-model";

export function planeInteriorCases() {
  const initial = createInteriorState(), id = initial.params.active;
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true, version = "plane-area-relations-lesson-v3") => cases.push({ label, accepted, scene: { toolId: "plane-area-relations", contentVersion: version, payload: { title: "Interior exploration", initial: state } } });
  const invalid = (label: string, change: (state: PlanarState) => void) => { const state = structuredClone(initial); change(state); add(label, state, false); };
  add("default", initial);
  const shown = toggleInterior(initial);
  add("visible", shown);
  add("oblique", setInteriorField(shown, "angle", 43));
  add("reflected", { ...shown, params: { ...shown.params, [`flip.${id}`]: -1 } });
  add("free-corner-low", setInteriorField(setInteriorField(shown, "innerBase", 0.05), "innerHeight", 0.05));
  add("free-corner-high", setInteriorField(setInteriorField(shown, "innerBase", 0.95), "innerHeight", 0.95));
  const locked = setInteriorField(setInteriorField(shown, "divisionRatio", 0.27), "innerConstraint", 1);
  add("collinear", locked); add("collinear-moved-D", setInteriorField(locked, "divisionRatio", 0.72));
  add("four-copies", copyInteriorParts(locked));
  add("quad", applyInteriorBase(shown, (base) => addRelationMaterial(base, "quadrilateral")));
  let full = shown;
  for (let i = 1; i < 16; i++) full = applyInteriorBase(full, (base) => addRelationMaterial(base, "triangle"));
  add("capacity", full);
  for (const key of ["innerBase", "innerHeight"]) {
    for (const value of [-1, 0.049, 0.951, 2]) invalid(`${key}-${value}`, (state) => { state.params[`${key}.${id}`] = value; });
    invalid(`${key}-missing`, (state) => { delete state.params[`${key}.${id}`]; });
    invalid(`${key}-orphan`, (state) => { state.params[`${key}.999`] = 0.5; });
  }
  for (const key of ["interior", "collinear"]) {
    invalid(`${key}-missing`, (state) => { delete state.flags[`${key}.${id}`]; });
    invalid(`${key}-orphan`, (state) => { state.flags[`${key}.999`] = true; });
  }
  invalid("collinear-mismatch", (state) => { state.flags[`collinear.${id}`] = true; state.params[`innerBase.${id}`] = 0.6; });
  invalid("unknown-parameter", (state) => { state.params.extra = 1; });
  invalid("unknown-flag", (state) => { state.flags.extra = true; });
  invalid("helper-point", (state) => { state.points.P = { x: 20, y: 30 }; });
  const quad = applyInteriorBase(initial, (base) => addRelationMaterial(base, "quadrilateral"));
  for (const key of ["interior", "collinear"]) add(`quad-${key}`, { ...quad, flags: { ...quad.flags, [`${key}.${quad.params.active}`]: true } }, false);
  add("v2-as-v3", createRelationsState(), false); add("v3-as-v2", initial, false, "plane-area-relations-lesson-v2");
  return cases;
}
