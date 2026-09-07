import type { FaceDirection, VoxelFaceSelection } from "../domain";
import { FACE_DIRECTIONS, FACE_OFFSETS, voxelKey } from "../domain";
import type { VoxelRenderCell } from "./voxel-render-model";

export const VOXEL_SOLID_SIZE = 1;
export const VOXEL_EDGE_THICKNESS = 0.055;
export const VOXEL_EDGE_LENGTH = 1.035;
export const VOXEL_EDGE_COLOR = "#211e1a";
export const VOXEL_PAINT_FACE_OFFSET = 0.501;

export type VoxelEdgeAxis = "x" | "y" | "z";

export interface VoxelEdgeInstance {
  readonly key: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
  readonly color?: string;
  readonly priority?: number;
}

export interface VoxelEdgeInstanceGroups {
  readonly x: readonly VoxelEdgeInstance[];
  readonly y: readonly VoxelEdgeInstance[];
  readonly z: readonly VoxelEdgeInstance[];
}

export interface VoxelPaintFaceInstance {
  readonly key: string;
  readonly direction: FaceDirection;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number };
}

function coordinateKey(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
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
  emphasis?: VoxelRenderCell["emphasis"],
) {
  const key = edgeKey(axis, x, y, z);
  const existing = target.get(key);
  // 相邻块仍共享同一条棱边，高亮替换原颜色而不增添几何；单独选择优先于分组。
  if (existing && (!emphasis || (existing.priority ?? 0) >= emphasis.priority)) return;
  target.set(key, {
    key,
    center: { x, y, z },
    scale: edgeScale(axis),
    ...(emphasis ? { color: emphasis.color, priority: emphasis.priority } : {}),
  });
}

/**
 * Builds deterministic, de-duplicated solid edge bars for visible unit cubes.
 * Adjacent cubes share the bars on their common face, so thick outlines do not
 * add duplicate coplanar geometry while exterior seams remain legible.
 */
export function buildVoxelEdgeInstances(
  cells: readonly Pick<VoxelRenderCell, "x" | "y" | "z" | "emphasis">[],
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
        insertEdge(groups.x, "x", cell.x, cell.y + first, cell.z + second, cell.emphasis);
        insertEdge(groups.y, "y", cell.x + first, cell.y, cell.z + second, cell.emphasis);
        insertEdge(groups.z, "z", cell.x + first, cell.y + second, cell.z, cell.emphasis);
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

/** 高亮只覆盖当前可见外露面，保留后方方块遮挡及原来的面染色。 */
export function buildVoxelEmphasisFaceGroups(cells: readonly Pick<VoxelRenderCell, "x" | "y" | "z" | "emphasis">[]) {
  const occupied = new Set(cells.map(voxelKey));
  const groups = new Map<string, { color: string; opacity: number; faces: VoxelFaceSelection[] }>();
  for (const cell of cells) {
    if (!cell.emphasis) continue;
    const { color, faceOpacity: opacity } = cell.emphasis;
    const key = color + ":" + opacity;
    const group = groups.get(key) ?? { color, opacity, faces: [] };
    for (const direction of FACE_DIRECTIONS) {
      const offset = FACE_OFFSETS[direction];
      if (!occupied.has(voxelKey({ x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z }))) {
        group.faces.push({ cell, direction });
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

const paintFaceTransform: Readonly<Record<FaceDirection, {
  readonly offset: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number };
}>> = {
  "x-": { offset: { x: -VOXEL_PAINT_FACE_OFFSET, y: 0, z: 0 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } },
  "x+": { offset: { x: VOXEL_PAINT_FACE_OFFSET, y: 0, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
  "y-": { offset: { x: 0, y: -VOXEL_PAINT_FACE_OFFSET, z: 0 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } },
  "y+": { offset: { x: 0, y: VOXEL_PAINT_FACE_OFFSET, z: 0 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 } },
  "z-": { offset: { x: 0, y: 0, z: -VOXEL_PAINT_FACE_OFFSET }, rotation: { x: 0, y: Math.PI, z: 0 } },
  "z+": { offset: { x: 0, y: 0, z: VOXEL_PAINT_FACE_OFFSET }, rotation: { x: 0, y: 0, z: 0 } },
};

export function buildVoxelPaintFaceInstances(
  cells: readonly Pick<VoxelRenderCell, "x" | "y" | "z">[],
  faces: readonly VoxelFaceSelection[],
  faceOffset = VOXEL_PAINT_FACE_OFFSET,
): readonly VoxelPaintFaceInstance[] {
  const visibleCells = new Set(cells.map((cell) => voxelKey(cell)));
  return faces
    .filter((face) => visibleCells.has(voxelKey(face.cell)))
    .map((face) => {
      const transform = paintFaceTransform[face.direction];
      const extraOffset = faceOffset - VOXEL_PAINT_FACE_OFFSET;
      return {
        key: `${voxelKey(face.cell)}:${face.direction}`,
        direction: face.direction,
        center: {
          x: face.cell.x + transform.offset.x + FACE_OFFSETS[face.direction].x * extraOffset,
          y: face.cell.y + transform.offset.y + FACE_OFFSETS[face.direction].y * extraOffset,
          z: face.cell.z + transform.offset.z + FACE_OFFSETS[face.direction].z * extraOffset,
        },
        rotation: transform.rotation,
      };
    });
}

export function voxelFaceDirectionFromNormal(
  normal: { readonly x: number; readonly y: number; readonly z: number },
): FaceDirection | null {
  const candidates = [
    { axis: "x" as const, magnitude: Math.abs(normal.x), value: normal.x },
    { axis: "y" as const, magnitude: Math.abs(normal.y), value: normal.y },
    { axis: "z" as const, magnitude: Math.abs(normal.z), value: normal.z },
  ].sort((left, right) => right.magnitude - left.magnitude);
  const primary = candidates[0];
  if (!primary || primary.magnitude < 0.5) return null;
  return `${primary.axis}${primary.value < 0 ? "-" : "+"}`;
}
