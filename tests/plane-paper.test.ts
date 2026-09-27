import { describe, expect, it } from "vitest";
import { addConstruction, constructionArea, constructionObject, constructionObjects, duplicateConstruction, interpolateConstruction, moveConstruction, removeConstruction, transformConstruction, worldVertices } from "@/features/tools/plane-construction/model";
import { PAPER_MATERIALS, addPaperMaterial, createPaperGeometry, createPaperState, cutAlongPaperAltitude, cutPaper, paperAltitude, paperArea, splitPaperPolygon, tapPaper } from "@/features/tools/plane-paper/model";
import { isValidPaperState } from "@/features/tools/plane-paper/validation";

const square = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
const uShape = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 }, { x: 0, y: 300 }];
const empty = () => removeConstruction(createPaperState());
describe("constructed paper and real straight cuts", () => {
  it("cuts convex paper and handles existing vertices without inventing bridges", () => {
    const halves = splitPaperPolygon(square, { x: 100, y: -50 }, { x: 100, y: 250 })!;
    expect(halves).toHaveLength(2); expect(halves.map(constructionArea)).toEqual([20000, 20000]);
    const diagonal = splitPaperPolygon(square, { x: 0, y: 0 }, { x: 200, y: 200 })!;
    expect(diagonal).toHaveLength(2); expect(diagonal.every((paper) => paper.length === 3)).toBe(true);
    expect(diagonal.reduce((sum, piece) => sum + constructionArea(piece), 0)).toBe(40000);
  });
  it("keeps disconnected components separate for a concave paper and either winding", () => {
    for (const shape of [uShape, [...uShape].reverse()]) for (const y of [100, 200]) {
      const pieces = splitPaperPolygon(shape, { x: -20, y }, { x: 320, y })!;
      expect(pieces).toHaveLength(3);
      expect(pieces.reduce((sum, piece) => sum + constructionArea(piece), 0)).toBeCloseTo(constructionArea(shape), 8);
      expect(pieces.every((piece) => piece.length <= 8)).toBe(true);
    }
  });
  it("rejects edge-only, tangent, short and tiny-sliver cuts atomically", () => {
    expect(splitPaperPolygon(square, { x: -50, y: 0 }, { x: 250, y: 0 })).toBeNull();
    expect(splitPaperPolygon(square, { x: 0, y: 0 }, { x: -100, y: 100 })).toBeNull();
    expect(splitPaperPolygon(square, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(splitPaperPolygon(square, { x: 0.002, y: -50 }, { x: 0.002, y: 250 })).toBeNull();
    expect(splitPaperPolygon(square, { x: NaN, y: 0 }, { x: 20, y: 10 })).toBeNull();
  });
  it("preserves area for varied simple concave polygons and cut directions", () => {
    for (let sample = 0; sample < 35; sample++) {
      const polygon = Array.from({ length: 14 }, (_, index) => {
        const angle = index * Math.PI * 2 / 14, radius = 110 + ((sample * 17 + index * 31) % 90);
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      });
      const angle = sample * 0.271, d = { x: Math.cos(angle) * 300, y: Math.sin(angle) * 300 };
      const pieces = splitPaperPolygon(polygon, { x: -d.x, y: -d.y }, d);
      expect(pieces, `cut ${sample}`).not.toBeNull();
      expect(pieces!.reduce((sum, piece) => sum + constructionArea(piece), 0)).toBeCloseTo(constructionArea(polygon), 6);
    }
  });
  it("preserves the other papers and uses stable IDs while cutting a reflected and rotated paper", () => {
    let state = addConstruction(empty(), "polygon", square);
    const first = constructionObject(state)!, originalId = first.id;
    state = addPaperMaterial(state, "triangle"); const otherId = state.params.active;
    state = { ...state, params: { ...state.params, active: originalId, [`angle.${originalId}`]: 37, [`flip.${originalId}`]: -1 }, flags: { ...state.flags, snap: true } };
    const before = constructionObject(state, originalId)!, other = constructionObject(state, otherId)!, lineY = before.center.y, area = paperArea(state);
    const cut = cutPaper(state, { x: -400, y: lineY }, { x: 900, y: lineY })!;
    expect(cut).not.toBeNull(); expect(isValidPaperState(cut)).toBe(true);
    expect(constructionObject(cut, originalId)).toBeNull(); expect(constructionObject(cut, otherId)).toEqual(other);
    expect(constructionObjects(cut)).toHaveLength(3); expect(cut.params.active).toBe(state.params.nextId);
    expect(cut.flags.snap).toBe(true); expect(paperArea(cut)).toBeCloseTo(area, 7);
    const reopened = JSON.parse(JSON.stringify(cut)); expect(isValidPaperState(reopened)).toBe(true); expect(reopened).toEqual(cut);
  });
  it("allows independent movement, turning, copying, removal and repeated cuts after a split", () => {
    const state = addConstruction(empty(), "polygon", square), firstCut = cutPaper(state, { x: 100, y: -20 }, { x: 100, y: 220 })!;
    const papers = constructionObjects(firstCut), active = constructionObject(firstCut)!;
    const moved = moveConstruction(firstCut, `object.${active.id}`, active.center, { x: 70, y: 25 });
    expect(constructionObject(moved)!.center.x).toBeCloseTo(active.center.x + 70);
    expect(constructionObject(moved, papers[1].id)).toEqual(papers[1]);
    const prepared = { ...moved, points: { ...moved.points, pivot: constructionObject(moved)!.center }, params: { ...moved.params, turn: 90 } };
    const turned = transformConstruction(prepared, "rotate");
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(paperArea(interpolateConstruction(prepared, turned, t, "rotate"))).toBeCloseTo(paperArea(firstCut), 7);
    const reflected = transformConstruction(prepared, "reflect");
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(paperArea(interpolateConstruction(prepared, reflected, t, "reflect"))).toBeCloseTo(paperArea(firstCut), 7);
    const center = constructionObject(turned)!.center, again = cutPaper(turned, { x: center.x - 400, y: center.y }, { x: center.x + 400, y: center.y })!;
    expect(constructionObjects(again)).toHaveLength(3); expect(paperArea(again)).toBeCloseTo(paperArea(state), 7);
    const copiedArea = constructionArea(worldVertices(constructionObject(again)!)), duplicate = duplicateConstruction(again);
    expect(paperArea(duplicate)).toBeCloseTo(paperArea(again) + copiedArea, 7);
    expect(paperArea(removeConstruction(duplicate))).toBeCloseTo(paperArea(again), 7);
    expect(isValidPaperState(duplicate)).toBe(true);
  });
  it("adds each shortcut without replacing the existing classroom stage", () => {
    for (const material of PAPER_MATERIALS) {
      const before = createPaperState(), first = constructionObject(before)!, after = addPaperMaterial(before, material.id);
      expect(isValidPaperState(after), material.id).toBe(true);
      expect(constructionObject(after, first.id)).toEqual(first);
      expect(constructionObjects(after)).toHaveLength(material.polygons.length + 1);
    }
  });
  it("derives a perpendicular altitude from a chosen edge and uses it as the same real cut", () => {
    const state = createPaperState(), id = state.params.active, marked = tapPaper(state, `edge.${id}.0`), height = paperAltitude(marked)!;
    expect(height).not.toBeNull(); expect(marked.flags.edges).toBe(false);
    const dx = height.baseB.x - height.baseA.x, dy = height.baseB.y - height.baseA.y;
    expect(dx * (height.vertex.x - height.foot.x) + dy * (height.vertex.y - height.foot.y)).toBeCloseTo(0, 9);
    const cut = cutAlongPaperAltitude(marked)!;
    expect(cut).not.toBeNull(); expect(paperArea(cut)).toBeCloseTo(paperArea(state), 8);
    const alternate = tapPaper(state, `edge.${id}.1`), second = paperAltitude(alternate)!;
    expect(second.height).not.toBeCloseTo(height.height); expect(cutAlongPaperAltitude(alternate)).not.toBeNull();
  });
  it("keeps a useful exterior altitude on a strongly sheared paper and permits a second custom cut", () => {
    const state = addPaperMaterial(empty(), "steep-parallelogram"), selected = `edge.${state.params.active}.0`;
    const marked = tapPaper(state, selected), altitude = paperAltitude(marked)!;
    expect(altitude.within).toBe(false);
    const first = cutAlongPaperAltitude(marked)!;
    expect(first).not.toBeNull(); expect(constructionObjects(first)).toHaveLength(2);
    const center = constructionObject(first)!.center;
    const second = cutPaper(first, { x: center.x, y: center.y - 300 }, { x: center.x, y: center.y + 300 })!;
    expect(second).not.toBeNull(); expect(constructionObjects(second)).toHaveLength(3);
    expect(paperArea(second)).toBeCloseTo(paperArea(state), 7); expect(isValidPaperState(second)).toBe(true);
  });
  it("keeps the shared strict budgets and rejects curves, metadata and uncommitted frame keys", () => {
    const state = createPaperState(), id = state.params.active;
    expect(isValidPaperState({ ...state, sceneId: "14" })).toBe(false);
    expect(isValidPaperState({ ...state, params: { ...state.params, [`frameA.${id}`]: 1 } })).toBe(false);
    const circle = addConstruction(empty(), "circle", [{ x: 300, y: 300 }, { x: 400, y: 300 }]);
    expect(isValidPaperState(circle)).toBe(false);
    expect(createPaperGeometry(state, "circle", [{ x: 300, y: 300 }, { x: 400, y: 300 }])).toBeNull();
    let full = empty();
    for (let index = 0; index < 16; index++) full = addConstruction(full, "polygon", square);
    const snapshot = structuredClone(full);
    expect(cutPaper(full, { x: 100, y: -20 }, { x: 100, y: 220 })).toBeNull(); expect(full).toEqual(snapshot);
  });
});
