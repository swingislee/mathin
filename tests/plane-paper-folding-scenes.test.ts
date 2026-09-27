// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarSnapshot, PlanarState } from "../src/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory, planarPause } from "../src/features/tools/planar-kit/presentation";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { constructPaper, createPaperFoldingState, paperPointRemains, setPaperField } from "../src/features/tools/plane-paper-folding/model";
import { planePaperFoldingScene as scene } from "../src/features/tools/plane-paper-folding/scenes";
import { isValidPaperFoldingState } from "../src/features/tools/plane-paper-folding/validation";

const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
function draw(state: PlanarState, extras: Partial<PlanarDrawingApi> = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.innerHTML = renderToStaticMarkup(scene.draw(state, { ...api, ...extras }));
  expect(svg.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
  return svg;
}
function prepared() {
  return setPaperField(constructPaper(createPaperFoldingState(), "crease", [{ x: 480, y: 190 }, { x: 480, y: 550 }])!, "side", -1);
}
function cutPaper() {
  return constructPaper({ ...prepared(), phase: 1 }, "cut-circle", [{ x: 590, y: 300 }, { x: 615, y: 300 }])!;
}
const snapshot = (state: PlanarState): PlanarSnapshot => ({ current: state, past: [], future: [], motion: null });
const action = (id: string) => scene.actions!.find((entry) => entry.id === id)!;

describe("open fold-and-cut teaching scene", () => {
  it("does not add labels or editing handles on ordinary selection", () => {
    const initial = createPaperFoldingState();
    expect(draw(initial, { selected: "paper-fixed" }).querySelectorAll("text,[data-paper-handle]")).toHaveLength(0);
    const edited = action("paper-edit").run(initial, { selected: "paper-fixed" });
    expect(draw(edited).querySelectorAll("[data-paper-handle]")).toHaveLength(0);
    expect(draw(edited, { selected: "paper-fixed" }).querySelectorAll("[data-paper-handle]")).toHaveLength(4);
    expect(draw(prepared(), { operation: "fold" }).querySelectorAll("[data-paper-handle]")).toHaveLength(2);
    expect(draw(prepared()).querySelectorAll("[data-paper-handle]")).toHaveLength(0);
    expect(draw(prepared()).querySelectorAll("[data-paper-crease]")).toHaveLength(1);
    const hidden = { ...prepared(), flags: { ...prepared().flags, crease: false } };
    expect(draw(hidden).querySelectorAll("[data-paper-crease]")).toHaveLength(0);
    expect(draw(hidden, { operation: "fold" }).querySelectorAll("[data-paper-crease]")).toHaveLength(1);
  });

  it("subtracts every cut from its own real layer without painting over lower paper", () => {
    const state = { ...cutPaper(), phase: 0.8 }, svg = draw(state);
    const fixedMask = svg.querySelector('mask[id$="-holes-false"]')!;
    const movingMask = svg.querySelector('mask[id$="-holes-true"]')!;
    expect(fixedMask.querySelector("circle")?.getAttribute("cx")).toBe("590");
    expect(movingMask.querySelector("circle")?.getAttribute("cx")).toBe("370");
    for (const mask of [fixedMask, movingMask]) {
      expect(mask.querySelector("circle")?.getAttribute("fill")).toBe("black");
      expect(mask.querySelector("rect")?.getAttribute("fill")).toBe("white");
    }
    expect(svg.querySelectorAll('[data-paper-layer] circle[fill="var(--paper)"]')).toHaveLength(0);
    for (const layer of Array.from(svg.querySelectorAll("[data-paper-layer]"))) {
      expect(layer.querySelector("[mask] [fill='none'][stroke='var(--ink)']")).not.toBeNull();
    }
    // Moving hole and stationary hole differ mid-fold. The fixed material below
    // the moving hole remains real paper instead of being erased to background.
    expect(paperPointRemains(state, { x: 520, y: 300 })).toBe(true);
    expect(paperPointRemains(state, { x: 590, y: 300 })).toBe(false);
    expect(paperPointRemains(state, { x: 370, y: 300 })).toBe(false);
  });

  it("isolates mask and clip IDs across simultaneous stages and thumbnails", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = renderToStaticMarkup(createElement(Fragment, null, scene.draw(cutPaper(), api), scene.draw(cutPaper(), api), scene.draw(prepared(), api)));
    const ids = Array.from(svg.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const element of Array.from(svg.querySelectorAll("[mask],[clip-path]"))) {
      for (const name of ["mask", "clip-path"]) {
        const value = element.getAttribute(name);
        if (value) expect(ids).toContain(value.slice(5, -1));
      }
    }
  });

  it("shares exact phase geometry for dragging, accurate angle and reversible animation", () => {
    const from = prepared(), fold = action("paper-fold"), to = fold.run(from, { selected: null });
    const transforms: string[] = [];
    for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = fold.interpolate!(from, to, phase);
      expect(frame).toEqual(setPaperField(from, "foldAngle", phase * 180));
      expect(isValidPaperFoldingState(frame)).toBe(true);
      transforms.push(draw(frame).querySelector('[data-paper-layer="moving"]')!.getAttribute("transform")!);
    }
    expect(new Set(transforms).size).toBe(5);
    const reverse = action("paper-unfold");
    expect(reverse.interpolate!(to, from, 0.35).phase).toBeCloseTo(0.65);
    expect(reverse.interpolate!(to, from, 1)).toEqual(from);
  });

  it("preserves pause time, late-join frames and exact cut geometry through replay and undo", () => {
    const from = cutPaper(), to = action("paper-unfold").run(from, { selected: null });
    let snap = planarCommit(snapshot(from), from, to, { id: "paper-unfold", duration: 1800, now: 1000 });
    expect(planarFrame(snap, scene, 1450).phase).toBeCloseTo(0.75);
    const echoed = JSON.parse(JSON.stringify(snap)) as PlanarSnapshot;
    expect(planarFrame(echoed, scene, 1450)).toEqual(planarFrame(snap, scene, 1450));
    snap = planarPause(snap, 1450, true);
    expect(planarFrame(snap, scene, 99000)).toEqual(planarFrame(snap, scene, 1450));
    const pausedFrame = planarFrame(snap, scene, 1450);
    expect(isValidPaperFoldingState(pausedFrame)).toBe(true);
    expect(isValidPaperFoldingState(snap.current)).toBe(true);
    snap = planarPause(snap, 10000, false);
    expect(planarFrame(snap, scene, 11350)).toEqual(to);
    expect(planarHistory(snap, "undo").current).toEqual(from);
    const redo = planarHistory(planarHistory(snap, "undo"), "redo");
    expect(redo.current).toEqual(to);
    expect(redo.current.points["cut.0.0"]).toEqual({ x: 590, y: 300 });
    const cleared = action("paper-remove-cuts").run(to, { selected: null });
    expect(planarHistory(planarCommit(redo, to, cleared), "undo").current).toEqual(to);
  });

  it("limits drawing to the supported paper stage and requires explicit cut removal before replacement", () => {
    const initial = createPaperFoldingState(), tools = scene.construction!.tools;
    expect(tools.find((entry) => entry.id === "crease")?.once).toBe(true);
    for (const id of ["cut-circle", "cut-polygon"]) {
      const tool = tools.find((entry) => entry.id === id)!;
      expect(tool.once).toBe(true);
      expect(tool.disabled!(initial)).toBe(true);
      expect(tool.disabled!({ ...prepared(), phase: 1 })).toBe(false);
    }
    const unfoldedCut = { ...cutPaper(), phase: 0 };
    expect(tools.find((entry) => entry.id === "paper-rectangle")!.disabled!(unfoldedCut)).toBe(true);
    const clear = action("paper-remove-cuts").run(unfoldedCut, { selected: null });
    expect(clear.points.creaseA).toEqual(unfoldedCut.points.creaseA);
    expect(tools.find((entry) => entry.id === "paper-rectangle")!.disabled!(clear)).toBe(false);
    const replaced = scene.construction!.create(clear, "paper-rectangle", [{ x: 100, y: 100 }, { x: 300, y: 240 }])!;
    expect(replaced.params.creaseSet).toBe(0);
    expect(replaced.params.cutCount).toBe(0);
    expect(isValidPaperFoldingState(replaced)).toBe(true);
  });

  it("reports original paper area in shared 40-pixel units and hides it once material was cut", () => {
    const measured = { ...prepared(), flags: { ...prepared().flags, measures: true } };
    expect(draw(measured).textContent).toContain("104.5 u²");
    expect(draw({ ...measured, phase: 0.5 }).textContent).toContain("104.5 u²");
    expect(draw({ ...cutPaper(), flags: measured.flags }).textContent).not.toContain("u²");
    for (const field of scene.operations![0].fields!) expect(Number.isFinite(field.read!(measured))).toBe(true);
  });
});
