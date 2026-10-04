import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { constructPaperLayers, createPaperLayersState, deleteCut, foldStep, interpolateFold, setPaperLayersField } from "../../src/features/tools/plane-paper-layers/model";
import { createPaperFoldingState } from "../../src/features/tools/plane-paper-folding/model";
import { planeMotionScenes } from "../../src/features/tools/plane-motion/scenes";

export function firstFoldState(): PlanarState {
  const prepared = constructPaperLayers(createPaperLayersState(), "crease", [{ x: 480, y: 180 }, { x: 480, y: 560 }])!;
  return foldStep(setPaperLayersField(prepared, "foldSide", -1));
}
export function twoFoldState(): PlanarState {
  return foldStep(constructPaperLayers(firstFoldState(), "crease", [{ x: 480, y: 370 }, { x: 700, y: 370 }])!);
}
export function planePaperLayersCases() {
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, state: PlanarState, accepted = true, version = "plane-folding-lesson-v3") => { const entry = { label, accepted, scene: { toolId: "plane-folding", contentVersion: version, payload: { title: "Two folds on one paper", initial: state } } }; cases.push(entry); return entry; };
  const bad = (label: string, state: PlanarState, change: (s: PlanarState) => void) => { const copy = structuredClone(state); change(copy); add(label, copy, false); };
  const base = createPaperLayersState(), first = firstFoldState(), second = twoFoldState();
  add("layers-default", base); add("one-full-fold", first); add("two-full-folds", second);
  const circle = constructPaperLayers(second, "cut-circle", [{ x: 590, y: 450 }, { x: 610, y: 450 }])!;
  const polygon = constructPaperLayers(circle, "cut-polygon", [{ x: 640, y: 540 }, { x: 720, y: 540 }, { x: 680, y: 585 }])!;
  add("four-layer-circle", circle); add("circle-plus-edge-polygon", polygon);
  add("one-layer-unfolded", foldStep(polygon, true)); add("all-layers-unfolded", foldStep(foldStep(polygon, true), true));
  add("stable-cut-gap", deleteCut(polygon, 1)); add("edited-radius", setPaperLayersField(setPaperLayersField(circle, "activeCut", 1), "cutRadius", 25));
  const cutAtFirst = constructPaperLayers(first, "cut-circle", [{ x: 600, y: 260 }, { x: 615, y: 260 }])!;
  const successive = foldStep(constructPaperLayers(cutAtFirst, "crease", [{ x: 480, y: 370 }, { x: 700, y: 370 }])!);
  add("cut-before-second-fold", successive); add("mixed-cut-depths", constructPaperLayers(successive, "cut-circle", [{ x: 550, y: 440 }, { x: 560, y: 440 }])!);
  add("explicit-semantic-half-fold", setPaperLayersField(second, "foldAngle", 90));
  add("animation-projection", interpolateFold(first, foldStep(first, true), 0.4), false);
  const concave = constructPaperLayers(base, "paper-polygon", [{ x: 200, y: 160 }, { x: 700, y: 160 }, { x: 700, y: 560 }, { x: 560, y: 560 }, { x: 560, y: 280 }, { x: 340, y: 280 }, { x: 340, y: 560 }, { x: 200, y: 560 }])!;
  const concaveFirst = foldStep(constructPaperLayers(concave, "crease", [{ x: 140, y: 400 }, { x: 760, y: 400 }])!);
  add("concave-two-creases", constructPaperLayers(concaveFirst, "crease", [{ x: 450, y: 100 }, { x: 450, y: 650 }])!);
  let oblique = constructPaperLayers(base, "crease", [{ x: 220, y: 170 }, { x: 720, y: 540 }])!;
  oblique = foldStep(oblique); oblique = foldStep(constructPaperLayers(oblique, "crease", [{ x: 350, y: 100 }, { x: 350, y: 680 }])!);
  add("oblique-real-layers", oblique);
  let twelve = second;
  for (let i = 0; i < 12; i++) twelve = constructPaperLayers(twelve, "cut-circle", [{ x: 500 + (i % 4) * 40, y: 410 + Math.floor(i / 4) * 40 }, { x: 510 + (i % 4) * 40, y: 410 + Math.floor(i / 4) * 40 }])!;
  add("twelve-independent-cuts", twelve);
  let maximumPoints = second;
  for (let i = 0; i < 6; i++) maximumPoints = constructPaperLayers(maximumPoints, "cut-polygon", Array.from({ length: 32 }, (_, j) => ({ x: 515 + (i % 3) * 65 + 18 * Math.cos(j * Math.PI / 16), y: 420 + Math.floor(i / 3) * 85 + 18 * Math.sin(j * Math.PI / 16) })))!;
  add("192-cut-points", maximumPoints);
  for (const s of [base, circle]) {
    bad(`${s.params.foldCount}-unknown-param`, s, (v) => { v.params.answer = 4; }); bad(`${s.params.foldCount}-unknown-point`, s, (v) => { v.points.answer = { x: 0, y: 0 }; });
    bad(`${s.params.foldCount}-unknown-flag`, s, (v) => { v.flags.answer = true; }); bad(`${s.params.foldCount}-unexpected-phase`, s, (v) => { v.phase = 0.1; }); bad(`${s.params.foldCount}-answer-mark`, s, (v) => { v.marks = ["answer.4"]; });
    bad(`${s.params.foldCount}-point-extra-key`, s, (v) => { Object.assign(v.points["paper.0"], { z: 0 }); });
  }
  bad("second-fold-before-first", second, (s) => { s.params["foldAngle.0"] = 179; }); bad("missing-crease", second, (s) => { delete s.points["foldA.1"]; });
  bad("tangent-crease", first, (s) => { s.points["foldA.0"].x = 260; s.points["foldB.0"].x = 260; });
  bad("singular-crease", first, (s) => { s.points["foldB.0"] = s.points["foldA.0"]; }); bad("third-fold", second, (s) => { s.params.foldCount = 3; });
  bad("active-cut-absent", circle, (s) => { s.params.activeCut = 2; }); bad("active-vertex-absent", circle, (s) => { s.params.activeVertex = 1; });
  bad("reused-id", circle, (s) => { s.params.nextCutId = 1; }); bad("noncanonical-cut-id", circle, (s) => { s.params["cutKind.01"] = 0; });
  bad("duplicate-cut-reordered-point-keys", circle, (s) => { s.params.nextCutId = 3; for (const key of ["Kind", "Vertices", "Radius", "Depth"]) s.params[`cut${key}.2`] = s.params[`cut${key}.1`]; s.points["cut.2.0"] = { y: 450, x: 590 }; });
  bad("cut-depth-zero", circle, (s) => { s.params["cutDepth.1"] = 0; }); bad("cut-depth-absent", circle, (s) => { s.params["cutDepth.1"] = 3; });
  bad("empty-space-cut", circle, (s) => { s.points["cut.1.0"] = { x: 20, y: 20 }; }); bad("circle-below-radius", circle, (s) => { s.params["cutRadius.1"] = 2.99; });
  bad("circle-above-radius", circle, (s) => { s.params["cutRadius.1"] = 350.01; }); bad("circle-extra-vertex", circle, (s) => { s.params["cutVertices.1"] = 2; });
  bad("world-bound", circle, (s) => { s.points["cut.1.0"].x = 5001; }); bad("source-outside-stage", circle, (s) => { s.points["paper.0"].x = -1; });
  bad("crossed-paper", circle, (s) => { const first = s.points["paper.0"]; s.points["paper.0"] = s.points["paper.1"]; s.points["paper.1"] = first; });
  bad("bad-flag-type", base, (s) => { s.flags.grid = 1 as unknown as boolean; }); bad("number-string", base, (s) => { s.params.nextCutId = "1" as unknown as number; });
  bad("257-params", base, (s) => { for (let i = Object.keys(s.params).length; i < 257; i++) s.params[`extra.${i}`] = i; });
  bad("193-cut-points", maximumPoints, (s) => { const id = s.params.nextCutId; s.params.nextCutId++; s.params[`cutKind.${id}`] = 0; s.params[`cutDepth.${id}`] = 2; s.params[`cutVertices.${id}`] = 1; s.params[`cutRadius.${id}`] = 5; s.points[`cut.${id}.0`] = { x: 590, y: 490 }; });
  for (const [title, accepted, label] of [["\t　\n", false, "empty-title"], ["字".repeat(80), true, "80-title-units"], ["字".repeat(81), false, "81-title-units"], ["😀".repeat(40), true, "80-title-utf16"], ["😀".repeat(41), false, "82-title-utf16"], ["\uFEFF　Fold\t\n", true, "trimmed-title"]] as const) add(label, base, accepted).scene.payload.title = title;
  const v2 = createPaperFoldingState(), legacy = planeMotionScenes.find((scene) => scene.id === "32")!.create();
  add("v2-readable", v2, true, "plane-folding-lesson-v2"); add("v1-readable", legacy, true, "plane-folding-lesson-v1");
  add("v2-rejects-layers", second, false, "plane-folding-lesson-v2"); add("v3-rejects-v2", v2, false); add("v3-rejects-v1", legacy, false);
  add("wrong-tool", second, false).scene.toolId = "plane-paper-cut";
  return cases;
}
