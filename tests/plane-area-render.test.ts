import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planeAreaScenes } from "@/features/tools/plane-area/scenes";

const api: PlanarDrawingApi = {
  locale: "zh", selected: null, editable: false,
  bind: (target, label) => ({ onPointerDown: () => undefined, onKeyDown: () => undefined, role: "button", tabIndex: -1, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": true }),
};
describe("area drawings use the shared mathematical primitives", () => {
  it("renders every mathematical scene without local controls or invalid coordinates", () => {
    for (const scene of planeAreaScenes) {
      const state = scene.create(); state.flags.areas = true;
      const svg = renderToStaticMarkup(createElement("svg", {}, scene.draw(state, api)));
      expect(svg, scene.id).toContain(`data-plane-area-scene="${scene.id}"`);
      expect(svg, scene.id).not.toMatch(/NaN|Infinity|<button|<input|<select/);
    }
  });
  it("puts visible right-angle marks on altitudes and keeps every vertex directly addressable", () => {
    for (const id of ["14", "15", "16", "18", "37", "41"]) {
      const scene = planeAreaScenes.find((entry) => entry.id === id)!;
      const svg = renderToStaticMarkup(createElement("svg", {}, scene.draw(scene.create(), api)));
      expect(svg, id).toContain('data-height-mark="true"'); expect(svg, id).toContain('data-right-angle="true"');
    }
    const equalHeight = planeAreaScenes.find((entry) => entry.id === "18")!;
    const svg = renderToStaticMarkup(createElement("svg", {}, equalHeight.draw(equalHeight.create(), api)));
    for (const label of ["A", "B", "C"]) expect(svg).toContain(`aria-label="顶点 ${label}"`);
    expect(svg).toContain('aria-disabled="true"'); expect(svg).toContain('tabindex="-1"');
  });
  it("keeps the square-grid approximation distinct from the exact triangle", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "18")!, state = scene.create(); state.flags.strips = true;
    const strips = renderToStaticMarkup(createElement("svg", {}, scene.draw(state, api)));
    expect(strips).toContain('data-area-cell="strip"'); expect(strips).toContain('data-area-strip="0"');
    state.flags.cover = true;
    const svg = renderToStaticMarkup(createElement("svg", {}, scene.draw(state, api)));
    expect(svg).toContain('data-area-cell="inner"'); expect(svg).toContain('data-area-cell="boundary"');
  });
  it("makes nested source layers selectable and uses the same paper binding for independent copies", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "42")!, state = scene.create(), bindings: string[] = [];
    const drawingApi: PlanarDrawingApi = { ...api, selected: "piece.level1", bind: (target, label) => { bindings.push(target); return api.bind(target, label); } };
    const original = renderToStaticMarkup(createElement("svg", {}, scene.draw(state, drawingApi)));
    expect(bindings).toContain("piece.level1"); expect(bindings).toContain("piece.level2");
    expect(original).toContain('aria-label="第 1 层三角形，点选后可复制"');
    expect(original).not.toContain('data-area-paper="copy.level1"');
    const copied = scene.actions!.find((action) => action.id === "duplicate")!.run(state, { selected: "piece.level1" });
    const extracted = renderToStaticMarkup(createElement("svg", {}, scene.draw(copied, drawingApi)));
    expect(bindings).toContain("piece.copy.level1");
    expect(extracted).toContain('data-area-paper="level1"'); expect(extracted).toContain('data-area-paper="copy.level1"');
    expect(extracted).not.toMatch(/NaN|Infinity|<button|<input|<select/);
  });
});
