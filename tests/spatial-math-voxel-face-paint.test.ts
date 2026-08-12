import { describe, expect, it } from "vitest";
import {
  VOXEL_FACE_PAINT_VERSION,
  clearVoxelFacePaint,
  createVoxelFacePaintState,
  createVoxelSet,
  exteriorVoxelFaces,
  paintAllExteriorVoxelFaces,
  parseVoxelFacePaintState,
  summarizeVoxelFacePaint,
  toggleExteriorVoxelFacePaint,
} from "@/features/spatial-math/domain";

function solidCube(size: number) {
  return createVoxelSet(
    Array.from({ length: size }, (_, x) =>
      Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, z) => ({ x, y, z })),
      ).flat(),
    ).flat(),
  );
}

describe("voxel-face-paint-v1", () => {
  it("classifies a fully painted 3 by 3 by 3 cube exactly", () => {
    const voxels = solidCube(3);
    const empty = createVoxelFacePaintState({ entityId: "voxel.main", materialToken: "voxel.paint" });
    const painted = paintAllExteriorVoxelFaces(voxels, empty);
    const summary = summarizeVoxelFacePaint(voxels, painted);

    expect(painted.paintVersion).toBe(VOXEL_FACE_PAINT_VERSION);
    expect(exteriorVoxelFaces(voxels)).toHaveLength(54);
    expect(summary).toEqual({
      paintedUnitFaces: 54,
      totalExteriorUnitFaces: 54,
      complete: true,
      histogram: [1, 6, 12, 8, 0, 0, 0],
    });
  });

  it("toggles one exterior face deterministically and clears without changing identity", () => {
    const voxels = solidCube(2);
    const empty = createVoxelFacePaintState({ entityId: "voxel.main", materialToken: "voxel.paint" });
    const face = { cell: { x: 0, y: 0, z: 0 }, direction: "x-" as const };
    const painted = toggleExteriorVoxelFacePaint(voxels, empty, face);

    expect(painted.faces).toEqual([face]);
    expect(summarizeVoxelFacePaint(voxels, painted).histogram).toEqual([7, 1, 0, 0, 0, 0, 0]);
    expect(toggleExteriorVoxelFacePaint(voxels, painted, face)).toEqual(empty);
    expect(clearVoxelFacePaint(painted)).toEqual(empty);
  });

  it("rejects a shared internal face and a face opening into an enclosed cavity", () => {
    const pair = createVoxelSet([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    const empty = createVoxelFacePaintState({ entityId: "voxel.main", materialToken: "voxel.paint" });
    expect(() => toggleExteriorVoxelFacePaint(pair, empty, {
      cell: { x: 0, y: 0, z: 0 },
      direction: "x+",
    })).toThrow(/not exterior/);

    const shellCells = solidCube(3).cells.filter((cell) => !(cell.x === 1 && cell.y === 1 && cell.z === 1));
    const shell = createVoxelSet(shellCells);
    expect(() => toggleExteriorVoxelFacePaint(shell, empty, {
      cell: { x: 1, y: 1, z: 0 },
      direction: "z+",
    })).toThrow(/not exterior/);
  });

  it("canonicalizes constructed faces while strict parsing rejects disorder and duplicates", () => {
    const right = { cell: { x: 1, y: 0, z: 0 }, direction: "x+" as const };
    const left = { cell: { x: 0, y: 0, z: 0 }, direction: "x-" as const };
    const canonical = createVoxelFacePaintState({
      entityId: "voxel.main",
      materialToken: "voxel.paint",
      faces: [right, left],
    });
    expect(canonical.faces).toEqual([left, right]);
    expect(() => parseVoxelFacePaintState({ ...canonical, faces: [right, left] })).toThrow(/canonical order/);
    expect(() => parseVoxelFacePaintState({ ...canonical, faces: [left, left] })).toThrow(/duplicate/);
    expect(() => parseVoxelFacePaintState({ ...canonical, runtime: {} })).toThrow();
  });
});
