import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarPoint, PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { constructionMatrix, constructionMeasurements, constructionObject, isValidConstructionObject } from "@/features/tools/plane-construction/model";
import { createPerimeterGeometry, createPerimeterState, setPerimeterProgress, squarePerimeterRectangle, type PerimeterInvariant } from "@/features/tools/plane-perimeter/model";
import { dragPerimeterVertex, movePerimeterVertex, parsePerimeterVertexHandle } from "@/features/tools/plane-perimeter/vertex-model";
import { planePerimeterScene as scene } from "@/features/tools/plane-perimeter/scenes";
import { isValidPerimeterState } from "@/features/tools/plane-perimeter/validation";

const concave = [{ x: 100, y: 100 }, { x: 330, y: 130 }, { x: 350, y: 330 }, { x: 215, y: 240 }, { x: 95, y: 300 }];
const convex = [{ x: 140, y: 80 }, { x: 340, y: 150 }, { x: 295, y: 340 }, { x: 120, y: 320 }, { x: 80, y: 180 }];
const create = (points = concave) => createPerimeterGeometry(createPerimeterState(), "polygon", points)!;
const signedArea = (points: PlanarPoint[]) => points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - point.y * next.x; }, 0) / 2;
const amount = (state: PlanarState, name: PerimeterInvariant, id = state.params.active) => constructionMeasurements(constructionObject(state, id)!)[name];
const api: PlanarDrawingApi = { locale: "zh", selected: "object.1", editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false }) };
const plus = (point: PlanarPoint, delta: PlanarPoint) => ({ x: point.x + delta.x, y: point.y + delta.y });
const unchangedOthers = (before: PlanarState, after: PlanarState, index: number, id = before.params.active) => {
  const original = constructionObject(before, id)!, changed = constructionObject(after, id)!;
  original.vertices.forEach((point, ordinal) => { if (ordinal !== index) expect(changed.vertices[ordinal]).toEqual(point); });
  expect(changed.center).toEqual(original.center); expect(changed.angle).toBe(original.angle); expect(changed.flip).toBe(original.flip);
  expect(constructionObject(after, 0)).toEqual(constructionObject(before, 0));
  expect(Object.keys(after.params)).toEqual(Object.keys(before.params)); expect(Object.keys(after.points)).toEqual(Object.keys(before.points));
};

describe("single-vertex fixed-quantity trajectories", () => {
  for (const points of [convex, concave, [...concave].reverse()]) for (const invariant of ["area", "perimeter"] as const) {
    it(`moves only the chosen point on the exact ${invariant} locus for ${points === convex ? "convex" : points === concave ? "concave" : "reversed"} geometry`, () => {
      const state = create(points), original = structuredClone(state), object = constructionObject(state)!;
      for (let index = 0; index < object.vertices.length; index++) {
        const moved = movePerimeterVertex(state, invariant, index, plus(object.vertices[index], { x: 23, y: -17 }));
        expect(moved).not.toBe(state); expect(isValidPerimeterState(moved)).toBe(true);
        expect(amount(moved, invariant)).toBeCloseTo(amount(state, invariant), 7);
        expect(Math.sign(signedArea(constructionObject(moved)!.vertices))).toBe(Math.sign(signedArea(object.vertices)));
        if (invariant === "area") expect(signedArea(constructionObject(moved)!.vertices)).toBeCloseTo(signedArea(object.vertices), 7);
        unchangedOthers(state, moved, index);
      }
      expect(state).toEqual(original);
    });
  }

  it("projects area along the neighbor chord, not horizontal/vertical axes or a rounded measurement", () => {
    const state = create(), object = constructionObject(state)!, index = 3, a = object.vertices[2], b = object.vertices[4], origin = object.vertices[index];
    const moved = movePerimeterVertex(state, "area", index, plus(origin, { x: 47, y: 23 }));
    const point = constructionObject(moved)!.vertices[index], delta = { x: point.x - origin.x, y: point.y - origin.y };
    expect(delta.x * (b.y - a.y) - delta.y * (b.x - a.x)).toBeCloseTo(0, 8);
    expect(amount(moved, "area")).toBeCloseTo(amount(state, "area"), 8);
    expect(amount(moved, "perimeter")).not.toBeCloseTo(amount(state, "perimeter"), 4);
  });

  it("shares drag and local-coordinate endpoints under rotation, reflection and enabled snapping, using the hit ID", () => {
    for (const invariant of ["area", "perimeter"] as const) for (const angle of [0, 37, 149]) for (const flip of [-1, 1]) {
      let state = create(); state = { ...state, params: { ...state.params, "angle.1": angle, "flip.1": flip }, flags: { ...state.flags, snap: true } };
      const object = constructionObject(state)!, [a, b, c, d] = constructionMatrix(object), delta = { x: 27, y: -19 };
      const expected = movePerimeterVertex(state, invariant, 3, plus(object.vertices[3], delta));
      const result = dragPerimeterVertex({ ...state, params: { ...state.params, active: 0 } }, `invariant-vertex.${invariant}.1.3`, { x: a * delta.x + c * delta.y, y: b * delta.x + d * delta.y });
      expect(result.params.active).toBe(1); expect(isValidPerimeterState(result)).toBe(true);
      expect(constructionObject(result)!.vertices[3].x).toBeCloseTo(constructionObject(expected)!.vertices[3].x, 8);
      expect(constructionObject(result)!.vertices[3].y).toBeCloseTo(constructionObject(expected)!.vertices[3].y, 8);
      expect(amount(result, invariant)).toBeCloseTo(amount(state, invariant), 7); unchangedOthers(state, result, 3);
    }
  });

  it("uses the collinear limiting segment and stops at short neighboring edges, preserving edit-point identity", () => {
    const state = create([{ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 340, y: 100 }, { x: 340, y: 260 }, { x: 100, y: 260 }]);
    const original = constructionObject(state)!, point = original.vertices[1];
    for (const invariant of ["area", "perimeter"] as const) {
      const moved = movePerimeterVertex(state, invariant, 1, plus(point, { x: 31, y: 500 }));
      expect(constructionObject(moved)!.vertices[1]).toEqual(plus(point, { x: 31, y: 0 }));
      expect(amount(moved, invariant)).toBeCloseTo(amount(state, invariant), 8); unchangedOthers(state, moved, 1);
      const limited = movePerimeterVertex(state, invariant, 1, plus(point, { x: 1000, y: 0 }));
      expect(isValidPerimeterState(limited)).toBe(true);
      expect(constructionObject(limited)!.vertices[1].x).toBeCloseTo(original.vertices[2].x - 1, 6);
      expect(constructionObject(limited)!.vertices[1].y).toBe(point.y);
    }
  });

  it("stops before arbitrarily narrow self-contact intervals even when both requested endpoints are legal", () => {
    for (const invariant of ["area", "perimeter"] as const) {
      const tipY = (invariant === "area" ? 100 : Math.sqrt(10000 * (1 - 3600 / 20000))) - 1e-7;
      const state = create([{ x: -100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 300 }, { x: 70, y: 300 }, { x: 60, y: tipY }, { x: 50, y: 300 }, { x: -200, y: 300 }, { x: -200, y: 0 }]);
      const object = constructionObject(state)!, origin = object.vertices[1];
      const desired = plus(origin, invariant === "area" ? { x: 120, y: 0 } : { x: 100, y: Math.sqrt(5000) - 100 });
      const legalFarSide = { ...object, vertices: object.vertices.map((point, index) => index === 1 ? desired : point) };
      expect(isValidConstructionObject(legalFarSide)).toBe(true);
      const moved = movePerimeterVertex(state, invariant, 1, desired), reached = constructionObject(moved)!.vertices[1];
      expect(isValidPerimeterState(moved)).toBe(true); expect(reached.x - origin.x).toBeGreaterThan(50);
      expect(reached.x - origin.x).toBeLessThan(60); expect(amount(moved, invariant)).toBeCloseTo(amount(state, invariant), 7);
      const held = movePerimeterVertex(state, invariant, 1, desired, object.id, moved);
      expect(constructionObject(held)!.vertices[1].x).toBeCloseTo(reached.x, 6);
      const reversed = movePerimeterVertex(state, invariant, 1, plus(origin, { x: 15, y: 0 }), object.id, moved);
      expect(constructionObject(reversed)!.vertices[1].x).toBeLessThan(reached.x - 20);
    }
  });

  it("preserves winding at area collapse, limits coordinates and keeps ellipse-center input on the previous point", () => {
    const state = create([{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 100 }]), object = constructionObject(state)!;
    const point = object.vertices[1], a = object.vertices[0], b = object.vertices[2];
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(movePerimeterVertex(state, "perimeter", 1, center)).toBe(state);
    const moved = movePerimeterVertex(state, "perimeter", 1, plus(point, { x: 0, y: -200 }));
    expect(isValidPerimeterState(moved)).toBe(true);
    expect(signedArea(constructionObject(moved)!.vertices) * signedArea(object.vertices)).toBeGreaterThan(0);
    expect(amount(moved, "perimeter")).toBeCloseTo(amount(state, "perimeter"), 7);
    const border = movePerimeterVertex(state, "area", 1, plus(point, { x: 1e8, y: 1e8 }));
    expect(isValidPerimeterState(border)).toBe(true); expect(constructionObject(border)!.vertices[1].x).toBeLessThanOrEqual(800);
    expect(amount(border, "area")).toBeCloseTo(amount(state, "area"), 7);
    const first = movePerimeterVertex(state, "perimeter", 1, plus(point, { x: 20, y: -10 }));
    const held = movePerimeterVertex(state, "perimeter", 1, center, object.id, first);
    expect(constructionObject(held)!.vertices[1].x).toBeCloseTo(constructionObject(first)!.vertices[1].x, 9);
  });

  it("turns a changed rectangle into an ordinary polygon and resets only its boundary progress", () => {
    const first = setPerimeterProgress(setPerimeterProgress(createPerimeterState(), "walk", 0.7), "straight", 0.8);
    let state = createPerimeterGeometry(first, "rectangle", [{ x: 100, y: 100 }, { x: 340, y: 250 }])!;
    state = setPerimeterProgress(setPerimeterProgress(state, "walk", 0.4), "straight", 1);
    state = { ...state, marks: ["edge.0.1", "vertex.1.2"], flags: { ...state.flags, measures: true, edit: true } };
    expect(constructionObject(state)!.kind).toBe(1);
    const result = movePerimeterVertex(state, "area", 2, plus(constructionObject(state)!.vertices[2], { x: 30, y: 0 }));
    expect(constructionObject(result)!.kind).toBe(0); expect(result.marks).toEqual(state.marks); expect(result.flags).toEqual(state.flags);
    expect(result.params["walk.1"]).toBe(0); expect(result.params["straight.1"]).toBe(0);
    expect(result.params["walk.0"]).toBe(0.7); expect(result.params["straight.0"]).toBe(0.8);
    expect(squarePerimeterRectangle(state, "area")).not.toBe(state); expect(squarePerimeterRectangle(result, "area")).toBe(result);
    unchangedOthers(state, result, 2);
  });

  it("keeps repeated previews on the original invariant and safely ignores malformed targets", () => {
    for (const count of [3, 8, 16, 32]) for (const invariant of ["area", "perimeter"] as const) {
      const state = create(Array.from({ length: count }, (_, index) => { const angle = index * 2 * Math.PI / count, radius = index % 2 ? 90 : 140; return { x: 340 + radius * Math.cos(angle), y: 280 + radius * Math.sin(angle) }; }));
      let previous = state;
      for (let step = 0; step < 15; step++) {
        previous = dragPerimeterVertex(state, `invariant-vertex.${invariant}.1.1`, { x: step * 7 - 30, y: Math.sin(step) * 50 }, previous);
        expect(isValidPerimeterState(previous)).toBe(true); expect(amount(previous, invariant)).toBeCloseTo(amount(state, invariant), 6); unchangedOthers(state, previous, 1);
      }
    }
    const state = create();
    for (const target of ["invariant-vertex.area.01.1", "invariant-vertex.area.1.32", "invariant-vertex.foo.1.0", "invariant-vertex.area.99999.0", "invariant-vertex.area.1.-1", "invariant-vertex.area.5.1"]) expect(dragPerimeterVertex(state, target, { x: 30, y: 50 })).toBe(state);
    for (const index of [-1, 99, 0.5, NaN]) expect(movePerimeterVertex(state, "area", index, { x: 30, y: 50 })).toBe(state);
    for (const value of [NaN, Infinity, -Infinity]) expect(dragPerimeterVertex(state, "invariant-vertex.area.1.1", { x: value, y: 0 })).toBe(state);
    expect(movePerimeterVertex(state, "unknown" as PerimeterInvariant, 1, { x: 1, y: 2 })).toBe(state);
    const framed = { ...state, params: { ...state.params, "frameA.1": 1, "frameB.1": 0, "frameC.1": 0, "frameD.1": 1 } };
    expect(dragPerimeterVertex(framed, "invariant-vertex.area.1.1", { x: 30, y: 20 })).toBe(framed);
    expect(parsePerimeterVertexHandle("invariant-vertex.perimeter.99998.31")).toEqual({ invariant: "perimeter", id: 99998, index: 31 });
  });

  it("gates all edit-point handles by the explicit operation, selection and write access", () => {
    const state = { ...create(), flags: { ...create().flags, measures: true, edit: true } };
    for (const invariant of ["area", "perimeter"] as const) {
      const operation = `perimeter-vertex-${invariant}`, draw = (override: Partial<PlanarDrawingApi> = {}) => renderToStaticMarkup(scene.draw(state, { ...api, operation, ...override }));
      expect(scene.operations!.find((entry) => entry.id === operation)?.icon).toBe("editShape");
      expect(draw().match(/data-perimeter-vertex-handle=/g)).toHaveLength(5); expect(draw()).not.toContain("data-construction-edit-handle");
      expect(draw({ selected: `invariant-vertex.${invariant}.1.3` }).match(/data-perimeter-vertex-handle=/g)).toHaveLength(5);
      expect(draw({ selected: null })).not.toContain("data-perimeter-vertex-handle"); expect(draw({ editable: false })).not.toContain("data-perimeter-vertex-handle");
      expect(draw({ operation: null })).not.toContain("data-perimeter-vertex-handle"); expect(draw({ operation: null })).toContain("data-construction-edit-handle");
      expect(draw({ operation: null })).toContain("u²"); expect(draw({ locale: "en" })).toContain("other points stay");
      expect(scene.selectionAfterChange!(state, state, `invariant-vertex.${invariant}.1.3`)).toBe("object.1");
    }
  });

  it("handles 120 continuous previews on a full 32-point material, with optional non-gating timing", () => {
    const state = create(Array.from({ length: 32 }, (_, index) => {
      const angle = index * 2 * Math.PI / 32 + 0.13, radius = 135 + 30 * Math.sin(angle * 3);
      return { x: 420 + radius * Math.cos(angle), y: 290 + radius * Math.sin(angle) };
    }));
    for (const quantity of ["area", "perimeter"] as const) {
      let previous = state;
      const start = performance.now();
      for (let frame = 0; frame < 120; frame++) {
        previous = dragPerimeterVertex(state, `invariant-vertex.${quantity}.1.7`, { x: 75 * Math.sin(frame / 12), y: 65 * Math.cos(frame / 15) }, previous);
        expect(isValidPerimeterState(previous)).toBe(true); expect(amount(previous, quantity)).toBeCloseTo(amount(state, quantity), 7);
      }
      const duration = performance.now() - start;
      if (process.env.PERIMETER_VERTEX_PROFILE === "1") console.info(`32 vertices / ${quantity} / 120 previews (including assertions): ${duration.toFixed(1)} ms`);
    }
  });
});
