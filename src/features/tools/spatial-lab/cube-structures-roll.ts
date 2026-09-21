import { applyCubeOperation, cubeDisplayPosition, type CubeStructureState } from "./cube-structures-contract";
import type { CubeRotationOperation } from "./cube-structures-rotation";
import { planSpatialRoll, unitCubeCorners, voxelRollIsClear, type SpatialRollDirection } from "../spatial-interaction/rolling";

/** 沿接触棱翻滚仍是一个准确的旋转命令，保存、录制、撤销与课堂都复用原路径。 */
export function cubeRollOperation(state: CubeStructureState, ids: readonly string[], direction: SpatialRollDirection): CubeRotationOperation | null {
  const moving = state.cubes.filter((cube) => ids.includes(cube.id));
  const points = moving.map((cube) => cube.position), displayed = moving.map(cubeDisplayPosition);
  const logical = planSpatialRoll(unitCubeCorners(points), direction), display = planSpatialRoll(unitCubeCorners(displayed), direction);
  if (!logical || !display) return null;
  // 展示分离的多个组并非一个接触实体；各组可以先分别翻滚。
  const first = moving[0].displayOffset;
  if (moving.some((cube) => (["x", "y", "z"] as const).some((axis) => (cube.displayOffset?.[axis] ?? 0) !== (first?.[axis] ?? 0)))) return null;
  const operation: CubeRotationOperation = { kind: "rotate", ids: moving.map((cube) => cube.id), axis: logical.axis, turn: logical.turn, pivot: logical.pivot, displayPivot: display.pivot };
  if (applyCubeOperation(state, operation) === state) return null;
  return voxelRollIsClear(displayed, state.cubes.filter((cube) => !ids.includes(cube.id)).map(cubeDisplayPosition), display) ? operation : null;
}
