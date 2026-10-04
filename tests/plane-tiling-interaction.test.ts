import { describe, expect, it } from "vitest";
import { constructionObject, constructionObjects, duplicateConstruction, worldVertices } from "@/features/tools/plane-construction/model";
import { createTilingState, isValidTilingState, moveTile, snapTile } from "@/features/tools/plane-tiling/model";

describe("tile observations preserve direct movement", () => {
  it("moves the complete tile from an observed edge or vertex without colouring it", () => {
    const state = createTilingState(), object = constructionObject(state)!, delta = { x: 43, y: 27 };
    for (const target of [`edge.${object.id}.0`, `vertex.${object.id}.0`]) {
      const next = moveTile(state, target, { x: 0, y: 0 }, delta), moved = constructionObject(next)!;
      expect(moved.center).toEqual({ x: object.center.x + 43, y: object.center.y + 27 });
      expect(moved.vertices).toEqual(object.vertices); expect(next.marks).toEqual(state.marks);
      expect(next.flags).toEqual(state.flags); expect(isValidTilingState(next)).toBe(true);
    }
  });
  it("uses the same release snap for a tile body, edge and observation vertex", () => {
    let state = duplicateConstruction(createTilingState());
    const [other, current] = constructionObjects(state), own = worldVertices(current)[0], target = worldVertices(other)[0];
    state = { ...state, points: { ...state.points, [`center.${current.id}`]: { x: current.center.x + target.x - own.x + 5, y: current.center.y + target.y - own.y + 3 } } };
    const body = snapTile(state, `object.${current.id}`); expect(body).not.toBeNull();
    expect(snapTile(state, `edge.${current.id}.0`)).toEqual(body);
    expect(snapTile(state, `vertex.${current.id}.0`)).toEqual(body);
  });
  it("keeps explicit vertex editing distinct from whole-tile movement and snapping", () => {
    const initial = createTilingState(), state = { ...initial, flags: { ...initial.flags, edit: true } }, before = constructionObject(state)!;
    const next = moveTile(state, `vertex.${before.id}.0`, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(constructionObject(next)!.center).toEqual(before.center);
    expect(constructionObject(next)!.vertices).not.toEqual(before.vertices);
    expect(snapTile(next, `vertex.${before.id}.0`)).toBeNull();
  });
});
