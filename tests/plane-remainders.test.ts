import { describe, expect, it } from "vitest";
import { parseToolScene } from "@/features/tools/scenes/contract";
import { constructionArea, constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { addRelationMaterial, createRelationGeometry, relationFlag } from "@/features/tools/plane-relations/model";
import { convexRegions, crossAt } from "@/features/tools/plane-relations/geometry";
import { applyInteriorBase, createInteriorState, dragInterior, interiorModel, interpolateInteriorSeparation, setInteriorField, splitInteriorMaterial, toggleInterior, type InteriorSplit } from "@/features/tools/plane-relations/interior-model";
import { isValidInteriorState } from "@/features/tools/plane-relations/interior-validation";
import { planeInteriorScene } from "@/features/tools/plane-relations/interior-scene";

const prepared = () => toggleInterior(createInteriorState());
const valid = (state: ReturnType<typeof prepared>) => expect(isValidInteriorState(state)).toBe(true);
const action = (id: string) => planeInteriorScene.operations!.flatMap((operation) => operation.actions ?? []).find((entry) => entry.id === id)!;
const samePoints = (actual: ReturnType<typeof worldVertices>, expected: ReturnType<typeof worldVertices>) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, i) => { expect(point.x).toBeCloseTo(expected[i].x, 7); expect(point.y).toBeCloseTo(expected[i].y, 7); });
};

describe("common triangle and two real remainder materials", () => {
  it("replaces the source with three exact pieces for each base, rotation and reflection", () => {
    for (const angle of [0, 37, -125]) for (const flip of [1, -1]) for (const base of [0, 1, 2]) {
      let state = setInteriorField(setInteriorField(setInteriorField(prepared(), "angle", angle), "innerBase", 0.31), "innerHeight", 0.42);
      state = { ...state, params: { ...state.params, [`flip.${state.params.active}`]: flip, [`base.${state.params.active}`]: base } }; valid(state);
      const saved = JSON.stringify(state), model = interiorModel(state)!, next = splitInteriorMaterial(state, "pieces"); valid(next);
      const pieces = constructionObjects(next), expected = [model.common, ...model.parts.slice(2)];
      expect(constructionObject(next, model.object.id)).toBeNull(); expect(pieces).toHaveLength(3);
      expect(next.params.active).toBe(state.params.nextId); expect(next.params.nextId).toBe(state.params.nextId + 3);
      pieces.forEach((piece, index) => samePoints(worldVertices(piece), expected[index]));
      expect(pieces.reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(model.area, 7);
      pieces.forEach((piece, index) => pieces.slice(index + 1).forEach((other) => expect(constructionArea(convexRegions(worldVertices(piece), worldVertices(other)).intersection)).toBeLessThan(1e-6)));
      expect(JSON.stringify(state)).toBe(saved);
    }
  });

  it("moves only the common triangle beyond the actual base and preserves both wings", () => {
    for (const angle of [0, 53, -121]) for (const flip of [1, -1]) {
      let state = setInteriorField(setInteriorField(prepared(), "angle", angle), "innerConstraint", 1);
      state = { ...state, params: { ...state.params, [`flip.${state.params.active}`]: flip } };
      const model = interiorModel(state)!, split = splitInteriorMaterial(state, "pieces"), separate = splitInteriorMaterial(state, "separate"); valid(separate);
      const common = constructionObject(separate)!, before = constructionObject(split)!;
      const delta = { x: common.center.x - before.center.x, y: common.center.y - before.center.y };
      expect(Math.hypot(delta.x, delta.y)).toBeCloseTo(model.heights[0].amount * model.v + 36, 7);
      expect(delta.x * (model.b.x - model.a.x) + delta.y * (model.b.y - model.a.y)).toBeCloseTo(0, 7);
      const side = Math.sign(crossAt(model.a, model.b, model.c));
      worldVertices(common).forEach((point) => expect(side * crossAt(model.a, model.b, point) / model.length).toBeLessThanOrEqual(-36 + 1e-7));
      expect(common.vertices).toEqual(before.vertices);
      constructionObjects(separate).slice(1).forEach((piece) => expect(piece).toEqual(constructionObject(split, piece.id)));
    }
  });

  it("keeps only the two wings with precisely the source area minus the common triangle", () => {
    const state = setInteriorField(setInteriorField(prepared(), "innerBase", 0.22), "innerHeight", 0.63), model = interiorModel(state)!;
    const next = splitInteriorMaterial(state, "wings"); valid(next);
    const pieces = constructionObjects(next); expect(pieces).toHaveLength(2);
    pieces.forEach((piece, index) => samePoints(worldVertices(piece), model.parts[index + 2]));
    expect(pieces.reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(model.area - constructionArea(model.common), 7);
    expect(next.params.nextId).toBe(state.params.nextId + 2); expect(constructionObject(next, model.object.id)).toBeNull();
    expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Remainders", initial: JSON.parse(JSON.stringify(next)) } })).not.toThrow();
  });

  it("uses rigid conserved motion frames with exact start and finish and no new frame IDs", () => {
    const state = setInteriorField(prepared(), "angle", 29), target = splitInteriorMaterial(state, "separate"), assembled = splitInteriorMaterial(state, "pieces");
    const from = constructionObject(assembled)!, to = constructionObject(target)!, area = interiorModel(state)!.area;
    expect(interpolateInteriorSeparation(state, target, 0)).toBe(state); expect(interpolateInteriorSeparation(state, target, 1)).toBe(target);
    for (const progress of [1e-9, 0.25, 0.5, 0.9]) {
      const frame = interpolateInteriorSeparation(state, target, progress); valid(frame);
      const common = constructionObject(frame)!;
      expect(common.center.x).toBeCloseTo(from.center.x + (to.center.x - from.center.x) * progress, 7);
      expect(common.center.y).toBeCloseTo(from.center.y + (to.center.y - from.center.y) * progress, 7);
      expect(common.vertices).toEqual(to.vertices); expect(frame.params).toEqual(target.params);
      expect(constructionObjects(frame).reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(area, 7);
      constructionObjects(frame).slice(1).forEach((piece) => expect(piece).toEqual(constructionObject(target, piece.id)));
    }
    expect(interpolateInteriorSeparation(state, target, NaN)).toBe(state);
    expect(interpolateInteriorSeparation(state, target, -1)).toBe(state); expect(interpolateInteriorSeparation(state, target, 2)).toBe(target);
  });

  it("handles a self-drawn triangle and preserves unrelated material, observations and marks", () => {
    const original = prepared(), untouched = original.params.active;
    let state = applyInteriorBase(original, (base) => createRelationGeometry(base, "polygon", [{ x: 130, y: 410 }, { x: 590, y: 370 }, { x: 340, y: 105 }]) ?? base);
    state = setInteriorField(toggleInterior(state), "innerConstraint", 1);
    const source = state.params.active, model = interiorModel(state)!;
    state = { ...state, flags: { ...state.flags, snap: true }, marks: [`edge.${untouched}.1`, `vertex.${source}.0`] }; valid(state);
    const next = splitInteriorMaterial(state, "pieces"); valid(next);
    expect(constructionObject(next, untouched)).toEqual(constructionObject(state, untouched));
    expect(interiorModel(next, untouched)).toEqual(interiorModel(state, untouched)); expect(next.marks).toEqual([`edge.${untouched}.1`]);
    expect(next.flags.snap).toBe(true); expect(next.params[`innerBase.${source}`]).toBeUndefined(); expect(next.flags[`collinear.${source}`]).toBeUndefined();
    const pieces = constructionObjects(next).filter((piece) => piece.id !== untouched);
    pieces.forEach((piece, i) => {
      samePoints(worldVertices(piece), [model.common, ...model.parts.slice(2)][i]);
      expect(relationFlag(next, "interior", piece.id)).toBe(false); expect(relationFlag(next, "collinear", piece.id)).toBe(false);
    });
    const moved = dragInterior(next, `object.${next.params.active}`, { x: 0, y: 0 }, { x: 45, y: -30 }); valid(moved);
    pieces.slice(1).forEach((piece) => expect(constructionObject(moved, piece.id)).toEqual(piece));
  });

  it("keeps exact fragment geometry independent of the drawing grid", () => {
    const plain = setInteriorField(setInteriorField(prepared(), "angle", 17), "innerBase", 0.237);
    const snapped = { ...plain, flags: { ...plain.flags, snap: true } };
    for (const mode of ["pieces", "separate", "wings"] as const) {
      const a = splitInteriorMaterial(plain, mode), b = splitInteriorMaterial(snapped, mode); valid(a); valid(b);
      expect(b).toEqual({ ...a, flags: { ...a.flags, snap: true } });
    }
  });

  it("uses capacity released by the source and rejects the whole action when any extra piece will not fit", () => {
    const seed = prepared(), source = seed.params.active;
    let state = seed;
    for (let i = 1; i < 16; i++) {
      state = applyInteriorBase(state, (base) => addRelationMaterial(base, "triangle"));
      state = { ...state, params: { ...state.params, active: source } }; valid(state);
      const count = constructionObjects(state).length;
      if (count === 14) expect(constructionObjects(splitInteriorMaterial(state, "pieces"))).toHaveLength(16);
      if (count === 15) {
        expect(splitInteriorMaterial(state, "pieces")).toBe(state); expect(splitInteriorMaterial(state, "separate")).toBe(state);
        expect(constructionObjects(splitInteriorMaterial(state, "wings"))).toHaveLength(16);
      }
      if (count === 16) expect(splitInteriorMaterial(state, "wings")).toBe(state);
    }
  });

  it("keeps IDs monotonic and rejects exhaustion atomically", () => {
    const state = prepared();
    const lastThree = { ...state, params: { ...state.params, nextId: 99996 } }; valid(lastThree);
    expect(splitInteriorMaterial(lastThree, "pieces").params.nextId).toBe(99999);
    const lastTwo = { ...state, params: { ...state.params, nextId: 99997 } }; valid(lastTwo);
    expect(splitInteriorMaterial(lastTwo, "pieces")).toBe(lastTwo);
    expect(splitInteriorMaterial(lastTwo, "wings").params.nextId).toBe(99999);
    const lastOne = { ...state, params: { ...state.params, nextId: 99998 } }; valid(lastOne);
    expect(splitInteriorMaterial(lastOne, "wings")).toBe(lastOne);
  });

  it("rejects tiny fragments and an out-of-range separation without losing the original", () => {
    const tiny = setInteriorField(setInteriorField(setInteriorField(setInteriorField(prepared(), "width", 12), "height", 12), "innerBase", 0.05), "innerHeight", 0.95); valid(tiny);
    for (const mode of ["pieces", "separate", "wings"] as const) expect(splitInteriorMaterial(tiny, mode)).toBe(tiny);
    const edge = setInteriorField(prepared(), "centerY", 1640); valid(edge);
    expect(splitInteriorMaterial(edge, "pieces")).not.toBe(edge); expect(splitInteriorMaterial(edge, "separate")).toBe(edge);
    expect(action("relations-separate-common").disabled!(edge, { selected: null })).toBe(true);
  });

  it("exposes all actions through the existing operation and disables them without visible interior material", () => {
    const modes: [string, InteriorSplit][] = [["relations-split-common", "pieces"], ["relations-separate-common", "separate"], ["relations-keep-wings", "wings"]];
    const state = prepared(), hidden = createInteriorState(), quad = applyInteriorBase(state, (base) => addRelationMaterial(base, "quadrilateral"));
    for (const [id, mode] of modes) {
      const entry = action(id); expect(entry).toBeDefined(); expect(entry.label.en).toBeTruthy();
      expect(entry.run(state, { selected: null })).toEqual(splitInteriorMaterial(state, mode));
      expect(entry.disabled!(hidden, { selected: null })).toBe(true); expect(entry.run(hidden, { selected: null })).toBe(hidden);
      expect(entry.disabled!(quad, { selected: null })).toBe(true); expect(entry.run(quad, { selected: null })).toBe(quad);
    }
    expect(action("relations-separate-common").duration).toBeGreaterThan(0);
    expect(action("relations-separate-common").interpolate).toBe(interpolateInteriorSeparation);
  });
});
