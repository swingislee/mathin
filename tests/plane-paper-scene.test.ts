import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { constructionObject, constructionObjects } from "@/features/tools/plane-construction/model";
import { createConstructionDefinition } from "@/features/tools/plane-construction/scenes";
import { paperArea, tapPaper } from "@/features/tools/plane-paper/model";
import { planePaperScene as scene } from "@/features/tools/plane-paper/scenes";
import { isValidPaperState } from "@/features/tools/plane-paper/validation";

const api = (selected: string | null = null, operation?: string): PlanarDrawingApi => ({
  locale: "zh", selected, operation, editable: true,
  bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": selected === target, "aria-disabled": false }),
});
const draw = (state = scene.create(), selected: string | null = null, operation?: string) => renderToStaticMarkup(createElement("svg", null, scene.draw(state, api(selected, operation))));

describe("paper dissection shared descriptor", () => {
  it("uses the shared shape manipulation and operation implementations", () => {
    const shared = createConstructionDefinition("14-create", "plane-area", scene.title);
    expect(scene.setField).toBe(shared.setField); expect(scene.setFlag).toBe(shared.setFlag);
    expect(scene.operations?.slice(1)).toEqual(shared.operations);
    expect(scene.actions?.every((action) => shared.actions?.includes(action))).toBe(true);
    expect(scene.actions?.some((action) => action.id === "construction-life-outline")).toBe(false);
    expect(scene.fields?.some((field) => field.key === "detail")).toBe(false);
    expect(scene.construction?.tools.map((tool) => tool.id)).toEqual(["rectangle", "polygon", "cut-line"]);
  });
  it("keeps the initial paper clean and shows a linked perpendicular altitude only when requested", () => {
    const state = scene.create(), id = state.params.active, initial = draw(state);
    expect(initial).not.toContain("data-height-mark"); expect(initial).not.toContain("周长");
    expect(initial).not.toContain("data-construction-guide");
    const marked = tapPaper(state, `edge.${id}.0`), shown = draw(marked, `edge.${id}.0`, "cut");
    expect(shown).toContain('data-height-mark="true"'); expect(shown).toContain('data-right-angle="true"');
    expect(shown).toContain('data-construction-highlight="edge"'); expect(shown).toContain("高");
    expect(marked.flags.edges).toBe(false);
    const measured = { ...marked, flags: { ...marked.flags, measures: true } };
    expect(draw(measured)).toContain('data-height-mark="true"');
  });
  it("the shared scissors opens drawing once, previews the extended line, and cuts without moving material", () => {
    const state = scene.create(), object = constructionObject(state)!, x = object.center.x;
    const operation = scene.operations!.find((entry) => entry.id === "cut")!;
    const tool = scene.construction!.tools.find((entry) => entry.id === operation.constructionTool)!;
    expect(tool.kind).toBe("drag"); expect(tool.once).toBe(true);
    const points = [{ x, y: object.center.y - 160 }, { x, y: object.center.y + 160 }];
    const preview = renderToStaticMarkup(createElement("svg", null, scene.construction!.preview("cut-line", points, state)));
    expect(preview).toContain('data-paper-cut-preview="valid"'); expect(preview).toContain('data-paper-cut-extension="true"');
    const cut = scene.construction!.create(state, "cut-line", points)!;
    expect(isValidPaperState(cut)).toBe(true); expect(constructionObjects(cut)).toHaveLength(2);
    expect(paperArea(cut)).toBeCloseTo(paperArea(state), 7);
    const selected = scene.selectionAfterChange!(state, cut, `object.${object.id}`);
    expect(selected).toBe(`object.${cut.params.active}`);
    const moved = scene.drag!(cut, selected!, constructionObject(cut)!.center, { x: 50, y: 30 });
    expect(isValidPaperState(moved)).toBe(true); expect(paperArea(moved)).toBeCloseTo(paperArea(cut), 7);
  });
  it("the altitude action shares the real cutter and accepts changed base edges", () => {
    const state = scene.create(), id = state.params.active, action = scene.operations!.find((entry) => entry.id === "cut")!.actions![0];
    expect(action.disabled!(state, { selected: null })).toBe(true);
    for (const edge of [0, 1]) {
      const selected = `edge.${id}.${edge}`, marked = scene.tap!(state, selected);
      expect(action.disabled!(marked, { selected })).toBe(false);
      const result = action.run(marked, { selected });
      expect(isValidPaperState(result)).toBe(true); expect(paperArea(result)).toBeCloseTo(paperArea(state), 7);
    }
  });
  it("moves a narrow paper from its edge while taps still choose a base", () => {
    const original = scene.create();
    const rectangle = scene.construction!.create(original, "rectangle", [{ x: 400, y: 250 }, { x: 416, y: 400 }])!;
    const object = constructionObject(rectangle)!, target = `edge.${object.id}.1`;
    const edgePoint = { x: 416, y: 300 }, delta = { x: 70, y: 25 };
    const moved = scene.drag!(rectangle, target, { x: edgePoint.x + delta.x, y: edgePoint.y + delta.y }, delta);
    expect(constructionObject(moved)!.center).toEqual({ x: object.center.x + delta.x, y: object.center.y + delta.y });
    expect(constructionObject(moved)!.vertices).toEqual(object.vertices);
    expect(constructionObject(moved, original.params.active)).toEqual(constructionObject(original));
    expect(moved.marks).toEqual(rectangle.marks); expect(isValidPaperState(moved)).toBe(true);
    const tapped = scene.tap!(rectangle, target);
    expect(tapped.marks).toContain(target); expect(constructionObject(tapped)).toEqual(object);
    expect(draw(tapped, target, "cut")).toContain('data-right-angle="true"');
    const editing = { ...rectangle, flags: { ...rectangle.flags, edit: true } };
    expect(scene.drag!(editing, target, edgePoint, delta)).toBe(editing);
    expect(scene.drag!(rectangle, `edge.${object.id}.10`, edgePoint, delta)).toBe(rectangle);
  });
  it("all materials append valid real polygons instead of changing a template mode", () => {
    const state = scene.create(), original = constructionObject(state)!;
    for (const material of scene.materials!) {
      const added = material.add(state);
      expect(isValidPaperState(added), material.id).toBe(true);
      expect(constructionObject(added, original.id)).toEqual(original);
      expect(constructionObjects(added).length).toBeGreaterThan(1);
    }
  });
});
