// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarPoint, PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi, PlanarSceneDefinition } from "../src/features/tools/planar-kit/types";
import { constructionLifeMatrix, constructionMatrix, constructionObject, constructionObjects, worldVertices } from "../src/features/tools/plane-construction/model";
import { planeConstructionScenes } from "../src/features/tools/plane-construction/scenes";

const scene = (id = "01-create") => planeConstructionScenes.find((entry) => entry.id === id)!;
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
function draw(definition: PlanarSceneDefinition, state: PlanarState, extras: Partial<PlanarDrawingApi> = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.innerHTML = renderToStaticMarkup(definition.draw(state, { ...api, ...extras }));
  expect(svg.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
  return svg;
}
const polygon: PlanarPoint[] = [{ x: 150, y: 190 }, { x: 250, y: 165 }, { x: 285, y: 250 }, { x: 215, y: 290 }, { x: 135, y: 255 }];
const createPolygon = (definition: PlanarSceneDefinition) => definition.construction!.create(definition.create(), "polygon", polygon)!;
const invoke = (definition: PlanarSceneDefinition, id: string, state: PlanarState, selected: string | null = null) => definition.actions!.find((action) => action.id === id)!.run(state, { selected });
const positionClose = (actual: PlanarPoint, expected: PlanarPoint) => { expect(actual.x).toBeCloseTo(expected.x); expect(actual.y).toBeCloseTo(expected.y); };

describe("open construction scenes", () => {
  it.each(["01-create", "20-create"])("%s starts with an unlabeled shape and never shows editing handles merely on selection", (id) => {
    const definition = scene(id), initial = definition.create(), object = constructionObject(initial)!;
    for (const selected of [null, `object.${object.id}`]) {
      const svg = draw(definition, initial, { selected });
      expect(svg.querySelectorAll("[data-construction-object]")).toHaveLength(1);
      expect(svg.querySelectorAll("text, [data-construction-edit-handle], [data-construction-guide]")).toHaveLength(0);
    }
    expect(definition.operations!.map((operation) => operation.id)).toEqual(["move", "rotate", "reflect"]);
    expect(definition.construction!.tools.map((tool) => tool.id)).toEqual(["rectangle", "circle", "ellipse", "polygon"]);
  });

  it("only highlights tapped boundaries and vertices, with numbers requiring an independent switch", () => {
    const definition = scene(), initial = definition.create(), id = constructionObject(initial)!.id;
    let observed = invoke(definition, "construction-edges", initial);
    observed = invoke(definition, "construction-vertices", observed);
    observed = definition.tap!(observed, `edge.${id}.0`);
    observed = definition.tap!(observed, `vertex.${id}.0`);
    const svg = draw(definition, observed, { selected: `vertex.${id}.0` });
    expect(svg.querySelectorAll('[data-construction-highlight="edge"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-construction-highlight="vertex"]')).toHaveLength(1);
    expect(svg.querySelectorAll("text, [data-construction-edit-handle]")).toHaveLength(0);
    const counted = invoke(definition, "construction-counts", observed);
    expect(draw(definition, counted).textContent).toContain("4 条直边 · 4 个顶点");
    const hidden = invoke(definition, "construction-counts", counted);
    expect(draw(definition, hidden).querySelectorAll("text")).toHaveLength(0);
    const unedited = definition.drag!(observed, `vertex.${id}.0`, { x: 320, y: 250 }, { x: 30, y: 30 });
    expect(constructionObject(unedited)).toEqual(constructionObject(observed));
  });

  it("retains custom polygon geometry and existing objects instead of switching to a sample", () => {
    const definition = scene(), original = definition.create(), first = constructionObject(original)!;
    const created = definition.construction!.create(original, "polygon", polygon)!;
    expect(created.sceneId).toBe(original.sceneId);
    expect(constructionObjects(created)).toHaveLength(2);
    expect(constructionObject(created, first.id)).toEqual(first);
    const vertices = worldVertices(constructionObject(created)!);
    expect(vertices).toHaveLength(polygon.length);
    vertices.forEach((point, index) => positionClose(point, polygon[index]));
    const svg = draw(definition, created);
    expect(svg.querySelectorAll("[data-construction-object]")).toHaveLength(2);
    expect(svg.querySelectorAll("text")).toHaveLength(0);
    expect(definition.construction!.create(created, "polygon", [{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
    expect(definition.construction!.create(created, "rectangle", [{ x: 300, y: 300 }, { x: 300, y: 300 }])).toBeNull();
  });

  it("draws true rectangles, circles and ellipses using the same construction model for previews", () => {
    const definition = scene();
    for (const [tool, points, expectedTag] of [
      ["rectangle", [{ x: 150, y: 180 }, { x: 280, y: 270 }], "polygon"],
      ["circle", [{ x: 220, y: 240 }, { x: 255, y: 275 }], "circle"],
      ["ellipse", [{ x: 160, y: 190 }, { x: 310, y: 280 }], "ellipse"],
    ] as const) {
      const state = definition.construction!.create(definition.create(), tool, points)!;
      const active = constructionObject(state)!, svg = draw(definition, state);
      expect(svg.querySelector(`[data-construction-object="${active.id}"] ${expectedTag}`)).not.toBeNull();
      const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      preview.innerHTML = renderToStaticMarkup(definition.construction!.preview(tool, points));
      const outline = preview.querySelector(expectedTag)!;
      expect(outline.getAttribute("fill")).toBe("none");
      expect(outline.getAttribute("stroke-dasharray")).toBe("5 5");
      expect(preview.querySelectorAll("[id]")).toHaveLength(0);
    }
  });

  it("enables geometry editing explicitly and keeps observation separate from editing", () => {
    const definition = scene(), original = createPolygon(definition), object = constructionObject(original)!;
    const enabled = invoke(definition, "construction-edit", original);
    expect(draw(definition, enabled).querySelectorAll("[data-construction-edit-handle]")).toHaveLength(0);
    expect(draw(definition, enabled, { selected: `object.${object.id}` }).querySelectorAll("[data-construction-edit-handle]")).toHaveLength(5);
    const moved = definition.drag!(enabled, `vertex.${object.id}.0`, { x: polygon[0].x - 30, y: polygon[0].y - 25 }, { x: -30, y: -25 });
    positionClose(worldVertices(constructionObject(moved)!)[0], { x: polygon[0].x - 30, y: polygon[0].y - 25 });
    const insert = definition.actions!.find((action) => action.id === "construction-insert-vertex")!;
    expect(insert.disabled!(original, { selected: `edge.${object.id}.1` })).toBe(true);
    const inserted = insert.run(enabled, { selected: `edge.${object.id}.1` });
    expect(constructionObject(inserted)!.vertices).toHaveLength(6);
    const removed = invoke(definition, "construction-remove-vertex", inserted, `vertex.${object.id}.2`);
    expect(constructionObject(removed)!.vertices).toHaveLength(5);
  });

  it("shows rotation centers and reflection axes only while their operation panel is open", () => {
    const definition = scene("20-create"), state = createPolygon(definition);
    expect(draw(definition, state).querySelectorAll("[data-construction-guide]")).toHaveLength(0);
    expect(draw(definition, state, { operation: "move" }).querySelectorAll("[data-construction-guide]")).toHaveLength(0);
    const rotation = draw(definition, state, { operation: "rotate" });
    expect(rotation.querySelector('[data-construction-edit-handle="pivot"]')).not.toBeNull();
    expect(rotation.querySelector('[data-construction-guide="reflect"]')).toBeNull();
    const reflection = draw(definition, state, { operation: "reflect" });
    expect(reflection.querySelector('[data-construction-guide="rotate"]')).toBeNull();
    expect(reflection.querySelector('[data-construction-edit-handle="axis-handle"]')).not.toBeNull();
  });

  it("keeps collinear editing points separate from mathematical corners and sides", () => {
    const definition = scene(), initial = definition.create(), id = constructionObject(initial)!.id;
    const editable = invoke(definition, "construction-edit", initial);
    const split = invoke(definition, "construction-insert-vertex", editable, `edge.${id}.0`);
    expect(constructionObject(split)!.vertices).toHaveLength(5);
    expect(draw(definition, split, { selected: `object.${id}` }).querySelectorAll("[data-construction-edit-handle]")).toHaveLength(5);
    let observed = invoke(definition, "construction-edit", split);
    for (const action of ["construction-edges", "construction-vertices", "construction-counts"]) observed = invoke(definition, action, observed);
    const svg = draw(definition, observed);
    expect(svg.querySelectorAll('[role="button"][aria-label^="顶点 "]')).toHaveLength(4);
    expect(svg.querySelectorAll('[role="button"][aria-label^="边 "]')).toHaveLength(4);
    expect(svg.textContent).toContain("4 条直边 · 4 个顶点");
  });

  it("translates the current custom shape with a real intermediate frame and leaves other objects unchanged", () => {
    const definition = scene("20-create");
    let from = createPolygon(definition);
    from = definition.setField!(definition.setField!(from, "dx", 80), "dy", 30);
    const id = from.params.active, action = definition.operations!.find((operation) => operation.id === "move")!.actions![0];
    const to = action.run(from, { selected: null }), middle = action.interpolate!(from, to, 0.5);
    const original = worldVertices(constructionObject(from)!);
    worldVertices(constructionObject(middle)!).forEach((point, index) => positionClose(point, { x: original[index].x + 40, y: original[index].y + 15 }));
    worldVertices(constructionObject(to)!).forEach((point, index) => positionClose(point, { x: original[index].x + 80, y: original[index].y + 30 }));
    for (const object of constructionObjects(from).filter((entry) => entry.id !== id)) expect(constructionObject(to, object.id)).toEqual(object);
    expect(action.interpolate!(from, to, 1)).toEqual(to);
    draw(definition, middle);
  });

  it("rotates around the chosen pivot along arcs instead of linearly morphing vertices", () => {
    const definition = scene("20-create");
    let from = createPolygon(definition);
    from = { ...definition.setField!(from, "turn", 90), points: { ...from.points, pivot: { x: 360, y: 350 } } };
    const action = definition.operations!.find((operation) => operation.id === "rotate")!.actions![0];
    const to = action.run(from, { selected: null }), middle = action.interpolate!(from, to, 0.5);
    const before = worldVertices(constructionObject(from)!);
    worldVertices(constructionObject(middle)!).forEach((point, index) => {
      const x = before[index].x - 360, y = before[index].y - 350;
      positionClose(point, { x: 360 + (x - y) * Math.SQRT1_2, y: 350 + (x + y) * Math.SQRT1_2 });
      expect(Math.hypot(point.x - 360, point.y - 350)).toBeCloseTo(Math.hypot(x, y));
    });
    expect(action.interpolate!(from, to, 1)).toEqual(to);
    draw(definition, middle, { operation: "rotate" });
  });

  it("reflects arbitrary custom geometry through an edge-on frame and draws a genuine prior outline", () => {
    const definition = scene("20-create"), created = createPolygon(definition);
    const from = { ...definition.setField!(created, "axisAngle", 90), points: { ...created.points, axis: { x: 400, y: 350 } } };
    const action = definition.operations!.find((operation) => operation.id === "reflect")!.actions![0];
    const to = action.run(from, { selected: null }), middle = action.interpolate!(from, to, 0.5);
    const original = worldVertices(constructionObject(from)!);
    worldVertices(constructionObject(to)!).forEach((point, index) => positionClose(point, { x: 800 - original[index].x, y: original[index].y }));
    worldVertices(constructionObject(middle)!).forEach((point, index) => positionClose(point, { x: 400, y: original[index].y }));
    const svg = draw(definition, to, { ghostState: from });
    expect(svg.querySelectorAll("[data-construction-ghost]")).toHaveLength(1);
    const hidden = { ...to, flags: { ...to.flags, ghost: false } };
    expect(draw(definition, hidden, { ghostState: from }).querySelectorAll("[data-construction-ghost]")).toHaveLength(0);
    draw(definition, middle, { operation: "reflect" });
  });

  it("adds all shortcut materials to the same state without imposing captions or replacing a custom shape", () => {
    const definition = scene(), custom = createPolygon(definition), object = constructionObject(custom)!;
    expect(definition.materials).toHaveLength(12);
    for (const material of definition.materials!) {
      const state = material.add(custom);
      expect(constructionObjects(state)).toHaveLength(3);
      expect(constructionObject(state, object.id)).toEqual(object);
      expect(state.sceneId).toBe(custom.sceneId);
      expect(draw(definition, state).querySelectorAll("text")).toHaveLength(0);
      expect(renderToStaticMarkup(material.preview)).not.toMatch(/NaN|undefined/);
    }
  });

  it("keeps real-life details on the same geometry through resizing and reflected projection", () => {
    const definition = scene("20-create"), material = definition.materials!.find((entry) => entry.id === "construction-preset-window")!;
    let from = material.add(definition.create());
    from = definition.setField!(definition.setField!(from, "width", 340), "height", 155);
    from = definition.setField!(definition.setField!(from, "axisAngle", 35), "angle", 20);
    from = invoke(definition, "construction-measures", from);
    const action = definition.operations!.find((entry) => entry.id === "reflect")!.actions![0], to = action.run(from, { selected: null });
    const middle = action.interpolate!(from, to, 0.35), object = constructionObject(middle)!;
    const svg = draw(definition, middle), details = svg.querySelector(`[data-construction-object="${object.id}"] [data-life-details]`)!;
    expect(details.parentElement!.getAttribute("transform")).toBe(`matrix(${constructionLifeMatrix(object).join(" ")})`);
    const outline = svg.querySelector(`[data-construction-object="${object.id}"] polygon`)!;
    expect(outline.parentElement!.getAttribute("transform")).toBe(`matrix(${constructionMatrix(object).join(" ")})`);
    expect(svg.textContent).toBe(draw(definition, from).textContent);
    expect(svg.querySelectorAll("[id]")).toHaveLength(0);
  });

  it("reads accurate object fields and disables them when there is no current object", () => {
    const definition = scene(), initial = definition.create();
    const empty = invoke(definition, "construction-remove", initial);
    for (const field of [...definition.fields!, ...definition.operations!.flatMap((operation) => operation.fields ?? [])]) {
      expect(field.read).toBeTypeOf("function");
      expect(field.disabled).toBeTypeOf("function");
      expect(Number.isFinite(field.read!(initial))).toBe(true);
      expect(field.disabled!(empty)).toBe(true);
    }
  });
  it("keeps an empty or replaced material safe when replaying an old detail animation", () => {
    const definition = scene(), initial = definition.create(), empty = invoke(definition, "construction-remove", initial);
    const action = definition.actions!.find((entry) => entry.id === "construction-life-outline")!;
    expect(action.interpolate!(empty, empty, 0.5)).toEqual(empty);
    expect(action.interpolate!(initial, empty, 0.5)).toEqual(initial);
  });
});
