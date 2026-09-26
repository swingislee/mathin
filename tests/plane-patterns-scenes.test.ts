import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planarStateSchema, type PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { planePatternsScenes } from "../src/features/tools/plane-patterns/scenes";
import { isValidPlanePatternsState } from "../src/features/tools/plane-patterns/validation";

const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (id, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? id, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
const scene = (id: string) => planePatternsScenes.find((item) => item.id === id)!;
describe("shared-descriptor counting and path scenes", () => {
  for (const definition of planePatternsScenes) {
    it(`${definition.id} saves and renders every field boundary, toggle and action frame`, () => {
      const initial = definition.create();
      expect(isValidPlanePatternsState(initial)).toBe(true);
      const render = (state: PlanarState) => { expect(planarStateSchema.safeParse(state).success).toBe(true); const html = renderToStaticMarkup(definition.draw(state, api)); expect(html).not.toMatch(/NaN|Infinity|undefined/); expect(html).toContain("<"); return html; };
      render(initial);
      for (const field of definition.fields ?? []) for (const boundary of [field.min, field.max]) render(definition.setField?.(initial, field.key, boundary) ?? { ...initial, params: { ...initial.params, [field.key]: boundary } });
      for (const toggle of definition.toggles ?? []) render(definition.setFlag?.(initial, toggle.key, !initial.flags[toggle.key]) ?? { ...initial, flags: { ...initial.flags, [toggle.key]: !initial.flags[toggle.key] } });
      for (const action of definition.actions ?? []) {
        if (action.disabled?.(initial, { selected: "match-0" })) continue;
        const target = action.run(initial, { selected: "match-0" }); render(target); expect(isValidPlanePatternsState(target)).toBe(true);
        if (action.interpolate) { render(action.interpolate(initial, target, 0.5)); expect(action.interpolate(initial, target, 1)).toEqual(target); }
      }
    });
  }
  it("records a selected object, not an expected answer or a total", () => {
    const def = scene("47"), from = def.create();
    expect(from.marks).toEqual([]);
    const selected = def.tap!(def.tap!(from, "point.A"), "point.F"), marked = def.actions![0].run(selected, { selected: null });
    expect(marked.marks).toContain("figure.A.F");
    expect(marked.marks.some((mark) => mark.includes("answer"))).toBe(false);
    expect(planarStateSchema.safeParse(marked).success).toBe(true);
    expect(isValidPlanePatternsState(marked)).toBe(true);
  });
  it("cannot record a triangle whose side is absent", () => {
    const def = scene("48"); let state = def.create();
    for (const target of ["point.0_0", "point.1_2", "point.3_3"]) state = def.tap!(state, target);
    expect(def.actions![0].disabled!(state, { selected: null })).toBe(true);
  });
  it("records paths, lifts the pen and replays a genuinely intermediate frame", () => {
    const def = scene("52"); let state = def.create();
    for (const target of ["point.A", "point.B", "point.C"]) state = def.tap!(state, target);
    expect(state.marks).toContain("stroke.A.B.C");
    const replay = def.actions!.find((action) => action.id === "replay-path")!, target = replay.run(state, { selected: null }), middle = replay.interpolate!(state, target, 0.3);
    expect(middle.phase).toBe(0.3); expect(target.marks).toEqual(state.marks);
    const lifted = def.actions![0].run(state, { selected: null }), next = def.tap!(lifted, "point.E");
    expect(next.marks).toContain("stroke.E");
  });
  it("keeps grid counts hidden until explicitly revealed and treats closed roads as geometry", () => {
    const def = scene("53"), state = def.create();
    expect(state.params.numberStep).toBe(-1);
    const closed = def.tap!({ ...state, flags: { ...state.flags, editEdges: true } }, "edge.0_0.1_0");
    expect(closed.marks).toContain("closed.0_0.1_0");
    const start = def.tap!({ ...closed, flags: { ...closed.flags, editEdges: false } }, "point.0_0"), blocked = def.tap!(start, "point.1_0");
    expect(blocked.marks).toContain("stroke.0_0");
    expect(blocked.marks).not.toContain("stroke.0_0.1_0");
  });
  it("animates a domino turn and rejects an overlapping drag endpoint", () => {
    const def = scene("57"), original = def.create(), turn = def.actions!.find((action) => action.id === "turn-domino")!;
    const target = turn.run(original, { selected: "domino-0" }), middle = turn.interpolate!(original, target, 0.5);
    expect(middle.params.turn0).toBe(45); expect(target.flags.vertical0).toBe(true);
    const moved = def.drag!(original, "domino-0", { x: -500, y: -500 }, { x: -500, y: -500 }), snapped = def.snap!(moved, "domino-0")!;
    expect(snapped.points.domino0).toEqual(original.points.domino0);
    expect(isValidPlanePatternsState(snapped)).toBe(true);
  });
  it("rejects oversized grids, invalid recorded edges and overlapping dominoes", () => {
    const grid = scene("53").create();
    expect(isValidPlanePatternsState({ ...grid, params: { ...grid.params, columns: 9999 } })).toBe(false);
    expect(isValidPlanePatternsState({ ...grid, marks: ["stroke.0_0.4_3"] })).toBe(false);
    const board = scene("57").create();
    expect(isValidPlanePatternsState({ ...board, params: { ...board.params, count: 2 }, points: { ...board.points, domino1: board.points.domino0 } })).toBe(false);
  });
  it("changing the graph removes stale routes and keeps repeated tracing within the snapshot bound", () => {
    const def = scene("52"); let state: PlanarState = { ...def.create(), flags: { ...def.create().flags, repeat: true } };
    for (let step = 0; step < 80; step++) state = def.tap!(state, step % 2 ? "point.B" : "point.A");
    expect(planarStateSchema.safeParse(state).success).toBe(true);
    expect(isValidPlanePatternsState(state)).toBe(true);
    const closed = def.tap!({ ...state, flags: { ...state.flags, editEdges: true } }, "edge.A.B");
    expect(closed.marks.some((mark) => mark.startsWith("stroke."))).toBe(false);
    expect(isValidPlanePatternsState(closed)).toBe(true);
  });
  it("clearing and adding a domino does not retain a previous rotation", () => {
    const def = scene("57"), initial = def.create(), turned = def.actions![1].run(initial, { selected: "domino-0" }), cleared = def.actions![2].run(turned, { selected: "domino-0" }), added = def.actions![0].run(cleared, { selected: null });
    expect(added.flags.vertical0).toBe(false); expect(added.params.turn0).toBe(0);
  });
  it("lets one continuous finger gesture visit multiple connected vertices", () => {
    const def = scene("52"), initial = def.create();
    const first = def.drag!(initial, "point.A", { x: 610, y: 470 }, { x: 300, y: 0 }, { previous: initial });
    expect(first.marks).toContain("stroke.A.B");
    const next = def.drag!(initial, "point.A", { x: 610, y: 280 }, { x: 300, y: -190 }, { previous: first });
    expect(next.marks).toContain("stroke.A.B.C");
    expect(isValidPlanePatternsState(next)).toBe(true);
  });
});
