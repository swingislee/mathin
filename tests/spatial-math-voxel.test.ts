import { describe, expect, it } from "vitest";
import {
  FACE_DIRECTIONS,
  SPATIAL_VOXEL_LIMITS,
  VoxelAnalysisLimitError,
  allOrthographicProjections,
  analyzeSurfacePaint,
  analyzeVoxelSurfaceArea,
  boundaryVoxelFaces,
  connectedVoxelComponents,
  countVoxelLayers,
  createVoxelSet,
  findEnclosedVoxelCavities,
  hiddenVoxelsFromView,
  primaryOrthographicProjections,
  projectVoxels,
  voxelCoordinateListSchema,
  voxelKey,
  type Axis,
  type VoxelCoordinate,
} from "@/features/spatial-math/domain";

function rectangularPrism(
  width: number,
  height: number,
  depth: number,
  offset: VoxelCoordinate = { x: 0, y: 0, z: 0 },
): VoxelCoordinate[] {
  const cells: VoxelCoordinate[] = [];
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) {
        cells.push({ x: x + offset.x, y: y + offset.y, z: z + offset.z });
      }
    }
  }
  return cells;
}

function cubicalShell(size: number): VoxelCoordinate[] {
  return rectangularPrism(size, size, size).filter(
    ({ x, y, z }) =>
      x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1,
  );
}

function oracleSurfaceArea(cells: readonly VoxelCoordinate[]): number {
  let adjacentPairs = 0;
  for (let left = 0; left < cells.length; left += 1) {
    for (let right = left + 1; right < cells.length; right += 1) {
      const a = cells[left];
      const b = cells[right];
      const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
      if (manhattan === 1) adjacentPairs += 1;
    }
  }
  return cells.length * 6 - adjacentPairs * 2;
}

function oracleProjectionSize(
  cells: readonly VoxelCoordinate[],
  view: "front" | "right" | "top",
): number {
  const projectionKeys = new Set<string>();
  for (const cell of cells) {
    if (view === "front") projectionKeys.add(`${cell.x},${cell.y}`);
    if (view === "right") projectionKeys.add(`${cell.z},${cell.y}`);
    if (view === "top") projectionKeys.add(`${cell.x},${cell.z}`);
  }
  return projectionKeys.size;
}

function oracleLayerCounts(cells: readonly VoxelCoordinate[], axis: Axis): number[] {
  if (cells.length === 0) return [];
  const values = cells.map((cell) => cell[axis]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Array.from({ length: max - min + 1 }, (_, index) => {
    const coordinate = min + index;
    return cells.filter((cell) => cell[axis] === coordinate).length;
  });
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("spatial math voxel contract", () => {
  it("rejects malformed, duplicate, out-of-range and oversized coordinate sets", () => {
    expect(voxelCoordinateListSchema.safeParse([{ x: 0.5, y: 0, z: 0 }]).success).toBe(false);
    expect(voxelCoordinateListSchema.safeParse([{ x: 0, y: 0, z: 0, script: "bad" }]).success).toBe(false);
    expect(
      voxelCoordinateListSchema.safeParse([{ x: SPATIAL_VOXEL_LIMITS.maxCoordinate + 1, y: 0, z: 0 }])
        .success,
    ).toBe(false);
    expect(
      voxelCoordinateListSchema.safeParse([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ]).success,
    ).toBe(false);

    const oversized = Array.from({ length: SPATIAL_VOXEL_LIMITS.maxCells + 1 }, (_, index) => ({
      x: index % 100,
      y: Math.floor(index / 100) % 100,
      z: Math.floor(index / 10_000),
    }));
    expect(voxelCoordinateListSchema.safeParse(oversized).success).toBe(false);
  });

  it("canonicalizes valid cells without mutating the input", () => {
    const input = [
      { x: 2, y: 0, z: 0 },
      { x: -1, y: 3, z: 0 },
      { x: -1, y: 2, z: 4 },
    ];
    const voxels = createVoxelSet(input);

    expect(voxels.cells.map(voxelKey)).toEqual(["-1,2,4", "-1,3,0", "2,0,0"]);
    expect(input.map(voxelKey)).toEqual(["2,0,0", "-1,3,0", "-1,2,4"]);
    expect(voxels.bounds).toEqual({ minX: -1, maxX: 2, minY: 0, maxY: 3, minZ: 0, maxZ: 4 });
  });

  it("keeps empty models mathematically well-defined", () => {
    const empty = createVoxelSet([]);

    expect(empty.bounds).toBeNull();
    expect(countVoxelLayers(empty, "y")).toEqual([]);
    expect(projectVoxels(empty, "front")).toMatchObject({
      cells: [],
      bounds: null,
      visibleVoxelCount: 0,
      hiddenVoxelCount: 0,
    });
    expect(analyzeVoxelSurfaceArea(empty)).toEqual({
      totalUnitFaces: 0,
      exteriorUnitFaces: 0,
      interiorUnitFaces: 0,
    });
  });

  it("computes canonical front/right/top projections and hidden stacks", () => {
    const voxels = createVoxelSet([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ]);
    const views = primaryOrthographicProjections(voxels);

    expect(views.front.cells).toHaveLength(3);
    expect(views.front.hiddenVoxelCount).toBe(1);
    expect(views.front.cells.find((cell) => cell.u === 0 && cell.v === 0)).toMatchObject({
      depth: 1,
      stackSize: 2,
      hiddenCount: 1,
      frontmostCell: { x: 0, y: 0, z: 1 },
    });
    expect(views.right.visibleVoxelCount).toBe(3);
    expect(views.top.visibleVoxelCount).toBe(3);
    expect(hiddenVoxelsFromView(voxels, "front").map(voxelKey)).toEqual(["0,0,0"]);
  });

  it("selects the correct frontmost voxel from all six directions", () => {
    const voxels = createVoxelSet([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]);
    const views = allOrthographicProjections(voxels);

    expect(views.front.cells.find((cell) => cell.u === 0 && cell.v === 0)?.frontmostCell).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
    expect(views.back.cells.find((cell) => cell.u === 0 && cell.v === 0)?.frontmostCell).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
    expect(views.right.cells.find((cell) => cell.u === 0 && cell.v === 0)?.frontmostCell).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(views.left.cells.find((cell) => cell.u === 0 && cell.v === 0)?.frontmostCell).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
    expect(views.top.cells.find((cell) => cell.u === 0 && cell.v === 0)?.frontmostCell).toEqual({
      x: 0,
      y: 1,
      z: 0,
    });
    expect(views.bottom.cells.find((cell) => cell.u === 0 && cell.v === 0)?.frontmostCell).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it("includes empty coordinates between occupied layers", () => {
    const voxels = createVoxelSet([
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ]);

    expect(countVoxelLayers(voxels, "y")).toEqual([
      { coordinate: -1, count: 1 },
      { coordinate: 0, count: 0 },
      { coordinate: 1, count: 2 },
    ]);
  });

  it("separates total, exterior and enclosed interior surface area", () => {
    const solid = createVoxelSet(rectangularPrism(3, 3, 3));
    const shell = createVoxelSet(cubicalShell(3));
    const openedShell = createVoxelSet(cubicalShell(3).filter((cell) => voxelKey(cell) !== "1,2,1"));

    expect(analyzeVoxelSurfaceArea(solid)).toEqual({
      totalUnitFaces: 54,
      exteriorUnitFaces: 54,
      interiorUnitFaces: 0,
    });
    expect(findEnclosedVoxelCavities(shell)).toEqual([
      { cells: [{ x: 1, y: 1, z: 1 }], volumeInUnitCubes: 1 },
    ]);
    expect(analyzeVoxelSurfaceArea(shell)).toEqual({
      totalUnitFaces: 60,
      exteriorUnitFaces: 54,
      interiorUnitFaces: 6,
    });
    expect(findEnclosedVoxelCavities(openedShell)).toEqual([]);
    expect(analyzeVoxelSurfaceArea(openedShell).interiorUnitFaces).toBe(0);
  });

  it("classifies whole-surface and directional paint by voxel", () => {
    const solid = createVoxelSet(rectangularPrism(3, 3, 3));
    const allSides = analyzeSurfacePaint(solid);
    const topOnly = analyzeSurfacePaint(createVoxelSet(rectangularPrism(2, 2, 2)), {
      directions: ["y+"],
    });

    expect(allSides.paintedUnitFaces).toBe(54);
    expect(allSides.histogram).toEqual([1, 6, 12, 8, 0, 0, 0]);
    expect(topOnly.paintedUnitFaces).toBe(4);
    expect(topOnly.histogram).toEqual([4, 4, 0, 0, 0, 0, 0]);
  });

  it("does not paint a sealed cavity unless all boundary faces are requested", () => {
    const shell = createVoxelSet(cubicalShell(3));
    const exterior = analyzeSurfacePaint(shell);
    const everyBoundary = analyzeSurfacePaint(shell, { exposure: "all-boundary" });

    expect(exterior.paintedUnitFaces).toBe(54);
    expect(exterior.histogram).toEqual([0, 6, 12, 8, 0, 0, 0]);
    expect(everyBoundary.paintedUnitFaces).toBe(60);
    expect(everyBoundary.histogram).toEqual([0, 0, 18, 8, 0, 0, 0]);
  });

  it("finds face-connected components deterministically", () => {
    const voxels = createVoxelSet([
      { x: 9, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 9, y: 0, z: 1 },
      { x: -4, y: 2, z: 8 },
    ]);

    expect(connectedVoxelComponents(voxels).map((component) => component.map(voxelKey))).toEqual([
      ["-4,2,8"],
      ["0,0,0", "0,1,0"],
      ["9,0,0", "9,0,1"],
    ]);
  });

  it("fails closed before a sparse shape can trigger an unbounded cavity flood", () => {
    const sparse = createVoxelSet([
      {
        x: SPATIAL_VOXEL_LIMITS.minCoordinate,
        y: SPATIAL_VOXEL_LIMITS.minCoordinate,
        z: SPATIAL_VOXEL_LIMITS.minCoordinate,
      },
      {
        x: SPATIAL_VOXEL_LIMITS.maxCoordinate,
        y: SPATIAL_VOXEL_LIMITS.maxCoordinate,
        z: SPATIAL_VOXEL_LIMITS.maxCoordinate,
      },
    ]);

    expect(analyzeSurfacePaint(sparse, { exposure: "all-boundary" }).paintedUnitFaces).toBe(12);
    expect(() => findEnclosedVoxelCavities(sparse)).toThrow(VoxelAnalysisLimitError);
    expect(() => analyzeVoxelSurfaceArea(sparse)).toThrow(/exceeds limit/);
  });

  it("matches independent oracles across deterministic generated shapes", () => {
    const random = deterministicRandom(0x5eed_c0de);

    for (let sample = 0; sample < 250; sample += 1) {
      const cells = rectangularPrism(4, 4, 4).filter(() => random() < 0.35);
      const voxels = createVoxelSet(cells);
      const surface = analyzeVoxelSurfaceArea(voxels);
      const projections = primaryOrthographicProjections(voxels);
      const paint = analyzeSurfacePaint(voxels, {
        exposure: "all-boundary",
        directions: FACE_DIRECTIONS,
      });

      expect(surface.totalUnitFaces).toBe(oracleSurfaceArea(cells));
      expect(boundaryVoxelFaces(voxels)).toHaveLength(oracleSurfaceArea(cells));
      expect(paint.paintedUnitFaces).toBe(surface.totalUnitFaces);
      expect(paint.histogram.reduce((sum, count) => sum + count, 0)).toBe(cells.length);
      expect(
        paint.histogram.reduce((sum, count, paintedFaces) => sum + count * paintedFaces, 0),
      ).toBe(surface.totalUnitFaces);

      for (const view of ["front", "right", "top"] as const) {
        expect(projections[view].visibleVoxelCount).toBe(oracleProjectionSize(cells, view));
        expect(projections[view].hiddenVoxelCount).toBe(cells.length - oracleProjectionSize(cells, view));
      }
      for (const axis of ["x", "y", "z"] as const) {
        expect(countVoxelLayers(voxels, axis).map((layer) => layer.count)).toEqual(
          oracleLayerCounts(cells, axis),
        );
      }
    }
  });
});
