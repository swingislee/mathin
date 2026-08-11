import { describe, expect, it } from "vitest";
import {
  SPATIAL_GOLD_REVIEW_STATUS,
  SPATIAL_VOXEL_GOLD_CANDIDATES,
  evaluateSpatialGoldCase,
  spatialGoldCaseSetSchema,
  type SpatialGoldAssertion,
  type SpatialGoldCase,
} from "@/features/spatial-math/gold";
import type { FaceDirection, OrthographicView, VoxelCoordinate } from "@/features/spatial-math/domain";

const OFFSETS: Record<FaceDirection, VoxelCoordinate> = {
  "x-": { x: -1, y: 0, z: 0 },
  "x+": { x: 1, y: 0, z: 0 },
  "y-": { x: 0, y: -1, z: 0 },
  "y+": { x: 0, y: 1, z: 0 },
  "z-": { x: 0, y: 0, z: -1 },
  "z+": { x: 0, y: 0, z: 1 },
};

function key(cell: VoxelCoordinate): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

function neighbor(cell: VoxelCoordinate, direction: FaceDirection): VoxelCoordinate {
  const offset = OFFSETS[direction];
  return { x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z };
}

function independentSurfaceTotal(cells: readonly VoxelCoordinate[]): number {
  let adjacentPairs = 0;
  for (let left = 0; left < cells.length; left += 1) {
    for (let right = left + 1; right < cells.length; right += 1) {
      const a = cells[left];
      const b = cells[right];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) === 1) {
        adjacentPairs += 1;
      }
    }
  }
  return cells.length * 6 - adjacentPairs * 2;
}

interface IndependentAirAnalysis {
  readonly exteriorAir: ReadonlySet<string>;
  readonly cavityVolumes: readonly number[];
}

function independentAir(cells: readonly VoxelCoordinate[]): IndependentAirAnalysis {
  if (cells.length === 0) return { exteriorAir: new Set(), cavityVolumes: [] };
  const occupied = new Set(cells.map(key));
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const zs = cells.map((cell) => cell.z);
  const bounds = {
    minX: Math.min(...xs) - 1,
    maxX: Math.max(...xs) + 1,
    minY: Math.min(...ys) - 1,
    maxY: Math.max(...ys) + 1,
    minZ: Math.min(...zs) - 1,
    maxZ: Math.max(...zs) + 1,
  };
  const inside = (cell: VoxelCoordinate) =>
    cell.x >= bounds.minX &&
    cell.x <= bounds.maxX &&
    cell.y >= bounds.minY &&
    cell.y <= bounds.maxY &&
    cell.z >= bounds.minZ &&
    cell.z <= bounds.maxZ;
  const seed = { x: bounds.minX, y: bounds.minY, z: bounds.minZ };
  const exteriorAir = new Set([key(seed)]);
  const queue = [seed];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    for (const direction of Object.keys(OFFSETS) as FaceDirection[]) {
      const next = neighbor(cell, direction);
      const nextKey = key(next);
      if (!inside(next) || occupied.has(nextKey) || exteriorAir.has(nextKey)) continue;
      exteriorAir.add(nextKey);
      queue.push(next);
    }
  }

  const enclosed = new Map<string, VoxelCoordinate>();
  for (let x = bounds.minX + 1; x < bounds.maxX; x += 1) {
    for (let y = bounds.minY + 1; y < bounds.maxY; y += 1) {
      for (let z = bounds.minZ + 1; z < bounds.maxZ; z += 1) {
        const cell = { x, y, z };
        const cellKey = key(cell);
        if (!occupied.has(cellKey) && !exteriorAir.has(cellKey)) enclosed.set(cellKey, cell);
      }
    }
  }

  const cavityVolumes: number[] = [];
  while (enclosed.size > 0) {
    const first = enclosed.values().next().value as VoxelCoordinate;
    const cavityQueue = [first];
    let volume = 0;
    enclosed.delete(key(first));
    for (let cursor = 0; cursor < cavityQueue.length; cursor += 1) {
      const cell = cavityQueue[cursor];
      volume += 1;
      for (const direction of Object.keys(OFFSETS) as FaceDirection[]) {
        const next = neighbor(cell, direction);
        const nextKey = key(next);
        const found = enclosed.get(nextKey);
        if (!found) continue;
        enclosed.delete(nextKey);
        cavityQueue.push(found);
      }
    }
    cavityVolumes.push(volume);
  }
  return { exteriorAir, cavityVolumes: cavityVolumes.sort((left, right) => left - right) };
}

function independentProjection(
  cells: readonly VoxelCoordinate[],
  view: OrthographicView,
): { visibleVoxelCount: number; hiddenVoxelCount: number } {
  const rays = new Set<string>();
  for (const cell of cells) {
    if (view === "front" || view === "back") rays.add(`${cell.x},${cell.y}`);
    if (view === "right" || view === "left") rays.add(`${cell.z},${cell.y}`);
    if (view === "top" || view === "bottom") rays.add(`${cell.x},${cell.z}`);
  }
  return { visibleVoxelCount: rays.size, hiddenVoxelCount: cells.length - rays.size };
}

function independentComponents(cells: readonly VoxelCoordinate[]): number {
  const remaining = new Map(cells.map((cell) => [key(cell), cell]));
  let components = 0;
  while (remaining.size > 0) {
    components += 1;
    const first = remaining.values().next().value as VoxelCoordinate;
    const queue = [first];
    remaining.delete(key(first));
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const direction of Object.keys(OFFSETS) as FaceDirection[]) {
        const next = neighbor(queue[cursor], direction);
        const found = remaining.get(key(next));
        if (!found) continue;
        remaining.delete(key(next));
        queue.push(found);
      }
    }
  }
  return components;
}

function independentExpected(goldCase: SpatialGoldCase, assertion: SpatialGoldAssertion): unknown {
  const cells = goldCase.cells;
  if (assertion.kind === "voxel-count") return cells.length;
  if (assertion.kind === "projection") return independentProjection(cells, assertion.view);
  if (assertion.kind === "layer-counts") {
    if (cells.length === 0) return [];
    const values = cells.map((cell) => cell[assertion.axis]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return Array.from({ length: max - min + 1 }, (_, index) => {
      const coordinate = min + index;
      return { coordinate, count: cells.filter((cell) => cell[assertion.axis] === coordinate).length };
    });
  }
  if (assertion.kind === "component-count") return independentComponents(cells);

  const occupied = new Set(cells.map(key));
  const air = independentAir(cells);
  if (assertion.kind === "cavity-volumes") return air.cavityVolumes;
  if (assertion.kind === "surface-area") {
    let exteriorUnitFaces = 0;
    let interiorUnitFaces = 0;
    for (const cell of cells) {
      for (const direction of Object.keys(OFFSETS) as FaceDirection[]) {
        const adjacent = neighbor(cell, direction);
        if (occupied.has(key(adjacent))) continue;
        if (air.exteriorAir.has(key(adjacent))) exteriorUnitFaces += 1;
        else interiorUnitFaces += 1;
      }
    }
    return {
      totalUnitFaces: independentSurfaceTotal(cells),
      exteriorUnitFaces,
      interiorUnitFaces,
    };
  }
  if (assertion.kind === "paint-histogram") {
    const selectedDirections = new Set(assertion.directions);
    const histogram: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];
    let paintedUnitFaces = 0;
    for (const cell of cells) {
      let paintedFaceCount = 0;
      for (const direction of Object.keys(OFFSETS) as FaceDirection[]) {
        if (!selectedDirections.has(direction)) continue;
        const adjacent = neighbor(cell, direction);
        if (occupied.has(key(adjacent))) continue;
        if (assertion.exposure === "exterior-only" && !air.exteriorAir.has(key(adjacent))) continue;
        paintedFaceCount += 1;
        paintedUnitFaces += 1;
      }
      histogram[paintedFaceCount] += 1;
    }
    return { paintedUnitFaces, histogram };
  }
}

describe("spatial voxel engineering gold candidates", () => {
  it("contains exactly twenty stable, explicitly unreviewed candidate contracts", () => {
    expect(spatialGoldCaseSetSchema.safeParse(SPATIAL_VOXEL_GOLD_CANDIDATES).success).toBe(true);
    expect(SPATIAL_VOXEL_GOLD_CANDIDATES).toHaveLength(20);
    expect(SPATIAL_VOXEL_GOLD_CANDIDATES.every((item) => item.reviewStatus === SPATIAL_GOLD_REVIEW_STATUS)).toBe(true);
    expect(new Set(SPATIAL_VOXEL_GOLD_CANDIDATES.map((item) => item.id)).size).toBe(20);
  });

  it("covers the current observation, counting, painting, hollowing and measurement bands", () => {
    expect(new Set(SPATIAL_VOXEL_GOLD_CANDIDATES.map((item) => item.capability))).toEqual(
      new Set(["P1", "P2", "P3", "P5"]),
    );
    expect(new Set(SPATIAL_VOXEL_GOLD_CANDIDATES.map((item) => item.problemFamily))).toEqual(
      new Set(["view", "layer-count", "hidden-count", "paint", "hollow", "surface-volume"]),
    );
  });

  it("matches every authored expectation against the production-independent oracle", () => {
    const failures: string[] = [];
    for (const goldCase of SPATIAL_VOXEL_GOLD_CANDIDATES) {
      for (const assertion of goldCase.assertions) {
        const actual = independentExpected(goldCase, assertion);
        if (JSON.stringify(actual) !== JSON.stringify(assertion.expected)) {
          failures.push(`${goldCase.id}:${assertion.kind} expected=${JSON.stringify(assertion.expected)} actual=${JSON.stringify(actual)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("matches every authored expectation against the spatial math kernel", () => {
    const failures = SPATIAL_VOXEL_GOLD_CANDIDATES.flatMap((goldCase) =>
      evaluateSpatialGoldCase(goldCase)
        .filter((result) => !result.pass)
        .map(
          (result) =>
            `${goldCase.id}:${result.assertion.kind} expected=${JSON.stringify(result.assertion.expected)} actual=${JSON.stringify(result.actual)}`,
        ),
    );
    expect(failures).toEqual([]);
  });
});
