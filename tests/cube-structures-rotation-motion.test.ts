import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendCubeOperation, createCubeHistory, cubeDisplayPosition, replayCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeDisplayPositions } from "@/features/tools/spatial-lab/cube-structures-motion";
import { cubeRotationOperation } from "@/features/tools/spatial-lab/cube-structures-rotation";
import { cubeRotationAngle, cubeRotationMotion, cubeRotationPositions } from "@/features/tools/spatial-lab/cube-structures-rotation-motion";

describe("rigid rotation animation and semantic replay", () => {
  it("keeps pairwise distances constant on curved paths instead of crossing through the center", () => {
    const initial = createCubeHistory([{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    const state = initial.initial;
    const operation = { ...cubeRotationOperation(state, state.cubes.map((cube) => cube.id), "y", 1)!, pivot: { x: 0, y: 0, z: 0 }, displayPivot: { x: 0, y: 0, z: 0 } };
    const next = appendCubeOperation(initial, operation);
    const after = replayCubeHistory(next);
    const motion = cubeRotationMotion(state, after, initial, next)!;
    const targets = cubeDisplayPositions(after.cubes);
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const positions = cubeRotationPositions(motion, targets, progress);
      const a = positions.get("cube-1")!, b = positions.get("cube-2")!;
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(2, 12);
      expect(Math.hypot(a.x, a.z)).toBeCloseTo(1, 12);
    }
    const middle = cubeRotationPositions(motion, targets, 0.5).get("cube-2")!;
    expect(Math.abs(middle.x)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.abs(middle.z)).toBeCloseTo(Math.SQRT1_2);
    expect(cubeRotationPositions(motion, targets, 1)).toBe(targets);
    expect(cubeRotationAngle(1, 0.5)).toBeCloseTo(Math.PI / 4);
  });

  it("animates single-cube orientation changes even when its center stays fixed", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }]);
    const next = appendCubeOperation(initial, cubeRotationOperation(initial.initial, ["cube-1"], "x", -1)!);
    const after = replayCubeHistory(next);
    expect(after.cubes.map(cubeDisplayPosition)).toEqual(initial.initial.cubes.map(cubeDisplayPosition));
    expect(cubeRotationMotion(initial.initial, after, initial, next)?.operation.turn).toBe(-1);
    expect(cubeRotationMotion(after, initial.initial, next, { ...next, cursor: 0 })?.operation.turn).toBe(1);
  });

  it("does not restart on a repeated classroom snapshot, ordinary move, or unrelated state", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    const next = appendCubeOperation(initial, cubeRotationOperation(initial.initial, ["cube-1", "cube-2"], "z", 1)!);
    const after = replayCubeHistory(next);
    expect(cubeRotationMotion(after, structuredClone(after), next, structuredClone(next))).toBeNull();
    const moved = appendCubeOperation(next, { kind: "move", ids: ["cube-1", "cube-2"], axis: "x", distance: 2 });
    expect(cubeRotationMotion(after, replayCubeHistory(moved), next, moved)).toBeNull();
    expect(cubeRotationMotion(initial.initial, replayCubeHistory(moved), initial, next)).toBeNull();
  });

  it("reuses existing geometry in one rotating group, with the original drag controller untouched", () => {
    const viewport = readFileSync("src/features/tools/spatial-lab/CubeStructuresViewport.tsx", "utf8");
    const workbench = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    const renderer = readFileSync("src/features/spatial-math/renderer-r3f/VoxelCanvas.tsx", "utf8");
    expect(viewport).toContain('name="cube-rigid-rotation"');
    expect(viewport).toContain("<VoxelGeometry model={rotating.model}");
    expect(viewport).toContain("<CubeStructureAnnotations state={rotating.state}");
    expect(viewport).toContain("<CubeMoveHandles interaction={moveInteraction}");
    expect(renderer).toContain("export function VoxelGeometry(");
    expect(workbench).toContain('panel === "move"');
    expect(workbench).toContain("data-cube-rotation-controls");
    expect(workbench).toContain("courseware.allowRotation === true");
  });
});
