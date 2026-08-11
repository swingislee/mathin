import { z } from "zod";
import {
  SPATIAL_VOXEL_LIMITS,
  type VoxelBounds,
  type VoxelCoordinate,
} from "./voxel-types";

const coordinateValueSchema = z
  .number()
  .int()
  .min(SPATIAL_VOXEL_LIMITS.minCoordinate)
  .max(SPATIAL_VOXEL_LIMITS.maxCoordinate);

export const voxelCoordinateSchema = z
  .object({
    x: coordinateValueSchema,
    y: coordinateValueSchema,
    z: coordinateValueSchema,
  })
  .strict();

export const voxelCoordinateListSchema = z
  .array(voxelCoordinateSchema)
  .max(SPATIAL_VOXEL_LIMITS.maxCells)
  .superRefine((cells, context) => {
    const firstIndexByKey = new Map<string, number>();
    cells.forEach((cell, index) => {
      const key = voxelKey(cell);
      const firstIndex = firstIndexByKey.get(key);
      if (firstIndex !== undefined) {
        context.addIssue({
          code: "custom",
          message: `duplicate voxel coordinate; first seen at index ${firstIndex}`,
          path: [index],
        });
        return;
      }
      firstIndexByKey.set(key, index);
    });
  });

export function voxelKey(cell: VoxelCoordinate): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function compareVoxelCoordinates(left: VoxelCoordinate, right: VoxelCoordinate): number {
  return left.x - right.x || left.y - right.y || left.z - right.z;
}

function boundsOf(cells: readonly VoxelCoordinate[]): VoxelBounds | null {
  const first = cells[0];
  if (!first) return null;

  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  let minZ = first.z;
  let maxZ = first.z;

  for (const cell of cells.slice(1)) {
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minY = Math.min(minY, cell.y);
    maxY = Math.max(maxY, cell.y);
    minZ = Math.min(minZ, cell.z);
    maxZ = Math.max(maxZ, cell.z);
  }

  return Object.freeze({ minX, maxX, minY, maxY, minZ, maxZ });
}

/**
 * Validated, canonical runtime representation. It is deliberately separate from
 * the serializable scene document so algorithms never depend on renderer state.
 */
export class VoxelSet {
  readonly cells: readonly VoxelCoordinate[];
  readonly bounds: VoxelBounds | null;
  readonly size: number;
  private readonly keys: ReadonlySet<string>;

  private constructor(cells: readonly VoxelCoordinate[]) {
    const canonicalCells = cells
      .map((cell) => Object.freeze({ x: cell.x, y: cell.y, z: cell.z }))
      .sort(compareVoxelCoordinates);

    this.cells = Object.freeze(canonicalCells);
    this.bounds = boundsOf(this.cells);
    this.size = this.cells.length;
    this.keys = new Set(this.cells.map(voxelKey));
    Object.freeze(this);
  }

  static parse(input: unknown): VoxelSet {
    return new VoxelSet(voxelCoordinateListSchema.parse(input));
  }

  has(cell: VoxelCoordinate): boolean {
    return this.keys.has(voxelKey(cell));
  }

  hasXYZ(x: number, y: number, z: number): boolean {
    return this.keys.has(`${x},${y},${z}`);
  }
}

export function createVoxelSet(input: unknown): VoxelSet {
  return VoxelSet.parse(input);
}
