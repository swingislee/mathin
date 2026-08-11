import {
  compareSquareCells,
  parseUnitSquareNet,
  squareCellKey,
  unitSquareNet,
  type SquareCell,
  type UnitSquareNet,
} from "./net-schema";

export const CUBE_NET_KERNEL_VERSION = "cube-net-kernel-v1" as const;

export const CUBE_NET_ANALYSIS_REASONS = {
  valid: "VALID",
  cellCount: "CELL_COUNT",
  disconnected: "DISCONNECTED",
  orientationConflict: "ORIENTATION_CONFLICT",
  faceOverlap: "FACE_OVERLAP",
} as const;

export type CubeNetAnalysisReason =
  (typeof CUBE_NET_ANALYSIS_REASONS)[keyof typeof CUBE_NET_ANALYSIS_REASONS];

type AxisComponent = -1 | 0 | 1;

export interface IntegerVector3 {
  readonly x: AxisComponent;
  readonly y: AxisComponent;
  readonly z: AxisComponent;
}

export type CubeFaceDirection = "x-" | "x+" | "y-" | "y+" | "z-" | "z+";

export interface CubeNetFacePlacement {
  readonly cell: SquareCell;
  readonly normal: IntegerVector3;
  readonly right: IntegerVector3;
  readonly up: IntegerVector3;
  readonly cubeFace: CubeFaceDirection;
}

export interface CubeNetAnalysis {
  readonly kernelVersion: typeof CUBE_NET_KERNEL_VERSION;
  readonly canonicalKey: string;
  readonly cellCount: number;
  readonly adjacencyEdgeCount: number;
  readonly connected: boolean;
  readonly isCubeNet: boolean;
  readonly reason: CubeNetAnalysisReason;
  readonly faces: readonly CubeNetFacePlacement[];
}

const PLANAR_DIRECTIONS = [
  { dx: 1, dy: 0, direction: "east" },
  { dx: 0, dy: 1, direction: "north" },
  { dx: -1, dy: 0, direction: "west" },
  { dx: 0, dy: -1, direction: "south" },
] as const;

type PlanarDirection = (typeof PLANAR_DIRECTIONS)[number]["direction"];

interface FaceOrientation {
  readonly normal: IntegerVector3;
  readonly right: IntegerVector3;
  readonly up: IntegerVector3;
}

const ROOT_ORIENTATION: FaceOrientation = {
  normal: { x: 0, y: 0, z: 1 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};

function negate(vector: IntegerVector3): IntegerVector3 {
  const component = (value: AxisComponent): AxisComponent => (value === 0 ? 0 : (-value as AxisComponent));
  return { x: component(vector.x), y: component(vector.y), z: component(vector.z) };
}

function sameVector(left: IntegerVector3, right: IntegerVector3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function sameOrientation(left: FaceOrientation, right: FaceOrientation): boolean {
  return sameVector(left.normal, right.normal) && sameVector(left.right, right.right) && sameVector(left.up, right.up);
}

function foldOrientation(orientation: FaceOrientation, direction: PlanarDirection): FaceOrientation {
  if (direction === "east") {
    return { normal: orientation.right, right: negate(orientation.normal), up: orientation.up };
  }
  if (direction === "west") {
    return { normal: negate(orientation.right), right: orientation.normal, up: orientation.up };
  }
  if (direction === "north") {
    return { normal: orientation.up, right: orientation.right, up: negate(orientation.normal) };
  }
  return { normal: negate(orientation.up), right: orientation.right, up: orientation.normal };
}

function cubeFaceForNormal(normal: IntegerVector3): CubeFaceDirection {
  if (normal.x === 1) return "x+";
  if (normal.x === -1) return "x-";
  if (normal.y === 1) return "y+";
  if (normal.y === -1) return "y-";
  if (normal.z === 1) return "z+";
  return "z-";
}

function vectorKey(vector: IntegerVector3): string {
  return `${vector.x},${vector.y},${vector.z}`;
}

function normalizedCells(cells: readonly SquareCell[]): SquareCell[] {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return cells.map((cell) => ({ x: cell.x - minX, y: cell.y - minY })).sort(compareSquareCells);
}

function transformedCells(cells: readonly SquareCell[], transformIndex: number): SquareCell[] {
  const transformed = cells.map(({ x, y }) => {
    if (transformIndex === 0) return { x, y };
    if (transformIndex === 1) return { x: -y, y: x };
    if (transformIndex === 2) return { x: -x, y: -y };
    if (transformIndex === 3) return { x: y, y: -x };
    if (transformIndex === 4) return { x: -x, y };
    if (transformIndex === 5) return { x: -y, y: -x };
    if (transformIndex === 6) return { x, y: -y };
    return { x: y, y: x };
  });
  return normalizedCells(transformed);
}

function cellsKey(cells: readonly SquareCell[]): string {
  return cells.map(squareCellKey).join(";");
}

function canonicalCells(cells: readonly SquareCell[]): SquareCell[] {
  let bestCells = transformedCells(cells, 0);
  let bestKey = cellsKey(bestCells);
  for (let transformIndex = 1; transformIndex < 8; transformIndex += 1) {
    const candidate = transformedCells(cells, transformIndex);
    const candidateKey = cellsKey(candidate);
    if (candidateKey < bestKey) {
      bestCells = candidate;
      bestKey = candidateKey;
    }
  }
  return bestCells;
}

export function canonicalizeFreeUnitSquareNet(input: unknown): UnitSquareNet {
  const net = parseUnitSquareNet(input);
  return unitSquareNet(canonicalCells(net.cells));
}

export function unitSquareNetCanonicalKey(input: unknown): string {
  return cellsKey(canonicalizeFreeUnitSquareNet(input).cells);
}

/** Enumerates free polyominoes modulo translation, rotation and reflection. */
export function enumerateFreePolyominoes(cellCount: number): readonly UnitSquareNet[] {
  if (!Number.isInteger(cellCount) || cellCount < 1 || cellCount > 8) {
    throw new RangeError("cellCount must be an integer from 1 through 8");
  }

  let current = new Map<string, UnitSquareNet>();
  const seed = unitSquareNet([{ x: 0, y: 0 }]);
  current.set(unitSquareNetCanonicalKey(seed), seed);

  for (let size = 2; size <= cellCount; size += 1) {
    const next = new Map<string, UnitSquareNet>();
    for (const net of current.values()) {
      const occupied = new Set(net.cells.map(squareCellKey));
      for (const cell of net.cells) {
        for (const { dx, dy } of PLANAR_DIRECTIONS) {
          const candidateCell = { x: cell.x + dx, y: cell.y + dy };
          if (occupied.has(squareCellKey(candidateCell))) continue;
          const candidate = unitSquareNet(canonicalCells([...net.cells, candidateCell]));
          next.set(cellsKey(candidate.cells), candidate);
        }
      }
    }
    current = next;
  }

  return [...current.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, net]) => net);
}

function adjacencyEdgeCount(net: UnitSquareNet): number {
  const occupied = new Set(net.cells.map(squareCellKey));
  return net.cells.reduce(
    (total, cell) =>
      total +
      Number(occupied.has(squareCellKey({ x: cell.x + 1, y: cell.y }))) +
      Number(occupied.has(squareCellKey({ x: cell.x, y: cell.y + 1 }))),
    0,
  );
}

function connectedCellCount(net: UnitSquareNet): number {
  const occupied = new Set(net.cells.map(squareCellKey));
  const visited = new Set<string>();
  const queue = [net.cells[0]];
  while (queue.length > 0) {
    const cell = queue.shift();
    if (!cell) break;
    const key = squareCellKey(cell);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const { dx, dy } of PLANAR_DIRECTIONS) {
      const neighbor = { x: cell.x + dx, y: cell.y + dy };
      const neighborKey = squareCellKey(neighbor);
      if (occupied.has(neighborKey) && !visited.has(neighborKey)) queue.push(neighbor);
    }
  }
  return visited.size;
}

function analysisBase(net: UnitSquareNet) {
  return {
    kernelVersion: CUBE_NET_KERNEL_VERSION,
    canonicalKey: unitSquareNetCanonicalKey(net),
    cellCount: net.cells.length,
    adjacencyEdgeCount: adjacencyEdgeCount(net),
  } as const;
}

export function analyzeCubeNet(input: unknown): CubeNetAnalysis {
  const net = parseUnitSquareNet(input);
  const base = analysisBase(net);
  if (net.cells.length !== 6) {
    return { ...base, connected: connectedCellCount(net) === net.cells.length, isCubeNet: false, reason: "CELL_COUNT", faces: [] };
  }
  if (connectedCellCount(net) !== net.cells.length) {
    return { ...base, connected: false, isCubeNet: false, reason: "DISCONNECTED", faces: [] };
  }

  const occupied = new Set(net.cells.map(squareCellKey));
  const orientations = new Map<string, FaceOrientation>();
  orientations.set(squareCellKey(net.cells[0]), ROOT_ORIENTATION);
  const queue = [net.cells[0]];
  let orientationConflict = false;

  while (queue.length > 0) {
    const cell = queue.shift();
    if (!cell) break;
    const orientation = orientations.get(squareCellKey(cell));
    if (!orientation) throw new Error("connected cube net traversal lost a face orientation");
    for (const { dx, dy, direction } of PLANAR_DIRECTIONS) {
      const neighbor = { x: cell.x + dx, y: cell.y + dy };
      const neighborKey = squareCellKey(neighbor);
      if (!occupied.has(neighborKey)) continue;
      const expected = foldOrientation(orientation, direction);
      const existing = orientations.get(neighborKey);
      if (existing && !sameOrientation(existing, expected)) {
        orientationConflict = true;
        continue;
      }
      if (!existing) {
        orientations.set(neighborKey, expected);
        queue.push(neighbor);
      }
    }
  }

  const faces = net.cells
    .map((cell): CubeNetFacePlacement => {
      const orientation = orientations.get(squareCellKey(cell));
      if (!orientation) throw new Error("connected cube net is missing an orientation");
      return { cell, ...orientation, cubeFace: cubeFaceForNormal(orientation.normal) };
    })
    .sort((left, right) => compareSquareCells(left.cell, right.cell));

  if (orientationConflict) {
    return { ...base, connected: true, isCubeNet: false, reason: "ORIENTATION_CONFLICT", faces };
  }
  const normalCount = new Set(faces.map((face) => vectorKey(face.normal))).size;
  if (normalCount !== 6) {
    return { ...base, connected: true, isCubeNet: false, reason: "FACE_OVERLAP", faces };
  }
  return { ...base, connected: true, isCubeNet: true, reason: "VALID", faces };
}
