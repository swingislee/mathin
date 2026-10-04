import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addConstruction, addPreset, constructionMeasurements, constructionObject, constructionShapeKind, createConstructionState, insertConstructionVertex, removeConstruction, setConstructionField } from "@/features/tools/plane-construction/model";
import { createConstructionDefinition } from "@/features/tools/plane-construction/scenes";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";

const empty = () => removeConstruction(createConstructionState("01-create"));
const preset = (id: number) => addPreset(empty(), id);
const kind = (state: ReturnType<typeof empty>) => constructionShapeKind(constructionObject(state)!);
const scene = createConstructionDefinition("01-create", "plane-shapes", { zh: "图形", en: "Shapes" });
const api = (locale: string): PlanarDrawingApi => ({ locale, editable: false, selected: null, operation: null, bind: (target, label) => ({ role: "button", tabIndex: -1, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": true }) });

describe("observations follow the actual construction material", () => {
  it("identifies all seven basic shortcuts by current geometry", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((id) => kind(preset(id)))).toEqual(["triangle", "square", "rectangle", "parallelogram", "trapezoid", "circle", "ellipse"]);
    expect(kind(setConstructionField(preset(1), "width", 300))).toBe("rectangle");
    expect(kind(setConstructionField(setConstructionField(preset(6), "rx", 100), "ry", 100))).toBe("circle");
  });
  it("keeps classification through collinear edit points, rigid transforms and projected animation frames", () => {
    let state = preset(1); state = { ...state, flags: { ...state.flags, edit: true } };
    state = insertConstructionVertex(state, `edge.${state.params.active}.0`);
    const object = constructionObject(state)!;
    expect(object.vertices).toHaveLength(5); expect(constructionShapeKind(object)).toBe("square");
    expect(constructionShapeKind({ ...object, angle: 73, flip: -1, basis: [1, 0, 0, 0] })).toBe("square");
  });
  it("distinguishes a rhombus and a general concave quadrilateral", () => {
    const rhombus = addConstruction(empty(), "polygon", [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 0 }, { x: 100, y: -60 }]);
    const concave = addConstruction(empty(), "polygon", [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 180 }]);
    expect(kind(rhombus)).toBe("rhombus"); expect(kind(concave)).toBe("quadrilateral");
  });
  it("pairs a life outline with its current shape even after details fade", () => {
    let state = setConstructionField(setConstructionField(preset(8), "width", 300), "detail", 0);
    state = { ...state, flags: { ...state.flags, names: true } };
    expect(renderToStaticMarkup(scene.draw(state, api("zh")))).toContain("窗框外轮廓 → 长方形");
    expect(renderToStaticMarkup(scene.draw(state, api("en")))).toContain("Window outline → Rectangle");
  });
  it("labels the ellipse perimeter approximation in both languages", () => {
    const state = preset(6), visible = { ...state, flags: { ...state.flags, measures: true } };
    expect(constructionMeasurements(constructionObject(state)!).perimeterApproximate).toBe(true);
    expect(renderToStaticMarkup(scene.draw(visible, api("zh")))).toContain("周长约 ");
    expect(renderToStaticMarkup(scene.draw(visible, api("en")))).toContain("Perimeter ≈ ");
    expect(constructionMeasurements(constructionObject(preset(5))!).perimeterApproximate).toBe(false);
  });
});
