import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { constructionObjects, constructionObject } from "../src/features/tools/plane-construction/model";
import { planePerimeterScene } from "../src/features/tools/plane-perimeter/scenes";
import { planePerimeterBoundaryScene as scene } from "../src/features/tools/plane-perimeter-boundary/scenes";
import { boundaryUnion, edgeCopies, isValidPerimeterBoundaryState, perimeterBaseState } from "../src/features/tools/plane-perimeter-boundary/model";

const api: PlanarDrawingApi = { locale: "zh", editable: true, selected: null, operation: null, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false }) };
const draw = (state: PlanarState, options: Partial<PlanarDrawingApi> = {}) => renderToStaticMarkup(createElement("svg", null, scene.draw(state, { ...api, ...options })));
const action = (id: string) => [...(scene.actions ?? []), ...(scene.operations ?? []).flatMap((operation) => operation.actions ?? [])].find((item) => item.id === id)!;
const run = (state: PlanarState, id: string, selected: string | null = null) => action(id).run(state, { selected });

describe("boundary observations and rigid copies through the preserved perimeter descriptor", () => {
  it("starts quiet and keeps every previous construction, invariant and progress operation available", () => {
    const initial = scene.create(); expect(isValidPerimeterBoundaryState(initial)).toBe(true); expect(draw(initial)).not.toContain("data-boundary-kind"); expect(draw(initial)).not.toContain("data-edge-copy=");
    expect(scene.construction!.tools.map((tool) => tool.id)).toEqual(planePerimeterScene.construction!.tools.map((tool) => tool.id));
    for (const operation of planePerimeterScene.operations!) expect(scene.operations!.some((item) => item.id === operation.id)).toBe(true);
    for (const material of planePerimeterScene.materials!) {
      const next = scene.materials!.find((item) => item.id === material.id)!.add(initial);
      expect(perimeterBaseState(next)).toEqual(material.add(perimeterBaseState(initial))); expect(isValidPerimeterBoundaryState(next)).toBe(true); expect(constructionObjects(next)).toHaveLength(2);
    }
    const traced = scene.setField!(scene.setField!(initial, "walk", 53.75), "straight", 72.125);
    expect(traced.params["walk.0"]).toBe(0.5375); expect(traced.params["straight.0"]).toBe(0.72125); expect(draw(traced)).toContain("data-perimeter-copy");
  });
  it("draws observations from teacher-selected real paper without caching geometry or changing materials", () => {
    let state = scene.create(); state = scene.construction!.create(state, "rectangle", [{ x: 410, y: 220 }, { x: 580, y: 320 }])!;
    const original = constructionObjects(state); state = run(state, "union-include-all");
    for (const flag of ["unionBoundary", "unionHoles", "unionSeams", "unionCovered"]) state = scene.setFlag!(state, flag, true);
    state = scene.setFlag!(state, "measures", true);
    const html = draw(state, { operation: "union-boundary" }); expect(html).toContain('data-boundary-kind="outer"'); expect(html).toContain("组合外环"); expect(html).toContain("孔边界");
    expect(boundaryUnion(state).valid).toBe(true); expect(constructionObjects(state)).toEqual(original); expect(Object.keys(state.points).every((key) => !key.startsWith("union"))).toBe(true);
    const cleared = run(state, "union-clear-members"); expect(boundaryUnion(cleared).perimeter).toBe(0); expect(constructionObjects(cleared)).toEqual(original);
  });
  it("adds editable staircase material and exposes direct copy drags, numeric fields, collect and restore", () => {
    const initial = scene.create(), added = scene.materials!.find((material) => material.id === "notched-staircase")!.add(initial), extracted = run(added, "edge-copy-extract");
    expect(constructionObject(added, 0)).toEqual(constructionObject(initial, 0)); expect(constructionObjects(added)).toHaveLength(2);
    const selected = scene.tap!(extracted, "edge-copy.3"), moved = scene.drag!(selected, "edge-copy.3", { x: 400, y: 400 }, { x: 22.25, y: 19.5 });
    expect(scene.selectionAfterChange!(extracted, selected, null)).toBe("edge-copy.3"); expect(constructionObjects(moved)).toEqual(constructionObjects(added));
    const panel = scene.operations!.find((operation) => operation.id === "edge-translate")!;
    expect(panel.fields!.find((field) => field.key === "edgeDx")!.read!(moved)).toBeCloseTo(22.25 / 30, 10);
    expect(scene.contextActions!(moved, "edge-copy.3")!.items.map((item) => item.id)).toEqual(["edge-translate", "edge-copy-restore-one", "edge-copy-clear"]);
    const html = draw(moved, { operation: "edge-translate", selected: "edge-copy.3" }); expect(html.match(/data-rigid-edge=/g)).toHaveLength(constructionObject(added)!.vertices.length); expect(html).toContain("data-edge-copy-handle");
    const collected = run(moved, "edge-copy-collect"), frame = action("edge-copy-collect").interpolate!(moved, collected, 0.43);
    expect(isValidPerimeterBoundaryState(frame)).toBe(true); expect(perimeterBaseState(frame)).toEqual(perimeterBaseState(moved));
    const returned = run(collected, "edge-copy-restore-all"); expect(edgeCopies(returned).every((edge) => edge.offset.x === 0 && edge.offset.y === 0)).toBe(true);
    const cleared = run(returned, "edge-copy-clear"); expect(edgeCopies(cleared)).toEqual([]); expect(constructionObjects(cleared)).toEqual(constructionObjects(added)); expect(scene.selectionAfterChange!(returned, cleared, "edge-copy.3")).toBe(`object.${added.params.active}`);
  });
  it("bridges original exact rigid transforms and shape edits while preserving extension fields", () => {
    const extracted = run(scene.create(), "edge-copy-extract"), moved = scene.drag!(extracted, "edge-copy.0", { x: 0, y: 0 }, { x: 20, y: 30 });
    const input = scene.setField!(scene.setField!(moved, "dx", 36.25), "dy", -12.375), transformed = run(input, "construction-translate");
    for (const progress of [0.25, 0.75, 1]) {
      const frame = action("construction-translate").interpolate!(input, transformed, progress);
      expect(isValidPerimeterBoundaryState(frame)).toBe(true); expect(frame.points["edgeMove.0"]).toEqual(moved.points["edgeMove.0"]);
    }
    const duplicated = run(transformed, "construction-duplicate"); expect(duplicated.params.edgeSource).toBe(0); expect(duplicated.params["unionMember.1"]).toBe(0); expect(duplicated.points["edgeMove.0"]).toEqual(moved.points["edgeMove.0"]);
    const removedOther = run(duplicated, "construction-remove"), removedSource = run(removedOther, "construction-remove");
    expect(isValidPerimeterBoundaryState(removedSource)).toBe(true); expect(removedSource.params.edgeSource).toBe(-1); expect(scene.selectionAfterChange!(removedOther, removedSource, "edge-copy.0")).toBeNull();
  });
  it("retains free nonorthogonal editing without a misleading two-direction action", () => {
    const triangle = scene.construction!.create(scene.create(), "polygon", [{ x: 100, y: 100 }, { x: 250, y: 140 }, { x: 200, y: 300 }])!, copied = run(triangle, "edge-copy-extract");
    expect(action("edge-copy-collect").disabled!(copied, { selected: null })).toBe(true); expect(draw(copied, { editable: false })).not.toContain("data-edge-copy-handle");
    const edited = scene.setField!(copied, "width", 7.125); expect(isValidPerimeterBoundaryState(edited)).toBe(true); expect(constructionObject(edited)!.vertices).not.toEqual(constructionObject(copied)!.vertices);
  });
});
