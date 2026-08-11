export const SPATIAL_VOXEL_LIMITS = {
  maxCells: 8_192,
  minCoordinate: -1_024,
  maxCoordinate: 1_024,
  maxFloodCells: 262_144,
} as const;

export const AXES = ["x", "y", "z"] as const;
export type Axis = (typeof AXES)[number];

export const FACE_DIRECTIONS = ["x-", "x+", "y-", "y+", "z-", "z+"] as const;
export type FaceDirection = (typeof FACE_DIRECTIONS)[number];

export const ORTHOGRAPHIC_VIEWS = ["front", "back", "right", "left", "top", "bottom"] as const;
export type OrthographicView = (typeof ORTHOGRAPHIC_VIEWS)[number];

export type SignedAxis = Axis | `-${Axis}`;

export interface VoxelCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VoxelBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface VoxelLayerCount {
  readonly coordinate: number;
  readonly count: number;
}

export interface ProjectedVoxelCell {
  readonly u: number;
  readonly v: number;
  readonly depth: number;
  readonly stackSize: number;
  readonly hiddenCount: number;
  readonly frontmostCell: VoxelCoordinate;
}

export interface ProjectionBounds {
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

export interface OrthographicProjection {
  readonly view: OrthographicView;
  readonly horizontalAxis: SignedAxis;
  readonly verticalAxis: SignedAxis;
  readonly depthAxis: SignedAxis;
  readonly cells: readonly ProjectedVoxelCell[];
  readonly bounds: ProjectionBounds | null;
  readonly visibleVoxelCount: number;
  readonly hiddenVoxelCount: number;
}

export interface VoxelFace {
  readonly cell: VoxelCoordinate;
  readonly direction: FaceDirection;
  readonly neighbor: VoxelCoordinate;
}

export interface EnclosedVoxelCavity {
  readonly cells: readonly VoxelCoordinate[];
  readonly volumeInUnitCubes: number;
}

export interface VoxelSurfaceArea {
  readonly totalUnitFaces: number;
  readonly exteriorUnitFaces: number;
  readonly interiorUnitFaces: number;
}

export interface PaintedVoxel {
  readonly cell: VoxelCoordinate;
  readonly paintedFaceCount: number;
}

export interface SurfacePaintAnalysis {
  readonly exposure: "exterior-only" | "all-boundary";
  readonly directions: readonly FaceDirection[];
  readonly paintedUnitFaces: number;
  readonly histogram: readonly [number, number, number, number, number, number, number];
  readonly voxels: readonly PaintedVoxel[];
}

export interface SurfacePaintOptions {
  readonly exposure?: "exterior-only" | "all-boundary";
  readonly directions?: readonly FaceDirection[];
}

export const FACE_OFFSETS: Readonly<Record<FaceDirection, VoxelCoordinate>> = {
  "x-": { x: -1, y: 0, z: 0 },
  "x+": { x: 1, y: 0, z: 0 },
  "y-": { x: 0, y: -1, z: 0 },
  "y+": { x: 0, y: 1, z: 0 },
  "z-": { x: 0, y: 0, z: -1 },
  "z+": { x: 0, y: 0, z: 1 },
};
