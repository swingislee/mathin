import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlanarSnapshot, PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory, planarPause } from "@/features/tools/planar-kit/presentation";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planePolygonWorkbenchScene as scene } from "@/features/tools/plane-polygons/scenes";
import { addPolygonMaterial, activatePolygonMaterial, createPolygonGeometry, createPolygonWorkbenchState, emptyPolygonWorkbenchState, polygonMaterial, polygonWorldVertices, setPolygonField, togglePolygonCorners, togglePolygonHeight } from "@/features/tools/plane-polygons/model";
import { distance, polygonCornerGeometry, polygonJoinedCorners } from "@/features/tools/plane-polygons/geometry";
import { isValidPolygonWorkbenchState } from "@/features/tools/plane-polygons/validation";

const api = (operation: string | null = null, editable = true, locale = "zh"): PlanarDrawingApi => ({ selected: "polygon.0.body", operation, editable, locale,
  bind: (target, label) => ({ role: "button", tabIndex: editable ? 0 : -1, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": !editable }) });
const one = (kind: Parameters<typeof addPolygonMaterial>[1]) => addPolygonMaterial(emptyPolygonWorkbenchState(), kind);
const html = (state: PlanarState, operation: string | null = null, editable = true, locale = "zh") => renderToStaticMarkup(scene.draw(state, api(operation, editable, locale)));
const snapshot = (current: PlanarState): PlanarSnapshot => ({ current, past: [], future: [], motion: null });
const action = (id: string) => [...(scene.actions ?? []), ...(scene.operations?.flatMap((o) => o.actions ?? []) ?? [])].find((item) => item.id === id)!;

describe("polygon descriptor, renderer and shared motion integration", () => {
  it("offers all material kinds and real construction from a single descriptor with a useful start", () => {
    expect(scene.id).toBe("06-create"); expect(scene.toolId).toBe("plane-polygons"); expect(scene.materials).toHaveLength(10);
    expect(scene.create().params.count).toBe(2); expect(scene.construction?.tools.map((tool) => tool.id)).toContain("quadrilateral");
    const state = scene.materials![3].add(createPolygonWorkbenchState());
    expect(state.params.count).toBe(3); expect(html(state)).not.toContain("data-height-mark");
    expect(html(state)).not.toContain("data-polygon-corners"); expect(html(state)).not.toContain("data-polygon-measurements");
    expect(scene.selectionAfterChange?.(scene.create(), state, null)).toBe("polygon.2.body");
  });
  it("keeps mathematical results while operation handles open and close, and hides handles in read-only projections", () => {
    const state = togglePolygonHeight(setPolygonField(one(7), "rotation", 33));
    expect(html(state)).toContain("data-height-mark"); expect(html(state)).not.toContain("data-polygon-handle");
    expect(html(state, "polygon-edit")).toContain("data-polygon-handle");
    expect(html(state, "polygon-edit", false)).not.toContain("data-polygon-handle");
    expect(html(state, null, false)).toContain("data-height-mark");
    const observed = { ...state, flags: { ...state.flags, names: true, measures: true } };
    expect(html(observed, null, false, "en")).toContain("Parallelogram"); expect(html(observed)).toContain("data-right-angle");
    expect(html(state)).not.toContain("= 180");
  });
  it("renders both true altitudes of a concave quad and switches the base without replacing it", () => {
    let state = createPolygonGeometry(emptyPolygonWorkbenchState(), "quadrilateral", [{ x: 120, y: 450 }, { x: 400, y: 450 }, { x: 220, y: 365 }, { x: 160, y: 180 }])!;
    state = togglePolygonHeight(state); const before = polygonMaterial(state)!;
    const changed = scene.tap!(state, "polygon.0.edge.2");
    expect(polygonMaterial(changed)?.base).toBe(2); expect(polygonMaterial(changed)?.vertices).toEqual(before.vertices);
    expect(html(changed).match(/data-height-mark=/g)).toHaveLength(2);
  });
  it("uses unconstrained precise input steps and disables unrelated dimensions", () => {
    const fields = scene.operations!.find((operation) => operation.id === "polygon-size")!.fields!;
    const width = fields.find((field) => field.key === "width")!, left = fields.find((field) => field.key === "left")!;
    expect(width.step).toBeUndefined(); expect(left.step).toBeUndefined();
    const state = scene.setField!(one(5), "width", 3.25);
    expect(width.read!(state)).toBe(3.25); expect(left.disabled!(state)).toBe(true);
    expect(width.disabled!(one(3))).toBe(true);
  });
  it("keeps square construction preview and committed geometry on the same dimensions", () => {
    const points = [{ x: 180, y: 140 }, { x: 290, y: 360 }];
    const preview = renderToStaticMarkup(scene.construction!.preview("square", points));
    expect(preview).toContain('x="180"'); expect(preview).toContain('y="250"'); expect(preview).toContain('width="110"'); expect(preview).toContain('height="110"');
    const state = scene.construction!.create(emptyPolygonWorkbenchState(), "square", points)!;
    const vertices = polygonWorldVertices(polygonMaterial(state)!); expect(Math.min(...vertices.map((p) => p.y))).toBe(250);
    expect(distance(vertices[0], vertices[1])).toBe(110); expect(distance(vertices[1], vertices[2])).toBe(110);
  });
  it("pauses, resumes, saves and undoes true angle-piece poses through the shared semantic motion helpers", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto); vi.stubGlobal("crypto", { getRandomValues });
    try {
      const initial = togglePolygonCorners(one(3)), join = action("polygon-join-angles"), end = join.run(initial, { selected: "polygon.0.body" });
      const committed = planarCommit(snapshot(initial), initial, end, { id: join.id, duration: join.duration!, now: 1000 });
      expect(committed.motion?.id).toMatch(/^[0-9a-f-]{36}$/i);
      const middle = planarFrame(committed, scene, 1900); expect(isValidPolygonWorkbenchState(middle)).toBe(true);
      const paused = planarPause(committed, 1900, true); expect(planarFrame(paused, scene, 100000)).toEqual(middle);
      const resumed = planarPause(paused, 100000, false); expect(planarFrame(resumed, scene, 105000)).toEqual(end);
      expect(polygonCornerGeometry(polygonMaterial(middle)!)).toEqual(polygonCornerGeometry(polygonMaterial(initial)!));
      expect(isValidPolygonWorkbenchState(JSON.parse(JSON.stringify(middle)))).toBe(true);
      expect(planarHistory(committed, "undo").current).toEqual(initial);
      expect(polygonMaterial(end)?.corners).toEqual(polygonJoinedCorners(polygonMaterial(end)!));
      const readOnly = html(middle, "polygon-angles", false); expect(readOnly).toContain("data-polygon-corner"); expect(readOnly).not.toContain("data-polygon-handle");
    } finally { vi.unstubAllGlobals(); }
  });
  it("plays the current hinged frame while the other materials stay unchanged and retains results when closed", () => {
    const state = createPolygonWorkbenchState(), motion = action("polygon-frame-shear"), end = motion.run(state, { selected: "polygon.1.body" });
    const committed = planarCommit(snapshot(state), state, end, { id: motion.id, duration: motion.duration!, now: 1000 });
    for (const time of [1000, 1200, 1700, 2400]) {
      const frame = planarFrame(committed, scene, time); expect(isValidPolygonWorkbenchState(frame)).toBe(true);
      expect(polygonMaterial(frame, 0)).toEqual(polygonMaterial(state, 0));
    }
    expect(html(end)).not.toContain("data-polygon-handle"); expect(polygonMaterial(end)?.dimensions.opening).not.toBe(polygonMaterial(state)?.dimensions.opening);
  });
  it("keeps action enablement, context choices and per-material observations tied to the selected material", () => {
    const state = addPolygonMaterial(one(3), 5), triangle = activatePolygonMaterial(state, "polygon.0.body");
    expect(action("polygon-corners").disabled!(triangle, { selected: "polygon.0.body" })).toBe(false);
    expect(action("polygon-corners").disabled!(state, { selected: "polygon.1.body" })).toBe(true);
    const shown = togglePolygonHeight(triangle); expect(polygonMaterial(shown, 0)?.height).toBe(true); expect(polygonMaterial(shown, 1)?.height).toBe(false);
    expect(scene.contextActions!(triangle, "polygon.0.body")?.items.some((item) => item.id === "polygon-angles")).toBe(true);
    expect(scene.contextActions!(state, "polygon.1.body")?.items.some((item) => item.id === "polygon-size")).toBe(true);
    const split = togglePolygonCorners(triangle); expect(html(split, "polygon-edit")).not.toContain("data-polygon-handle");
    const remove = action("polygon-remove"), next = remove.run(one(0), { selected: "polygon.0.body" });
    expect(scene.selectionAfterChange!(one(0), next, "polygon.0.body")).toBeNull();
  });
});
