import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { planePatternsScenes } from "../../src/features/tools/plane-patterns/scenes";
import { planeMotionScenes } from "../../src/features/tools/plane-motion/scenes";
import { addGridCandidate, addReflectionCandidate, appendGridVisit, createGridRouteState, createReflectionRouteState, removeGridCandidate, removeReflectionCandidate, resizeGridRoutes, setGridPoint, setGridRouteField, setGridRouteFlag, setReflectionRouteField, setReflectionRouteFlag, toggleGridRoad } from "../../src/features/tools/plane-route-workbench/model";

export function planeRoutesCases() {
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true, version?: string) => {
    const toolId = state.sceneId.startsWith("53") ? "plane-grid-path" : "plane-reflection-path";
    const entry = { label, accepted, scene: { toolId, contentVersion: version ?? `${toolId}-lesson-v2`, payload: { title: "Teacher-built route candidates", initial: state } } };
    cases.push(entry); return entry;
  };
  const grid = createGridRouteState(), reflection = createReflectionRouteState();
  const bad = (label: string, initial: PlanarState, change: (state: PlanarState) => void) => { const state = structuredClone(initial); change(state); add(label, state, false); };
  add("grid-default", grid); add("reflection-default", reflection);
  const traced = appendGridVisit(appendGridVisit(grid, { x: 4, y: 0 }), { x: 4, y: 3 });
  add("shared-candidate-edges", addGridCandidate(traced, true));
  add("grid-empty", removeGridCandidate(grid)); add("reflection-empty", removeReflectionCandidate(reflection));
  add("grid-max-size", resizeGridRoutes(grid, 12, 12)); add("grid-min-size", resizeGridRoutes(grid, 1, 1));
  add("closed-road-preserves-prefix", toggleGridRoad(traced, { x: 2, y: 0 }, { x: 3, y: 0 }));
  add("resized-prefix", resizeGridRoutes(traced, 3, 2));
  add("required-point", setGridRouteFlag(grid, "required", true));
  const reversed = setGridPoint(setGridPoint(grid, "start", { x: 4, y: 3 }), "end", { x: 0, y: 0 });
  add("left-down-route", appendGridVisit(appendGridVisit(reversed, { x: 0, y: 3 }), { x: 0, y: 0 }));
  let fullGrid = grid, fullReflection = reflection;
  for (let i = 1; i < 8; i++) { fullGrid = addGridCandidate(fullGrid); fullReflection = addReflectionCandidate(fullReflection); }
  add("grid-eight-candidates", fullGrid); add("reflection-eight-candidates", fullReflection);
  let loop = setGridRouteField(grid, "direction", 1);
  for (let i = 1; i < 480; i++) loop = appendGridVisit(loop, { x: i % 2, y: 0 });
  add("grid-480-visits", loop);
  for (const angle of [-180, -135, -90, 0, 90, 135, 180]) add(`reflection-angle-${angle}`, setReflectionRouteField(reflection, "axisAngle", angle));
  add("reflection-maximum-contact", setReflectionRouteField(reflection, "contact", 5000));
  add("reflection-minimum-contact", setReflectionRouteField(reflection, "contact", -5000));
  add("reflection-world-coordinate", setReflectionRouteField(setReflectionRouteField(reflection, "aX", -1000), "bY", 1000));
  add("reflection-visible-mirror", setReflectionRouteFlag(reflection, "mirror", true));
  add("reflection-paused-frame", { ...setReflectionRouteFlag(reflection, "mirror", true), phase: 0.41 });
  add("reflection-coincident-on-axis", { ...reflection, points: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, axis: { x: 0, y: 0 } } });
  for (const initial of [grid, reflection]) {
    const prefix = initial.sceneId;
    bad(`${prefix}-unknown-param`, initial, (s) => { s.params.answer = 7; });
    bad(`${prefix}-unknown-flag`, initial, (s) => { s.flags.answer = true; });
    bad(`${prefix}-unknown-point`, initial, (s) => { s.points.answer = { x: 0, y: 0 }; });
    bad(`${prefix}-active-absent`, initial, (s) => { s.params.active = 4; });
    bad(`${prefix}-next-id-reused`, initial, (s) => { s.params.nextId = 0; });
    bad(`${prefix}-phase-invalid`, initial, (s) => { s.phase = 1.01; });
    bad(`${prefix}-reference-grid`, initial, (s) => { s.flags.grid = true; });
    bad(`${prefix}-string-number`, initial, (s) => { s.params.nextId = "1" as unknown as number; });
    bad(`${prefix}-point-extra-key`, initial, (s) => { Object.assign(Object.values(s.points)[0], { z: 0 }); });
    add(`${prefix}-v2-as-v1`, initial, false, `${prefix === "53-create" ? "plane-grid-path" : "plane-reflection-path"}-lesson-v1`);
  }
  for (const [key, value] of [["columns", 13], ["rows", 0], ["rows", 2.5], ["h.0", 16], ["direction", 2], ["numberStep", 20], ["visits.0", 2]] as const) bad(`grid-bad-${key}`, grid, (s) => { s.params[key] = value; });
  bad("grid-route-step-duplicate", traced, (s) => { s.marks[1] = s.marks[0]; });
  bad("grid-route-step-missing", traced, (s) => { s.marks[1] = "visit.0.99.1_0"; });
  bad("grid-route-disconnected", traced, (s) => { s.marks[1] = "visit.0.1.2_1"; });
  bad("grid-route-blocked", traced, (s) => { s.params["h.0"] = 1; });
  bad("grid-noncanonical-id", grid, (s) => { s.params["visits.00"] = 1; });
  bad("grid-backwards-step", grid, (s) => { s.params["visits.0"] = 3; s.marks = ["visit.0.0.0_0", "visit.0.1.1_0", "visit.0.2.0_0"]; });
  bad("grid-route-unknown-id", grid, (s) => { s.marks = ["visit.1.0.0_0"]; });
  bad("grid-nine-candidates", fullGrid, (s) => { s.params["visits.8"] = 1; s.params.nextId = 9; s.marks.push("visit.8.0.0_0"); });
  bad("grid-over-capacity", loop, (s) => { s.params["visits.0"] = 481; s.marks.push("visit.0.480.0_0"); });
  bad("grid-noncanonical-coordinate", grid, (s) => { s.marks[0] = "visit.0.0.00_0"; });
  for (const [key, value] of [["axisAngle", 181], ["axisAngle", -181], ["contact.0", 5001], ["viewX", 1001], ["viewSpan", 0], ["viewSpan", 20001]] as const) bad(`reflection-bad-${key}-${value}`, reflection, (s) => { s.params[key] = value; });
  bad("reflection-ninth-candidate", fullReflection, (s) => { s.params["contact.8"] = 1; s.params.nextId = 9; });
  bad("reflection-answer-mark", reflection, (s) => { s.marks = ["answer.1"]; });
  bad("reflection-noncanonical-id", reflection, (s) => { s.params["contact.00"] = -2; });
  bad("reflection-point-bound", reflection, (s) => { s.points.a.x = 1001; });
  bad("reflection-nonfinite", reflection, (s) => { s.points.a.x = Number.POSITIVE_INFINITY; });
  for (const [title, accepted, label] of [["\t　\n", false, "empty-title"], ["字".repeat(80), true, "title-80-units"], ["字".repeat(81), false, "title-81-units"], ["😀".repeat(40), true, "title-80-utf16"], ["😀".repeat(41), false, "title-82-utf16"], ["\uFEFF　Route\t\n", true, "trimmed-title"]] as const) add(label, reflection, accepted).scene.payload.title = title;
  for (const [legacy, tool] of [[planePatternsScenes.find((scene) => scene.id === "53")!.create(), "plane-grid-path"], [planeMotionScenes.find((scene) => scene.id === "54")!.create(), "plane-reflection-path"]] as const) {
    add(`${tool}-legacy-readable`, legacy, true, `${tool}-lesson-v1`); add(`${tool}-legacy-as-v2`, legacy, false);
  }
  const foreign = add("cross-purpose-envelope", reflection, false); foreign.scene.toolId = "plane-grid-path"; foreign.scene.contentVersion = "plane-grid-path-lesson-v2";
  return cases;
}
