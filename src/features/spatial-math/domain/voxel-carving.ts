import { analyzeVoxelSurfaceArea, findEnclosedVoxelCavities } from "./voxel-kernel";
import {
  VOXEL_CARVING_VERSION,
  parseVoxelCarvingState,
  type VoxelCarvingState,
} from "./voxel-carving-schema";
import {
  compareVoxelCoordinates,
  createVoxelSet,
  voxelKey,
  type VoxelSet,
} from "./voxel-schema";
import type { VoxelCoordinate } from "./voxel-types";

export interface VoxelCarvingSummary {
  readonly originalVolume: number;
  readonly removedVolume: number;
  readonly remainingVolume: number;
  readonly totalSurfaceArea: number;
  readonly exteriorSurfaceArea: number;
  readonly interiorSurfaceArea: number;
  readonly enclosedCavityCount: number;
  readonly enclosedCavityVolume: number;
}

export function createVoxelCarvingState(input: {
  readonly entityId: string;
  readonly removedCells?: readonly VoxelCoordinate[];
}): VoxelCarvingState {
  return parseVoxelCarvingState({
    carvingVersion: VOXEL_CARVING_VERSION,
    entityId: input.entityId,
    removedCells: (input.removedCells ?? [])
      .map((cell) => ({ x: cell.x, y: cell.y, z: cell.z }))
      .sort(compareVoxelCoordinates),
  });
}

export function validateVoxelCarvingState(
  source: VoxelSet,
  stateInput: unknown,
): VoxelCarvingState {
  const state = parseVoxelCarvingState(stateInput);
  for (const cell of state.removedCells) {
    if (!source.has(cell)) throw new RangeError(`removed voxel is not in source: ${voxelKey(cell)}`);
  }
  return state;
}

export function carveVoxelSet(source: VoxelSet, stateInput: unknown): VoxelSet {
  const state = validateVoxelCarvingState(source, stateInput);
  const removed = new Set(state.removedCells.map(voxelKey));
  return createVoxelSet(source.cells.filter((cell) => !removed.has(voxelKey(cell))));
}

export function replaceVoxelCarvingCells(
  source: VoxelSet,
  stateInput: unknown,
  removedCells: readonly VoxelCoordinate[],
): VoxelCarvingState {
  const state = validateVoxelCarvingState(source, stateInput);
  return validateVoxelCarvingState(source, createVoxelCarvingState({
    entityId: state.entityId,
    removedCells,
  }));
}

export function toggleVoxelCarvingCell(
  source: VoxelSet,
  stateInput: unknown,
  cell: VoxelCoordinate,
): VoxelCarvingState {
  const state = validateVoxelCarvingState(source, stateInput);
  if (!source.has(cell)) throw new RangeError(`carved voxel is not in source: ${voxelKey(cell)}`);
  const target = voxelKey(cell);
  const exists = state.removedCells.some((candidate) => voxelKey(candidate) === target);
  return createVoxelCarvingState({
    entityId: state.entityId,
    removedCells: exists
      ? state.removedCells.filter((candidate) => voxelKey(candidate) !== target)
      : [...state.removedCells, cell],
  });
}

export function summarizeVoxelCarving(
  source: VoxelSet,
  stateInput: unknown,
): VoxelCarvingSummary {
  const state = validateVoxelCarvingState(source, stateInput);
  const remaining = carveVoxelSet(source, state);
  const surface = analyzeVoxelSurfaceArea(remaining);
  const cavities = findEnclosedVoxelCavities(remaining);
  return {
    originalVolume: source.size,
    removedVolume: state.removedCells.length,
    remainingVolume: remaining.size,
    totalSurfaceArea: surface.totalUnitFaces,
    exteriorSurfaceArea: surface.exteriorUnitFaces,
    interiorSurfaceArea: surface.interiorUnitFaces,
    enclosedCavityCount: cavities.length,
    enclosedCavityVolume: cavities.reduce((sum, cavity) => sum + cavity.volumeInUnitCubes, 0),
  };
}
