import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parseToolScene } from "@/features/tools/scenes/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { constructionArea, constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { addRelationMaterial, createRelationsState, relationFlag } from "@/features/tools/plane-relations/model";
import { crossAt } from "@/features/tools/plane-relations/geometry";
import { applyInteriorBase, copyInteriorParts, createInteriorState, dragInterior, interiorModel, setInteriorField, tapInterior, toggleInterior } from "@/features/tools/plane-relations/interior-model";
import { isValidInteriorState } from "@/features/tools/plane-relations/interior-validation";
import { planeInteriorScene } from "@/features/tools/plane-relations/interior-scene";
import { isValidRelationsState } from "@/features/tools/plane-relations/validation";
import { planeInteriorCases } from "./fixtures/plane-interior-cases";

const action = (id: string) => [...planeInteriorScene.actions!, ...planeInteriorScene.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
const context = { selected: null };
const valid = (state: ReturnType<typeof createInteriorState>) => expect(isValidInteriorState(state)).toBe(true);
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, operation: null,
  bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };

describe("interior-point material geometry", () => {
  it("uses the exact default fixture in the SQL save/read check", () => {
    const fixture = JSON.parse(readFileSync("supabase/tests/tool_plane_interior.sql", "utf8").split("$fixture$")[1]);
    expect(fixture.payload.initial).toEqual(createInteriorState()); expect(parseToolScene(fixture)).toEqual(fixture);
  });
  it("keeps old v2 strict and starts a separate v3 with no automatic conclusion", () => {
    const state = createInteriorState(); valid(state);
    expect(isValidRelationsState(state)).toBe(false); expect(isValidInteriorState(createRelationsState())).toBe(false);
    expect(state.flags.measures).toBe(false); expect(relationFlag(state, "interior")).toBe(false);
    for (const entry of planeInteriorCases()) {
      if (entry.accepted) expect(() => parseToolScene(entry.scene), entry.label).not.toThrow();
      else expect(() => parseToolScene(entry.scene), entry.label).toThrow();
    }
  });
  it("partitions any oblique or reflected triangle with four positive regions summing to the source", () => {
    for (const flip of [1, -1]) {
      let state = toggleInterior(setInteriorField(createInteriorState(), "angle", 37));
      state = { ...state, params: { ...state.params, [`flip.${state.params.active}`]: flip } };
      state = setInteriorField(setInteriorField(state, "innerBase", 0.23), "innerHeight", 0.61); valid(state);
      const model = interiorModel(state)!;
      expect(model.parts).toHaveLength(4); model.parts.forEach((part) => expect(constructionArea(part)).toBeGreaterThan(0));
      expect(model.parts.reduce((sum, part) => sum + constructionArea(part), 0)).toBeCloseTo(model.area, 7);
      expect(constructionArea(model.common) / model.area).toBeCloseTo(0.61, 10);
    }
  });
  it("uses the same accurate proportions for numeric input and free direct dragging", () => {
    let state = toggleInterior(setInteriorField(createInteriorState(), "angle", 41));
    state = { ...state, flags: { ...state.flags, snap: true } };
    const from = interiorModel(state)!, exact = setInteriorField(setInteriorField(state, "innerBase", 0.31), "innerHeight", 0.72), to = interiorModel(exact)!;
    const moved = dragInterior(state, `interior.${state.params.active}`, to.point, { x: to.point.x - from.point.x, y: to.point.y - from.point.y }); valid(moved);
    expect(interiorModel(moved)!.u).toBeCloseTo(to.u, 10); expect(interiorModel(moved)!.v).toBeCloseTo(to.v, 10);
    expect(moved.flags.snap).toBe(true); expect(constructionObject(moved)).toEqual(constructionObject(state));
    const outside = dragInterior(state, `interior.${state.params.active}`, { x: -5000, y: 10000 }, { x: -6000, y: 10000 }); valid(outside);
    interiorModel(outside)!.parts.forEach((part) => expect(constructionArea(part)).toBeGreaterThan(0));
  });
  it("keeps apex–P–D collinear along the real rotated line and releases it without jumping", () => {
    let state = setInteriorField(setInteriorField(toggleInterior(createInteriorState()), "divisionRatio", 0.3), "innerConstraint", 1);
    state = setInteriorField(state, "angle", -46); state = { ...state, flags: { ...state.flags, snap: true } };
    const model = interiorModel(state)!;
    const constrained = dragInterior(state, `interior.${state.params.active}`, model.point, { x: 80, y: -40 }); valid(constrained);
    const after = interiorModel(constrained)!;
    expect(crossAt(after.c, after.division, after.point)).toBeCloseTo(0, 7);
    expect(constructionArea(after.parts[3]) / constructionArea(after.parts[2])).toBeCloseTo(0.3 / 0.7, 9);
    expect(setInteriorField(constrained, "innerBase", 0.8)).toBe(constrained);
    const released = setInteriorField(constrained, "innerConstraint", 0); expect(interiorModel(released)!.point).toEqual(after.point);
    const free = dragInterior(released, `interior.${state.params.active}`, after.point, { x: 40, y: 30 }); valid(free);
    expect(Math.abs(crossAt(interiorModel(free)!.c, after.division, interiorModel(free)!.point))).toBeGreaterThan(1);
  });
  it("moves D and its constrained P together even when the older division overlay is off", () => {
    const state = setInteriorField(toggleInterior(createInteriorState()), "innerConstraint", 1), before = interiorModel(state)!;
    const moved = dragInterior(state, `division.${state.params.active}`, before.division, { x: (before.b.x - before.a.x) * 0.2, y: (before.b.y - before.a.y) * 0.2 }); valid(moved);
    expect(interiorModel(moved)!.fraction).toBeCloseTo(0.7); expect(interiorModel(moved)!.u).toBeCloseTo(0.7);
    expect(relationFlag(moved, "division")).toBe(false); expect(interiorModel(moved)!.v).toBe(before.v);
    expect(crossAt(interiorModel(moved)!.c, interiorModel(moved)!.division, interiorModel(moved)!.point)).toBeCloseTo(0, 8);
  });
  it("changes the base without moving P, including rotated, mirrored and collinear materials", () => {
    for (const angle of [0, 37]) for (const flip of [1, -1]) for (const constrained of [false, true]) {
      let state = setInteriorField(setInteriorField(setInteriorField(toggleInterior(createInteriorState()), "angle", angle), "innerBase", 0.31), "innerHeight", 0.44);
      state = setInteriorField(state, "divisionRatio", 0.3);
      state = { ...state, params: { ...state.params, [`flip.${state.params.active}`]: flip } };
      if (constrained) state = setInteriorField(state, "innerConstraint", 1);
      const original = interiorModel(state)!, id = state.params.active;
      for (const edge of [1, 2, 0]) {
        state = tapInterior(state, `edge.${id}.${edge}`); valid(state);
        const model = interiorModel(state)!;
        expect(state.params[`base.${id}`]).toBe(edge); expect(model.object).toEqual(original.object);
        expect(model.point.x).toBeCloseTo(original.point.x, 8); expect(model.point.y).toBeCloseTo(original.point.y, 8);
        expect(model.parts.reduce((sum, part) => sum + constructionArea(part), 0)).toBeCloseTo(original.area, 7);
        if (constrained) {
          expect(model.u).toBe(model.fraction); expect(crossAt(model.c, model.division, model.point)).toBeCloseTo(0, 7);
        } else expect(model.fraction).toBe(original.fraction);
      }
    }
  });
  it("keeps the original base and geometry when preserving P would exceed the new base's legal range", () => {
    for (const constrained of [false, true]) {
      let state = setInteriorField(setInteriorField(toggleInterior(createInteriorState()), "innerBase", 0.05), "innerHeight", 0.95);
      if (constrained) state = setInteriorField(setInteriorField(state, "divisionRatio", 0.05), "innerConstraint", 1);
      valid(state);
      expect(tapInterior(state, `edge.${state.params.active}.1`)).toBe(state);
      expect(tapInterior(state, `edge.${state.params.active}.2`)).toBe(state);
    }
  });
  it("copies four exact independent regions atomically, preserving the original and grid setting", () => {
    let state = toggleInterior(setInteriorField(createInteriorState(), "angle", 33));
    state = { ...state, flags: { ...state.flags, snap: true } };
    const model = interiorModel(state)!, copied = copyInteriorParts(state); valid(copied);
    expect(constructionObjects(copied)).toHaveLength(5); expect(constructionObject(copied, model.object.id)).toEqual(model.object); expect(copied.flags.snap).toBe(true);
    constructionObjects(copied).slice(1).forEach((object, index) => {
      expect(constructionArea(object.vertices)).toBeCloseTo(constructionArea(model.parts[index]), 7);
      worldVertices(object).forEach((point, vertex) => { expect(point.x).toBeCloseTo(model.parts[index][vertex].x + 65, 7); expect(point.y).toBeCloseTo(model.parts[index][vertex].y + 65, 7); });
      expect(relationFlag(copied, "interior", object.id)).toBe(false);
    });
    let crowded = state; for (let i = 0; i < 12; i++) crowded = applyInteriorBase(crowded, (base) => addRelationMaterial(base, "triangle"));
    crowded = { ...crowded, params: { ...crowded.params, active: model.object.id } };
    valid(crowded); expect(copyInteriorParts(crowded)).toBe(crowded);
    const exhausted = { ...state, params: { ...state.params, nextId: 99997 } }; valid(exhausted); expect(copyInteriorParts(exhausted)).toBe(exhausted);
  });
  it("keeps metadata owned through duplicate, delete, vertex edits, rigid animation and material addition", () => {
    const start = setInteriorField(toggleInterior(createInteriorState()), "innerBase", 0.27), id = start.params.active;
    let state = action("construction-duplicate").run(start, context); valid(state);
    const copy = state.params.active; expect(state.params[`innerBase.${copy}`]).toBe(0.27);
    state = setInteriorField(state, "innerBase", 0.8); expect(state.params[`innerBase.${id}`]).toBe(0.27);
    state = action("construction-remove").run(state, context); valid(state); expect(state.params[`innerBase.${copy}`]).toBeUndefined();
    const rotate = action("construction-rotate"), end = rotate.run(start, context); valid(end);
    for (const progress of [0.1, 0.5, 0.9]) { const frame = rotate.interpolate!(start, end, progress); valid(frame); expect(interiorModel(frame)!.area).toBeCloseTo(interiorModel(start)!.area, 7); }
    const quad = applyInteriorBase(start, (base) => addRelationMaterial(base, "quadrilateral")); valid(quad); expect(toggleInterior(quad)).toBe(quad);
    const editable = { ...start, flags: { ...start.flags, edit: true } }, vertex = interiorModel(start)!.c;
    valid(dragInterior(editable, `vertex.${id}.2`, vertex, { x: 25, y: -10 }));
  });
  it("selects the touched owner and exposes helpers only in its editable operation", () => {
    let state = toggleInterior(createInteriorState()); const id = state.params.active;
    state = applyInteriorBase(state, (base) => addRelationMaterial(base, "triangle"));
    expect(tapInterior(state, `interior.${id}`).params.active).toBe(id);
    const targets: string[] = [], drawApi = { ...api, selected: `object.${id}`, bind: (target: string) => { targets.push(target); return api.bind(target); } };
    renderToStaticMarkup(planeInteriorScene.draw(state, drawApi)); expect(targets).not.toContain(`interior.${id}`);
    targets.length = 0; const markup = renderToStaticMarkup(planeInteriorScene.draw(state, { ...drawApi, operation: "relations-interior" }));
    expect(targets).toContain(`interior.${id}`); expect(targets).toContain(`division.${id}`); expect(markup.match(/data-interior-part=/g)).toHaveLength(4);
    targets.length = 0; renderToStaticMarkup(planeInteriorScene.draw(state, { ...drawApi, operation: "relations-interior", editable: false })); expect(targets).not.toContain(`interior.${id}`);
    expect(dragInterior(state, `interior.${id}`, { x: NaN, y: 0 }, { x: 0, y: 1 })).toBe(state);
    expect(dragInterior(state, "interior.999", { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(state);
  });
});
