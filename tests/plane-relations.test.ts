import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { perpendicularFoot } from "@/features/tools/planar-kit/geometry";
import { constructionArea, constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { addRelationMaterial, copyMidpointTriangle, copyRelationParts, createRelationGeometry, createRelationsState, dragRelation, nestMidpointTriangle, relationModel, setRelationField, setRelationFlag, tapRelation } from "@/features/tools/plane-relations/model";
import { isValidRelationsState } from "@/features/tools/plane-relations/validation";
import { planeRelationsScene } from "@/features/tools/plane-relations/scenes";

const action = (id: string) => [...planeRelationsScene.actions!, ...planeRelationsScene.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
const context = { selected: null };
const valid = (state: ReturnType<typeof createRelationsState>) => expect(isValidRelationsState(state)).toBe(true);
const empty = () => action("construction-remove").run(createRelationsState(), context);
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, operation: null,
  bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };

describe("constructible area relationships", () => {
  it("starts with independent material and no prescribed area conclusion", () => {
    const state = createRelationsState(); valid(state);
    expect(constructionObjects(state)).toHaveLength(1);
    expect(state.flags.measures).toBe(false);
    expect(Object.entries(state.flags).filter(([key]) => /^(height|division|parallel|diagonals|midpoints)\./.test(key)).every(([, value]) => !value)).toBe(true);
    expect(renderToStaticMarkup(planeRelationsScene.draw(state, api))).not.toContain("data-height-mark");
  });

  it("adds user-drawn triangles and convex quadrilaterals without replacing earlier material", () => {
    const start = createRelationsState(), original = constructionObject(start)!;
    const drawn = createRelationGeometry(start, "polygon", [{ x: 100, y: 180 }, { x: 320, y: 240 }, { x: 290, y: 480 }, { x: 80, y: 380 }])!;
    valid(drawn); expect(constructionObjects(drawn)).toHaveLength(2);
    expect(constructionObject(drawn, original.id)).toEqual(original);
    expect(createRelationGeometry(drawn, "polygon", [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 200 }])).toBeNull();
    expect(createRelationGeometry(drawn, "circle", [{ x: 100, y: 100 }, { x: 140, y: 120 }])).toBeNull();
    expect(createRelationGeometry(drawn, "polygon", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 100 }])).toBeNull();
  });

  it("uses the actual selected oblique base and perpendicular height, including extension feet", () => {
    let state = createRelationGeometry(empty(), "polygon", [{ x: 100, y: 100 }, { x: 280, y: 220 }, { x: 340, y: 120 }])!;
    const id = state.params.active;
    state = tapRelation(state, `edge.${id}.0`); valid(state);
    const model = relationModel(state)!, height = model.heights[0], foot = perpendicularFoot(height.vertex, model.a, model.b)!;
    expect((height.vertex.x - foot.x) * (model.b.x - model.a.x) + (height.vertex.y - foot.y) * (model.b.y - model.a.y)).toBeCloseTo(0, 8);
    expect(model.area).toBeCloseTo(model.length * height.amount / 2, 8);
    expect(renderToStaticMarkup(planeRelationsScene.draw(state, api))).toContain('data-right-angle="true"');
    const other = tapRelation(state, `edge.${id}.1`);
    expect(relationModel(other)!.a).toEqual(model.points[1]);
    expect(relationModel(other)!.area).toBeCloseTo(model.area, 8);
  });

  it("moves a base division point by a real edge fraction and preserves shared-height areas", () => {
    let state = setRelationFlag(createRelationsState(), "division", true);
    state = setRelationField(state, "angle", 41);
    state = setRelationField(state, "divisionRatio", 0.27); valid(state);
    const id = state.params.active, model = relationModel(state)!;
    expect(constructionArea(model.parts[0]) / model.area).toBeCloseTo(0.27, 10);
    expect(constructionArea(model.parts[1]) / model.area).toBeCloseTo(0.73, 10);
    const moved = dragRelation(state, `division.${id}`, model.division, { x: (model.b.x - model.a.x) * 0.2, y: (model.b.y - model.a.y) * 0.2 });
    valid(moved); expect(relationModel(moved)!.fraction).toBeCloseTo(0.47, 10);
    const midpoint = action("relations-midpoint").run(moved, context);
    expect(relationModel(midpoint)!.fraction).toBe(0.5);
    relationModel(midpoint)!.parts.forEach((piece) => expect(constructionArea(piece)).toBeCloseTo(model.area / 2, 8));
  });

  it("holds true parallel-line motion even with grid snapping, then releases it for comparison", () => {
    let state = setRelationField(createRelationsState(), "angle", 33);
    state = setRelationField(state, "heightLock", 1);
    state = { ...state, flags: { ...state.flags, edit: true, snap: true } };
    const id = state.params.active, before = relationModel(state)!;
    const moved = dragRelation(state, `vertex.${id}.2`, before.points[2], { x: 80, y: -60 });
    valid(moved); expect(relationModel(moved)!.heights[0].amount).toBeCloseTo(before.heights[0].amount, 8);
    expect(relationModel(moved)!.area).toBeCloseTo(before.area, 8);
    expect(setRelationField(moved, "height", 550)).toBe(moved);
    const unlocked = setRelationField(state, "heightLock", 0);
    const free = dragRelation(unlocked, `vertex.${id}.2`, before.points[2], { x: 80, y: -60 });
    valid(free); expect(relationModel(free)!.heights[0].amount).not.toBeCloseTo(before.heights[0].amount, 3);
  });

  it("partitions a real convex quadrilateral along both diagonals and rejects concave vertex edits", () => {
    let state = addRelationMaterial(empty(), "quadrilateral");
    state = setRelationFlag(state, "diagonals", true); valid(state);
    const model = relationModel(state)!;
    expect(model.parts).toHaveLength(4);
    expect(model.parts.reduce((sum, piece) => sum + constructionArea(piece), 0)).toBeCloseTo(model.area, 8);
    state = { ...state, flags: { ...state.flags, edit: true } };
    const point = model.points[1], toward = { x: model.object.center.x - point.x - 50, y: model.object.center.y - point.y };
    expect(dragRelation(state, `vertex.${state.params.active}.1`, point, toward)).toBe(state);
    expect(setRelationField(state, "heightLock", 1)).toBe(state);
  });

  it("copies a midpoint triangle as independent exact paper, keeping source observations", () => {
    let state = setRelationFlag(createRelationsState(), "midpoints", true);
    const originalId = state.params.active, originalArea = relationModel(state)!.area;
    state = copyMidpointTriangle(state); valid(state);
    const copyId = state.params.active, copy = constructionObject(state)!;
    expect(copyId).not.toBe(originalId);
    expect(constructionArea(copy.vertices)).toBeCloseTo(originalArea / 4, 8);
    expect(state.flags[`midpoints.${originalId}`]).toBe(true);
    expect(state.flags[`midpoints.${copyId}`]).toBe(false);
    state = { ...state, flags: { ...state.flags, edit: true } };
    const moved = dragRelation(state, `vertex.${originalId}.2`, { x: 0, y: 0 }, { x: 100, y: -20 }); valid(moved);
    expect(constructionObject(moved, copyId)).toEqual(copy);
    expect(relationModel(moved, originalId)!.area).not.toBeCloseTo(originalArea);
  });

  it("copies true triangle partitions with exact area ratios even when the material is rotated and grid snap is enabled", () => {
    let state = setRelationField(setRelationField(setRelationFlag(createRelationsState(), "division", true), "divisionRatio", 0.31), "angle", 33);
    state = { ...state, flags: { ...state.flags, snap: true } };
    const before = structuredClone(state), model = relationModel(state)!, id = state.params.active;
    const copied = copyRelationParts(state), pieces = constructionObjects(copied).filter((object) => object.id !== id);
    valid(copied); expect(pieces).toHaveLength(2); expect(copied.flags.snap).toBe(true);
    expect(constructionObject(copied, id)).toEqual(model.object);
    expect(copied.flags[`division.${id}`]).toBe(true); expect(copied.params[`fraction.${id}`]).toBe(0.31);
    pieces.forEach((piece, index) => {
      expect(constructionArea(piece.vertices)).toBeCloseTo(constructionArea(model.parts[index]), 7);
      worldVertices(piece).forEach((point, vertex) => {
        expect(point.x).toBeCloseTo(model.parts[index][vertex].x + 65, 8);
        expect(point.y).toBeCloseTo(model.parts[index][vertex].y + 65, 8);
      });
    });
    expect(pieces.reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(model.area, 7);
    const moved = dragRelation(copied, `object.${pieces[0].id}`, pieces[0].center, { x: -30, y: 60 }); valid(moved);
    expect(constructionObject(moved, id)).toEqual(model.object); expect(constructionObject(moved, pieces[1].id)).toEqual(pieces[1]);
    expect(state).toEqual(before);
  });

  it("copies all four diagonal pieces atomically and keeps the original intact when capacity or IDs run out", () => {
    let state = setRelationFlag(addRelationMaterial(empty(), "quadrilateral"), "diagonals", true);
    const sourceId = state.params.active, model = relationModel(state)!, copied = copyRelationParts(state);
    valid(copied); expect(constructionObjects(copied)).toHaveLength(5);
    expect(constructionObjects(copied).filter((object) => object.id !== sourceId).reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(model.area, 7);
    for (let i = 0; i < 12; i++) state = addRelationMaterial(state, "triangle");
    state = tapRelation(state, `object.${sourceId}`);
    expect(constructionObjects(state)).toHaveLength(13); const saved = structuredClone(state);
    expect(copyRelationParts(state)).toBe(state); expect(state).toEqual(saved);
    expect(action("relations-copy-parts").disabled!(state, context)).toBe(true);
    const exhausted = { ...setRelationFlag(createRelationsState(), "division", true), params: { ...createRelationsState().params, nextId: 99998 } };
    valid(exhausted); expect(copyRelationParts(exhausted)).toBe(exhausted);
    expect(copyRelationParts(createRelationsState())).toEqual(createRelationsState());
  });

  it("adds repeated exact midpoint layers in place and keeps each material independent", () => {
    let state = setRelationField(createRelationsState(), "angle", 27);
    state = { ...state, flags: { ...state.flags, snap: true } };
    for (let depth = 0; depth < 5; depth++) {
      const model = relationModel(state)!, parents = constructionObjects(state), nested = nestMidpointTriangle(state);
      valid(nested); expect(nested.flags.snap).toBe(true);
      expect(constructionObjects(nested)).toHaveLength(parents.length + 1);
      const child = constructionObject(nested)!;
      expect(constructionArea(child.vertices)).toBeCloseTo(model.area / 4, 7);
      worldVertices(child).forEach((point, index) => {
        expect(point.x).toBeCloseTo(model.inner[index].x, 8); expect(point.y).toBeCloseTo(model.inner[index].y, 8);
      });
      parents.forEach((parent) => expect(constructionObject(nested, parent.id)).toEqual(parent));
      state = nested;
    }
    const childId = state.params.active, parents = constructionObjects(state).filter((object) => object.id !== childId);
    const moved = dragRelation(state, `object.${childId}`, constructionObject(state)!.center, { x: 60, y: 30 }); valid(moved);
    parents.forEach((parent) => expect(constructionObject(moved, parent.id)).toEqual(parent));
    expect(planeRelationsScene.selectionAfterChange!(state, nestMidpointTriangle(state), `object.${childId}`)).toBe(`object.${state.params.nextId}`);
  });

  it("keeps midpoint copying exact under snap and stops nesting at valid geometry or material limits", () => {
    let state = setRelationFlag(setRelationField(createRelationsState(), "angle", 31), "midpoints", true);
    state = { ...state, flags: { ...state.flags, snap: true } };
    expect(relationModel(copyMidpointTriangle(state))!.area).toBeCloseTo(relationModel(state)!.area / 4, 7);
    for (let i = 0; i < 24; i++) { const next = nestMidpointTriangle(state); valid(next); if (next === state) break; state = next; }
    expect(nestMidpointTriangle(state)).toBe(state); expect(action("relations-nest-midpoints").disabled!(state, context)).toBe(true);
    expect(constructionObjects(state).length).toBeLessThanOrEqual(16);
    const quad = addRelationMaterial(empty(), "quadrilateral"); expect(nestMidpointTriangle(quad)).toBe(quad);
  });

  it("duplicates observation parameters independently and removes only the deleted owner's metadata", () => {
    let state = setRelationFlag(createRelationsState(), "division", true);
    state = setRelationField(state, "divisionRatio", 0.31);
    const source = state.params.active;
    state = action("construction-duplicate").run(state, context); valid(state);
    const copy = state.params.active;
    expect(state.params[`fraction.${copy}`]).toBe(0.31);
    state = setRelationField(state, "divisionRatio", 0.7);
    expect(state.params[`fraction.${source}`]).toBe(0.31);
    state = action("construction-remove").run(state, context); valid(state);
    expect(state.params[`fraction.${copy}`]).toBeUndefined();
    expect(state.flags[`division.${copy}`]).toBeUndefined();
    expect(state.flags[`division.${source}`]).toBe(true);
  });

  it("preserves legal rigid intermediate frames and serializes only exact source material", () => {
    const start = setRelationFlag(createRelationsState(), "division", true), rotate = action("construction-rotate");
    const end = rotate.run(start, context); valid(end);
    for (const progress of [0.1, 0.5, 0.9]) {
      const frame = rotate.interpolate!(start, end, progress); valid(frame);
      expect(relationModel(frame)!.area).toBeCloseTo(relationModel(start)!.area, 7);
    }
    const restored = JSON.parse(JSON.stringify(end)); valid(restored);
    expect(worldVertices(constructionObject(restored)!)).toEqual(worldVertices(constructionObject(end)!));
    expect(Object.keys(end.params).some((key) => key.startsWith("area"))).toBe(false);
  });

  it("rejects stale references, unsupported flags, malformed metadata and unknown fields", () => {
    const start = createRelationsState(), id = start.params.active;
    const invalid = [
      { ...start, params: { ...start.params, "base.999": 0, "fraction.999": 0.5 } },
      { ...start, params: { ...start.params, [`base.${id}`]: 3 } },
      { ...start, params: { ...start.params, [`fraction.${id}`]: NaN } },
      { ...start, flags: { ...start.flags, [`diagonals.${id}`]: true } },
      { ...start, flags: { ...start.flags, unsupported: true } },
      { ...start, points: { ...start.points, auxiliary: { x: 10, y: 20 } } },
    ];
    invalid.forEach((state) => expect(isValidRelationsState(state)).toBe(false));
    const missing = structuredClone(start); delete missing.flags[`parallel.${id}`]; expect(isValidRelationsState(missing)).toBe(false);
  });

  it("keeps bounded objects and reuses declared context actions without persistent helper handles", () => {
    let state = createRelationsState();
    for (let i = 0; i < 20; i++) state = addRelationMaterial(state, "triangle");
    valid(state); expect(constructionObjects(state)).toHaveLength(16);
    const id = state.params.active, definition = planeRelationsScene.contextActions!(state, `object.${id}`)!;
    const ids = new Set([...planeRelationsScene.actions!.map((entry) => entry.id), ...planeRelationsScene.operations!.map((entry) => entry.id)]);
    expect(definition.items.every((entry) => ids.has(entry.id))).toBe(true);
    expect(planeRelationsScene.contextActions!(state, null)).toBeNull();
    state = setRelationFlag(state, "division", true);
    const targets: string[] = [], drawApi = { ...api, selected: `object.${id}`, bind: (target: string) => { targets.push(target); return api.bind(target); } };
    planeRelationsScene.draw(state, drawApi); expect(targets).not.toContain(`division.${id}`);
    planeRelationsScene.draw(state, { ...drawApi, operation: "relations" }); expect(targets).toContain(`division.${id}`);
  });
});
