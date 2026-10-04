import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { addPolygonMaterial, arrangePolygonCorners, createPolygonGeometry, createPolygonWorkbenchState, emptyPolygonWorkbenchState, interpolatePolygonCorners, setPolygonField, togglePolygonCorners, togglePolygonHeight, unlockPolygonMaterial } from "../../src/features/tools/plane-polygons/model";
import type { PolygonKind } from "../../src/features/tools/plane-polygons/geometry";

export function planePolygonWorkbenchCases() {
  const initial = createPolygonWorkbenchState();
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true, version = "plane-polygons-lesson-v2") => {
    const entry = { label, accepted, scene: { toolId: "plane-polygons", contentVersion: version, payload: { title: "Polygon and rod workbench", initial: state } } };
    cases.push(entry); return entry;
  };
  const invalid = (label: string, change: (state: PlanarState) => void, source = initial) => { const state = structuredClone(source); change(state); add(label, state, false); };
  add("default", initial); add("empty", emptyPolygonWorkbenchState());
  for (let kind = 0; kind <= 9; kind++) add(`material-${kind}`, addPolygonMaterial(emptyPolygonWorkbenchState(), kind as PolygonKind));
  const tri = addPolygonMaterial(emptyPolygonWorkbenchState(), 3), corners = togglePolygonCorners(tri), joined = arrangePolygonCorners(corners, true);
  add("corners-at-vertices", corners); add("corners-joined", joined); add("corners-rigid-midpoint", interpolatePolygonCorners(corners, joined, .45));
  add("rotated-altitudes", togglePolygonHeight(setPolygonField(tri, "rotation", 137.25)));
  const minimumRhombus = setPolygonField(setPolygonField(addPolygonMaterial(emptyPolygonWorkbenchState(), 8), "width", .1), "opening", 5);
  add("minimum-rhombus", minimumRhombus); add("minimum-rhombus-explicitly-unlocked", unlockPolygonMaterial(minimumRhombus));
  const concave = createPolygonGeometry(emptyPolygonWorkbenchState(), "quadrilateral", [{ x: 180, y: 320 }, { x: 450, y: 320 }, { x: 265, y: 275 }, { x: 180, y: 100 }])!;
  add("concave-quad", togglePolygonHeight(concave));
  const clockwise = structuredClone(concave);
  for (let i = 0; i < 4; i++) clockwise.points[`vertex.0.${i}`] = concave.points[`vertex.0.${3 - i}`];
  add("reversed-concave-quad", clockwise);
  for (const [label, values] of [["base-too-long", [10, 3, 4]], ["left-too-long", [3, 10, 4]], ["right-too-long", [3, 4, 10]], ["collinear-rods", [7, 3, 4]]] as const) {
    let rods = addPolygonMaterial(emptyPolygonWorkbenchState(), 1);
    for (const [index, key] of ["width", "left", "right"].entries()) rods = setPolygonField(rods, key, values[index]);
    add(label, rods);
  }
  let full = emptyPolygonWorkbenchState();
  for (let i = 0; i < 16; i++) full = togglePolygonCorners(addPolygonMaterial(full, 3));
  add("capacity-with-48-independent-corners", full);
  invalid("unknown-state-key", (s) => { Object.assign(s, { area: 12 }); });
  invalid("unknown-parameter", (s) => { s.params.extra = 1; });
  invalid("unknown-flag", (s) => { s.flags.extra = false; });
  invalid("unknown-point", (s) => { s.points.extra = { x: 1, y: 1 }; });
  invalid("orphan-active", (s) => { s.params.active = 2; });
  invalid("fractional-kind", (s) => { s.params["kind.1"] = 2.5; });
  invalid("noncanonical-id", (s) => { s.params["kind.01"] = 2; });
  invalid("missing-origin", (s) => { delete s.points["origin.1"]; });
  invalid("origin-bound", (s) => { s.points["origin.1"].x = 4001; });
  invalid("vertex-bound", (s) => { s.points["vertex.0.0"].x = 2401; });
  invalid("extra-point-coordinate", (s) => { Object.assign(s.points["origin.1"], { z: 0 }); });
  invalid("phase", (s) => { s.phase = .5; });
  invalid("marks", (s) => { s.marks = ["angle"]; });
  invalid("dimension-string", (s) => { Object.assign(s.params, { "width.1": "200" }); });
  invalid("dimension-null", (s) => { Object.assign(s.params, { "width.1": null }); });
  invalid("dimension-min", (s) => { s.params["width.1"] = 3.99; });
  invalid("dimension-max", (s) => { s.params["width.1"] = 1601; });
  invalid("opening-degenerate", (s) => { s.params["opening.1"] = 0; });
  invalid("side-zero", (s) => { s.params["side.1"] = 0; });
  invalid("side-fractional", (s) => { s.params["side.1"] = .5; });
  invalid("angles-on-frame", (s) => { s.flags["angles.1"] = true; });
  invalid("string-flag", (s) => { Object.assign(s.flags, { "height.1": "true" }); });
  invalid("degenerate-triangle", (s) => { s.points["vertex.0.2"] = { x: 60, y: 0 }; });
  invalid("duplicate-vertex", (s) => { s.points["vertex.0.2"] = { ...s.points["vertex.0.0"] }; });
  invalid("crossing-quad", (s) => { [{ x: 0, y: 0 }, { x: 240, y: -140 }, { x: 210, y: 0 }, { x: 0, y: -180 }].forEach((p, i) => { s.points[`vertex.0.${i}`] = p; }); }, concave);
  invalid("base-range", (s) => { s.params["base.0"] = 3; }, tri);
  invalid("orphan-corner", (s) => { s.points["corner.0.0"] = { x: 0, y: 0 }; }, tri);
  invalid("missing-corner", (s) => { delete s.points["corner.0.1"]; }, corners);
  invalid("corner-turn-range", (s) => { s.params["turn.0.0"] = 181; }, corners);
  invalid("corner-scaling", (s) => { s.params["scale.0.0"] = .5; }, corners);
  invalid("corner-bound", (s) => { s.points["corner.0.1"].y = -4001; }, corners);
  for (const [title, accepted, label] of [["\t　\n", false, "empty-title"], ["字".repeat(80), true, "title-80-units"], ["字".repeat(81), false, "title-81-units"], ["😀".repeat(40), true, "title-80-utf16"], ["😀".repeat(41), false, "title-82-utf16"], ["\uFEFF　Polygon\t\n", true, "trimmed-title"]] as const) add(label, initial, accepted).scene.payload.title = title;
  add("v2-state-as-v1", initial, false, "plane-polygons-lesson-v1");
  return cases;
}
