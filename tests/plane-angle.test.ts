import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import type { PlanarPoint, PlanarState } from "@/features/tools/planar-kit/contract";
import { constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { alignAngleTriangle, angleComparison, angleTriangle, copyAngleTriangle, dragAngle, interpolateAngleGeometry, parseAngleHandle, scaleAngleTriangle, setAngleLength } from "@/features/tools/plane-relations/angle-model";
import { applyInteriorBase, createInteriorState, dragInterior, setInteriorField, tapInterior, toggleInterior } from "@/features/tools/plane-relations/interior-model";
import { isValidInteriorState } from "@/features/tools/plane-relations/interior-validation";
import { addRelationMaterial, createRelationGeometry, createRelationsState } from "@/features/tools/plane-relations/model";
import { crossAt } from "@/features/tools/plane-relations/geometry";
import { planeInteriorScene } from "@/features/tools/plane-relations/interior-scene";

const valid = (state: PlanarState) => expect(isValidInteriorState(state)).toBe(true);
const pointNear = (a: PlanarPoint, b: PlanarPoint) => { expect(a.x).toBeCloseTo(b.x, 7); expect(a.y).toBeCloseTo(b.y, 7); };
const select = (state: PlanarState, id: number) => ({ ...state, params: { ...state.params, active: id } });
const action = (id: string) => planeInteriorScene.operations!.flatMap((operation) => operation.actions ?? []).find((entry) => entry.id === id)!;
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, operation: null,
  bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };

describe("common-angle and similar independent materials", () => {
  it("copies the actual triangle along the same or opposite rays, preserving the source and snap setting", () => {
    for (const opposite of [false, true]) for (const flip of [1, -1]) for (const edge of [0, 1, 2]) {
      let state = setInteriorField(createInteriorState(), "angle", 37);
      const id = state.params.active;
      state = { ...state, params: { ...state.params, [`base.${id}`]: edge, [`flip.${id}`]: flip }, flags: { ...state.flags, snap: true } };
      const original = angleTriangle(state)!, next = copyAngleTriangle(state, opposite), result = angleTriangle(next)!;
      valid(next); expect(constructionObjects(next)).toHaveLength(2);
      expect(constructionObject(next, id)).toEqual(original.object); expect(next.flags.snap).toBe(true);
      pointNear(result.origin, original.origin); expect(result.area / original.area).toBeCloseTo(0.36, 10);
      const scale = opposite ? -0.6 : 0.6;
      for (const side of ["a", "b"] as const) pointNear(result[side], { x: original.origin.x + scale * (original[side].x - original.origin.x), y: original.origin.y + scale * (original[side].y - original.origin.y) });
      const comparison = angleComparison(next)!;
      expect(comparison.reference.id).toBe(id); expect(comparison.aRatio).toBeCloseTo(0.6, 10);
      expect(comparison.bRatio).toBeCloseTo(0.6, 10); expect(comparison.opposite).toBe(opposite); expect(comparison.parallel).toBe(true);
    }
  });

  it("supports a hand-drawn scalene triangle and preserves its chosen apex while changing lengths independently", () => {
    let state = applyInteriorBase(createInteriorState(), (base) => createRelationGeometry(base, "polygon", [{ x: 73.2, y: 536.9 }, { x: 675.8, y: 491.3 }, { x: 435.6, y: 128.7 }])!);
    state = copyAngleTriangle(state); const before = angleTriangle(state)!;
    const next = setAngleLength(setAngleLength(state, "independent", "a", before.aLength * 1.2), "independent", "b", before.bLength * 0.7);
    valid(next); const after = angleTriangle(next)!, comparison = angleComparison(next)!;
    pointNear(after.origin, before.origin); expect(after.degrees).toBeCloseTo(before.degrees, 10);
    expect(after.area / before.area).toBeCloseTo(1.2 * 0.7, 10);
    expect(comparison.areaRatio).toBeCloseTo(comparison.aRatio * comparison.bRatio, 10);
    expect(comparison.parallel).toBe(false);
    expect(after.object.center).toEqual(before.object.center); expect(after.object.angle).toBe(before.object.angle);
  });

  it("projects total drag along the true rotated and mirrored ray, ignoring the perpendicular component and grid", () => {
    for (const flip of [1, -1]) for (const side of ["a", "b"] as const) {
      let state = setInteriorField(createInteriorState(), "angle", -54);
      const id = state.params.active;
      state = { ...state, params: { ...state.params, [`flip.${id}`]: flip }, flags: { ...state.flags, snap: true } };
      const before = angleTriangle(state)!, length = side === "a" ? before.aLength : before.bLength;
      const unit = { x: (before[side].x - before.origin.x) / length, y: (before[side].y - before.origin.y) / length };
      const delta = { x: unit.x * 43.7 - unit.y * 29, y: unit.y * 43.7 + unit.x * 29 };
      const next = dragAngle(state, `angle.independent.${side}.${id}`, before[side], delta), after = angleTriangle(next)!;
      valid(next); pointNear(after.origin, before.origin);
      expect(side === "a" ? after.aLength : after.bLength).toBeCloseTo(length + 43.7, 8);
      pointNear(after[side === "a" ? "b" : "a"], before[side === "a" ? "b" : "a"]);
      expect(after.degrees).toBeCloseTo(before.degrees, 10); expect(next.flags.snap).toBe(true);
      expect(planeInteriorScene.snap?.(next, `angle.independent.${side}.${id}`) ?? null).toBeNull();
    }
  });

  it("scales both rays about O by the same factor for either numeric field or handle", () => {
    const state = copyAngleTriangle(createInteriorState(), true), before = angleTriangle(state)!;
    for (const side of ["a", "b"] as const) {
      const length = side === "a" ? before.aLength : before.bLength;
      const numeric = planeInteriorScene.setField!(state, `similar-${side}`, length * 1.35);
      const pointer = dragAngle(state, `angle.similar.${side}.${before.object.id}`, before[side], { x: (before[side].x - before.origin.x) * 0.35, y: (before[side].y - before.origin.y) * 0.35 });
      for (const next of [numeric, pointer]) {
        valid(next); const after = angleTriangle(next)!;
        pointNear(after.origin, before.origin); expect(after.aLength / before.aLength).toBeCloseTo(1.35, 10);
        expect(after.bLength / before.bLength).toBeCloseTo(1.35, 10); expect(after.area / before.area).toBeCloseTo(1.35 ** 2, 10);
        expect(crossAt({ x: 0, y: 0 }, { x: before.b.x - before.a.x, y: before.b.y - before.a.y }, { x: after.b.x - after.a.x, y: after.b.y - after.a.y })).toBeCloseTo(0, 7);
      }
    }
  });

  it("aligns unequal common-angle sides with the actual reference, keeping OA and all other objects", () => {
    for (const opposite of [false, true]) {
      const state = copyAngleTriangle(createInteriorState(), opposite), model = angleTriangle(state)!;
      const unequal = setAngleLength(state, "independent", "b", model.bLength * 0.64), reference = angleComparison(unequal)!.reference;
      const next = alignAngleTriangle(unequal); valid(next);
      expect(angleTriangle(next)!.aLength).toBeCloseTo(model.aLength, 10);
      expect(angleComparison(next)!.parallel).toBe(true); expect(constructionObject(next, reference.id)).toEqual(reference);
      expect(alignAngleTriangle(next)).toBe(next);
    }
  });

  it("finds correspondences regardless of vertex order or the reference's selected base", () => {
    let state = copyAngleTriangle(createInteriorState()); const reference = angleComparison(state)!.reference;
    const original = worldVertices(reference);
    state = { ...state, params: { ...state.params, [`base.${reference.id}`]: 1 }, points: { ...state.points,
      [`vertex.${reference.id}.0`]: reference.vertices[1], [`vertex.${reference.id}.1`]: reference.vertices[0],
    } };
    valid(state); const comparison = angleComparison(state)!;
    expect(comparison.reference.id).toBe(reference.id); pointNear(comparison.a, original[0]); pointNear(comparison.b, original[1]);
    expect(comparison.aRatio).toBeCloseTo(0.6, 10); expect(comparison.parallel).toBe(true);
  });

  it("compares the largest eligible real material and ceases comparison after it is moved away", () => {
    let state = copyAngleTriangle(createInteriorState()); const original = angleComparison(state)!.reference.id;
    state = copyAngleTriangle(state); expect(angleComparison(state)!.reference.id).toBe(original);
    const active = state.params.active, intermediate = constructionObjects(state).find((object) => ![original, active].includes(object.id))!.id;
    state = dragInterior(state, `object.${original}`, { x: 0, y: 0 }, { x: 17, y: 11 }); state = select(state, active);
    expect(angleComparison(state)!.reference.id).toBe(intermediate);
    state = dragInterior(state, `object.${intermediate}`, { x: 0, y: 0 }, { x: 19, y: 12 }); state = select(state, active);
    expect(angleComparison(state)).toBeNull(); expect(alignAngleTriangle(state)).toBe(state);
  });

  it("does not claim a common angle when only one ray is reversed or the reference origin is separate", () => {
    const state = copyAngleTriangle(createInteriorState()), model = angleTriangle(state)!;
    const origin = model.object.vertices[model.originIndex], a = model.object.vertices[model.aIndex];
    const oneReversed = { ...state, points: { ...state.points, [`vertex.${model.object.id}.${model.aIndex}`]: { x: 2 * origin.x - a.x, y: 2 * origin.y - a.y } } };
    valid(oneReversed); expect(angleComparison(oneReversed)).toBeNull();
    const moved = dragInterior(state, `object.${model.object.id}`, model.origin, { x: 1, y: 0 });
    expect(angleComparison(moved)).toBeNull();
  });

  it("keeps handle ownership, existing interior metadata and unrelated marks", () => {
    const first = toggleInterior(createInteriorState()), id = first.params.active;
    let state = copyAngleTriangle(first); const other = state.params.active;
    state = { ...state, marks: [`edge.${id}.0`, `vertex.${other}.1`] };
    const before = angleTriangle(state, id)!, untouched = constructionObject(state, other);
    const next = dragAngle(state, `angle.independent.a.${id}`, before.a, { x: (before.a.x - before.origin.x) * 0.1, y: (before.a.y - before.origin.y) * 0.1 });
    valid(next); expect(next.params.active).toBe(id); expect(constructionObject(next, other)).toEqual(untouched);
    expect(next.params[`innerBase.${id}`]).toBe(state.params[`innerBase.${id}`]); expect(next.flags).toEqual(state.flags); expect(next.marks).toEqual(state.marks);
    expect(planeInteriorScene.tap!(state, `angle.similar.b.${id}`).params.active).toBe(id);
    expect(planeInteriorScene.contextActions!(next, `angle.independent.a.${id}`)!.items).toHaveLength(5);
  });

  it("honours equal-height locks, rejects non-triangles and invalid endpoints without a partial write", () => {
    const state = createInteriorState(), id = state.params.active;
    const legacy = createRelationsState(); expect(angleTriangle(legacy)).toBeNull(); expect(copyAngleTriangle(legacy)).toBe(legacy);
    const locked = setInteriorField(state, "heightLock", 1);
    expect(scaleAngleTriangle(locked, 2)).toBe(locked); expect(setAngleLength(locked, "independent", "b", 250)).toBe(locked);
    const quad = applyInteriorBase(state, (base) => addRelationMaterial(base, "quadrilateral"));
    expect(angleTriangle(quad)).toBeNull(); expect(copyAngleTriangle(quad)).toBe(quad);
    for (const value of [0, -1, NaN, Infinity, 1601]) expect(setAngleLength(state, "independent", "a", value)).toBe(state);
    for (const value of [0, -1, NaN, Infinity, 1e-8, 1000]) expect(scaleAngleTriangle(state, value)).toBe(state);
    expect(dragAngle(state, `angle.independent.a.${id}`, { x: 0, y: 0 }, { x: NaN, y: 1 })).toBe(state);
    expect(dragAngle(state, "angle.similar.a.99998", { x: 0, y: 0 }, { x: 12, y: 12 })).toBe(state);
    for (const target of ["angle.similar.a.99999", "angle.invalid.a.1", "angle.similar.c.1", "angle.similar.a.01"]) expect(parseAngleHandle(target)).toBeNull();
  });

  it("keeps the original state when capacity, IDs, minimal geometry or coordinates prevent a complete copy", () => {
    let state = createInteriorState(); const id = state.params.active;
    for (let index = 1; index < 16; index++) state = copyAngleTriangle(select(state, id));
    expect(constructionObjects(state)).toHaveLength(16); expect(copyAngleTriangle(state)).toBe(state);
    const exhausted = { ...createInteriorState(), params: { ...createInteriorState().params, nextId: 99999 } };
    expect(copyAngleTriangle(exhausted)).toBe(exhausted);
    let small = createInteriorState();
    for (let index = 0; index < 8; index++) small = scaleAngleTriangle(small, 0.5);
    small = scaleAngleTriangle(small, 0.75);
    expect(copyAngleTriangle(small)).toBe(small);
    const outside = createInteriorState(), object = constructionObject(outside)!;
    const boundary = { ...outside, points: { ...outside.points, [`center.${object.id}`]: { x: object.center.x, y: -1000 } } };
    valid(boundary); expect(copyAngleTriangle(boundary, true)).toBe(boundary);
  });

  it("keeps every animation frame legal, with the exact fixed apex and quadratic area for scaling", () => {
    const initial = copyAngleTriangle(toggleInterior(createInteriorState())), before = angleTriangle(initial)!;
    for (const scale of [0.5, 2]) {
      const endpoint = scaleAngleTriangle(initial, scale);
      for (const progress of [0.01, 0.17, 0.5, 0.88, 0.99]) {
        const frame = interpolateAngleGeometry(initial, endpoint, progress), model = angleTriangle(frame)!;
        valid(frame); pointNear(model.origin, before.origin); expect(model.area / before.area).toBeCloseTo((1 + (scale - 1) * progress) ** 2, 8);
        expect(model.degrees).toBeCloseTo(before.degrees, 8);
      }
      expect(interpolateAngleGeometry(initial, endpoint, 0)).toBe(initial); expect(interpolateAngleGeometry(initial, endpoint, 1)).toBe(endpoint);
    }
    const unequal = setAngleLength(initial, "independent", "b", before.bLength * 0.4), aligned = alignAngleTriangle(unequal);
    for (const progress of [0.1, 0.5, 0.9]) { const frame = interpolateAngleGeometry(unequal, aligned, progress); valid(frame); expect(angleTriangle(frame)!.aLength).toBeCloseTo(before.aLength, 8); }
  });

  it("shows actual comparisons on demand; handles are operation-local, selected, and editable", () => {
    const initial = copyAngleTriangle(createInteriorState()), id = initial.params.active;
    const unequal = setAngleLength(initial, "independent", "b", angleTriangle(initial)!.bLength * 0.7);
    const selectedApi = { ...api, selected: `object.${id}`, operation: "relations-common-angle" };
    const defaultMarkup = renderToStaticMarkup(planeInteriorScene.draw(initial, api));
    expect(defaultMarkup).not.toContain("data-angle-measures"); expect(defaultMarkup).not.toContain("data-angle-handle");
    const editing = renderToStaticMarkup(planeInteriorScene.draw(unequal, selectedApi));
    expect(editing).toContain('data-angle-handle="a"'); expect(editing).not.toContain("data-angle-measures");
    for (const changed of [{ ...selectedApi, operation: null }, { ...selectedApi, selected: null }, { ...selectedApi, editable: false }]) {
      expect(renderToStaticMarkup(planeInteriorScene.draw(initial, changed))).not.toContain("data-angle-handle");
    }
    const measured = { ...unequal, flags: { ...unequal.flags, measures: true } };
    const markup = renderToStaticMarkup(planeInteriorScene.draw(measured, { ...api, editable: false }));
    expect(markup).toContain("两射线的比例不同，底边不平行"); expect(markup).not.toContain(" = k²");
    expect(renderToStaticMarkup(planeInteriorScene.draw(measured, { ...api, locale: "en", editable: false }))).toContain("Different ray ratios: bases are not parallel");
    const similar = alignAngleTriangle(measured);
    expect(renderToStaticMarkup(planeInteriorScene.draw(similar, { ...api, editable: false }))).toContain(" = k²");
    expect(action("relations-align-similar").disabled!(similar, { selected: null })).toBe(true);
  });

  it("uses the existing base selection to change O, with no new persisted keys", () => {
    const state = createInteriorState(), id = state.params.active;
    const next = tapInterior(state, `edge.${id}.1`), model = angleTriangle(next)!;
    pointNear(model.origin, worldVertices(constructionObject(state)!)[0]);
    const scaled = scaleAngleTriangle(next, 0.5);
    expect(Object.keys(scaled.params)).toEqual(Object.keys(state.params)); expect(Object.keys(scaled.flags)).toEqual(Object.keys(state.flags)); expect(Object.keys(scaled.points)).toEqual(Object.keys(state.points));
    valid(scaled);
  });

  it("states non-parallel ray correspondence without falsely denying similarity with swapped sides", () => {
    const source = createInteriorState(), original = angleTriangle(source)!;
    const copied = copyAngleTriangle(source);
    const swapped = setAngleLength(setAngleLength(copied, "independent", "a", original.bLength * 0.6), "independent", "b", original.aLength * 0.6);
    const result = angleTriangle(swapped)!;
    expect(result.aLength / original.bLength).toBeCloseTo(result.bLength / original.aLength, 8);
    expect(angleComparison(swapped)!.parallel).toBe(false);
    const markup = renderToStaticMarkup(planeInteriorScene.draw({ ...swapped, flags: { ...swapped.flags, measures: true } }, api));
    expect(markup).toContain("底边不平行"); expect(markup).not.toContain("不相似"); expect(markup).not.toContain(" = k²");
  });
});
