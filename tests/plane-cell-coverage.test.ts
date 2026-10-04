import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { PlanarPoint, PlanarState } from "@/features/tools/planar-kit/contract";
import { constructionArea, constructionObject, constructionObjects } from "@/features/tools/plane-construction/model";
import { relationFlag } from "@/features/tools/plane-relations/model";
import { toggleInterior } from "@/features/tools/plane-relations/interior-model";
import { convexRegions } from "@/features/tools/plane-relations/geometry";
import { applyStripsBase, squareStripModel } from "@/features/tools/plane-relations/strips-model";
import { planeStripsScene } from "@/features/tools/plane-relations/strips-scene";
import { isValidStripsState } from "@/features/tools/plane-relations/strips-validation";
import { applyCoverageBase, cellCoverageModel, createCoverageState, refineCoverCells, setCoverCount, toggleCoverCells } from "@/features/tools/plane-relations/coverage-model";
import { coverageBaseState, isValidCoverageState } from "@/features/tools/plane-relations/coverage-validation";
import { CellCoverageOverlay, planeCoverageScene } from "@/features/tools/plane-relations/coverage-scene";
import { planeCellCoverageCases } from "./fixtures/plane-cell-coverage-cases";

const prepared = () => toggleCoverCells(setCoverCount(createCoverageState(), 8));
const valid = (state: PlanarState) => expect(isValidCoverageState(state)).toBe(true);
const actions = [...planeCoverageScene.actions ?? [], ...planeCoverageScene.operations!.flatMap((operation) => operation.actions ?? [])];
const run = (id: string, state: PlanarState) => actions.find((action) => action.id === id)!.run(state, { selected: `object.${state.params.active}` });
const field = (state: PlanarState, key: string, value: number) => planeCoverageScene.setField!(state, key, value);
function triangle(points: PlanarPoint[], divisions = 8): PlanarState {
  const state = setCoverCount(prepared(), divisions), id = state.params.active;
  return { ...state, points: { ...state.points, ...Object.fromEntries(points.map((point, i) => [`vertex.${id}.${i}`, point])) } };
}
function expectBounds(state: PlanarState) {
  valid(state);
  const model = cellCoverageModel(state)!;
  expect(model.innerArea).toBeLessThanOrEqual(model.area + 1e-8);
  expect(model.outerArea).toBeGreaterThanOrEqual(model.area - 1e-8);
  expect(model.cells.reduce((sum, cell) => sum + cell.intersectionArea, 0)).toBeCloseTo(model.area, 7);
  expect(model.scannedCount).toBeLessThanOrEqual(model.divisions ** 2);
  expect(model.columns).toBeLessThanOrEqual(48); expect(model.rows).toBeLessThanOrEqual(48);
  expect(model.cells.filter((cell) => cell.intersectionArea <= 0), JSON.stringify({ base: state.params[`base.${state.params.active}`], points: constructionObject(state)?.vertices, density: model.divisions })).toEqual([]);
  return model;
}

describe("full and boundary square coverage of actual triangles", () => {
  it("excludes pure edge and point contacts, and exactly counts a grid-aligned right triangle", () => {
    for (const divisions of [4, 8, 16, 32, 48]) {
      const model = expectBounds(triangle([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }], divisions));
      expect(model.fullCount).toBe(divisions * (divisions - 1) / 2);
      expect(model.boundaryCount).toBe(divisions);
      expect(model.cells.some((cell) => cell.column + cell.row >= divisions)).toBe(false);
      expect(model.cells.filter((cell) => cell.column + cell.row === divisions - 1).every((cell) => cell.kind === "boundary")).toBe(true);
      expect(model.cells.filter((cell) => cell.kind === "full").every((cell) => cell.column + cell.row < divisions - 1)).toBe(true);
    }
  });

  it("retains a genuine boundary sliver far below the old absolute geometry tolerance", () => {
    const state = triangle([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0.00001, y: 400 }], 4), model = expectBounds(state);
    const sliver = model.cells.find((cell) => cell.column === 3 && cell.row === 1)!;
    expect(sliver.kind).toBe("boundary"); expect(sliver.intersectionArea).toBeGreaterThan(0);
    expect(sliver.intersectionArea).toBeLessThan(1e-7);
    expect(model.boundaryCount).toBeGreaterThan(4);
  });

  it("uses genuine square clipping for acute, obtuse, clockwise and counterclockwise triangles", () => {
    const shapes = [
      [{ x: -200, y: 120 }, { x: 200, y: 120 }, { x: -50, y: -130 }],
      [{ x: -200, y: 120 }, { x: 200, y: 120 }, { x: 650, y: -70 }],
      [{ x: -200, y: 120 }, { x: 200, y: 120 }, { x: -650, y: -70 }],
    ];
    for (const points of shapes) for (const reversed of [false, true]) for (const angle of [0, 37, -131]) for (const flip of [1, -1]) for (const edge of [0, 1, 2]) {
      const seed = triangle(reversed ? [...points].reverse() : points), id = seed.params.active;
      const state = { ...seed, params: { ...seed.params, [`angle.${id}`]: angle, [`flip.${id}`]: flip, [`base.${id}`]: edge } };
      const model = expectBounds(state);
      for (const cell of model.cells) {
        const [a, b, c, d] = cell.points, width = { x: b.x - a.x, y: b.y - a.y }, height = { x: d.x - a.x, y: d.y - a.y };
        expect(Math.hypot(width.x, width.y)).toBeCloseTo(model.size, 8); expect(Math.hypot(height.x, height.y)).toBeCloseTo(model.size, 8);
        expect(width.x * height.x + width.y * height.y).toBeCloseTo(0, 7);
        expect(c.x).toBeCloseTo(b.x + height.x, 8); expect(c.y).toBeCloseTo(b.y + height.y, 8);
        const clipped = constructionArea(convexRegions(cell.points, model.points).intersection);
        expect(clipped).toBeCloseTo(cell.intersectionArea, 7);
        if (cell.kind === "full") expect(clipped).toBeCloseTo(model.size ** 2, 7);
        else expect(clipped).toBeLessThan(model.size ** 2 + 1e-7);
      }
    }
  });

  it("keeps classifications through rotation, reflection and translation", () => {
    const seed = triangle([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }], 16), before = cellCoverageModel(seed)!;
    for (const angle of [0, 19, 77, 181, -131]) for (const flip of [1, -1]) {
      const state = field({ ...seed, params: { ...seed.params, [`flip.${seed.params.active}`]: flip } }, "angle", angle);
      const moved = planeCoverageScene.drag!(state, `object.${seed.params.active}`, { x: 0, y: 0 }, { x: -500, y: 97 });
      const after = expectBounds(moved);
      expect(after.cells.map(({ row, column, kind }) => ({ row, column, kind }))).toEqual(before.cells.map(({ row, column, kind }) => ({ row, column, kind })));
      expect(after.innerArea).toBe(before.innerArea); expect(after.outerArea).toBe(before.outerArea);
    }
  });

  it("retains area bounds for fractional custom geometry at the maximum density", () => {
    for (let sample = 1; sample <= 30; sample++) {
      const points = [{ x: -180.25 - sample / 7, y: 85.75 }, { x: 230.5, y: 90.125 + sample / 11 },
        { x: Math.sin(sample * 1.37) * 610, y: -23.5 - sample * 6.123 }];
      const seed = triangle(points, 48);
      for (const edge of [0, 1, 2]) expectBounds({ ...seed, params: { ...seed.params, [`base.${seed.params.active}`]: edge } });
    }
  });

  it("bounds scans by the true projection extent, including extreme obtuse overhangs", () => {
    const seed = triangle([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 799, y: 3 }], 48);
    for (const edge of [0, 1, 2]) {
      const model = expectBounds({ ...seed, params: { ...seed.params, [`base.${seed.params.active}`]: edge } });
      expect(model.scannedCount).toBeLessThanOrEqual(48 * 48); expect(model.fullCount).toBe(0);
    }
    const model = cellCoverageModel(seed)!;
    expect(model.size).toBeCloseTo(799 / 48, 12); expect(model.columns).toBe(48); expect(model.rows).toBe(1);
    expect(model.size).toBeGreaterThan(squareStripModel(coverageBaseState(seed))!.size);
  });

  it("keeps nested refinements monotone while every arbitrary density retains the bounds", () => {
    const seed = triangle([{ x: -200, y: 120 }, { x: 200, y: 120 }, { x: 550, y: -150 }], 4);
    let state = seed, inner = 0, outer = Infinity;
    for (const divisions of [4, 8, 16, 32]) {
      const model = expectBounds(state); expect(model.divisions).toBe(divisions);
      expect(model.innerArea).toBeGreaterThanOrEqual(inner - 1e-8); expect(model.outerArea).toBeLessThanOrEqual(outer + 1e-8);
      inner = model.innerArea; outer = model.outerArea; state = refineCoverCells(state);
    }
    expect(cellCoverageModel(state)!.divisions).toBe(48); expectBounds(state); expect(refineCoverCells(state)).toBe(state);
    for (const divisions of [5, 7, 13, 23, 31, 47]) expectBounds(setCoverCount(seed, divisions));
  });

  it("preserves metadata for inherited actions and creates independent settings for new materials", () => {
    const plain = prepared(), interior = applyCoverageBase(plain, (base) => applyStripsBase(base, toggleInterior));
    for (const command of ["relations-midpoint", "relations-midpoints", "relations-nest-midpoints", "relations-copy-nested-angle", "relations-copy-hourglass", "relations-split-common", "relations-separate-common", "relations-keep-wings", "construction-rotate", "construction-translate", "relations-scale-half", "relations-refine-strips"]) {
      const action = actions.find((entry) => entry.id === command)!, source = command.includes("common") || command.includes("wings") ? interior : plain;
      const result = action.run(source, { selected: `object.${source.params.active}` }); valid(result); expect(result).not.toEqual(source);
      for (const object of constructionObjects(result)) {
        const existing = constructionObject(source, object.id);
        expect(result.params[`coverCount.${object.id}`]).toBe(existing ? source.params[`coverCount.${object.id}`] : 16);
        expect(relationFlag(result, "coverCells", object.id)).toBe(existing ? relationFlag(source, "coverCells", object.id) : false);
      }
      if (!constructionObject(result, source.params.active)) expect(result.params[`coverCount.${source.params.active}`]).toBeUndefined();
      if (action.interpolate) for (const progress of [0, 0.2, 0.5, 1]) valid(action.interpolate(source, result, progress));
    }
    const duplicate = run("construction-duplicate", plain); valid(duplicate);
    expect(duplicate.params[`coverCount.${duplicate.params.active}`]).toBe(8); expect(relationFlag(duplicate, "coverCells")).toBe(true);
    const removed = run("construction-remove", duplicate); valid(removed);
    expect(removed.params[`coverCount.${duplicate.params.active}`]).toBeUndefined(); expect(removed.flags[`coverCells.${duplicate.params.active}`]).toBeUndefined();
    const added = planeCoverageScene.materials!.find((material) => material.id === "relations-triangle")!.add(removed); valid(added);
    expect(added.params[`coverCount.${added.params.active}`]).toBe(16); expect(relationFlag(added, "coverCells")).toBe(false);
    expect(setCoverCount(added, 48).params[`coverCount.${plain.params.active}`]).toBe(8);
    expect(planeCoverageScene.operations!.map((operation) => operation.id)).toEqual(["relations-cell-coverage", ...planeStripsScene.operations!.map((operation) => operation.id)]);
  });

  it("retains inherited constrained drags and independent strip settings", () => {
    const source = run("relations-square-strips", prepared()), selected = source.params.active;
    const locked = field(field(source, "heightLock", 1), "angle", 37), before = cellCoverageModel(locked)!;
    const moved = planeCoverageScene.drag!(locked, `vertex.${selected}.2`, before.heights[0].vertex, { x: before.u.x * 150, y: before.u.y * 150 });
    const after = expectBounds(moved); expect(after.area).toBeCloseTo(before.area, 7);
    expect(moved.params[`coverCount.${selected}`]).toBe(8); expect(relationFlag(moved, "coverCells")).toBe(true);
    expect(relationFlag(moved, "strips")).toBe(true); expect(moved.params[`stripCount.${selected}`]).toBe(16);
    expect(field(moved, "stripDivisions", 4).params[`coverCount.${selected}`]).toBe(8);
    expect(field(moved, "coverDivisions", 48).params[`stripCount.${selected}`]).toBe(16);
    const beforeBase = constructionObject(moved), rebased = planeCoverageScene.tap!(moved, `edge.${selected}.1`);
    valid(rebased); expect(constructionObject(rebased)).toEqual(beforeBase); expectBounds(rebased);
  });

  it("fits 16 materials within the existing key budget and atomically refuses a seventeenth", () => {
    const state = planeCellCoverageCases().find((entry) => entry.label === "capacity")!.scene.payload.initial;
    valid(state); expect(constructionObjects(state)).toHaveLength(16);
    expect(Object.keys(state.params)).toHaveLength(230); expect(Object.keys(state.flags)).toHaveLength(153);
    const saved = JSON.stringify(state);
    expect(run("construction-duplicate", state)).toBe(state); expect(run("relations-copy-hourglass", state)).toBe(state);
    expect(planeCoverageScene.materials![0].add(state)).toBe(state); expect(JSON.stringify(state)).toBe(saved);
    const exhausted = { ...prepared(), params: { ...prepared().params, nextId: 99999 } }; valid(exhausted);
    expect(run("construction-duplicate", exhausted)).toBe(exhausted);
  });

  it("rejects unsupported materials, empty selection and malformed density without mutation", () => {
    const initial = createCoverageState(), quad = planeCoverageScene.materials!.find((material) => material.id === "relations-quadrilateral")!.add(initial);
    for (const state of [quad, { ...quad, params: { ...quad.params, active: -1 } }]) {
      valid(state); expect(cellCoverageModel(state)).toBeNull(); expect(toggleCoverCells(state)).toBe(state); expect(refineCoverCells(state)).toBe(state);
    }
    for (const value of [NaN, Infinity, -1, 3, 4.5, 49]) expect(setCoverCount(initial, value)).toBe(initial);
    expect(isValidStripsState(initial)).toBe(false); expect(isValidStripsState(coverageBaseState(initial))).toBe(true);
  });

  it("keeps observation without a panel, shows numbers only with measurements, and batches SVG cells", () => {
    const state = prepared(), api = { locale: "en", selected: `object.${state.params.active}`, editable: false, operation: null,
      bind: () => ({ role: "button" as const, tabIndex: 0, "aria-label": "", "aria-pressed": false, "aria-disabled": false }) };
    const hidden = renderToStaticMarkup(createElement(CellCoverageOverlay, { state: createCoverageState(), api }));
    expect(hidden).not.toContain("data-cell-coverage-object");
    const observed = renderToStaticMarkup(createElement(CellCoverageOverlay, { state, api }));
    expect(observed).toContain("data-cell-coverage-object"); expect(observed).not.toContain("data-cell-coverage-measures");
    expect(observed).not.toContain('role="button"'); expect(observed).toContain('pointer-events="none"');
    const measured = renderToStaticMarkup(createElement(CellCoverageOverlay, { state: { ...state, flags: { ...state.flags, measures: true } }, api }));
    expect(measured).toContain("data-cell-coverage-measures"); expect(measured).toContain("Inner cover"); expect(measured).toContain("Outer cover");
    expect(measured.match(/data-cell-coverage-kind=/g)).toHaveLength(2);
    const operating = renderToStaticMarkup(createElement(CellCoverageOverlay, { state, api: { ...api, operation: "relations-cell-coverage" } }));
    expect(operating).toContain("Touching alone does not count"); expect(operating).not.toContain("S△");
  });

  it.each(planeCellCoverageCases())("strict v5 state fixture: $label", ({ scene, accepted }: ReturnType<typeof planeCellCoverageCases>[number]) => {
    expect(isValidCoverageState(scene.payload.initial)).toBe(accepted || scene.contentVersion !== "plane-area-relations-lesson-v5");
  });
});
