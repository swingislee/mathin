import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { removeConstruction } from "../../src/features/tools/plane-construction/model";
import { addRelationMaterial, syncRelations } from "../../src/features/tools/plane-relations/model";
import { applyInteriorBase, createInteriorState, setInteriorField, toggleInterior } from "../../src/features/tools/plane-relations/interior-model";
import { applyStripsBase, copySquareStrips, createStripsState, refineStrips, setStripCount, toggleStrips } from "../../src/features/tools/plane-relations/strips-model";

export function planeStripsCases() {
  const initial = createStripsState(), id = initial.params.active;
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true, version = "plane-area-relations-lesson-v4") => cases.push({ label, accepted, scene: { toolId: "plane-area-relations", contentVersion: version, payload: { title: "Square-strip exploration", initial: state } } });
  const invalid = (label: string, change: (state: PlanarState) => void) => { const state = structuredClone(initial); change(state); add(label, state, false); };
  add("default", initial);
  const shown = toggleStrips(initial); add("visible", shown);
  for (const count of [4, 8, 16, 32, 48]) add(`density-${count}`, setStripCount(shown, count));
  add("refined", refineStrips(shown)); add("copies", copySquareStrips(setStripCount(shown, 8)));
  add("rotated", applyStripsBase(shown, (base) => setInteriorField(base, "angle", 43)));
  add("reflected", { ...shown, params: { ...shown.params, [`flip.${id}`]: -1 } });
  add("interior", applyStripsBase(shown, (base) => setInteriorField(toggleInterior(base), "innerConstraint", 1)));
  const append = (state: PlanarState, material: string) => applyStripsBase(state, (base) => applyInteriorBase(base, (relation) => addRelationMaterial(relation, material)));
  const quad = append(shown, "quadrilateral"); add("quad", quad);
  add("quad-strips", { ...quad, flags: { ...quad.flags, [`strips.${quad.params.active}`]: true } }, false);
  let full = shown;
  for (let i = 1; i < 16; i++) full = append(full, "triangle");
  add("capacity", full);
  add("empty", applyStripsBase(initial, (base) => applyInteriorBase(base, (relation) => syncRelations(relation, removeConstruction(relation)))));
  for (const count of [0, 3, 49, 4.5]) invalid(`count-${count}`, (state) => { state.params[`stripCount.${id}`] = count; });
  invalid("missing-count", (state) => { delete state.params[`stripCount.${id}`]; });
  invalid("orphan-count", (state) => { state.params["stripCount.999"] = 16; });
  invalid("noncanonical-count", (state) => { state.params["stripCount.01"] = 16; });
  invalid("missing-flag", (state) => { delete state.flags[`strips.${id}`]; });
  invalid("orphan-flag", (state) => { state.flags["strips.999"] = true; });
  invalid("noncanonical-flag", (state) => { state.flags["strips.01"] = true; });
  invalid("unknown-parameter", (state) => { state.params.extra = 1; });
  invalid("unknown-flag", (state) => { state.flags.extra = true; });
  invalid("helper-point", (state) => { state.points.strip = { x: 10, y: 10 }; });
  invalid("v3-collinearity", (state) => { state.flags[`collinear.${id}`] = true; state.params[`innerBase.${id}`] = 0.6; });
  add("v3-as-v4", createInteriorState(), false); add("v4-as-v3", initial, false, "plane-area-relations-lesson-v3");
  return cases;
}
