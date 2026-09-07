import type { Axis, VoxelCoordinate, VoxelFaceSelection } from "@/features/spatial-math/domain";
import { cubeAtDisplayPosition, cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";

export interface CubeCutSelection {
  readonly axis: Axis;
  readonly after: number;
  readonly side: -1 | 1;
  readonly ids: readonly string[];
  readonly anchor: VoxelCoordinate;
  readonly cubeId: string;
  readonly face?: VoxelFaceSelection;
  readonly edge?: { readonly start: VoxelCoordinate; readonly end: VoxelCoordinate };
}

export function cubeCutLayers(state: CubeStructureState, ids: readonly string[], axis: Axis): readonly number[] {
  return [...new Set(state.cubes.filter((cube) => ids.includes(cube.id)).map((cube) => cube.position[axis]))].sort((a, b) => a - b).slice(0, -1);
}

/** 面法向直接决定 XYZ；正/负外侧面向内取最近的层间界面，保留完整单位块。 */
export function cubeCutFromFace(state: CubeStructureState, ids: readonly string[], face: VoxelFaceSelection, point?: VoxelCoordinate): CubeCutSelection | null {
  const cube = cubeAtDisplayPosition(state, face.cell);
  if (!cube || !ids.includes(cube.id)) return null;
  const axis = face.direction[0] as Axis;
  const position = cubeDisplayPosition(cube);
  if (point && (["x", "y", "z"] as const).some((value) => value !== axis && Math.abs(point[value] - position[value]) > 0.36)) return null;
  const side = face.direction[1] === "+" ? 1 : -1;
  const layers = cubeCutLayers(state, ids, axis);
  if (!layers.length) return null;
  const preferred = cube.position[axis] - (side > 0 ? 1 : 0);
  const after = layers.reduce((closest, layer) => Math.abs(layer - preferred) < Math.abs(closest - preferred) ? layer : closest);
  return { axis, after, side, ids: [...ids], cubeId: cube.id, face, anchor: { ...position, [axis]: after + 0.5 + (cube.displayOffset?.[axis] ?? 0) } };
}

/** 指向实际层间线选截面；同一条线跨相邻面仍落在同一逻辑边界。 */
export function cubeCutFromEdge(state: CubeStructureState, ids: readonly string[], face: VoxelFaceSelection, point: VoxelCoordinate, previous: CubeCutSelection | null = null): CubeCutSelection | null {
  const cube = cubeAtDisplayPosition(state, face.cell);
  if (!cube || !ids.includes(cube.id)) return null;
  const position = cubeDisplayPosition(cube);
  const normal = face.direction[0] as Axis;
  const candidates = (["x", "y", "z"] as const).filter((axis) => axis !== normal).flatMap((axis) => {
    const delta = point[axis] - position[axis];
    const after = cube.position[axis] + (delta >= 0 ? 0 : -1);
    const distance = Math.abs(Math.abs(delta) - 0.5);
    if (distance > 0.18 || !cubeCutLayers(state, ids, axis).includes(after)) return [];
    return [{ axis, after, distance }];
  }).sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return null;
  // 交点附近保留已命中的轴，明显靠近另一条线时再切换。
  const retained = candidates.find((candidate) => candidate.axis === previous?.axis && candidate.after === previous.after && candidate.distance <= candidates[0].distance + 0.06);
  const { axis, after } = retained ?? candidates[0];
  const along = (["x", "y", "z"] as const).find((value) => value !== axis && value !== normal)!;
  const anchor = { ...position, [axis]: after + 0.5 + (cube.displayOffset?.[axis] ?? 0), [normal]: position[normal] + (face.direction[1] === "+" ? 0.53 : -0.53) };
  return { axis, after, side: 1, ids: [...ids], cubeId: cube.id, face, anchor,
    edge: { start: { ...anchor, [along]: position[along] - 0.5 }, end: { ...anchor, [along]: position[along] + 0.5 } } };
}
