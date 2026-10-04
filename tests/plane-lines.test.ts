import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarState } from "@/features/tools/planar-kit/contract";
import { planarSnapshot, planarSnapshotForTool, planarStateSchema } from "@/features/tools/planar-kit/contract";
import { planarHistory, planarCommit } from "@/features/tools/planar-kit/presentation";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { addLineMaterial, activateLine, createLineGeometry, createLinesState, dragLine, duplicateLine, lineMaterial, lineMaterials, lineMetrics, removeLine, setLineField, type LineKind } from "@/features/tools/plane-lines/model";
import { isValidLinesState, LINE_LIMIT } from "@/features/tools/plane-lines/validation";
import { planeLinesScene as scene } from "@/features/tools/plane-lines/scenes";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";

const api = (locale = "zh", operation: string | null = null, editable = true): PlanarDrawingApi => ({ locale, selected: "line.0.body", operation, editable,
  bind: (target, label) => ({ role: "button", tabIndex: editable ? 0 : -1, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": !editable }) });
const one = (kind: LineKind = 0) => addLineMaterial(createLinesState(), kind);
const metrics = (state: PlanarState) => lineMetrics(lineMaterial(state)!);
const closePoint = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 8); expect(a.y).toBeCloseTo(b.y, 8); };

describe("lines and angles on one teaching stage", () => {
  it("starts without revealed conclusions and adds seven independent material types", () => {
    let state = createLinesState(); expect(isValidLinesState(state)).toBe(true);
    expect(Object.values(state.flags).every((flag) => flag === false)).toBe(true);
    for (let kind = 0; kind < 7; kind++) {
      const previous = structuredClone(state); state = addLineMaterial(state, kind as LineKind);
      expect(isValidLinesState(state)).toBe(true); expect(lineMaterial(state)?.kind).toBe(kind);
      lineMaterials(previous).forEach((material) => expect(lineMaterial(state, material.id)).toEqual(material));
    }
    expect(state.params.count).toBe(7); expect(scene.materials).toHaveLength(7); expect(scene.construction?.tools).toHaveLength(7);
  });
  it("constructs arbitrary directed lines and three-point angles without replacing materials", () => {
    let state = one();
    const points = [{ x: 180, y: 290 }, { x: 330, y: 150 }, { x: 380, y: 400 }];
    state = createLineGeometry(state, "angle", points)!;
    expect(lineMaterial(state)).toMatchObject({ id: 1, kind: 3, a: points[0], b: points[1], c: points[2] });
    expect(lineMaterial(state, 0)).toEqual(lineMaterial(one(), 0)); expect(isValidLinesState(state)).toBe(true);
    expect(createLineGeometry(state, "line", [points[0], points[0]])).toBeNull();
    expect(createLineGeometry(state, "angle", points.slice(0, 2))).toBeNull();
  });
  it("targets the hit object regardless of the side-panel selection and uses one direct/precise endpoint", () => {
    const state = addLineMaterial(one(3), 0), object = lineMaterial(state, 0)!;
    const point = { x: object.a.x + 50, y: object.a.y - 30 };
    const dragged = dragLine(state, "line.0.a", point, { x: 50, y: -30 });
    expect(dragged.params.active).toBe(0); expect(lineMaterial(dragged, 1)).toEqual(lineMaterial(state, 1));
    const selected = activateLine(state, "line.0.a"), exact = setLineField(setLineField(selected, "pointX", point.x / 40), "pointY", point.y / 40);
    expect(exact.points).toEqual(dragged.points); expect(metrics(exact).angle).toBeCloseTo(90);
  });
  it("sets an opening relative to a freely oriented first arm and keeps independent arm lengths", () => {
    let state = setLineField(one(3), "orientation", 137); const before = metrics(state);
    state = setLineField(state, "angle", 223.25); const after = metrics(state);
    expect(after.orientation).toBeCloseTo(137); expect(after.angle).toBeCloseTo(223.25);
    expect(after.length).toBeCloseTo(before.length); expect(after.secondLength).toBeCloseTo(before.secondLength);
    state = setLineField(state, "secondLength", 3.25); expect(metrics(state).secondLength).toBeCloseTo(130); expect(metrics(state).angle).toBeCloseTo(223.25);
  });
  it("preserves the true point-line relation under arbitrary orientation and body translation", () => {
    const origin = one(6), initial = metrics(origin);
    for (const angle of [-177, -90, 0, 38.25, 179]) {
      let state = setLineField(origin, "orientation", angle); state = dragLine(state, "line.0.body", { x: 0, y: 0 }, { x: -120, y: 50 });
      const object = lineMaterial(state)!, m = metrics(state), perpendicular = { x: object.c.x - m.foot.x, y: object.c.y - m.foot.y };
      expect(perpendicular.x * m.unit.x + perpendicular.y * m.unit.y).toBeCloseTo(0, 7);
      expect(m.height).toBeCloseTo(initial.height, 8); expect(m.slant).toBeGreaterThanOrEqual(m.height);
      const footState = setLineField(state, "q", 0); expect(metrics(footState).slant).toBeCloseTo(m.height);
      const moved = dragLine(state, "line.0.q", m.foot, { x: 0, y: 0 }); closePoint(metrics(moved).via, m.foot);
      expect(isValidLinesState(moved)).toBe(true);
    }
  });
  it("can choose segment, ray or full line for one existing material without resetting other observations", () => {
    const state = { ...one(), flags: { ...one().flags, detour: true, measures: true } };
    const changed = setLineField(state, "kind", 2); expect(lineMaterial(changed)?.kind).toBe(2);
    expect(changed.points).toEqual(state.points); expect(changed.flags).toEqual(state.flags);
    expect(setLineField(one(3), "kind", 1)).toEqual(one(3));
  });
  it("keeps independent protractor position, orientation and exact radius within physical bounds", () => {
    const state = setLineField(setLineField(one(4), "orientation", -70), "length", 6);
    expect(metrics(state).orientation).toBeCloseTo(-70); expect(metrics(state).length).toBeCloseTo(240);
    expect(setLineField(state, "length", .9)).toBe(state); expect(setLineField(state, "length", 11)).toBe(state);
    const html = renderToStaticMarkup(scene.draw(state, api())); expect(html).toContain("data-line-protractor"); expect(html).toContain("rotate(-70)");
  });
  it("duplicates and deletes complete materials and refuses overflow atomically", () => {
    let state = setLineField(one(5), "q", -2.5); state = duplicateLine(state);
    expect(lineMaterial(state)?.q).toBe(-100); expect(metrics(state).height).toBeCloseTo(metrics(one(5)).height);
    const kept = lineMaterial(state, 1)!; state = removeLine(activateLine(state, "line.0.body"));
    expect(lineMaterial(state)).toMatchObject({ ...kept, id: 0 });
    while (state.params.count < LINE_LIMIT) state = addLineMaterial(state, 0);
    expect(duplicateLine(state)).toBe(state); expect(isValidLinesState(state)).toBe(true);
  });
  it("keeps endpoint validity and finite bounds without clamping a malformed candidate into a different result", () => {
    const state = one(), object = lineMaterial(state)!;
    expect(dragLine(state, "line.0.b", object.a, { x: 0, y: 0 }).points).toEqual(state.points);
    expect(setLineField(state, "pointX", Infinity)).toBe(state); expect(setLineField(state, "x", 101)).toBe(state);
    expect(setLineField(state, "length", 0)).toBe(state);
    expect(dragLine(state, "line.99.a", { x: 40, y: 40 }, { x: 1, y: 1 })).toBe(state);
  });
  it("rejects unknown, orphaned, fractional and degenerate persistent geometry", () => {
    const state = one(3), rejected = [
      { ...state, params: { ...state.params, extra: 1 } }, { ...state, params: { ...state.params, "kind.0": 3.5 } },
      { ...state, params: { ...state.params, active: 9 } }, { ...state, phase: .5 }, { ...state, marks: ["x"] },
      { ...state, points: { ...state.points, "b.0": state.points["a.0"] } },
      { ...state, points: { ...state.points, "c.0": state.points["a.0"] } },
      { ...state, points: { ...state.points, "c.3": { x: 1, y: 1 } } },
      { ...state, flags: { ...state.flags, hiddenAnswer: false } },
    ];
    rejected.forEach((candidate) => { expect(isValidLinesState(candidate)).toBe(false); expect(planarStateSchema.safeParse(candidate).success).toBe(false); });
  });
  it("only reveals the teacher's chosen observations and scopes editing handles to the operation", () => {
    const state = one(5), first = renderToStaticMarkup(scene.draw(state, api()));
    expect(first).not.toContain("data-height-mark"); expect(first).not.toContain("data-line-handle"); expect(first).not.toContain("斜线");
    const shown = { ...state, flags: { ...state.flags, foot: true, measures: true } };
    expect(renderToStaticMarkup(scene.draw(shown, api("en", "line-edit")))).toContain("data-right-angle");
    expect(renderToStaticMarkup(scene.draw(shown, api("en", "line-edit")))).toContain("data-line-handle");
    expect(renderToStaticMarkup(scene.draw(shown, api("en", "line-edit", false)))).not.toContain("data-line-handle");
  });
  it("freezes the new entry, restores its history and keeps all three old lessons readable by version", () => {
    const initial = one(3), moved = setLineField(initial, "angle", 60);
    const snapshot = planarCommit(planarSnapshot(initial), initial, moved);
    expect(planarSnapshotForTool("plane-geometry", "plane-geometry-lesson-v2").safeParse(snapshot).success).toBe(true);
    expect(planarHistory(snapshot, "undo").current).toEqual(initial);
    const saved = freezeToolScene(parseToolScene({ toolId: "plane-geometry", contentVersion: "plane-geometry-lesson-v2", payload: { title: "Lines", initial } }));
    if (saved.toolId !== "plane-geometry") throw new Error("Unexpected tool");
    initial.points["a.0"].x += 100; expect(saved.payload.initial).not.toEqual(initial);
    expect(scenesForPlanarTool("plane-geometry").map((s) => s.id)).toEqual(["03-create"]);
    for (const id of ["03", "04", "05"]) {
      const old = planarScene(id).create(); expect(() => parseToolScene({ toolId: "plane-geometry", contentVersion: "plane-geometry-lesson-v1", payload: { title: "Old", initial: old } })).not.toThrow();
      expect(planarSnapshotForTool("plane-geometry", "plane-geometry-lesson-v2").safeParse(planarSnapshot(old)).success).toBe(false);
    }
  });
});
