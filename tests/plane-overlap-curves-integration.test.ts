import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlanarSnapshot, PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planarCommit, planarFrame, planarHistory, planarPause } from "@/features/tools/planar-kit/presentation";
import { resolvePlanarContextActions } from "@/features/tools/planar-kit/context-actions";
import { regionArea } from "@/features/tools/plane-overlap-curves/geometry";
import { addSquareForCircle, createCurveOverlapState, curveMaterial, curveMaterials, curveWorldRegion, extractCurveRegion, setCurveField } from "@/features/tools/plane-overlap-curves/model";
import { planeCurveOverlapScene as scene } from "@/features/tools/plane-overlap-curves/scenes";
import { isValidCurveOverlapState } from "@/features/tools/plane-overlap-curves/validation";

const initialSnapshot = (current: PlanarState): PlanarSnapshot => ({ current, past: [], future: [], motion: null });
const action = (id: string) => [...scene.actions!, ...scene.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
const api = (editable: boolean, state: PlanarState, operation?: string): PlanarDrawingApi => ({ locale: "en", editable, selected: editable ? `curve.${state.params.active}` : null, operation,
  bind: (_target, label) => ({ role: "button", tabIndex: editable ? 0 : -1, "aria-label": label ?? "Material", "aria-pressed": false, "aria-disabled": !editable }) });
const svg = (state: PlanarState, editable = false, operation?: string) => renderToStaticMarkup(createElement("svg", null, scene.draw(state, api(editable, state, operation))));

describe("curved overlap descriptor and shared motion integration", () => {
  it("renders mathematical arc paths and holes without SVG masks or polygon circle substitutes", () => {
    const state = extractCurveRegion(setCurveField(addSquareForCircle(createCurveOverlapState(), true), "region", 3));
    const html = svg(state);
    expect(html).toContain('data-plane-overlap="curves"');
    expect(html).toContain('fill-rule="nonzero"');
    expect(html).toContain("A 120 120");
    expect(html).not.toContain("<mask"); expect(html).not.toContain("<clipPath");
    expect(html).not.toContain("data-curve-handle");
    expect((html.match(/data-curve-body/g) ?? []).length).toBe(curveMaterials(state).length);
    expect(html).not.toContain("data-curve-result");
    expect(html).toContain('fill="transparent"');
  });

  it("keeps material geometry while opening, closing or changing an operation", () => {
    const state = createCurveOverlapState(), original = JSON.stringify(state);
    const base = svg(state, true);
    expect(svg(state, true, "curves-move")).toContain('data-curve-handle="curve.1.rotate"');
    expect(svg(state, true, "curves-regions")).not.toContain('data-curve-handle="curve.1.rotate"');
    expect(svg(state, false, "curves-move")).not.toContain("data-curve-handle");
    expect(svg(state, true)).toBe(base); expect(JSON.stringify(state)).toBe(original);
  });

  it("reuses the same exact operation endpoints for the toolbar and context controls", () => {
    const state = createCurveOverlapState(), context = resolvePlanarContextActions(scene, state, "curve.1");
    expect(context).not.toBeNull(); expect(context!.items.length).toBeLessThanOrEqual(5);
    const endpoint = action("curves-turn").run(state, { selected: "curve.1" });
    expect(curveMaterial(endpoint)!.angle).toBe(90);
    expect(endpoint).toEqual(scene.setField!(state, "angle", 90));
    expect(action("curves-inner-square").run(state, { selected: "curve.1" })).toEqual(addSquareForCircle(state, true));
  });

  it("commits direct pointer movement once and leaves the frozen starting state unchanged", () => {
    const state = createCurveOverlapState(), frozen = JSON.stringify(state), origin = curveMaterial(state)!.origin;
    const first = scene.drag!(state, "curve.1", { x: origin.x + 37, y: origin.y + 26 }, { x: 30, y: 20 });
    const last = scene.drag!(state, "curve.1", { x: origin.x + 87, y: origin.y + 46 }, { x: 80, y: 40 }, { previous: first });
    expect(curveMaterial(last)!.origin).toEqual({ x: origin.x + 80, y: origin.y + 40 });
    const snapshot = planarCommit(initialSnapshot(state), state, last);
    expect(snapshot.past).toEqual([state]); expect(planarHistory(snapshot, "undo").current).toEqual(state);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(isValidCurveOverlapState(last)).toBe(true);
  });

  it("pauses and resumes actual rigid curved-paper motion through the shared presentation engine", () => {
    const state = extractCurveRegion(setCurveField(createCurveOverlapState(), "region", 3)), move = action("curves-aside");
    const endpoint = move.run(state, { selected: `curve.${state.params.active}` });
    let snapshot = planarCommit(initialSnapshot(state), state, endpoint, { id: move.id, duration: move.duration!, now: 1000 });
    const frame = planarFrame(snapshot, scene, 1450);
    expect(frame).not.toEqual(state); expect(frame).not.toEqual(endpoint);
    expect(scene.isExact!(frame)).toBe(true);
    const area = regionArea(curveWorldRegion(curveMaterial(state)!));
    expect(regionArea(curveWorldRegion(curveMaterial(frame)!))).toBeCloseTo(area, 8);
    snapshot = planarPause(snapshot, 1450, true);
    expect(planarFrame(snapshot, scene, 9000)).toEqual(frame);
    snapshot = planarPause(snapshot, 9000, false);
    expect(planarFrame(snapshot, scene, 9450)).toEqual(endpoint);
    expect(planarHistory(snapshot, "undo").current).toEqual(state);
  });

  it("reconstructs exact boundary data and running/paused frames after JSON transport", () => {
    const state = extractCurveRegion(setCurveField(addSquareForCircle(createCurveOverlapState(), false), "region", 3));
    const turn = action("curves-turn"), endpoint = turn.run(state, { selected: `curve.${state.params.active}` });
    const snapshot = planarCommit(initialSnapshot(state), state, endpoint, { id: turn.id, duration: turn.duration!, now: 500 });
    const copy = JSON.parse(JSON.stringify(snapshot)) as PlanarSnapshot;
    expect(isValidCurveOverlapState(copy.current)).toBe(true);
    expect(curveMaterial(copy.current)!.region).toEqual(curveMaterial(endpoint)!.region);
    expect(planarFrame(copy, scene, 850)).toEqual(planarFrame(snapshot, scene, 850));
    expect(svg(copy.current)).toBe(svg(endpoint));
  });

  it("uses the shared UUID fallback for semantic actions on LAN HTTP", () => {
    const original = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues: original });
    try {
      const state = createCurveOverlapState(), turn = action("curves-turn"), endpoint = turn.run(state, { selected: "curve.1" });
      const snapshot = planarCommit(initialSnapshot(state), state, endpoint, { id: turn.id, duration: turn.duration!, now: 100 });
      expect(snapshot.motion!.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      expect(isValidCurveOverlapState(snapshot.current)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps observation off at the start and exposes source/chord information only when requested", () => {
    const state = createCurveOverlapState();
    expect(svg(state)).not.toContain("data-curve-guides"); expect(svg(state)).not.toContain("data-curve-region-measures");
    const observed = { ...state, flags: { ...state.flags, guides: true, measures: true } };
    expect(svg(observed)).toContain("data-curve-guides"); expect(svg(observed)).toContain("data-curve-region-measures");
    expect(curveMaterials(observed)).toEqual(curveMaterials(state));
  });
});
