import { describe, expect, it } from "vitest";
import { constructionArea } from "../src/features/tools/plane-construction/model";
import { activeCut, applyMatrix, buildPaperLayers, constructPaperLayers, createPaperLayersState, cutEditingPose, deleteCut, dragPaperLayers, foldStep, interpolateFold, inverse, layerMatrix, paperCuts, paperPointRemains, paperVertices, removeLastFold, setPaperLayersField, sourceCut } from "../src/features/tools/plane-paper-layers/model";
import { isValidPaperLayersState } from "../src/features/tools/plane-paper-layers/validation";
import { firstFoldState, planePaperLayersCases, twoFoldState } from "./fixtures/plane-paper-layers-cases";

describe("true two-fold paper layers and independently editable cuts", () => {
  it("conserves original area and reverses the moving stack at each fold", () => {
    const state = twoFoldState(), { layers } = buildPaperLayers(state);
    expect(layers.map((layer) => layer.bits)).toEqual([0, 1, 3, 2]);
    expect(layers.reduce((sum, layer) => sum + layer.sourceRegions.reduce((area, poly) => area + constructionArea(poly), 0), 0)).toBeCloseTo(constructionArea(paperVertices(state)), 7);
    for (const layer of layers) for (const poly of layer.sourceRegions) for (const p of poly) { const roundtrip = applyMatrix(inverse(layer.maps[2]), applyMatrix(layer.maps[2], p)); expect(roundtrip.x).toBeCloseTo(p.x, 8); expect(roundtrip.y).toBeCloseTo(p.y, 8); }
  });
  it("cuts the four original regions and retains exactly the same holes while unfolding sequentially", () => {
    let s = constructPaperLayers(twoFoldState(), "cut-circle", [{ x: 590, y: 450 }, { x: 610, y: 450 }])!;
    const originals = [{ x: 590, y: 450 }, { x: 370, y: 450 }, { x: 590, y: 290 }, { x: 370, y: 290 }];
    for (let step = 0; step < 3; step++) { expect(originals.map((p) => paperPointRemains(s, p))).toEqual([false, false, false, false]); expect(paperPointRemains(s, { x: 630, y: 450 })).toBe(true); expect(isValidPaperLayersState(s)).toBe(true); s = foldStep(s, true); }
    expect(s.params["foldAngle.0"]).toBe(0); expect(s.params["foldAngle.1"]).toBe(0);
  });
  it("preserves cuts from the first depth and applies a later cut only through actual second-depth material", () => {
    const firstCut = constructPaperLayers(firstFoldState(), "cut-circle", [{ x: 600, y: 260 }, { x: 615, y: 260 }])!;
    const second = foldStep(constructPaperLayers(firstCut, "crease", [{ x: 480, y: 370 }, { x: 700, y: 370 }])!);
    const final = constructPaperLayers(second, "cut-circle", [{ x: 550, y: 440 }, { x: 560, y: 440 }])!;
    expect(paperCuts(final).map((cut) => cut.depth)).toEqual([1, 2]);
    expect(paperPointRemains(final, { x: 600, y: 260 })).toBe(false); expect(paperPointRemains(final, { x: 600, y: 480 })).toBe(true);
    expect(paperPointRemains(final, { x: 550, y: 300 })).toBe(false); expect(paperPointRemains(final, { x: 410, y: 440 })).toBe(false);
  });
  it("does not invent a reflected partner or a bridge through a concave gap", () => {
    const poly = [{ x: 200, y: 160 }, { x: 700, y: 160 }, { x: 700, y: 560 }, { x: 560, y: 560 }, { x: 560, y: 280 }, { x: 340, y: 280 }, { x: 340, y: 560 }, { x: 200, y: 560 }];
    const paper = constructPaperLayers(createPaperLayersState(), "paper-polygon", poly)!, first = foldStep(constructPaperLayers(paper, "crease", [{ x: 140, y: 400 }, { x: 760, y: 400 }])!);
    const second = foldStep(constructPaperLayers(first, "crease", [{ x: 450, y: 100 }, { x: 450, y: 650 }])!);
    expect(paperPointRemains(second, { x: 450, y: 450 })).toBe(false);
    expect(buildPaperLayers(second).layers.reduce((sum, layer) => sum + layer.sourceRegions.reduce((n, region) => n + constructionArea(region), 0), 0)).toBeCloseTo(constructionArea(poly), 6);
  });
  it("supports crossing paper edges and analytic circles at oblique fold angles", () => {
    const edge = constructPaperLayers(twoFoldState(), "cut-circle", [{ x: 698, y: 450 }, { x: 718, y: 450 }])!;
    expect(paperPointRemains(edge, { x: 695, y: 450 })).toBe(false); expect(paperPointRemains(edge, { x: 265, y: 290 })).toBe(false);
    const entry = planePaperLayersCases().find((c) => c.label === "oblique-real-layers")!;
    const s = entry.scene.payload.initial, layer = buildPaperLayers(s).layers.find((item) => item.sourceRegions.length)!;
    const source = layer.sourceRegions[0].reduce((sum, p) => ({ x: sum.x + p.x / layer.sourceRegions[0].length, y: sum.y + p.y / layer.sourceRegions[0].length }), { x: 0, y: 0 }), at = applyMatrix(layer.maps[2], source);
    const cut = constructPaperLayers(s, "cut-circle", [at, { x: at.x + 12, y: at.y }])!;
    expect(isValidPaperLayersState(cut)).toBe(true); expect(paperPointRemains(cut, source)).toBe(false); expect(sourceCut(paperCuts(cut)[0], layer).radius).toBe(12);
  });
  it("edits and deletes one stable cut without mutating another cut or its identity", () => {
    const a = constructPaperLayers(twoFoldState(), "cut-circle", [{ x: 570, y: 430 }, { x: 585, y: 430 }])!, b = constructPaperLayers(a, "cut-circle", [{ x: 650, y: 490 }, { x: 660, y: 490 }])!;
    const before = paperCuts(b)[1], selected = setPaperLayersField(b, "activeCut", 1), moved = setPaperLayersField(setPaperLayersField(selected, "cutX", 585), "cutRadius", 20);
    expect(paperCuts(moved)[1]).toEqual(before); expect(activeCut(moved)?.points[0].x).toBe(585); expect(activeCut(moved)?.radius).toBe(20);
    const removed = deleteCut(moved, 1); expect(paperCuts(removed)).toEqual([before]); expect(removed.params.nextCutId).toBe(3);
    const added = constructPaperLayers(removed, "cut-circle", [{ x: 530, y: 450 }, { x: 540, y: 450 }])!; expect(paperCuts(added).map((cut) => cut.id)).toEqual([2, 3]);
  });
  it("maps direct cut edits from any unfolded copy back into the cut-depth coordinate frame", () => {
    const s = constructPaperLayers(twoFoldState(), "cut-circle", [{ x: 590, y: 450 }, { x: 610, y: 450 }])!, flat = foldStep(foldStep(s, true), true);
    const moved = dragPaperLayers(flat, "cut-body.1.0.3", { x: 370, y: 290 }, { x: 10, y: 5 });
    expect(activeCut(moved)?.points[0]).toEqual({ x: 580, y: 445 }); expect(isValidPaperLayersState(moved)).toBe(true);
    const radius = dragPaperLayers(flat, "cut-radius.1.0.3", { x: 350, y: 290 }, { x: -5, y: 0 }); expect(activeCut(radius)?.radius).toBe(25);
    expect(cutEditingPose(flat).params["foldAngle.1"]).toBe(180);
  });
  it("edits polygon vertices and rejects self-crossing, empty-space or out-of-order moves", () => {
    const s = constructPaperLayers(twoFoldState(), "cut-polygon", [{ x: 550, y: 420 }, { x: 610, y: 420 }, { x: 610, y: 480 }, { x: 550, y: 480 }])!;
    const selected = setPaperLayersField(s, "activeVertex", 1), edited = setPaperLayersField(selected, "cutX", 620); expect(activeCut(edited)?.points[1].x).toBe(620);
    expect(setPaperLayersField(edited, "cutY", 490)).toBe(edited); expect(setPaperLayersField(s, "activeVertex", 99)).toBe(s);
    expect(setPaperLayersField(setPaperLayersField(s, "activeFold", 0), "foldAngle", 90).params["foldAngle.0"]).toBe(180);
    expect(constructPaperLayers(createPaperLayersState(), "cut-circle", [{ x: 400, y: 300 }, { x: 420, y: 300 }])).toBeNull();
  });
  it("locks only folds on which an existing cut depends and removes an empty final crease independently", () => {
    const first = constructPaperLayers(firstFoldState(), "cut-circle", [{ x: 600, y: 260 }, { x: 615, y: 260 }])!, two = constructPaperLayers(first, "crease", [{ x: 480, y: 370 }, { x: 700, y: 370 }])!;
    const edit = setPaperLayersField(two, "axisY", 390); expect(edit.points["foldA.1"].y).toBe(390); expect(paperCuts(edit)).toEqual(paperCuts(first));
    const removed = removeLastFold(edit); expect(removed.params.foldCount).toBe(1); expect(paperCuts(removed)).toEqual(paperCuts(first));
    const flat = foldStep(first, true); expect(setPaperLayersField(flat, "axisX", 450)).toBe(flat);
  });
  it("keeps continuous hinge poses reconstructible while marking animation projection frames unsaveable", () => {
    const s = firstFoldState(), to = foldStep(s, true), frame = interpolateFold(s, to, 0.37);
    expect(frame.params["foldAngle.0"]).toBeCloseTo(113.4); expect(isValidPaperLayersState(frame)).toBe(false); expect(interpolateFold(s, to, 1)).toBe(to);
    const semantic = setPaperLayersField(s, "foldAngle", 90); expect(isValidPaperLayersState(semantic)).toBe(true);
    const moving = buildPaperLayers(semantic).layers.find((layer) => layer.bits === 1)!; expect(Math.abs(layerMatrix(semantic, moving)[0])).toBeLessThan(1e-10);
    const normal = dragPaperLayers(to, "layer.1", { x: 370, y: 300 }, { x: 130, y: 0 }); expect(normal.params["foldAngle.0"]).toBeCloseTo(90);
    expect(dragPaperLayers(to, "layer.1", { x: 370, y: 300 }, { x: 0, y: 130 }).params["foldAngle.0"]).toBe(0);
  });
  it("covers strict state fixtures, capacity, title-independent version boundaries and malformed values", () => {
    for (const entry of planePaperLayersCases()) {
      if (entry.scene.contentVersion !== "plane-folding-lesson-v3" || entry.scene.toolId !== "plane-folding" || /title/.test(entry.label)) continue;
      expect(isValidPaperLayersState(entry.scene.payload.initial), entry.label).toBe(entry.accepted);
    }
    const full = planePaperLayersCases().find((c) => c.label === "twelve-independent-cuts")!.scene.payload.initial;
    expect(constructPaperLayers(full, "cut-circle", [{ x: 550, y: 450 }, { x: 565, y: 450 }])).toBeNull();
    expect(isValidPaperLayersState(null as never)).toBe(false);
  });
});
