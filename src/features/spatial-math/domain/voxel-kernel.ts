import {
  compareVoxelCoordinates,
  voxelKey,
  type VoxelSet,
} from "./voxel-schema";
import {
  AXES,
  FACE_DIRECTIONS,
  FACE_OFFSETS,
  ORTHOGRAPHIC_VIEWS,
  SPATIAL_VOXEL_LIMITS,
  type Axis,
  type EnclosedVoxelCavity,
  type FaceDirection,
  type OrthographicProjection,
  type OrthographicView,
  type PaintedVoxel,
  type ProjectedVoxelCell,
  type ProjectionBounds,
  type SignedAxis,
  type SurfacePaintAnalysis,
  type SurfacePaintOptions,
  type VoxelBounds,
  type VoxelCoordinate,
  type VoxelFace,
  type VoxelLayerCount,
  type VoxelSurfaceArea,
} from "./voxel-types";

interface ViewTransform {
  readonly horizontalAxis: SignedAxis;
  readonly verticalAxis: SignedAxis;
  readonly depthAxis: SignedAxis;
}

const VIEW_TRANSFORMS: Readonly<Record<OrthographicView, ViewTransform>> = {
  front: { horizontalAxis: "x", verticalAxis: "y", depthAxis: "z" },
  back: { horizontalAxis: "-x", verticalAxis: "y", depthAxis: "-z" },
  right: { horizontalAxis: "-z", verticalAxis: "y", depthAxis: "x" },
  left: { horizontalAxis: "z", verticalAxis: "y", depthAxis: "-x" },
  top: { horizontalAxis: "x", verticalAxis: "-z", depthAxis: "y" },
  bottom: { horizontalAxis: "x", verticalAxis: "z", depthAxis: "-y" },
};

interface BoundaryPartition {
  readonly all: readonly VoxelFace[];
  readonly exterior: readonly VoxelFace[];
  readonly interior: readonly VoxelFace[];
}

function signedAxisValue(cell: VoxelCoordinate, axis: SignedAxis): number {
  switch (axis) {
    case "x":
      return cell.x;
    case "-x":
      return -cell.x;
    case "y":
      return cell.y;
    case "-y":
      return -cell.y;
    case "z":
      return cell.z;
    case "-z":
      return -cell.z;
  }
}

function offsetCell(cell: VoxelCoordinate, direction: FaceDirection): VoxelCoordinate {
  const offset = FACE_OFFSETS[direction];
  return {
    x: cell.x + offset.x,
    y: cell.y + offset.y,
    z: cell.z + offset.z,
  };
}

function projectionBounds(cells: readonly ProjectedVoxelCell[]): ProjectionBounds | null {
  const first = cells[0];
  if (!first) return null;

  let minU = first.u;
  let maxU = first.u;
  let minV = first.v;
  let maxV = first.v;
  for (const cell of cells.slice(1)) {
    minU = Math.min(minU, cell.u);
    maxU = Math.max(maxU, cell.u);
    minV = Math.min(minV, cell.v);
    maxV = Math.max(maxV, cell.v);
  }
  return { minU, maxU, minV, maxV };
}

export function projectVoxels(voxels: VoxelSet, view: OrthographicView): OrthographicProjection {
  const transform = VIEW_TRANSFORMS[view];
  const rays = new Map<string, ProjectedVoxelCell>();

  for (const cell of voxels.cells) {
    const u = signedAxisValue(cell, transform.horizontalAxis);
    const v = signedAxisValue(cell, transform.verticalAxis);
    const depth = signedAxisValue(cell, transform.depthAxis);
    const rayKey = `${u},${v}`;
    const existing = rays.get(rayKey);

    if (!existing) {
      rays.set(rayKey, {
        u,
        v,
        depth,
        stackSize: 1,
        hiddenCount: 0,
        frontmostCell: cell,
      });
      continue;
    }

    const frontmost = depth > existing.depth;
    rays.set(rayKey, {
      u,
      v,
      depth: frontmost ? depth : existing.depth,
      stackSize: existing.stackSize + 1,
      hiddenCount: existing.hiddenCount + 1,
      frontmostCell: frontmost ? cell : existing.frontmostCell,
    });
  }

  const cells = [...rays.values()].sort((left, right) => left.v - right.v || left.u - right.u);
  return {
    view,
    horizontalAxis: transform.horizontalAxis,
    verticalAxis: transform.verticalAxis,
    depthAxis: transform.depthAxis,
    cells,
    bounds: projectionBounds(cells),
    visibleVoxelCount: cells.length,
    hiddenVoxelCount: voxels.size - cells.length,
  };
}

export function hiddenVoxelsFromView(
  voxels: VoxelSet,
  view: OrthographicView,
): readonly VoxelCoordinate[] {
  const visible = new Set(projectVoxels(voxels, view).cells.map((cell) => voxelKey(cell.frontmostCell)));
  return voxels.cells.filter((cell) => !visible.has(voxelKey(cell)));
}

export function countVoxelLayers(voxels: VoxelSet, axis: Axis): readonly VoxelLayerCount[] {
  if (!AXES.includes(axis) || !voxels.bounds) return [];

  const counts = new Map<number, number>();
  for (const cell of voxels.cells) counts.set(cell[axis], (counts.get(cell[axis]) ?? 0) + 1);

  const min = axis === "x" ? voxels.bounds.minX : axis === "y" ? voxels.bounds.minY : voxels.bounds.minZ;
  const max = axis === "x" ? voxels.bounds.maxX : axis === "y" ? voxels.bounds.maxY : voxels.bounds.maxZ;
  const layers: VoxelLayerCount[] = [];
  for (let coordinate = min; coordinate <= max; coordinate += 1) {
    layers.push({ coordinate, count: counts.get(coordinate) ?? 0 });
  }
  return layers;
}

export function connectedVoxelComponents(voxels: VoxelSet): readonly (readonly VoxelCoordinate[])[] {
  const remaining = new Map(voxels.cells.map((cell) => [voxelKey(cell), cell]));
  const components: VoxelCoordinate[][] = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value as VoxelCoordinate;
    const queue = [seed];
    const component: VoxelCoordinate[] = [];
    remaining.delete(voxelKey(seed));

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cell = queue[cursor];
      component.push(cell);
      for (const direction of FACE_DIRECTIONS) {
        const neighbor = offsetCell(cell, direction);
        const key = voxelKey(neighbor);
        const next = remaining.get(key);
        if (!next) continue;
        remaining.delete(key);
        queue.push(next);
      }
    }

    component.sort(compareVoxelCoordinates);
    components.push(component);
  }

  return components.sort((left, right) => compareVoxelCoordinates(left[0], right[0]));
}

export function boundaryVoxelFaces(voxels: VoxelSet): readonly VoxelFace[] {
  const faces: VoxelFace[] = [];
  for (const cell of voxels.cells) {
    for (const direction of FACE_DIRECTIONS) {
      const neighbor = offsetCell(cell, direction);
      if (!voxels.has(neighbor)) faces.push({ cell, direction, neighbor });
    }
  }
  return faces;
}

function expandedBounds(bounds: VoxelBounds): VoxelBounds {
  return {
    minX: bounds.minX - 1,
    maxX: bounds.maxX + 1,
    minY: bounds.minY - 1,
    maxY: bounds.maxY + 1,
    minZ: bounds.minZ - 1,
    maxZ: bounds.maxZ + 1,
  };
}

function boundsVolume(bounds: VoxelBounds): number {
  return (
    (bounds.maxX - bounds.minX + 1) *
    (bounds.maxY - bounds.minY + 1) *
    (bounds.maxZ - bounds.minZ + 1)
  );
}

function inBounds(cell: VoxelCoordinate, bounds: VoxelBounds): boolean {
  return (
    cell.x >= bounds.minX &&
    cell.x <= bounds.maxX &&
    cell.y >= bounds.minY &&
    cell.y <= bounds.maxY &&
    cell.z >= bounds.minZ &&
    cell.z <= bounds.maxZ
  );
}

export class VoxelAnalysisLimitError extends Error {
  readonly code = "VOXEL_FLOOD_VOLUME_LIMIT";
  readonly requestedCells: number;
  readonly maxCells = SPATIAL_VOXEL_LIMITS.maxFloodCells;

  constructor(requestedCells: number) {
    super(
      `voxel flood volume ${requestedCells} exceeds limit ${SPATIAL_VOXEL_LIMITS.maxFloodCells}`,
    );
    this.name = "VoxelAnalysisLimitError";
    this.requestedCells = requestedCells;
  }
}

export function findEnclosedVoxelCavities(voxels: VoxelSet): readonly EnclosedVoxelCavity[] {
  if (!voxels.bounds) return [];

  const floodBounds = expandedBounds(voxels.bounds);
  const floodVolume = boundsVolume(floodBounds);
  if (floodVolume > SPATIAL_VOXEL_LIMITS.maxFloodCells) {
    throw new VoxelAnalysisLimitError(floodVolume);
  }

  const seed: VoxelCoordinate = {
    x: floodBounds.minX,
    y: floodBounds.minY,
    z: floodBounds.minZ,
  };
  const exteriorAir = new Set<string>([voxelKey(seed)]);
  const queue = [seed];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    for (const direction of FACE_DIRECTIONS) {
      const neighbor = offsetCell(cell, direction);
      const key = voxelKey(neighbor);
      if (!inBounds(neighbor, floodBounds) || voxels.has(neighbor) || exteriorAir.has(key)) continue;
      exteriorAir.add(key);
      queue.push(neighbor);
    }
  }

  const enclosed = new Map<string, VoxelCoordinate>();
  for (let x = voxels.bounds.minX; x <= voxels.bounds.maxX; x += 1) {
    for (let y = voxels.bounds.minY; y <= voxels.bounds.maxY; y += 1) {
      for (let z = voxels.bounds.minZ; z <= voxels.bounds.maxZ; z += 1) {
        const cell = { x, y, z };
        const key = voxelKey(cell);
        if (!voxels.has(cell) && !exteriorAir.has(key)) enclosed.set(key, cell);
      }
    }
  }

  const cavities: EnclosedVoxelCavity[] = [];
  while (enclosed.size > 0) {
    const seedCell = enclosed.values().next().value as VoxelCoordinate;
    const cavityQueue = [seedCell];
    const cells: VoxelCoordinate[] = [];
    enclosed.delete(voxelKey(seedCell));

    for (let cursor = 0; cursor < cavityQueue.length; cursor += 1) {
      const cell = cavityQueue[cursor];
      cells.push(cell);
      for (const direction of FACE_DIRECTIONS) {
        const neighbor = offsetCell(cell, direction);
        const key = voxelKey(neighbor);
        const next = enclosed.get(key);
        if (!next) continue;
        enclosed.delete(key);
        cavityQueue.push(next);
      }
    }

    cells.sort(compareVoxelCoordinates);
    cavities.push({ cells, volumeInUnitCubes: cells.length });
  }

  return cavities.sort((left, right) => compareVoxelCoordinates(left.cells[0], right.cells[0]));
}

function partitionBoundaryFaces(voxels: VoxelSet): BoundaryPartition {
  const all = boundaryVoxelFaces(voxels);
  const enclosedAir = new Set(
    findEnclosedVoxelCavities(voxels).flatMap((cavity) => cavity.cells.map(voxelKey)),
  );
  const exterior: VoxelFace[] = [];
  const interior: VoxelFace[] = [];

  for (const face of all) {
    (enclosedAir.has(voxelKey(face.neighbor)) ? interior : exterior).push(face);
  }
  return { all, exterior, interior };
}

export function analyzeVoxelSurfaceArea(voxels: VoxelSet): VoxelSurfaceArea {
  const faces = partitionBoundaryFaces(voxels);
  return {
    totalUnitFaces: faces.all.length,
    exteriorUnitFaces: faces.exterior.length,
    interiorUnitFaces: faces.interior.length,
  };
}

function validatedPaintDirections(directions: readonly FaceDirection[]): readonly FaceDirection[] {
  const unique = new Set<FaceDirection>();
  for (const direction of directions) {
    if (!FACE_DIRECTIONS.includes(direction)) throw new Error(`invalid face direction: ${direction}`);
    unique.add(direction);
  }
  return FACE_DIRECTIONS.filter((direction) => unique.has(direction));
}

export function analyzeSurfacePaint(
  voxels: VoxelSet,
  options: SurfacePaintOptions = {},
): SurfacePaintAnalysis {
  const exposure = options.exposure ?? "exterior-only";
  if (exposure !== "exterior-only" && exposure !== "all-boundary") {
    throw new Error(`invalid surface exposure: ${exposure}`);
  }
  const directions = validatedPaintDirections(options.directions ?? FACE_DIRECTIONS);
  const directionSet = new Set(directions);
  const candidateFaces =
    exposure === "exterior-only" ? partitionBoundaryFaces(voxels).exterior : boundaryVoxelFaces(voxels);
  const paintedFaces = candidateFaces.filter((face) => directionSet.has(face.direction));
  const countByVoxel = new Map(voxels.cells.map((cell) => [voxelKey(cell), 0]));

  for (const face of paintedFaces) {
    const key = voxelKey(face.cell);
    countByVoxel.set(key, (countByVoxel.get(key) ?? 0) + 1);
  }

  const histogram = [0, 0, 0, 0, 0, 0, 0] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const paintedVoxels: PaintedVoxel[] = voxels.cells.map((cell) => {
    const paintedFaceCount = countByVoxel.get(voxelKey(cell)) ?? 0;
    histogram[paintedFaceCount] += 1;
    return { cell, paintedFaceCount };
  });

  return {
    exposure,
    directions,
    paintedUnitFaces: paintedFaces.length,
    histogram,
    voxels: paintedVoxels,
  };
}

export function primaryOrthographicProjections(
  voxels: VoxelSet,
): Readonly<Record<"front" | "right" | "top", OrthographicProjection>> {
  return {
    front: projectVoxels(voxels, "front"),
    right: projectVoxels(voxels, "right"),
    top: projectVoxels(voxels, "top"),
  };
}

export function allOrthographicProjections(
  voxels: VoxelSet,
): Readonly<Record<OrthographicView, OrthographicProjection>> {
  return Object.fromEntries(ORTHOGRAPHIC_VIEWS.map((view) => [view, projectVoxels(voxels, view)])) as Readonly<
    Record<OrthographicView, OrthographicProjection>
  >;
}
