import { describe, expect, it } from "vitest";
import { constructionArea } from "../src/features/tools/plane-construction/model";
import { clearPaperCuts, constructPaper, createPaperFoldingState, dragPaper, paperCuts, paperPointRemains, paperRegions, paperVertices, setPaperField, sourceCut, triangulatePaper } from "../src/features/tools/plane-paper-folding/model";
import { isValidPaperFoldingState } from "../src/features/tools/plane-paper-folding/validation";

const prepared = () => setPaperField(constructPaper(createPaperFoldingState(), "crease", [{ x: 480, y: 190 }, { x: 480, y: 550 }])!, "side", -1);
const folded = () => ({ ...prepared(), phase: 1 });
describe("one arbitrary paper fold and actual layer cuts", () => {
  it("accepts concave paper and preserves disjoint same-side regions without inventing connecting paper", () => {
    const polygon = [{ x: 200, y: 160 }, { x: 650, y: 160 }, { x: 650, y: 560 }, { x: 540, y: 560 }, { x: 540, y: 270 }, { x: 310, y: 270 }, { x: 310, y: 560 }, { x: 200, y: 560 }];
    const paper = constructPaper(createPaperFoldingState(), "paper-polygon", polygon)!;
    const state = constructPaper(paper, "crease", [{ x: 150, y: 390 }, { x: 750, y: 390 }])!;
    expect(isValidPaperFoldingState(state)).toBe(true);
    const triangles = triangulatePaper(polygon);
    expect(triangles.reduce((sum, triangle) => sum + constructionArea(triangle), 0)).toBeCloseTo(constructionArea(polygon));
    const all = [false, true].flatMap((side) => paperRegions(state, side, 0));
    expect(all.reduce((sum, fragment) => sum + constructionArea(fragment), 0)).toBeCloseTo(constructionArea(polygon));
    expect(paperPointRemains(state, { x: 420, y: 480 })).toBe(false);
  });
  it("cuts only the actual folded layers and maps each hole through the chosen off-center crease", () => {
    const state = constructPaper(folded(), "cut-circle", [{ x: 590, y: 300 }, { x: 610, y: 300 }])!;
    expect(isValidPaperFoldingState(state)).toBe(true);
    const cut = paperCuts(state)[0], source = sourceCut(state, cut, true);
    expect(source.points[0].x).toBeCloseTo(370); expect(source.points[0].y).toBeCloseTo(300);
    expect(paperPointRemains(state, { x: 590, y: 300 })).toBe(false);
    expect(paperPointRemains(state, { x: 370, y: 300 })).toBe(false);
    expect(paperPointRemains(state, { x: 590, y: 335 })).toBe(true);
  });
  it("supports a cut across an outer edge and a polygonal notch without filling exterior islands", () => {
    const circle = constructPaper(folded(), "cut-circle", [{ x: 696, y: 300 }, { x: 716, y: 300 }])!;
    expect(isValidPaperFoldingState(circle)).toBe(true);
    expect(paperPointRemains(circle, { x: 692, y: 300 })).toBe(false);
    expect(paperPointRemains(circle, { x: 268, y: 300 })).toBe(false);
    expect(paperPointRemains(circle, { x: 705, y: 340 })).toBe(false);
    const notch = constructPaper(circle, "cut-polygon", [{ x: 550, y: 170 }, { x: 620, y: 170 }, { x: 585, y: 235 }])!;
    expect(isValidPaperFoldingState(notch)).toBe(true);
    expect(paperPointRemains(notch, { x: 585, y: 205 })).toBe(false);
    expect(paperPointRemains(notch, { x: 375, y: 205 })).toBe(false);
  });
  it("keeps a one-layer cut one-layer when an asymmetric paper has no partner under it", () => {
    const paper = constructPaper(createPaperFoldingState(), "paper-polygon", [{ x: 260, y: 180 }, { x: 700, y: 180 }, { x: 700, y: 560 }, { x: 480, y: 370 }, { x: 260, y: 370 }])!;
    const state = { ...setPaperField(constructPaper(paper, "crease", [{ x: 480, y: 190 }, { x: 480, y: 540 }])!, "side", -1), phase: 1 };
    const cut = constructPaper(state, "cut-circle", [{ x: 640, y: 445 }, { x: 650, y: 445 }])!;
    expect(isValidPaperFoldingState(cut)).toBe(true);
    expect(paperPointRemains(state, { x: 640, y: 445 })).toBe(true);
    expect(paperPointRemains(cut, { x: 640, y: 445 })).toBe(false);
    expect(paperPointRemains(cut, { x: 320, y: 445 })).toBe(false);
  });
  it("rejects crossing or degenerate outlines, tangential creases and cuts through empty space", () => {
    const initial = createPaperFoldingState();
    expect(constructPaper(initial, "paper-polygon", [{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }, { x: 300, y: 100 }])).toBeNull();
    expect(constructPaper(initial, "crease", [{ x: 260, y: 180 }, { x: 700, y: 180 }])).toBeNull();
    expect(constructPaper(initial, "crease", [{ x: 400, y: 300 }, { x: 400, y: 300 }])).toBeNull();
    expect(constructPaper(prepared(), "cut-circle", [{ x: 590, y: 300 }, { x: 610, y: 300 }])).toBeNull();
    expect(constructPaper(folded(), "cut-circle", [{ x: 100, y: 100 }, { x: 110, y: 100 }])).toBeNull();
    expect(constructPaper(folded(), "cut-polygon", [{ x: 530, y: 200 }, { x: 630, y: 300 }, { x: 530, y: 300 }, { x: 630, y: 200 }])).toBeNull();
  });
  it("locks crease mapping after cutting until the teacher explicitly removes the cuts", () => {
    const state = constructPaper(folded(), "cut-circle", [{ x: 590, y: 300 }, { x: 610, y: 300 }])!;
    const flat = { ...state, phase: 0 };
    expect(setPaperField(flat, "axisX", 470)).toBe(flat); expect(setPaperField(flat, "side", -1)).toBe(flat);
    expect(constructPaper(flat, "paper-rectangle", [{ x: 100, y: 100 }, { x: 500, y: 400 }])).toBeNull();
    const cleared = clearPaperCuts(flat); expect(isValidPaperFoldingState(cleared)).toBe(true); expect(paperCuts(cleared)).toEqual([]);
    expect(setPaperField(cleared, "axisX", 470).points.creaseA.x).toBeCloseTo(470);
    expect(paperVertices(cleared)).toEqual(paperVertices(state));
  });
  it("uses the real crease normal for direct drag and exact angles for any saved intermediate pose", () => {
    const state = { ...prepared(), phase: 0.2 };
    expect(dragPaper(state, "paper-moving", { x: 500, y: 300 }, { x: 0, y: 130 }).phase).toBeCloseTo(0.2);
    expect(dragPaper(state, "paper-moving", { x: 500, y: 300 }, { x: 130, y: 0 }).phase).toBeCloseTo(0.7);
    expect(setPaperField(state, "foldAngle", 90).phase).toBe(0.5);
    for (const phase of [0, 0.1, 0.5, 0.9, 1]) expect(isValidPaperFoldingState({ ...state, phase })).toBe(true);
  });
  it("strictly rejects phantom keys, singular undeclared creases and impossible cut records", () => {
    const initial = createPaperFoldingState(); expect(isValidPaperFoldingState(initial)).toBe(true);
    expect(isValidPaperFoldingState({ ...initial, params: { ...initial.params, extra: 1 } })).toBe(false);
    expect(isValidPaperFoldingState({ ...initial, points: { ...initial.points, creaseB: initial.points.creaseA } })).toBe(false);
    expect(isValidPaperFoldingState({ ...initial, phase: 0.5 })).toBe(false);
    const cut = constructPaper(folded(), "cut-circle", [{ x: 590, y: 300 }, { x: 610, y: 300 }])!;
    expect(isValidPaperFoldingState({ ...cut, points: { ...cut.points, "cut.0.0": { x: 0, y: 0 } } })).toBe(false);
  });
});
