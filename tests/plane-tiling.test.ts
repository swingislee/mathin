import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addConstruction, constructionObject, constructionObjects, removeConstruction, setConstructionField, worldVertices } from "@/features/tools/plane-construction/model";
import { addRegularTile, createTilingState, isValidTilingState, moveTile, snapTile } from "@/features/tools/plane-tiling/model";
import { planeTilingScene } from "@/features/tools/plane-tiling/scenes";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";

describe("independently constructed tiling materials", () => {
  it("mixes templates while preserving each existing tile", () => {
    let state = createTilingState();
    expect(isValidTilingState(state)).toBe(true);
    for (const sides of [4, 5, 6, 8]) {
      const before = constructionObjects(state);
      state = addRegularTile(state, sides);
      expect(isValidTilingState(state)).toBe(true);
      expect(constructionObjects(state).slice(0, before.length)).toEqual(before);
      const vertices = worldVertices(constructionObject(state)!);
      expect(vertices).toHaveLength(sides);
      for (let i = 0; i < sides; i++) expect(Math.hypot(vertices[i].x - vertices[(i + 1) % sides].x, vertices[i].y - vertices[(i + 1) % sides].y)).toBeCloseTo(100);
    }
  });
  it("supports a custom concave tile and edits it without replacing other materials", () => {
    const start = createTilingState(), original = constructionObjects(start);
    const points = [{ x: 180, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 240 }, { x: 220, y: 240 }, { x: 220, y: 320 }, { x: 180, y: 320 }];
    const custom = planeTilingScene.construction!.create(start, "polygon", points)!;
    expect(isValidTilingState(custom)).toBe(true);
    const changed = setConstructionField(custom, "width", 170);
    expect(isValidTilingState(changed)).toBe(true);
    expect(constructionObjects(changed).slice(0, 1)).toEqual(original);
  });
  it("moves continuously then snaps only the complete tile on release", () => {
    let state = removeConstruction(createTilingState());
    state = addConstruction(state, "rectangle", [{ x: 240, y: 240 }, { x: 340, y: 340 }]);
    // Drawing uses raw coordinates in the scene; disable construction's grid snapping for this fixture.
    state = { ...state, flags: { ...state.flags, snap: false } };
    state = addConstruction(state, "rectangle", [{ x: 430, y: 240 }, { x: 530, y: 340 }]);
    state = { ...state, flags: { ...state.flags, snap: true } };
    const tile = constructionObject(state)!, other = constructionObjects(state)[0];
    const a = worldVertices(tile)[0], b = worldVertices(other)[1];
    const moved = moveTile(state, "object." + tile.id, a, { x: b.x - a.x + 7.3, y: b.y - a.y + 4.2 });
    expect(constructionObject(moved)!.center.x - tile.center.x).toBeCloseTo(b.x - a.x + 7.3);
    expect(isValidTilingState(moved)).toBe(true);
    const snapped = snapTile(moved, "object." + tile.id)!;
    expect(worldVertices(constructionObject(snapped)!)[0]).toEqual(b);
    expect(constructionObjects(snapped)[0]).toEqual(other);
    expect(snapTile({ ...moved, flags: { ...moved.flags, snap: false } }, "object." + tile.id)).toBeNull();
  });
  it("refuses curves, forged metadata and excess pieces, but supports an empty stage", () => {
    const empty = removeConstruction(createTilingState());
    expect(isValidTilingState(empty)).toBe(true);
    expect(isValidTilingState({ ...empty, params: { ...empty.params, extra: 1 } })).toBe(false);
    expect(isValidTilingState({ ...empty, phase: 0.5 })).toBe(false);
    expect(isValidTilingState(addConstruction(empty, "circle", [{ x: 300, y: 300 }, { x: 330, y: 300 }]))).toBe(false);
    let many = empty;
    for (let i = 0; i < 25; i++) many = addRegularTile(many, 3);
    expect(constructionObjects(many)).toHaveLength(16);
    expect(isValidTilingState(many)).toBe(true);
  });
  it("starts without counts, conclusions or permanent editing handles", () => {
    const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };
    const html = renderToStaticMarkup(createElement("svg", null, planeTilingScene.draw(createTilingState(), api)));
    expect(html).not.toContain("条直边");
    expect(html).not.toContain("data-construction-edit-handle");
    expect(planeTilingScene.construction!.tools.map((tool) => tool.id)).toEqual(["rectangle", "polygon"]);
  });
});
