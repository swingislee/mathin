import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planarStateSchema, type PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { planeMotionScenes } from "../src/features/tools/plane-motion/scenes";
import { isValidPlaneMotionState } from "../src/features/tools/plane-motion/validation";

const api: PlanarDrawingApi = { locale: "zh", selected: "tile-0", editable: true, bind: (id, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? id, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
const scene = (id: string) => planeMotionScenes.find((item) => item.id === id)!;
describe("shared-descriptor plane motion scenes", () => {
  for (const definition of planeMotionScenes) {
    it(`${definition.id} saves and renders every field boundary, toggle and action frame`, () => {
      const initial = definition.create();
      expect(isValidPlaneMotionState(initial)).toBe(true);
      const render = (state: PlanarState) => { expect(planarStateSchema.safeParse(state).success).toBe(true); const html = renderToStaticMarkup(definition.draw(state, api)); expect(html).not.toMatch(/NaN|Infinity|undefined/); expect(html).toContain("<"); return html; };
      render(initial); render({ ...initial, phase: 0.5 }); render({ ...initial, phase: 1 });
      for (const field of definition.fields ?? []) for (const boundary of [field.min, field.max]) render(definition.setField?.(initial, field.key, boundary) ?? { ...initial, params: { ...initial.params, [field.key]: boundary } });
      for (const toggle of definition.toggles ?? []) render(definition.setFlag?.(initial, toggle.key, !initial.flags[toggle.key]) ?? { ...initial, flags: { ...initial.flags, [toggle.key]: !initial.flags[toggle.key] } });
      for (const action of definition.actions ?? []) {
        const from = action.id === "cut-hole" ? { ...initial, phase: 1 } : initial;
        if (action.disabled?.(from, { selected: "tile-0" })) continue;
        const target = action.run(from, { selected: "tile-0" }); render(target); expect(isValidPlaneMotionState(target)).toBe(true);
        if (action.interpolate) { render(action.interpolate(from, target, 0.3)); expect(action.interpolate(from, target, 1)).toEqual(target); }
      }
    });
  }
  it("draws true right-angle marks for corresponding-point perpendiculars", () => {
    for (const id of ["22", "54"]) expect(renderToStaticMarkup(scene(id).draw(scene(id).create(), api))).toContain('data-right-angle="true"');
  });
  it("a direct translation after a partial animation continues from the visible position", () => {
    const def = scene("20"), initial = { ...def.create(), phase: 0.4 }, moved = def.drag!(initial, "body", { x: 400, y: 300 }, { x: 20, y: 10 });
    expect(moved.phase).toBe(1); expect(moved.params.dx).toBe(104); expect(moved.params.dy).toBe(-6);
  });
  it("preserves distinct tile identities, copies and independent drag endpoints", () => {
    const def = scene("36"), original = def.create(), duplicate = def.actions![0].run(original, { selected: "tile-0" });
    expect(duplicate.params.count).toBe(2); expect(duplicate.points.tile0).toEqual(original.points.tile0);
    const moved = def.drag!(duplicate, "tile-1", { x: 300, y: 300 }, { x: 35, y: 28 });
    expect(moved.points.tile0).toEqual(original.points.tile0); expect(moved.points.tile1.x).toBe(501);
  });
  it("only cuts after folding, then opens the actual perforated layers progressively", () => {
    const def = scene("32"), original = def.create(), cut = def.actions!.find((action) => action.id === "cut-hole")!;
    expect(cut.disabled!(original, { selected: null })).toBe(true);
    const cutState = cut.run({ ...original, phase: 1 }, { selected: null }), unfold = def.actions!.at(-1)!;
    const unfolded = unfold.run(cutState, { selected: null }), middle = unfold.interpolate!(cutState, unfolded, 0.5);
    expect(middle.phase).toBe(0.5); expect(middle.flags.cut).toBe(true);
    expect(renderToStaticMarkup(def.draw(unfolded, api)).match(/<ellipse /g)).toHaveLength(4);
  });
  it("rejects missing mathematical fields, excessive object counts and impossible circle radii", () => {
    expect(isValidPlaneMotionState({ ...scene("20").create(), params: {} })).toBe(false);
    const tiles = scene("36").create();
    expect(isValidPlaneMotionState({ ...tiles, params: { ...tiles.params, count: 1000 } })).toBe(false);
    expect(isValidPlaneMotionState({ ...tiles, points: {} })).toBe(false);
    const rolling = scene("55").create();
    expect(isValidPlaneMotionState({ ...rolling, params: { ...rolling.params, smallRadius: 150 } })).toBe(false);
  });
  it("keeps a resized cut inside the folded paper instead of invalidating a saved scene", () => {
    const def = scene("32"), initial = def.create(), moved = def.drag!(initial, "hole", { x: 500, y: 500 }, { x: 300, y: 300 }), resized = def.setField!(moved, "radius", 35);
    expect(isValidPlaneMotionState(moved)).toBe(true); expect(isValidPlaneMotionState(resized)).toBe(true);
  });
  it("unwraps object rotation through 180 degrees and multiple full turns", () => {
    const def = scene("21"), initial = def.create(), pivot = initial.points.center, grab = { x: pivot.x + 150, y: pivot.y };
    let previous: PlanarState = initial;
    for (let angle = 20; angle <= 720; angle += 20) {
      const point = { x: pivot.x + Math.cos(angle * Math.PI / 180) * 150, y: pivot.y + Math.sin(angle * Math.PI / 180) * 150 };
      previous = def.drag!(initial, "body", point, { x: point.x - grab.x, y: point.y - grab.y }, { previous });
      expect(previous.params.angle).toBeCloseTo(angle);
    }
    expect(isValidPlaneMotionState(previous)).toBe(true);
  });
  it("keeps rolling continuous across angular seams while allowing two full orbits", () => {
    const def = scene("55"), initial = { ...def.create(), params: { ...def.create().params, orbit: 720 } }, pivot = initial.points.center, grab = { x: pivot.x + 185, y: pivot.y };
    let previous: PlanarState = initial;
    for (let angle = 20; angle <= 720; angle += 20) {
      const point = { x: pivot.x + Math.cos(angle * Math.PI / 180) * 185, y: pivot.y + Math.sin(angle * Math.PI / 180) * 185 };
      previous = def.drag!(initial, "rolling-circle", point, { x: point.x - grab.x, y: point.y - grab.y }, { previous });
      expect(previous.phase * 720).toBeCloseTo(angle);
    }
    expect(previous.phase).toBeCloseTo(1);
  });
});
