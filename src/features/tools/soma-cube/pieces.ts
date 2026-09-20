import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { spatialBasisQuaternion, type SpatialRigidPose } from "../spatial-interaction/rigid-motion";
import { spatialRigidAxes, spatialRigidPoint, spatialUnitCubesOverlap } from "../spatial-interaction/rigid-geometry";

export const SOMA_IDS = ["bao-1", "bao-2", "bao-3", "bao-4", "bao-5", "bao-6", "bao-7"] as const;
export type SomaId = (typeof SOMA_IDS)[number];
export const SOMA_LIMIT = 12;
type Matrix = readonly [VoxelCoordinate, VoxelCoordinate, VoxelCoordinate];
const point = (x: number, y: number, z: number): VoxelCoordinate => ({ x, y, z });

/** 来自用户七个 GLB 的单位块相对位置；颜色取内嵌底色纹理的众数（sRGB）。 */
export const SOMA_PIECES = [
  { id: "bao-1", name: "1宝", color: "#ffffff", cells: [point(0, 1, 0), point(0, 0, 0), point(0, 0, 1)] },
  { id: "bao-2", name: "2宝", color: "#ffff00", cells: [point(0, 0, 2), point(0, 1, 0), point(0, 0, 0), point(0, 0, 1)] },
  { id: "bao-3", name: "3宝", color: "#fe0000", cells: [point(0, 0, 2), point(0, 1, 1), point(0, 0, 0), point(0, 0, 1)] },
  { id: "bao-4", name: "4宝", color: "#ffa500", cells: [point(0, 0, 2), point(0, 1, 1), point(0, 1, 0), point(0, 0, 1)] },
  { id: "bao-5", name: "5宝", color: "#81007f", cells: [point(1, 0, 0), point(0, 1, 1), point(0, 0, 0), point(0, 0, 1)] },
  { id: "bao-6", name: "6宝", color: "#00ff01", cells: [point(1, 0, 1), point(0, 1, 0), point(0, 0, 0), point(0, 0, 1)] },
  { id: "bao-7", name: "7宝", color: "#0000fe", cells: [point(1, 0, 0), point(0, 1, 0), point(0, 0, 0), point(0, 0, 1)] },
] as const satisfies readonly { id: SomaId; name: string; color: string; cells: readonly VoxelCoordinate[] }[];

export function somaDefinition(id: SomaId) { return SOMA_PIECES.find((piece) => piece.id === id)!; }
export function quarterTurn(p: VoxelCoordinate, axis: Axis): VoxelCoordinate {
  if (axis === "x") return point(p.x, -p.z, p.y);
  if (axis === "y") return point(p.z, p.y, -p.x);
  return point(-p.y, p.x, p.z);
}
function matrixKey(matrix: Matrix) { return matrix.map((p) => `${p.x},${p.y},${p.z}`).join(";"); }
/** 固定 BFS 顺序是 v1 朝向编号合同，仅包含旋转，保持 5宝/6宝的左右手性。 */
export const SOMA_ROTATIONS: readonly Matrix[] = (() => {
  const matrices: Matrix[] = [[point(1, 0, 0), point(0, 1, 0), point(0, 0, 1)]];
  const seen = new Set(matrices.map(matrixKey));
  for (let i = 0; i < matrices.length; i++) for (const axis of ["x", "y", "z"] as const) {
    const next = matrices[i].map((p) => quarterTurn(p, axis)) as unknown as Matrix;
    if (!seen.has(matrixKey(next))) { seen.add(matrixKey(next)); matrices.push(next); }
  }
  return matrices;
})();
export function somaTurn(orientation: number, axis: Axis, direction: -1 | 1) {
  let matrix = SOMA_ROTATIONS[orientation];
  for (let turn = 0; turn < (direction === 1 ? 1 : 3); turn++) matrix = matrix.map((p) => quarterTurn(p, axis)) as unknown as Matrix;
  return SOMA_ROTATIONS.findIndex((candidate) => matrixKey(candidate) === matrixKey(matrix));
}
export function somaLocalCells(id: SomaId, orientation: number): VoxelCoordinate[] {
  const [a, b, c] = SOMA_ROTATIONS[orientation];
  const cells = somaDefinition(id).cells.map((p) => point(p.x * a.x + p.y * b.x + p.z * c.x, p.x * a.y + p.y * b.y + p.z * c.y, p.x * a.z + p.y * b.z + p.z * c.z));
  const min = point(Math.min(...cells.map((p) => p.x)), Math.min(...cells.map((p) => p.y)), Math.min(...cells.map((p) => p.z)));
  return cells.map((p) => point(p.x - min.x, p.y - min.y, p.z - min.z));
}
export interface SomaGridPiece { id: SomaId; position: VoxelCoordinate; orientation: number; quaternion?: never }
/** v2 自由姿态的位置是源模型原点；与 v1 的格点包围盒位置互斥，避免两份朝向真相。 */
export interface SomaFreePiece { id: SomaId; position: VoxelCoordinate; quaternion: SpatialRigidPose["quaternion"]; orientation?: never }
export type SomaPiece = SomaGridPiece | SomaFreePiece;
export function somaPose(piece: SomaPiece): SpatialRigidPose {
  if (piece.quaternion) return { id: piece.id, position: piece.position, quaternion: piece.quaternion };
  const quaternion = spatialBasisQuaternion(SOMA_ROTATIONS[piece.orientation]);
  const origin = { id: piece.id, quaternion, position: point(0, 0, 0) };
  const cells = somaDefinition(piece.id).cells.map((p) => spatialRigidPoint(p, origin));
  const position = { ...piece.position };
  for (const axis of ["x", "y", "z"] as const) position[axis] -= Math.round(Math.min(...cells.map((p) => p[axis])));
  return { ...origin, position };
}
export function somaCells(piece: SomaPiece): VoxelCoordinate[] {
  if (piece.quaternion) return somaDefinition(piece.id).cells.map((p) => spatialRigidPoint(p, somaPose(piece)));
  return somaLocalCells(piece.id, piece.orientation).map((p) => point(p.x + piece.position.x, p.y + piece.position.y, p.z + piece.position.z));
}
export function somaPlacementValid(pieces: readonly SomaPiece[]): boolean {
  const occupied = new Set<string>();
  for (const piece of pieces) {
    if (!SOMA_IDS.includes(piece.id) || !Object.values(piece.position).every(Number.isFinite)) return false;
    if (piece.quaternion) {
      if (piece.orientation !== undefined || piece.quaternion.length !== 4 || !piece.quaternion.every(Number.isFinite)
        || Math.abs(piece.quaternion.reduce((sum, n) => sum + n * n, 0) - 1) > 1e-6
        || Object.values(piece.position).some((n) => Math.abs(n) > 16)) return false;
    } else if (!Number.isInteger(piece.orientation) || piece.orientation < 0 || piece.orientation >= SOMA_ROTATIONS.length) return false;
    for (const p of somaCells(piece)) {
      if (piece.quaternion) {
        if (Object.values(p).some((n) => !Number.isFinite(n) || Math.abs(n) > SOMA_LIMIT + 1e-7)) return false;
        continue;
      }
      if (![p.x, p.y, p.z].every(Number.isInteger) || Math.abs(p.x) > SOMA_LIMIT || Math.abs(p.z) > SOMA_LIMIT || p.y < 0 || p.y > SOMA_LIMIT) return false;
      const key = `${p.x},${p.y},${p.z}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  if (pieces.some((piece) => piece.quaternion)) {
    const geometry = pieces.map((piece) => ({ cells: somaCells(piece), axes: spatialRigidAxes(somaPose(piece).quaternion) }));
    for (let i = 0; i < geometry.length; i++) for (let j = 0; j < i; j++) {
      if (geometry[i].cells.some((a) => geometry[j].cells.some((b) => spatialUnitCubesOverlap(a, geometry[i].axes, b, geometry[j].axes)))) return false;
    }
  }
  return true;
}
