import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { Quaternion, Vector3 } from "three";
import { CUBE_COLORS, buildCubeStructureRenderModel, cubeFrame, type CubeStructureState } from "../spatial-lab/cube-structures-contract";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import type { SomaSnapshot } from "./contract";
import { SOMA_IDS, SOMA_ROTATIONS, somaCells, somaDefinition, somaLocalCells, somaPlacementValid, somaPose, somaTurn, type SomaId, type SomaPiece, type SomaGridPiece } from "./pieces";
import { planSpatialRoll, spatialRollPoint, unitCubeCorners, voxelRollIsClear, type SpatialRollDirection } from "../spatial-interaction/rolling";
import { spatialRigidPoint } from "../spatial-interaction/rigid-geometry";
import { spatialBasisQuaternion } from "../spatial-interaction/rigid-motion";

export function somaApart(ids: readonly SomaId[]): SomaGridPiece[] {
  const columns = Math.min(ids.length, 4);
  return ids.map((id, index) => ({ id, orientation: 0, position: { x: (index % columns) * 3 - Math.floor((columns - 1) * 3 / 2), y: 0, z: Math.floor(index / columns) * 4 - (ids.length > 4 ? 2 : 1) } }));
}
export function somaCubeState(pieces: readonly SomaPiece[]): CubeStructureState {
  const cubes = pieces.flatMap((piece) => somaCells(piece).map((position, index) => ({ id: `${piece.id}:${index}`, position, color: CUBE_COLORS[0], faces: {} })));
  return { cubes, hiddenCubeIds: [], groups: [], origin: { x: -0.5, y: -0.5, z: -0.5 }, axesVisible: false, view: "angle", frame: cubeFrame(cubes), nextCubeId: 28, nextNumber: 1, hiddenEdgesVisible: false };
}
export function somaVisiblePieces(snapshot: SomaSnapshot): SomaPiece[] {
  return snapshot.mode === "observe" ? snapshot.pieces.filter((piece) => piece.id === snapshot.selectedId).map((piece) => ({ ...piece, position: { x: 0, y: 0, z: 0 } })) : snapshot.pieces;
}
export function somaFit(snapshot: SomaSnapshot): SomaSnapshot {
  return { ...snapshot, frame: somaCubeState(somaVisiblePieces(snapshot)).frame, cameraRevision: (snapshot.cameraRevision + 1) % 1_000_001 };
}
export function createSomaInitial(): SomaSnapshot {
  return somaFit({ pieces: somaApart(SOMA_IDS), selectedId: "bao-1", mode: "assemble", view: "angle", grid: true, axes: false, labels: true, frame: { center: { x: 0, y: 0, z: 0 }, radius: 6 }, cameraRevision: 0 });
}
/** 用七个原模型的 24 个刚体朝向求得，27 格各占一次。 */
export const SOMA_CUBE_EXAMPLE: readonly SomaGridPiece[] = [
  { id: "bao-1", orientation: 1, position: { x: -1, y: 0, z: -1 } },
  { id: "bao-2", orientation: 4, position: { x: -1, y: 1, z: -1 } },
  { id: "bao-3", orientation: 2, position: { x: -1, y: 0, z: 1 } },
  { id: "bao-4", orientation: 6, position: { x: -1, y: 0, z: -1 } },
  { id: "bao-5", orientation: 10, position: { x: 0, y: 0, z: -1 } },
  { id: "bao-6", orientation: 4, position: { x: 0, y: 1, z: -1 } },
  { id: "bao-7", orientation: 12, position: { x: 0, y: 1, z: 0 } },
];
export function somaChoose(snapshot: SomaSnapshot, ids: readonly SomaId[]): SomaSnapshot | null {
  if (ids.length < 1 || ids.length > 7 || new Set(ids).size !== ids.length || ids.some((id) => !SOMA_IDS.includes(id))) return null;
  const pieces = snapshot.pieces.filter((piece) => ids.includes(piece.id));
  for (const id of ids.filter((id) => !pieces.some((piece) => piece.id === id))) {
    let placed = false;
    for (let z = -5; z <= 10 && !placed; z += 3) for (let x = -6; x <= 10 && !placed; x += 3) {
      const piece = { id, position: { x, y: 0, z }, orientation: 0 };
      if (somaPlacementValid([...pieces, piece])) { pieces.push(piece); placed = true; }
    }
    if (!placed) return null;
  }
  pieces.sort((a, b) => SOMA_IDS.indexOf(a.id) - SOMA_IDS.indexOf(b.id));
  return somaFit({ ...snapshot, pieces, selectedId: ids.includes(snapshot.selectedId) ? snapshot.selectedId : pieces[0].id });
}
export function somaMove(snapshot: SomaSnapshot, id: SomaId, axis: Axis, distance: number): SomaSnapshot | null {
  if (!Number.isInteger(distance) || !distance || !snapshot.pieces.some((piece) => piece.id === id)) return null;
  const pieces = snapshot.pieces.map((piece) => piece.id === id ? { ...piece, position: { ...piece.position, [axis]: piece.position[axis] + distance } } : piece);
  return somaPlacementValid(pieces) ? { ...snapshot, pieces, selectedId: id } : null;
}
/** 锚点绑定同一个单元块，随姿态转换而非随包围盒重选；其中心始终可精确落在整数格。 */
export function somaAnchorIndex(id: SomaId): number {
  const cells = somaDefinition(id).cells;
  const middle = { x: 0, y: 0, z: 0 };
  for (const p of cells) for (const axis of ["x", "y", "z"] as const) middle[axis] += p[axis] / cells.length;
  return cells.reduce((best, p, index) => {
    const distance = (q: VoxelCoordinate) => (q.x - middle.x) ** 2 + (q.y - middle.y) ** 2 + (q.z - middle.z) ** 2;
    return distance(p) < distance(cells[best]) - 1e-7 ? index : best;
  }, 0);
}
export function somaLocalCenter(id: SomaId): VoxelCoordinate {
  const cells = somaDefinition(id).cells;
  const center = (axis: Axis) => (Math.min(...cells.map((p) => p[axis])) + Math.max(...cells.map((p) => p[axis]))) / 2;
  return { x: center("x"), y: center("y"), z: center("z") };
}
export function somaRotationRadius(id: SomaId): number {
  const center = somaLocalCenter(id);
  return Math.max(...unitCubeCorners(somaDefinition(id).cells).map((p) => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)));
}
export function somaRotationPivot(piece: SomaPiece, free = false): VoxelCoordinate {
  return free || piece.quaternion ? spatialRigidPoint(somaLocalCenter(piece.id), somaPose(piece)) : somaCells(piece)[somaAnchorIndex(piece.id)];
}
export function somaOrientAroundAnchor(piece: SomaGridPiece, orientation: number): SomaGridPiece {
  const pivot = somaRotationPivot(piece), local = somaLocalCells(piece.id, orientation)[somaAnchorIndex(piece.id)];
  return { ...piece, orientation, position: { x: pivot.x - local.x, y: pivot.y - local.y, z: pivot.z - local.z } };
}
export function somaRotate(snapshot: SomaSnapshot, axis: Axis, direction: -1 | 1, free = false): SomaSnapshot | null {
  const pieces = snapshot.pieces.map((piece): SomaPiece => {
    if (piece.id !== snapshot.selectedId) return piece;
    if (!free && !piece.quaternion) return somaOrientAroundAnchor(piece, somaTurn(piece.orientation, axis, direction));
    const pose = somaPose(piece), pivot = somaRotationPivot(piece, true);
    const q = new Quaternion().setFromAxisAngle(new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0), direction * Math.PI / 2);
    const p = new Vector3(pose.position.x - pivot.x, pose.position.y - pivot.y, pose.position.z - pivot.z).applyQuaternion(q);
    return { id: piece.id, position: { x: pivot.x + p.x, y: pivot.y + p.y, z: pivot.z + p.z }, quaternion: q.multiply(new Quaternion(...pose.quaternion)).normalize().toArray() };
  });
  return somaPlacementValid(pieces) ? { ...snapshot, pieces } : null;
}
/** 显式回到拼搭网格：最近的合法立方体朝向和格点；空间不足时保留现场，不偷偷挪开其他宝。 */
export function somaAlignToGrid(snapshot: SomaSnapshot): SomaSnapshot | null {
  const piece = snapshot.pieces.find((p) => p.id === snapshot.selectedId)!;
  if (!piece.quaternion) return snapshot;
  const q = new Quaternion(...piece.quaternion), center = somaRotationPivot(piece, true);
  let orientation = 0, distance = Infinity;
  SOMA_ROTATIONS.forEach((basis, index) => { const angle = q.angleTo(new Quaternion(...spatialBasisQuaternion(basis))); if (angle < distance - 1e-7) { orientation = index; distance = angle; } });
  const template: SomaGridPiece = { id: piece.id, orientation, position: { x: 0, y: 0, z: 0 } };
  const localCenter = somaRotationPivot(template, true);
  const position = { x: Math.round(center.x - localCenter.x), y: Math.round(center.y - localCenter.y), z: Math.round(center.z - localCenter.z) };
  const pieces = snapshot.pieces.map((p) => p.id === piece.id ? { ...template, position } : p);
  return somaPlacementValid(pieces) ? { ...snapshot, pieces } : null;
}
export function somaRoll(snapshot: SomaSnapshot, direction: SpatialRollDirection): SomaSnapshot | null {
  const piece = snapshot.pieces.find((piece) => piece.id === snapshot.selectedId);
  if (!piece || piece.quaternion || snapshot.mode !== "assemble") return null;
  const points = somaCells(piece), plan = planSpatialRoll(unitCubeCorners(points), direction);
  if (!plan || !voxelRollIsClear(points, snapshot.pieces.filter((p) => p.id !== piece.id).flatMap(somaCells), plan)) return null;
  const rolled = points.map((point) => spatialRollPoint(point, plan));
  const position = { x: Math.min(...rolled.map((p) => p.x)), y: Math.min(...rolled.map((p) => p.y)), z: Math.min(...rolled.map((p) => p.z)) };
  const target = { ...piece, orientation: somaTurn(piece.orientation, plan.axis, plan.turn), position };
  const pieces = snapshot.pieces.map((p) => p.id === piece.id ? target : p);
  return somaPlacementValid(pieces) ? { ...snapshot, pieces } : null;
}
export function somaIdFromCell(cellId: string): SomaId | null {
  const id = cellId.split(":")[0]; return SOMA_IDS.find((candidate) => candidate === id) ?? null;
}
/** 共用手柄可命中任意小方块；领域适配始终把整宝作为刚体提交。 */
export function somaDrag(snapshot: SomaSnapshot, operation: CubeMoveOperation): SomaSnapshot | null {
  const ids = new Set(operation.ids.map(somaIdFromCell));
  const id = [...ids][0];
  return ids.size === 1 && id && operation.kind === "move" ? somaMove(snapshot, id, operation.axis, operation.distance) : null;
}
export function somaDragPresentation(state: CubeStructureState, preview: CubeDragPreview | null): CubeStructureState {
  if (!preview) return state;
  const moved = state.cubes.find((cube) => preview.positions.get(cube.id)?.[preview.axis] !== cube.position[preview.axis]);
  const id = moved && somaIdFromCell(moved.id);
  if (!id) return state;
  const distance = preview.positions.get(moved!.id)![preview.axis] - moved!.position[preview.axis];
  return { ...state, cubes: state.cubes.map((cube) => somaIdFromCell(cube.id) === id ? { ...cube, position: { ...cube.position, [preview.axis]: cube.position[preview.axis] + distance } } : cube) };
}
export function somaRenderModel(state: CubeStructureState, snapshot: SomaSnapshot, label: string, presentation: CubeStructureState = state) {
  const selectedIds = state.cubes.filter((cube) => somaIdFromCell(cube.id) === snapshot.selectedId).map((cube) => cube.id);
  const free = snapshot.pieces.some((piece) => piece.quaternion);
  // 自由姿态使用真实刚体几何；格点投影只服务格点模型，不把小数坐标塞进 voxel 合同。
  const base = buildCubeStructureRenderModel({ ...state, cubes: free ? [] : state.cubes, frame: snapshot.frame, view: snapshot.view }, selectedIds, label);
  const model = free ? { ...base, cells: state.cubes.map((cube) => ({ key: cube.id, ...cube.position, materialToken: cube.color, selected: selectedIds.includes(cube.id), emphasis: undefined })), totalCellCount: state.cubes.length } : base;
  // 投影使用已确认的合法落位；拖动途中允许重叠，仅覆盖画布显示坐标。
  const positions = new Map(presentation.cubes.map((cube) => [cube.id, cube.position]));
  return { ...model, entityId: "soma-cube", cells: model.cells.map((cell) => ({ ...cell, ...positions.get(cell.key), materialToken: somaDefinition(somaIdFromCell(cell.key)!).color,
    emphasis: cell.emphasis ? { ...cell.emphasis, faceOpacity: 0 } : undefined })) };
}
