import { describe, expect, it } from "vitest";
import {
  VOXEL_CARVING_VERSION,
  carveVoxelSet,
  createVoxelCarvingState,
  createVoxelSet,
  parseVoxelCarvingState,
  replaceVoxelCarvingCells,
  summarizeVoxelCarving,
  toggleVoxelCarvingCell,
} from "@/features/spatial-math/domain";

const solidThree = createVoxelSet(
  Array.from({ length: 3 }, (_, x) =>
    Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: 3 }, (_, z) => ({ x, y, z })),
    ).flat(),
  ).flat(),
);

function summary(removedCells: readonly { readonly x: number; readonly y: number; readonly z: number }[]) {
  return summarizeVoxelCarving(solidThree, createVoxelCarvingState({
    entityId: "voxel.main",
    removedCells,
  }));
}

describe("voxel-carving-v1", () => {
  it("keeps an explicit empty removal set for the original solid", () => {
    const state = createVoxelCarvingState({ entityId: "voxel.main" });
    expect(state.carvingVersion).toBe(VOXEL_CARVING_VERSION);
    expect(summary([])).toEqual({
      originalVolume: 27,
      removedVolume: 0,
      remainingVolume: 27,
      totalSurfaceArea: 54,
      exteriorSurfaceArea: 54,
      interiorSurfaceArea: 0,
      enclosedCavityCount: 0,
      enclosedCavityVolume: 0,
    });
  });

  it("distinguishes a sealed center cavity from an opened cavity", () => {
    expect(summary([{ x: 1, y: 1, z: 1 }])).toEqual({
      originalVolume: 27,
      removedVolume: 1,
      remainingVolume: 26,
      totalSurfaceArea: 60,
      exteriorSurfaceArea: 54,
      interiorSurfaceArea: 6,
      enclosedCavityCount: 1,
      enclosedCavityVolume: 1,
    });
    expect(summary([{ x: 1, y: 1, z: 1 }, { x: 1, y: 2, z: 1 }])).toEqual({
      originalVolume: 27,
      removedVolume: 2,
      remainingVolume: 25,
      totalSurfaceArea: 62,
      exteriorSurfaceArea: 62,
      interiorSurfaceArea: 0,
      enclosedCavityCount: 0,
      enclosedCavityVolume: 0,
    });
  });

  it("recomputes a top dent and a through tunnel instead of applying a fixed delta", () => {
    expect(summary([{ x: 1, y: 2, z: 1 }])).toMatchObject({
      removedVolume: 1,
      remainingVolume: 26,
      totalSurfaceArea: 58,
      exteriorSurfaceArea: 58,
      interiorSurfaceArea: 0,
    });
    expect(summary([{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 2 }])).toMatchObject({
      removedVolume: 3,
      remainingVolume: 24,
      totalSurfaceArea: 64,
      exteriorSurfaceArea: 64,
      interiorSurfaceArea: 0,
      enclosedCavityVolume: 0,
    });
  });

  it("toggles and replaces removals canonically", () => {
    const empty = createVoxelCarvingState({ entityId: "voxel.main" });
    const center = { x: 1, y: 1, z: 1 };
    const removed = toggleVoxelCarvingCell(solidThree, empty, center);
    expect(removed.removedCells).toEqual([center]);
    expect(toggleVoxelCarvingCell(solidThree, removed, center)).toEqual(empty);

    const replaced = replaceVoxelCarvingCells(solidThree, empty, [
      { x: 2, y: 2, z: 2 },
      { x: 0, y: 0, z: 0 },
    ]);
    expect(replaced.removedCells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 2 },
    ]);
    expect(carveVoxelSet(solidThree, replaced).size).toBe(25);
  });

  it("rejects removal outside the source and malformed serialized state", () => {
    const empty = createVoxelCarvingState({ entityId: "voxel.main" });
    expect(() => replaceVoxelCarvingCells(solidThree, empty, [{ x: 9, y: 9, z: 9 }]))
      .toThrow(/not in source/);
    expect(() => parseVoxelCarvingState({
      ...empty,
      removedCells: [{ x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0 }],
    })).toThrow(/canonical order/);
    expect(() => parseVoxelCarvingState({
      ...empty,
      removedCells: [{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }],
    })).toThrow(/duplicate/);
    expect(() => parseVoxelCarvingState({ ...empty, inferredHollow: true })).toThrow();
  });
});
