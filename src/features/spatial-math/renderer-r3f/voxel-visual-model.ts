import type { VoxelRenderCell } from "./voxel-render-model";

export const VOXEL_SOLID_SIZE = 1;
export const VOXEL_EDGE_THICKNESS = 0.055;
export const VOXEL_EDGE_LENGTH = 1.035;
export const VOXEL_EDGE_COLOR = "#211e1a";

export type VoxelEdgeAxis = "x" | "y" | "z";

export interface VoxelEdgeInstance {
  readonly key: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
}

export interface VoxelEdgeInstanceGroups {
  readonly x: readonly VoxelEdgeInstance[];
  readonly y: readonly VoxelEdgeInstance[];
  readonly z: readonly VoxelEdgeInstance[];
}

function coordinateKey(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function edgeKey(
  axis: VoxelEdgeAxis,
  x: number,
  y: number,
  z: number,
): string {
  return `${axis}:${coordinateKey(x)}:${coordinateKey(y)}:${coordinateKey(z)}`;
}

function edgeScale(axis: VoxelEdgeAxis) {
  return {
    x: axis === "x" ? VOXEL_EDGE_LENGTH : VOXEL_EDGE_THICKNESS,
    y: axis === "y" ? VOXEL_EDGE_LENGTH : VOXEL_EDGE_THICKNESS,
    z: axis === "z" ? VOXEL_EDGE_LENGTH : VOXEL_EDGE_THICKNESS,
  };
}

function insertEdge(
  target: Map<string, VoxelEdgeInstance>,
  axis: VoxelEdgeAxis,
  x: number,
  y: number,
  z: number,
) {
  const key = edgeKey(axis, x, y, z);
  if (target.has(key)) return;
  target.set(key, {
    key,
    center: { x, y, z },
    scale: edgeScale(axis),
  });
}

/**
 * Builds deterministic, de-duplicated solid edge bars for visible unit cubes.
 * Adjacent cubes share the bars on their common face, so thick outlines do not
 * add duplicate coplanar geometry while exterior seams remain legible.
 */
export function buildVoxelEdgeInstances(
  cells: readonly Pick<VoxelRenderCell, "x" | "y" | "z">[],
): VoxelEdgeInstanceGroups {
  const groups = {
    x: new Map<string, VoxelEdgeInstance>(),
    y: new Map<string, VoxelEdgeInstance>(),
    z: new Map<string, VoxelEdgeInstance>(),
  };
  const offsets = [-0.5, 0.5] as const;

  for (const cell of cells) {
    for (const first of offsets) {
      for (const second of offsets) {
        insertEdge(groups.x, "x", cell.x, cell.y + first, cell.z + second);
        insertEdge(groups.y, "y", cell.x + first, cell.y, cell.z + second);
        insertEdge(groups.z, "z", cell.x + first, cell.y + second, cell.z);
      }
    }
  }

  const stable = (entries: Map<string, VoxelEdgeInstance>) =>
    [...entries.values()].sort((left, right) => left.key.localeCompare(right.key));
  return {
    x: stable(groups.x),
    y: stable(groups.y),
    z: stable(groups.z),
  };
}
