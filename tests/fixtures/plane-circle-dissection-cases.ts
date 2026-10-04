import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { planeAreaScenes } from "../../src/features/tools/plane-area/scenes";
import { arrangeCircleSectors, changeCircleCount, createCircleDissectionState, interpolateCircleSectors, selectSector, setCircleSectorField } from "../../src/features/tools/plane-circle-dissection/model";

export function planeCircleDissectionCases() {
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, initial: PlanarState, accepted = true, version = "plane-circle-area-lesson-v2") => {
    const entry = { label: `circle-${label}`, accepted, scene: { toolId: "plane-circle-area", contentVersion: version, payload: { title: "Independent circular sectors", initial } } }; cases.push(entry); return entry;
  };
  const initial = createCircleDissectionState(), rows = arrangeCircleSectors(initial, "rows");
  add("default", initial); add("rows", rows); add("mid-motion", interpolateCircleSectors(initial, rows, .37));
  for (const count of [8, 16, 32, 64]) for (const radius of [.5, 3]) add(`count-${count}-radius-${radius}`, setCircleSectorField(changeCircleCount(rows, count), "radius", radius));
  const precise = setCircleSectorField(setCircleSectorField(setCircleSectorField(selectSector(initial, "sector.3"), "x", -4.375), "y", 9.125), "angle", 729.125);
  add("precise", precise); add("custom-refined", changeCircleCount(precise, 64));
  for (const angle of [-36000, 36000]) add(`custom-bound-${angle}`, changeCircleCount(setCircleSectorField(precise, "angle", angle), 64));
  const bad = (label: string, change: (s: PlanarState) => void) => { const state = structuredClone(initial); change(state); add(label, state, false); };
  bad("extra-parameter", s => { s.params.answer = 1; }); bad("extra-point", s => { s.points.extra = { x: 0, y: 0 }; });
  bad("extra-flag", s => { s.flags.answer = true; }); bad("extra-state", s => { Object.assign(s, { answer: 3 }); });
  bad("count", s => { s.params.count = 9; }); bad("active", s => { s.params.active = 16; });
  bad("fractional-active", s => { s.params.active = 2.5; }); bad("missing-pose", s => { delete s.points["sector.0"]; });
  bad("missing-turn", s => { delete s.params["turn.0"]; }); bad("extra-point-field", s => { Object.assign(s.points["sector.0"], { z: 0 }); });
  bad("coordinate", s => { s.points["sector.0"].x = 20.00001; }); bad("angle", s => { s.params["turn.0"] = 36000.00001; });
  bad("radius", s => { s.params.radius = .4999; }); bad("phase", s => { s.phase = .1; }); bad("mark", s => { s.marks.push("answer"); });
  bad("flag-type", s => { s.flags.names = 1 as unknown as boolean; }); bad("number-type", s => { s.params.radius = "2.3" as unknown as number; });
  add("v2-as-v1", initial, false, "plane-circle-area-lesson-v1");
  const legacy = planeAreaScenes.find(scene => scene.id === "27")!.create();
  add("legacy", legacy, true, "plane-circle-area-lesson-v1"); add("legacy-as-v2", legacy, false);
  for (const [title, accepted, label] of [["\t　\n", false, "empty-title"], ["字".repeat(80), true, "80-units"], ["字".repeat(81), false, "81-units"], ["😀".repeat(40), true, "80-utf16"], ["😀".repeat(41), false, "82-utf16"], ["\uFEFF　Circle\t\n", true, "trim"]] as const) add(label, initial, accepted).scene.payload.title = title;
  return cases;
}
