import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { planeMotionScenes } from "../../src/features/tools/plane-motion/scenes";
import { addRollingPair, createRollingWorkbenchState, duplicateRollingPair, interpolateRolling, removeRollingPair, rollCurrentPair, selectRollingPair, setRollingField, setRollingFlag } from "../../src/features/tools/plane-rolling-workbench/model";

export function planeRollingCases() {
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, initial: PlanarState, accepted = true, contentVersion = "plane-rolling-lesson-v2") => {
    const entry = { label, accepted, scene: { toolId: "plane-rolling", contentVersion, payload: { title: "Independent rolling pairs", initial: structuredClone(initial) } } }; cases.push(entry); return entry;
  };
  const initial = createRollingWorkbenchState();
  const bad = (label: string, change: (state: PlanarState) => void) => { const state = structuredClone(initial); change(state); add(label, state, false); };
  add("rolling-default", initial); add("rolling-empty", removeRollingPair(initial));
  const exact = setRollingField(setRollingField(setRollingField(initial, "R", 5.123456789), "r", 1.246813579), "angle", -901.23456789);
  add("rolling-fractional-reversed", exact);
  add("rolling-inside", setRollingField(exact, "mode", 1));
  add("rolling-large-external-roller", setRollingField(setRollingField(initial, "R", 0.1), "r", 1000));
  add("rolling-thin-internal-orbit", setRollingField(setRollingField(setRollingField(initial, "r", 3.499999999), "R", 3.5), "mode", 1));
  add("rolling-minimum-radii", setRollingField(setRollingField(initial, "R", 0.1), "r", 0.1));
  add("rolling-positive-angle-limit", setRollingField(initial, "angle", 100000));
  add("rolling-negative-angle-limit", setRollingField(initial, "angle", -100000));
  add("rolling-center-boundary", setRollingField(setRollingField(initial, "x", -1000), "y", 1000));
  add("rolling-relative-negative-playback", rollCurrentPair(setRollingField(exact, "rollBy", -360.125)));
  add("rolling-exact-paused-frame", interpolateRolling(exact, rollCurrentPair(exact), 0.271828));
  let full = setRollingFlag(setRollingFlag(setRollingFlag(initial, "orbit", true), "links", true), "trace", true);
  full = setRollingFlag(full, "measures", true); full = setRollingFlag(full, "names", true);
  for (let i = 1; i < 4; i++) full = addRollingPair(full);
  add("rolling-four-pairs", full);
  add("rolling-deleted-id-gap", removeRollingPair(selectRollingPair(full, "pair.1")));
  add("rolling-independent-copy", duplicateRollingPair(exact));
  add("rolling-last-identity", { ...initial, params: { nextId: 99999, active: 99998, rollBy: 360, viewX: 0, viewY: 0, viewSpan: 14, "R.99998": 3.5, "r.99998": 1.1, "angle.99998": 0 }, points: { "center.99998": { x: 0, y: 0 } }, flags: { grid: false, measures: false, names: false, "inside.99998": false, "orbit.99998": false, "links.99998": false, "trace.99998": false } });
  for (const [label, change] of [
    ["unknown-param", (s: PlanarState) => { s.params.spin = 40; }], ["unknown-point", (s: PlanarState) => { s.points.contact = { x: 0, y: 0 }; }],
    ["unknown-flag", (s: PlanarState) => { s.flags.answer = true; }], ["reference-grid", (s: PlanarState) => { s.flags.grid = true; }],
    ["missing-flag", (s: PlanarState) => { delete s.flags["inside.0"]; }], ["nonboolean-flag", (s: PlanarState) => { s.flags["inside.0"] = 1 as unknown as boolean; }],
    ["active-absent", (s: PlanarState) => { s.params.active = 1; }], ["active-fractional", (s: PlanarState) => { s.params.active = 0.5; }],
    ["active-empty-with-pair", (s: PlanarState) => { s.params.active = -1; }], ["reused-id", (s: PlanarState) => { s.params.nextId = 0; }],
    ["fractional-next-id", (s: PlanarState) => { s.params.nextId = 1.5; }], ["noncanonical-id", (s: PlanarState) => { s.params["R.00"] = s.params["R.0"]; delete s.params["R.0"]; }],
    ["missing-radius", (s: PlanarState) => { delete s.params["r.0"]; }], ["zero-radius", (s: PlanarState) => { s.params["r.0"] = 0; }],
    ["large-radius", (s: PlanarState) => { s.params["R.0"] = 1000.01; }], ["inside-equal", (s: PlanarState) => { s.flags["inside.0"] = true; s.params["r.0"] = s.params["R.0"]; }],
    ["inside-oversize", (s: PlanarState) => { s.flags["inside.0"] = true; s.params["r.0"] = 4; }], ["angle-overflow", (s: PlanarState) => { s.params["angle.0"] = 100000.1; }],
    ["angle-string", (s: PlanarState) => { s.params["angle.0"] = "1" as unknown as number; }], ["roll-step-overflow", (s: PlanarState) => { s.params.rollBy = 36000.1; }],
    ["center-overflow", (s: PlanarState) => { s.points["center.0"].x = 1000.1; }], ["extra-point-coordinate", (s: PlanarState) => { Object.assign(s.points["center.0"], { z: 0 }); }],
    ["unknown-center", (s: PlanarState) => { s.points["center.1"] = { x: 0, y: 0 }; }], ["view-zero", (s: PlanarState) => { s.params.viewSpan = 0; }],
    ["view-overflow", (s: PlanarState) => { s.params.viewSpan = 20000.1; }], ["nonzero-phase", (s: PlanarState) => { s.phase = 0.5; }],
    ["cached-mark", (s: PlanarState) => { s.marks = ["trace.0"]; }],
  ] as const) bad(`rolling-${label}`, change);
  const fifth = structuredClone(full); fifth.params.nextId = 5; fifth.params["R.4"] = 3.5; fifth.params["r.4"] = 1.1; fifth.params["angle.4"] = 0; fifth.points["center.4"] = { x: 0, y: 0 };
  for (const key of ["inside", "orbit", "links", "trace"]) fifth.flags[`${key}.4`] = false;
  add("rolling-fifth-pair", fifth, false);
  const legacy = planeMotionScenes.find((scene) => scene.id === "55")!.create();
  add("rolling-v1-readable", legacy, true, "plane-rolling-lesson-v1"); add("rolling-v1-not-v2", legacy, false); add("rolling-v2-not-v1", initial, false, "plane-rolling-lesson-v1");
  add("rolling-wrong-tool", initial, false).scene.toolId = "plane-motion";
  add("rolling-title-trim", initial).scene.payload.title = "\u3000滚动圆对\u00a0";
  add("rolling-title-empty", initial, false).scene.payload.title = "\u3000\uFEFF\t";
  add("rolling-title-80-units", initial).scene.payload.title = "😀".repeat(40);
  add("rolling-title-82-units", initial, false).scene.payload.title = "😀".repeat(41);
  return cases;
}
