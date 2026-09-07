import type { Axis, VoxelCoordinate, VoxelFaceSelection } from "@/features/spatial-math/domain";
import { cubeAtDisplayPosition, cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";

export interface CubeCutSelection {
  readonly axis: Axis;
  readonly after: number;
  readonly side: -1 | 1;
  readonly ids: readonly string[];
  readonly anchor: VoxelCoordinate;
  readonly cubeId: string;
}

export function cubeCutLayers(state: CubeStructureState, ids: readonly string[], axis: Axis): readonly number[] {
  return [...new Set(state.cubes.filter((cube) => ids.includes(cube.id)).map((cube) => cube.position[axis]))].sort((a, b) => a - b).slice(0, -1);
}

/** 面法向直接决定 XYZ；正/负外侧面向内取最近的层间界面，保留完整单位块。 */
export function cubeCutFromFace(state: CubeStructureState, ids: readonly string[], face: VoxelFaceSelection): CubeCutSelection | null {
  const cube = cubeAtDisplayPosition(state, face.cell);
  if (!cube || !ids.includes(cube.id)) return null;
  const axis = face.direction[0] as Axis;
  const side = face.direction[1] === "+" ? 1 : -1;
  const layers = cubeCutLayers(state, ids, axis);
  if (!layers.length) return null;
  const preferred = cube.position[axis] - (side > 0 ? 1 : 0);
  const after = layers.reduce((closest, layer) => Math.abs(layer - preferred) < Math.abs(closest - preferred) ? layer : closest);
  const position = cubeDisplayPosition(cube);
  return { axis, after, side, ids: [...ids], cubeId: cube.id, anchor: { ...position, [axis]: after + 0.5 + (cube.displayOffset?.[axis] ?? 0) } };
}
