// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planarStateSchema, type PlanarPoint, type PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import {
  addConstruction, appendConstructionBatch, constructionArea, constructionObject, constructionObjects, constructionShapeKind,
  createConstructionState, duplicateConstruction, insertConstructionVertex, removeConstruction, setConstructionField, transformConstruction, worldVertices,
} from "../src/features/tools/plane-construction/model";
import {
  constructionCorrespondences, constructionMotionOrigin, constructionRepeatParts, dragConstructionMotion, interpolateConstructionRepeat,
  parseConstructionMotionTarget, repeatConstruction, setConstructionRepeatParts, snapConstructionMotion,
} from "../src/features/tools/plane-construction/motion";
import { planeConstructionScenes } from "../src/features/tools/plane-construction/scenes";
import { isValidConstructionState } from "../src/features/tools/plane-construction/validation";
import { reflectedPoint, rotatePoint } from "../src/features/tools/plane-motion/model";
import { planeConstructionMotionCases } from "./fixtures/plane-construction-motion-cases";

const initial = () => createConstructionState("20-create"), close = (actual: PlanarPoint, expected: PlanarPoint) => { expect(actual.x).toBeCloseTo(expected.x, 7); expect(actual.y).toBeCloseTo(expected.y, 7); };
const definition = planeConstructionScenes.find((entry) => entry.id === "20-create")!;
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false }) };
function draw(state: PlanarState, extras: Partial<PlanarDrawingApi> = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.innerHTML = renderToStaticMarkup(definition.draw(state, { ...api, ...extras }));
  expect(svg.innerHTML).not.toMatch(/NaN|Infinity|undefined/); return svg;
}
function turnPosition(state: PlanarState, angle: number) { return rotatePoint({ x: state.points.pivot.x + 100, y: state.points.pivot.y }, state.points.pivot, angle); }
function directTurn(state: PlanarState, angle: number, previous?: PlanarState) {
  const down = turnPosition(state, 0), at = turnPosition(state, angle);
  return dragConstructionMotion(state, `motion-rotate.${state.params.active}`, at, { x: at.x - down.x, y: at.y - down.y }, previous);
}
function directFold(state: PlanarState, amount: number) {
  const object = constructionObject(state)!, angle = state.params.axisAngle * Math.PI / 180, normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const side = (object.center.x - state.points.axis.x) * normal.x + (object.center.y - state.points.axis.y) * normal.y;
  const span = Math.max(48, Math.abs(side) * 2), delta = { x: -Math.sign(side) * span * amount * normal.x, y: -Math.sign(side) * span * amount * normal.y };
  return dragConstructionMotion(state, `motion-reflect.${object.id}`, { x: object.center.x + delta.x, y: object.center.y + delta.y }, delta);
}

describe("atomic repetitions of real v2 materials", () => {
  it.each([2, 3, 4, 7, 12, 16])("creates %i total independently editable parts with exact angular spacing", (parts: number) => {
    const start = setConstructionRepeatParts(initial(), parts), original = constructionObject(start)!, next = repeatConstruction(start);
    expect(constructionObjects(next)).toHaveLength(parts); expect(isValidConstructionState(next)).toBe(true);
    expect(constructionObject(next, original.id)).toEqual(original); expect(next.params.active).toBe(original.id); expect(next.params.nextId).toBe(parts);
    for (const [index, copy] of constructionObjects(next).entries()) {
      close(copy.center, rotatePoint(original.center, start.points.pivot, index * 360 / parts));
      worldVertices(copy).forEach((point, vertex) => close(point, rotatePoint(worldVertices(original)[vertex], start.points.pivot, index * 360 / parts)));
      expect(constructionArea(worldVertices(copy))).toBeCloseTo(constructionArea(worldVertices(original)), 6);
    }
    const changed = setConstructionField({ ...next, params: { ...next.params, active: 1 } }, "centerX", 100.125);
    expect(constructionObject(changed, 0)).toEqual(original); expect(changed.points["center.1"].x).toBe(100.125);
  });
  it("derives parts from the existing signed turn without storing a parts or group cache", () => {
    const start = initial(); expect(constructionRepeatParts(start)).toBe(4);
    expect(constructionRepeatParts(setConstructionField(start, "turn", 100))).toBe(0);
    const next = setConstructionRepeatParts(setConstructionField(start, "turn", -100), 7);
    expect(next.params.turn).toBe(-360 / 7); expect(constructionRepeatParts(next)).toBe(7); expect(next.params.repeatParts).toBeUndefined();
    close(constructionObject(repeatConstruction(next), 1)!.center, rotatePoint(constructionObject(start)!.center, start.points.pivot, -360 / 7));
    for (const value of [0, 1, 17, 2.5, NaN, Infinity]) expect(setConstructionRepeatParts(start, value)).toBe(start);
    expect(repeatConstruction(setConstructionField(start, "turn", 0))).toEqual(setConstructionField(start, "turn", 0));
  });
  it("keeps all originals and marks, and stores copied vertices as independent values", () => {
    const start = { ...duplicateConstruction(initial()), marks: ["vertex.0.0", "edge.1.2"] }, saved = JSON.stringify(start);
    const next = repeatConstruction(setConstructionRepeatParts(start, 3));
    expect(constructionObjects(next)).toHaveLength(4); expect(next.marks).toEqual(start.marks);
    expect(constructionObject(next, 0)).toEqual(constructionObject(start, 0)); expect(constructionObject(next, 1)).toEqual(constructionObject(start, 1));
    next.points["vertex.2.0"].x = 700; expect(JSON.stringify(start)).toBe(saved);
  });
  it("rejects the complete batch when a later copy exceeds a coordinate bound", () => {
    const start = { ...setConstructionField(initial(), "centerX", 1900), points: { ...setConstructionField(initial(), "centerX", 1900).points, pivot: { x: 2000, y: 340 } } };
    expect(isValidConstructionState(start)).toBe(true); expect(repeatConstruction(start, 4)).toBe(start);
    expect(start.params.nextId).toBe(1); expect(constructionObjects(start)).toHaveLength(1);
  });
  it("checks object and vertex capacities before generating any copy", () => {
    const full = repeatConstruction(initial(), 16); expect(repeatConstruction(full, 2)).toBe(full);
    const vertices = Array.from({ length: 32 }, (_, index) => ({ x: 400 + Math.cos(index * Math.PI / 16) * 70, y: 350 + Math.sin(index * Math.PI / 16) * 70 }));
    const polygon = addConstruction(removeConstruction(initial()), "polygon", vertices);
    expect(repeatConstruction(polygon, 7)).toBe(polygon); const accepted = repeatConstruction(polygon, 6);
    expect(constructionObjects(accepted)).toHaveLength(6); expect(isValidConstructionState(accepted)).toBe(true);
    expect(constructionObjects(accepted).reduce((sum, object) => sum + object.vertices.length, 0)).toBe(192);
  });
  it("preserves monotonic IDs and atomically rejects exhausted identities", () => {
    const start = { ...initial(), params: { ...initial().params, nextId: 99998 } };
    expect(repeatConstruction(start, 3)).toBe(start); const last = repeatConstruction(start, 2);
    expect(last.params.nextId).toBe(99999); expect(constructionObject(last, 99998)).not.toBeNull(); expect(isValidConstructionState(last)).toBe(true);
    expect(repeatConstruction(last, 2)).toBe(last);
  });
  it("uses the same atomic helper for arbitrary batches and rejects invalid material", () => {
    const start = initial(), object = constructionObject(start)!;
    expect(appendConstructionBatch(start, [])).toBe(start);
    expect(appendConstructionBatch(start, [object, { ...object, rx: 1 }])).toBe(start);
    expect(constructionObjects(start)).toHaveLength(1);
  });
  it("animates one independent copy at a time along the actual pivot arc", () => {
    const from = initial(), to = repeatConstruction(from, 4), middle = interpolateConstructionRepeat(from, to, 1 / 6);
    expect(constructionObjects(middle)).toHaveLength(2); const source = constructionObject(from)!, moving = constructionObject(middle, 1)!;
    close(moving.center, rotatePoint(source.center, from.points.pivot, 45));
    worldVertices(moving).forEach((point, index) => close(point, rotatePoint(worldVertices(source)[index], from.points.pivot, 45)));
    expect(constructionObject(middle, 0)).toEqual(source); expect(interpolateConstructionRepeat(from, to, 0)).toBe(from); expect(interpolateConstructionRepeat(from, to, 1)).toBe(to);
  });
});

describe("operation-specific direct transformations", () => {
  it("pairs a live translation with its actual frozen origin and saves only the exact displacement", () => {
    const start = initial(), frame = dragConstructionMotion(start, "motion-translate.0", { x: 431.5, y: 302.75 }, { x: 51.5, y: -37.25 });
    expect(constructionMotionOrigin(frame)).toEqual(start); expect(isValidConstructionState(frame)).toBe(false);
    const pairs = constructionCorrespondences(constructionMotionOrigin(frame)!, frame, 0); expect(pairs).toHaveLength(4);
    pairs.forEach((pair) => close(pair.to, { x: pair.from.x + 51.5, y: pair.from.y - 37.25 }));
    const landed = snapConstructionMotion(frame, "motion-translate.0")!; expect(isValidConstructionState(landed)).toBe(true);
    close(landed.points["center.0"], { x: 431.5, y: 302.75 }); expect(landed.params.dx).toBe(start.params.dx);
  });
  it("continuously unwraps multiple turns using the frozen pivot and starting shape", () => {
    const start = initial(); let frame = start;
    for (let angle = 30; angle <= 750; angle += 30) frame = directTurn(start, angle, frame);
    expect(frame.params["frameTurn.0"]).toBeCloseTo(750); expect(isValidConstructionState(frame)).toBe(false);
    const landed = snapConstructionMotion(frame, "motion-rotate.0")!;
    expect(constructionObject(landed)!.angle).toBeCloseTo(750); expect(isValidConstructionState(landed)).toBe(true);
    worldVertices(constructionObject(landed)!).forEach((point, index) => close(point, rotatePoint(worldVertices(constructionObject(start)!)[index], start.points.pivot, 750)));
    expect(constructionMotionOrigin(frame)).toEqual(start); expect(Object.keys(landed.params).some((key) => key.startsWith("frame"))).toBe(false);
  });
  it("supports negative seam crossing and keeps the last legal rigid frame at a boundary", () => {
    const start = initial(); let frame = start;
    for (let angle = -30; angle >= -390; angle -= 30) frame = directTurn(start, angle, frame);
    expect(snapConstructionMotion(frame, "motion-rotate.0")!.params["angle.0"]).toBeCloseTo(-390);
    const near = setConstructionField(initial(), "centerX", 1900), boundary = { ...near, points: { ...near.points, pivot: { x: 2000, y: 340 } } };
    const legal = directTurn(boundary, 90), rejected = directTurn(boundary, 180, legal);
    expect(rejected).toBe(legal); expect(isValidConstructionState(snapConstructionMotion(rejected, "motion-rotate.0")!)).toBe(true);
  });
  it("keeps an undefined angular grab and unknown targets unchanged", () => {
    const start = initial(); expect(dragConstructionMotion(start, "motion-rotate.0", start.points.pivot, { x: 0, y: 0 })).toBe(start);
    for (const target of ["motion-rotate.000", "motion-rotate.99999", "motion-rotate.2", "motion-other.0", "object.0"]) {
      expect(dragConstructionMotion(start, target, { x: 500, y: 500 }, { x: 30, y: 30 })).toBe(start);
    }
    expect(parseConstructionMotionTarget("motion-reflect.0")).toEqual({ kind: "reflect", id: 0 });
    expect(snapConstructionMotion(start, "motion-reflect.0")).toBeNull();
  });
  it.each([0, 37, 90, -145, 180])("previews a fold perpendicular to the %i° axis and lands at the exact mirrored geometry", (angle: number) => {
    const start = setConstructionField(initial(), "axisAngle", angle), frame = directFold(start, 0.5), source = constructionObject(start)!;
    expect(isValidConstructionState(frame)).toBe(false); expect(constructionMotionOrigin(frame)).toEqual(start);
    const u = { x: Math.cos(angle * Math.PI / 180), y: Math.sin(angle * Math.PI / 180) };
    worldVertices(constructionObject(frame)!).forEach((point) => expect((point.x - start.points.axis.x) * -u.y + (point.y - start.points.axis.y) * u.x).toBeCloseTo(0, 7));
    const landed = snapConstructionMotion(frame, "motion-reflect.0")!; expect(isValidConstructionState(landed)).toBe(true);
    worldVertices(constructionObject(landed)!).forEach((point, index) => close(point, reflectedPoint(worldVertices(source)[index], { point: start.points.axis, angle })));
    expect(constructionArea(worldVertices(constructionObject(landed)!))).toBeCloseTo(constructionArea(worldVertices(source)), 6);
  });
  it("releases below the fold midpoint at the original pose, and can unfold an already mirrored shape", () => {
    const start = initial(), early = directFold(start, 0.4); expect(snapConstructionMotion(early, "motion-reflect.0")).toEqual(start);
    const complete = directFold(start, 1), first = snapConstructionMotion(complete, "motion-reflect.0")!;
    expect(constructionMotionOrigin(complete)).toEqual(start); expect(first.params["flip.0"]).toBe(-1);
    const second = snapConstructionMotion(directFold(first, 1), "motion-reflect.0")!;
    expect(second.params["flip.0"]).toBe(1); worldVertices(constructionObject(second)!).forEach((point, index) => close(point, worldVertices(constructionObject(start)!)[index]));
  });
  it("ignores tangential drag and refuses a mirror outside the material domain", () => {
    const start = initial(), frame = dragConstructionMotion(start, "motion-reflect.0", { x: 380, y: 410 }, { x: 0, y: 70 });
    expect(frame.params["frameProgress.0"]).toBeCloseTo(0); expect(snapConstructionMotion(frame, "motion-reflect.0")).toEqual(start);
    const outside = { ...start, points: { ...start.points, axis: { x: 2000, y: 340 } } };
    expect(dragConstructionMotion(outside, "motion-reflect.0", { x: 580, y: 340 }, { x: 200, y: 0 })).toBe(outside);
  });
});

describe("corresponding points derived from unchanged materials", () => {
  it("pairs actual corners and excludes inserted collinear editing points", () => {
    const start = initial(), split = insertConstructionVertex({ ...start, flags: { ...start.flags, edit: true } }, "edge.0.0");
    const to = transformConstruction(split, "translate"), pairs = constructionCorrespondences(split, to, 0);
    expect(constructionObject(split)!.vertices).toHaveLength(5); expect(pairs).toHaveLength(4);
    for (const pair of pairs) close(pair.to, { x: pair.from.x + 180, y: pair.from.y });
    expect(constructionShapeKind(constructionObject(split)!)).toBe("rectangle");
  });
  it("pairs a curve center and material reference points without pretending they are vertices", () => {
    const start = addConstruction(removeConstruction(initial()), "ellipse", [{ x: 220, y: 200 }, { x: 380, y: 290 }]);
    const to = transformConstruction(start, "reflect"), pairs = constructionCorrespondences(start, to, start.params.active);
    expect(pairs.map((pair) => pair.label)).toEqual(["O", "P", "Q"]);
    for (const pair of pairs) close(pair.to, reflectedPoint(pair.from, { point: start.points.axis, angle: start.params.axisAngle }));
    expect(constructionShapeKind(constructionObject(to)!)).toBe("ellipse");
  });
  it("does not guess correspondence after resizing, replacing or removing a material", () => {
    const start = initial(); expect(constructionCorrespondences(start, setConstructionField(start, "width", 123), 0)).toEqual([]);
    expect(constructionCorrespondences(start, removeConstruction(start), 0)).toEqual([]); expect(constructionCorrespondences(start, start, 0)).toEqual([]);
  });
  it("shows correspondence only on explicit observation and derives planned and actual endpoints", () => {
    const start = initial(); expect(draw(start, { operation: "rotate" }).querySelectorAll("[data-construction-correspondence]")).toHaveLength(0);
    const observed = { ...start, flags: { ...start.flags, vertices: true, ghost: true } };
    const planned = draw(observed, { operation: "move" }); expect(planned.querySelectorAll("[data-construction-correspondence]")).toHaveLength(4);
    expect(planned.querySelector('[data-construction-correspondences="planned"]')).not.toBeNull();
    const folded = directFold(observed, 0.5), actual = draw(folded, { operation: "reflect" });
    expect(actual.querySelector('[data-construction-correspondences="actual"]')).not.toBeNull(); expect(actual.querySelectorAll("[data-construction-correspondence]")).toHaveLength(4);
    expect(actual.textContent).toContain("P1′");
  });
  it("binds bodies to the explicit operation and restores normal dragging when the panel is closed", () => {
    const start = initial(); expect(draw(start).querySelector('[data-construction-body="object.0"]')).not.toBeNull();
    expect(draw(start, { operation: "rotate" }).querySelector('[data-construction-body="motion-rotate.0"]')).not.toBeNull();
    expect(draw(start, { operation: "reflect" }).querySelector('[data-construction-body="motion-reflect.0"]')).not.toBeNull();
    expect(draw(start, { operation: null }).querySelectorAll("[data-construction-guide]")).toHaveLength(0);
    const parts = definition.operations!.find((operation) => operation.id === "rotate")!.fields!.find((field) => field.key === "repeatParts")!;
    expect(parts.read!(start)).toBe(4); expect(parts.options!.map((option) => option.value)).toEqual([0, ...Array.from({ length: 15 }, (_, index) => index + 2)]);
    expect(isValidConstructionState(definition.setField!(start, "repeatParts", 7))).toBe(true);
  });
  it("retains the basic-shapes scene's ordinary body behavior and v2 contract", () => {
    const basic = planeConstructionScenes.find((entry) => entry.id === "01-create")!, state = basic.create();
    const markup = renderToStaticMarkup(basic.draw(state, { ...api, operation: "rotate" }));
    expect(markup).toContain('data-construction-body="object.0"'); expect(markup).not.toContain("motion-rotate");
    expect(basic.operations!.flatMap((operation) => operation.actions ?? []).some((action) => action.id === "construction-repeat")).toBe(false);
  });
  it("accepts all accurate fixture endpoints and rejects every transient or invented cache", () => {
    for (const entry of planeConstructionMotionCases()) expect(planarStateSchema.safeParse(entry.scene.payload.initial).success, entry.label).toBe(entry.accepted);
  });
});
