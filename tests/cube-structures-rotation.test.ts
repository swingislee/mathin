import { describe, expect, it } from "vitest";
import type { Axis, FaceDirection } from "@/features/spatial-math/domain";
import { CUBE_COLORS, applyCubeOperation, createCubeHistory, cubeDisplayPosition, cubeStructureMetrics, type CubeStructureState } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeLabelAnchor } from "@/features/tools/spatial-lab/cube-structures-annotations";
import { cubeLabelUp, cubeRotationOperation, rotateCubeDirection, rotateCubePoint, rotateCubeVector } from "@/features/tools/spatial-lab/cube-structures-rotation";

const axes: readonly Axis[] = ["x", "y", "z"];
const directions: readonly FaceDirection[] = ["x+", "x-", "y+", "y-", "z+", "z-"];
const all = (state: CubeStructureState) => state.cubes.map((cube) => cube.id);

function marked() {
  let state = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]).initial;
  state = applyCubeOperation(state, { kind: "group", id: "part", name: "part", ids: all(state) });
  state = applyCubeOperation(state, { kind: "mark", ids: ["cube-1"], shape: "triangle", placement: "face", direction: "z+", color: CUBE_COLORS[1] });
  state = applyCubeOperation(state, { kind: "number", id: "cube-1", placement: "face", direction: "z+", color: CUBE_COLORS[2] });
  state = applyCubeOperation(state, { kind: "paint", faces: [{ id: "cube-1", direction: "x+" }, { id: "cube-1", direction: "y-" }], color: CUBE_COLORS[3] });
  return state;
}

describe("cube rigid-group quarter turns", () => {
  it.each(axes)("keeps exact integer geometry, IDs, groups and face decoration around %s", (axis) => {
    const initial = marked();
    for (const turn of [-1, 1] as const) {
      const operation = cubeRotationOperation(initial, all(initial), axis, turn)!;
      const result = applyCubeOperation(initial, operation);
      expect(result).not.toBe(initial);
      expect(result.cubes.map((cube) => cube.id)).toEqual(all(initial));
      expect(result.groups).toBe(initial.groups);
      expect(result.origin).toBe(initial.origin);
      expect(cubeStructureMetrics(result)).toEqual(cubeStructureMetrics(initial));
      for (const cube of result.cubes) {
        const source = initial.cubes.find((candidate) => candidate.id === cube.id)!;
        expect(cube.position).toEqual(rotateCubePoint(source.position, operation.pivot, axis, turn));
        expect(Object.values(cube.position).every(Number.isInteger)).toBe(true);
        for (const direction of Object.keys(source.faces) as FaceDirection[]) expect(cube.faces[rotateCubeDirection(direction, axis, turn)]).toBe(source.faces[direction]);
      }
      const first = result.cubes[0], old = initial.cubes[0];
      expect(cubeLabelUp(first.mark!)).toEqual(rotateCubeVector(cubeLabelUp(old.mark!), axis, turn));
      for (const lane of [-1, 1] as const) expect(cubeLabelAnchor(first, first.mark!, lane)).toEqual(rotateCubePoint(cubeLabelAnchor(old, old.mark!, lane), operation.displayPivot, axis, turn));
      let restored = result;
      for (let index = 0; index < 3; index++) restored = applyCubeOperation(restored, cubeRotationOperation(restored, all(restored), axis, turn)!);
      expect(restored).toEqual(initial);
    }
  });

  it.each(directions)("rotates %s labels with their face plane, including in-plane twists", (direction) => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial;
    const state = applyCubeOperation(initial, { kind: "mark", ids: ["cube-1"], shape: "triangle", placement: "face", direction, color: CUBE_COLORS[1] });
    for (const axis of axes) for (const turn of [-1, 1] as const) {
      const operation = cubeRotationOperation(state, ["cube-1"], axis, turn)!;
      const result = applyCubeOperation(state, operation);
      expect(result.cubes[0].mark?.direction).toBe(rotateCubeDirection(direction, axis, turn));
      expect(cubeLabelUp(result.cubes[0].mark!)).toEqual(rotateCubeVector(cubeLabelUp(state.cubes[0].mark!), axis, turn));
      expect(applyCubeOperation(result, { ...operation, turn: turn === 1 ? -1 : 1 })).toEqual(state);
    }
  });

  it("uses a central lattice pivot for odd/even dimensions and can rotate a plain single cube", () => {
    const state = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial;
    const operation = cubeRotationOperation(state, all(state), "z", 1)!;
    expect(operation.pivot).toEqual({ x: 0, y: 0, z: 0 });
    expect(applyCubeOperation(state, operation).cubes[1].position).toEqual({ x: 0, y: 1, z: 0 });
    const single = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial;
    expect(applyCubeOperation(single, cubeRotationOperation(single, all(single), "y", 1)!)).not.toBe(single);
  });

  it("preserves the common separated display offset and keeps all gaps out of the mathematical surface", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial;
    const separated = applyCubeOperation(initial, { kind: "display-move", ids: all(initial), axis: "x", distance: 3.5 });
    const result = applyCubeOperation(separated, cubeRotationOperation(separated, all(separated), "z", 1)!);
    expect(result.cubes.map((cube) => cube.displayOffset)).toEqual([{ x: 3.5, y: 0, z: 0 }, { x: 3.5, y: 0, z: 0 }]);
    expect(cubeStructureMetrics(result).volume).toBe(2);
    expect(cubeStructureMetrics(result).totalUnitFaces).toBe(10);
    const rejoined = applyCubeOperation(result, { kind: "display-reset", ids: all(result) });
    expect(rejoined.cubes.map(cubeDisplayPosition)).toEqual(result.cubes.map((cube) => cube.position));
    expect(cubeStructureMetrics(rejoined)).toEqual(cubeStructureMetrics(result));
  });

  it("keeps unrelated cubes fixed and rejects logical occupancy even when hidden", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]).initial;
    const selected = initial.cubes.filter((cube) => cube.position.y === 0).map((cube) => cube.id);
    const operation = cubeRotationOperation(initial, selected, "z", 1)!;
    expect(applyCubeOperation(initial, operation)).toBe(initial);
    const hidden = { ...initial, hiddenCubeIds: initial.cubes.filter((cube) => !selected.includes(cube.id)).map((cube) => cube.id) };
    expect(applyCubeOperation(hidden, operation)).toBe(hidden);
    const moved = applyCubeOperation(initial, { kind: "move", ids: selected, axis: "x", distance: 3 });
    const rotated = applyCubeOperation(moved, cubeRotationOperation(moved, selected, "z", 1)!);
    expect(rotated.cubes.filter((cube) => !selected.includes(cube.id))).toEqual(initial.cubes.filter((cube) => !selected.includes(cube.id)));
  });

  it("rejects display overlap, non-grid pivots, missing/duplicate IDs and coordinate limits atomically", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 5, y: 1, z: 0 }]).initial;
    const ids = initial.cubes.filter((cube) => cube.position.y === 0).map((cube) => cube.id);
    const obstacle = initial.cubes.find((cube) => cube.position.y === 1)!;
    const displayed = applyCubeOperation(initial, { kind: "display-move", ids: [obstacle.id], axis: "x", distance: -5 });
    expect(applyCubeOperation(displayed, cubeRotationOperation(displayed, ids, "z", 1)!)).toBe(displayed);
    const operation = cubeRotationOperation(initial, ids, "z", 1)!;
    for (const invalid of [
      { ...operation, pivot: { x: 0.5, y: 0, z: 0 } },
      { ...operation, pivot: { x: -12, y: -12, z: 0 } },
      { ...operation, ids: [...ids, "missing"] }, { ...operation, ids: [ids[0], ids[0]] },
      { ...operation, displayPivot: { x: 0, y: 0.1, z: 0 } },
    ]) expect(applyCubeOperation(initial, invalid)).toBe(initial);
    expect(cubeRotationOperation(initial, [], "x", 1)).toBeNull();
  });
});
