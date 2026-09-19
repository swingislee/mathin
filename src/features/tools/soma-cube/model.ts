import type { Axis } from "@/features/spatial-math/domain";
import { CUBE_COLORS, buildCubeStructureRenderModel, cubeFrame, type CubeStructureState } from "../spatial-lab/cube-structures-contract";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import type { CubeDragPreview } from "../spatial-lab/cube-structures-drag-controller";
import type { SomaSnapshot } from "./contract";
import { SOMA_IDS, somaCells, somaDefinition, somaPlacementValid, somaTurn, type SomaId, type SomaPiece } from "./pieces";

export function somaApart(ids: readonly SomaId[]): SomaPiece[] {
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
export const SOMA_CUBE_EXAMPLE: readonly SomaPiece[] = [
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
export function somaRotate(snapshot: SomaSnapshot, axis: Axis, direction: -1 | 1): SomaSnapshot | null {
  const pieces = snapshot.pieces.map((piece) => piece.id === snapshot.selectedId ? { ...piece, orientation: somaTurn(piece.orientation, axis, direction) } : piece);
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
  return { ...state, cubes: state.cubes.map((cube) => somaIdFromCell(cube.id) === id ? { ...cube, position: { ...cube.position, [preview.axis]: cube.position[preview.axis] + preview.distance } } : cube) };
}
export function somaRenderModel(state: CubeStructureState, snapshot: SomaSnapshot, label: string, presentation: CubeStructureState = state) {
  const model = buildCubeStructureRenderModel({ ...state, frame: snapshot.frame, view: snapshot.view }, state.cubes.filter((cube) => somaIdFromCell(cube.id) === snapshot.selectedId).map((cube) => cube.id), label);
  // 投影使用已确认的合法落位；拖动途中允许重叠，仅覆盖画布显示坐标。
  const positions = new Map(presentation.cubes.map((cube) => [cube.id, cube.position]));
  return { ...model, entityId: "soma-cube", cells: model.cells.map((cell) => ({ ...cell, ...positions.get(cell.key), materialToken: somaDefinition(somaIdFromCell(cell.key)!).color,
    emphasis: cell.emphasis ? { ...cell.emphasis, faceOpacity: 0 } : undefined })) };
}
