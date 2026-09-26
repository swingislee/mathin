// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { paperFoldLayers, paperLayerPath, type PaperFoldLayer } from "../src/features/tools/plane-motion/model";
import { planeMotionScenes } from "../src/features/tools/plane-motion/scenes";

const scene = (id: string) => planeMotionScenes.find((definition) => definition.id === id)!;
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
const c = { x: 460, y: 350 }, hole = { x: 390, y: 280 };
function covers(layer: PaperFoldLayer, point: { x: number; y: number }): boolean {
  const xs = layer.corners.map((corner) => corner.x), ys = layer.corners.map((corner) => corner.y);
  const inside = point.x > Math.min(...xs) && point.x < Math.max(...xs) && point.y > Math.min(...ys) && point.y < Math.max(...ys);
  const h = layer.hole;
  return inside && (!h || ((point.x - h.center.x) / h.rx) ** 2 + ((point.y - h.center.y) / h.ry) ** 2 >= 1);
}

describe("paper layers and fold-normal gestures", () => {
  it("cuts a hole out of each independent DOM layer without painting over lower paper", () => {
    const definition = scene("32"), initial = definition.create();
    const state = { ...initial, phase: 0.8, flags: { ...initial.flags, cut: true } };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = renderToStaticMarkup(definition.draw(state, api));
    const layers = paperFoldLayers(c, hole, 22, state.phase, true, true);
    expect(svg.querySelectorAll("[data-paper-layer]")).toHaveLength(4);
    for (const layer of layers) {
      const group = svg.querySelector(`[data-paper-layer="${layer.key}"]`)!;
      const fill = group.querySelector("path")!, rim = group.querySelector("ellipse")!;
      expect(fill.getAttribute("fill-rule")).toBe("evenodd");
      expect(fill.getAttribute("d")).toBe(paperLayerPath(layer));
      expect(fill.getAttribute("d")!.match(/ A /g)).toHaveLength(2);
      expect(rim.getAttribute("fill")).toBe("none");
      expect(Number(rim.getAttribute("cx"))).toBeCloseTo(layer.hole!.center.x);
      expect(Number(rim.getAttribute("cy"))).toBeCloseTo(layer.hole!.center.y);
    }
    const lower = layers.find((layer) => layer.key === "top-left")!;
    const upper = layers.find((layer) => layer.key === "bottom-left")!;
    expect(upper.hole!.center.x).toBeCloseTo(390);
    expect(upper.hole!.center.y).toBeCloseTo(328.3688103937537);
    expect(lower.hole!.center.y).toBeCloseTo(280);
    // 移动层的孔下方仍有完整纸，不能被一个背景色椭圆全部擦掉。
    expect(covers(upper, upper.hole!.center)).toBe(false);
    expect(covers(lower, upper.hole!.center)).toBe(true);
    expect(covers(lower, lower.hole!.center)).toBe(false);
  });

  it("uses no mask ids that could collide between live stages and thumbnails", () => {
    const definition = scene("32"), initial = definition.create();
    const folded = { ...initial, phase: 0.8, flags: { ...initial.flags, cut: true } };
    const container = document.createElement("div");
    container.innerHTML = `<svg>${renderToStaticMarkup(definition.draw(folded, api))}</svg><svg>${renderToStaticMarkup(definition.draw(folded, api))}</svg>`;
    expect(container.querySelectorAll("[data-paper-layer]")).toHaveLength(8);
    expect(container.querySelectorAll("[id], mask, clipPath, defs")).toHaveLength(0);
  });

  it("preserves actual perforation area through projections and edge-on frames", () => {
    for (const progress of [0, 0.2, 0.25, 0.5, 0.75, 0.8, 1]) {
      for (const layer of paperFoldLayers(c, hole, 22, progress, true, true)) {
        const xs = layer.corners.map((corner) => corner.x), ys = layer.corners.map((corner) => corner.y);
        const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
        const ellipse = layer.hole!;
        expect(width * height - Math.PI * ellipse.rx * ellipse.ry).toBeCloseTo((155 * 155 - Math.PI * 22 * 22) * width / 155 * height / 155);
        expect(paperLayerPath(layer)).not.toMatch(/NaN|Infinity/);
        if (ellipse.rx < 1e-8 || ellipse.ry < 1e-8) expect(paperLayerPath(layer)).not.toContain(" A ");
      }
    }
    for (const layer of paperFoldLayers(c, hole, 22, 1, true, true)) {
      expect(layer.hole!.center.x).toBeCloseTo(hole.x);
      expect(layer.hole!.center.y).toBeCloseTo(hole.y);
    }
    expect(paperFoldLayers(c, hole, 22, 1, false, true).filter((layer) => layer.hole)).toHaveLength(2);
    expect(paperFoldLayers(c, hole, 22, 1, true, false).every((layer) => !layer.hole)).toBe(true);
  });

  it.each([
    { angle: 90, normal: { x: 1, y: 0 }, tangent: { x: 0, y: 1 } },
    { angle: -90, normal: { x: 1, y: 0 }, tangent: { x: 0, y: 1 } },
    { angle: 0, normal: { x: 0, y: 1 }, tangent: { x: 1, y: 0 } },
    { angle: 180, normal: { x: 0, y: 1 }, tangent: { x: 1, y: 0 } },
    { angle: 45, normal: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, tangent: { x: Math.SQRT1_2, y: Math.SQRT1_2 } },
  ])("uses only the current fold normal with a $angle degree reflection axis", ({ angle, normal, tangent }) => {
    const definition = scene("22"), state = { ...definition.create(), phase: 0.25, params: { axisAngle: angle } };
    const along = definition.drag!(state, "body", hole, { x: tangent.x * 65, y: tangent.y * 65 });
    const across = definition.drag!(state, "body", hole, { x: normal.x * 65, y: normal.y * 65 });
    expect(along.phase).toBeCloseTo(0.25);
    expect(across.phase).toBeCloseTo(0.5);
    const back = definition.drag!(across, "body", hole, { x: -normal.x * 65, y: -normal.y * 65 });
    expect(back.phase).toBeCloseTo(0.25);
  });

  it("folds vertically first and horizontally second, with reversible normal-only drags", () => {
    const definition = scene("32"), initial = definition.create();
    const first = definition.drag!(initial, "paper", hole, { x: -150, y: 0 });
    expect(first.phase).toBe(0.25);
    expect(definition.drag!(first, "paper", hole, { x: 0, y: -150 }).phase).toBe(0.25);
    const between = definition.drag!(first, "paper", hole, { x: -300, y: 0 });
    expect(between.phase).toBe(0.5);
    const second = definition.drag!(between, "paper", hole, { x: 0, y: -150 });
    expect(second.phase).toBe(0.75);
    expect(definition.drag!(second, "paper", hole, { x: -150, y: 0 }).phase).toBe(0.75);
    expect(definition.drag!(second, "paper", hole, { x: 0, y: 150 }).phase).toBe(0.5);
    expect(definition.drag!(between, "paper", hole, { x: 300, y: 0 }).phase).toBe(0);
    const once = { ...initial, flags: { ...initial.flags, twice: false } };
    expect(definition.drag!(once, "paper", hole, { x: -150, y: 0 }).phase).toBe(0.5);
    expect(definition.drag!(once, "paper", hole, { x: 0, y: -150 }).phase).toBe(0);
  });
});
