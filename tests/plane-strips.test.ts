import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseToolScene } from "@/features/tools/scenes/contract";
import { constructionArea, constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { addRelationMaterial, relationFlag } from "@/features/tools/plane-relations/model";
import { applyInteriorBase, interiorModel, toggleInterior } from "@/features/tools/plane-relations/interior-model";
import { angleTriangle } from "@/features/tools/plane-relations/angle-model";
import { convexRegions } from "@/features/tools/plane-relations/geometry";
import { applyStripsBase, copySquareStrips, createStripsState, refineStrips, setStripCount, squareStripModel, toggleStrips } from "@/features/tools/plane-relations/strips-model";
import { isValidStripsState, stripsBaseState } from "@/features/tools/plane-relations/strips-validation";
import { planeStripsScene, SquareStripsOverlay } from "@/features/tools/plane-relations/strips-scene";
import { planeStripsCases } from "./fixtures/plane-strips-cases";

const prepared = () => toggleStrips(setStripCount(createStripsState(), 8));
const valid = (state: ReturnType<typeof prepared>) => expect(isValidStripsState(state)).toBe(true);
const actions = [...planeStripsScene.actions ?? [], ...planeStripsScene.operations!.flatMap((operation) => operation.actions ?? [])];
const run = (id: string, state: ReturnType<typeof prepared>) => actions.find((action) => action.id === id)!.run(state, { selected: `object.${state.params.active}` });
const field = (state: ReturnType<typeof prepared>, key: string, value: number) => planeStripsScene.setField!(state, key, value);
const append = (state: ReturnType<typeof prepared>) => applyStripsBase(state, (base) => applyInteriorBase(base, (relation) => addRelationMaterial(relation, "triangle")));

describe("square strips on actual open triangle materials", () => {
  it("constructs genuine squares for every base, rotation and reflection", () => {
    for (const angle of [0, 37, -131]) for (const flip of [1, -1]) for (const edge of [0, 1, 2]) {
      const seed = field(prepared(), "angle", angle), id = seed.params.active;
      const state = { ...seed, params: { ...seed.params, [`flip.${id}`]: flip, [`base.${id}`]: edge } }; valid(state);
      const model = squareStripModel(state)!; expect(model.strips.length).toBeGreaterThan(0);
      for (const strip of model.strips) {
        const [a, b, c, d] = strip.points, width = { x: b.x - a.x, y: b.y - a.y }, height = { x: d.x - a.x, y: d.y - a.y };
        expect(Math.hypot(width.x, width.y) / strip.count).toBeCloseTo(model.size, 8);
        expect(Math.hypot(height.x, height.y)).toBeCloseTo(model.size, 8);
        expect(width.x * height.x + width.y * height.y).toBeCloseTo(0, 7);
        expect(c.x).toBeCloseTo(b.x + height.x, 8); expect(c.y).toBeCloseTo(b.y + height.y, 8);
        expect(constructionArea(strip.points)).toBeCloseTo(strip.area, 7);
      }
      expect(model.approximateArea).toBeCloseTo(model.squareCount * model.size ** 2, 7);
    }
  });

  it("preserves every strip count and area under actual oblique equal-height apex motion", () => {
    for (const angle of [0, 53, -97]) for (const flip of [1, -1]) {
      let state = field(field(prepared(), "angle", angle), "heightLock", 1);
      const id = state.params.active;
      state = { ...state, params: { ...state.params, [`flip.${id}`]: flip }, flags: { ...state.flags, edit: true, snap: true } };
      const before = squareStripModel(state)!, shift = 73;
      const next = planeStripsScene.drag!(state, `vertex.${id}.2`, before.c, { x: before.u.x * shift, y: before.u.y * shift }); valid(next);
      const after = squareStripModel(next)!; expect(next).not.toBe(state);
      expect(after.area).toBeCloseTo(before.area, 7); expect(after.size).toBeCloseTo(before.size, 8);
      expect(after.strips.map((strip) => strip.count)).toEqual(before.strips.map((strip) => strip.count));
      expect(after.approximateArea).toBeCloseTo(before.approximateArea, 7);
      after.strips.forEach((strip, i) => strip.points.forEach((point, j) => {
        const fraction = (strip.row + 0.5) * before.size / before.height;
        expect(point.x - before.strips[i].points[j].x).toBeCloseTo(before.u.x * shift * fraction, 7);
        expect(point.y - before.strips[i].points[j].y).toBeCloseTo(before.u.y * shift * fraction, 7);
      }));
      expect(next.flags.snap).toBe(true);
    }
  });

  it("changes the approximation when the height is freely edited and improves this triangle with refinement", () => {
    const seed = prepared(), state = { ...seed, flags: { ...seed.flags, edit: true } }, before = squareStripModel(state)!;
    const free = planeStripsScene.drag!(state, `vertex.${state.params.active}.2`, before.c, { x: 0, y: -80 }); valid(free);
    expect(squareStripModel(free)!.area).not.toBe(before.area);
    let next = setStripCount(state, 4), error = Infinity;
    for (const count of [4, 8, 16, 32, 48]) {
      expect(squareStripModel(next)!.divisions).toBe(count);
      const model = squareStripModel(next)!;
      expect(model.area - model.approximateArea).toBeLessThanOrEqual(error + 1e-7);
      error = model.area - model.approximateArea;
      next = refineStrips(next); valid(next);
    }
    expect(refineStrips(next)).toBe(next);
    expect(error / before.area).toBeLessThan(0.03);
  });

  it("does not mislabel a shear-shifted approximation as a fully interior cover", () => {
    const state = prepared(), before = squareStripModel(state)!;
    const skewed = planeStripsScene.drag!(field(state, "heightLock", 1), `vertex.${state.params.active}.2`, before.c, { x: 380, y: 0 });
    const model = squareStripModel(skewed)!;
    expect(model.strips.some((strip) => constructionArea(convexRegions(strip.points, model.points).intersection) < strip.area - 1)).toBe(true);
    const api = { locale: "en", selected: `object.${state.params.active}`, editable: true, operation: "relations-strips", bind: () => ({ role: "button" as const, tabIndex: 0, "aria-label": "", "aria-pressed": false, "aria-disabled": false }) };
    const markup = renderToStaticMarkup(createElement(SquareStripsOverlay, { state: skewed, api }));
    expect(markup).toContain("not an exact dissection or an inner cover");
    expect(markup).toContain("pointer-events=\"none\""); expect(markup).not.toContain('role="button"');
    expect(markup).not.toContain("S△");
  });

  it("copies exactly the approximate strip area into independent rectangles and preserves the source", () => {
    const original = prepared(), id = original.params.active;
    const state = { ...original, flags: { ...original.flags, snap: true }, marks: [`edge.${id}.0`] }, saved = JSON.stringify(state);
    const model = squareStripModel(state)!, next = copySquareStrips(state); valid(next);
    const copies = constructionObjects(next).filter((object) => object.id !== id);
    expect(copies).toHaveLength(model.strips.length); expect(next.params.active).toBe(state.params.nextId);
    expect(constructionObject(next, id)).toEqual(constructionObject(state, id)); expect(squareStripModel(next, id)).toEqual(model);
    expect(next.marks).toEqual(state.marks); expect(next.flags.snap).toBe(true); expect(JSON.stringify(state)).toBe(saved);
    copies.forEach((copy, i) => {
      expect(copy.vertices).toHaveLength(4); expect(relationFlag(next, "strips", copy.id)).toBe(false);
      expect(constructionArea(copy.vertices)).toBeCloseTo(model.strips[i].area, 7);
      worldVertices(copy).forEach((point, j) => {
        expect(point.x).toBeCloseTo(model.strips[i].points[j].x - model.v.x * (model.height + 36), 7);
        expect(point.y).toBeCloseTo(model.strips[i].points[j].y - model.v.y * (model.height + 36), 7);
      });
    });
    expect(copies.reduce((sum, copy) => sum + constructionArea(copy.vertices), 0)).toBeCloseTo(model.approximateArea, 7);
    const moved = planeStripsScene.drag!(next, `object.${next.params.active}`, { x: 0, y: 0 }, { x: 31, y: -29 }); valid(moved);
    copies.slice(1).forEach((copy) => expect(constructionObject(moved, copy.id)).toEqual(copy));
  });

  it("keeps metadata with duplicated and deleted materials, and leaves newly added shapes independent", () => {
    const state = prepared(), duplicate = run("construction-duplicate", state); valid(duplicate);
    expect(duplicate.params[`stripCount.${duplicate.params.active}`]).toBe(8); expect(relationFlag(duplicate, "strips")).toBe(true);
    const id = duplicate.params.active, removed = run("construction-remove", duplicate); valid(removed);
    expect(removed.params[`stripCount.${id}`]).toBeUndefined(); expect(removed.flags[`strips.${id}`]).toBeUndefined();
    const added = planeStripsScene.materials!.find((material) => material.id === "relations-triangle")!.add(removed); valid(added);
    expect(added.params[`stripCount.${added.params.active}`]).toBe(16); expect(relationFlag(added, "strips")).toBe(false);
    const edited = setStripCount(added, 48); expect(edited.params[`stripCount.${state.params.active}`]).toBe(8);
  });

  it("retains strips through all inherited v3 operations and through valid motion frames", () => {
    const plain = prepared(), interior = applyStripsBase(plain, toggleInterior);
    for (const command of ["relations-midpoint", "relations-midpoints", "relations-nest-midpoints", "relations-copy-nested-angle", "relations-copy-hourglass", "relations-split-common", "relations-separate-common", "relations-keep-wings", "construction-rotate", "construction-translate", "relations-scale-half"]) {
      const action = actions.find((entry) => entry.id === command)!, source = command.includes("common") || command.includes("wings") ? interior : plain;
      const result = action.run(source, { selected: `object.${source.params.active}` }); valid(result); expect(result).not.toEqual(source);
      if (constructionObject(result, source.params.active)) {
        expect(result.params[`stripCount.${source.params.active}`]).toBe(8); expect(relationFlag(result, "strips", source.params.active)).toBe(true);
      } else expect(result.params[`stripCount.${source.params.active}`]).toBeUndefined();
      if (action.interpolate) for (const progress of [0, 0.2, 0.5, 1]) valid(action.interpolate(source, result, progress));
    }
    expect(interiorModel(stripsBaseState(field(interior, "innerHeight", 0.73)))!.v).toBe(0.73);
    const angle = angleTriangle(stripsBaseState(plain))!;
    expect(angleTriangle(stripsBaseState(field(plain, "angle-a", angle.aLength * 0.8)))!.aLength).toBeCloseTo(angle.aLength * 0.8, 7);
    const locked = field(plain, "heightLock", 1), aField = planeStripsScene.operations!.find((operation) => operation.id === "relations-common-angle")!.fields![0];
    expect(aField.disabled!(locked)).toBe(true); expect(field(locked, "angle-a", 20)).toBe(locked);
  });

  it("rejects capacity, ID, tiny geometry and coordinate limits as a whole group", () => {
    const state = prepared(), rows = squareStripModel(state)!.strips.length, source = state.params.active;
    let full = state;
    while (constructionObjects(full).length < 16 - rows) full = append(full);
    full = { ...full, params: { ...full.params, active: source } };
    expect(constructionObjects(copySquareStrips(full))).toHaveLength(16);
    full = append(full); full = { ...full, params: { ...full.params, active: source } };
    expect(copySquareStrips(full)).toBe(full);
    const exhausted = { ...state, params: { ...state.params, nextId: 99999 - rows + 1 } }; valid(exhausted); expect(copySquareStrips(exhausted)).toBe(exhausted);
    const last = { ...state, params: { ...state.params, nextId: 99999 - rows } }; valid(last); expect(copySquareStrips(last).params.nextId).toBe(99999);
    const tiny = field(field(setStripCount(state, 48), "width", 12), "height", 12); valid(tiny); expect(copySquareStrips(tiny)).toBe(tiny);
    const edge = field(state, "centerY", 1640); valid(edge); expect(copySquareStrips(edge)).toBe(edge);
  });

  it("handles no strips, non-triangles and malformed density without changing the original", () => {
    const hidden = createStripsState(); expect(copySquareStrips(hidden)).toBe(hidden);
    const slender = field(setStripCount(prepared(), 4), "height", 12); valid(slender);
    expect(squareStripModel(slender)!.strips).toHaveLength(0); expect(copySquareStrips(slender)).toBe(slender);
    const quad = planeStripsScene.materials!.find((material) => material.id === "relations-quadrilateral")!.add(hidden); valid(quad);
    for (const state of [quad, { ...quad, params: { ...quad.params, active: -1 } }]) {
      expect(squareStripModel(state)).toBeNull(); expect(toggleStrips(state)).toBe(state); expect(refineStrips(state)).toBe(state); expect(copySquareStrips(state)).toBe(state);
    }
    for (const value of [NaN, Infinity, -1, 3, 4.5, 49]) expect(setStripCount(hidden, value)).toBe(hidden);
  });

  it.each(planeStripsCases())("strict v4 fixture: $label", ({ scene, accepted }: ReturnType<typeof planeStripsCases>[number]) => {
    expect(isValidStripsState(scene.payload.initial)).toBe(accepted || scene.contentVersion !== "plane-area-relations-lesson-v4");
    if (accepted) expect(() => parseToolScene(scene)).not.toThrow();
    else expect(() => parseToolScene(scene)).toThrow();
  });
});
