import { CUBE_COLORS, cubeFrame, type CubeStructureState } from "./cube-structures-contract";
import type { CubeMoveOperation } from "./cube-structures-drag";
import { canPlaceDie, type DiceScene, type TeachingDie } from "./dice-teaching-model";

export const DICE_DRAG_GRID_ORIGIN = { x: 0, y: 0.5, z: 0 } as const;

/** 只适配命中与手柄的数据，骰子继续持有自己的朝向、点数、移面和样式。 */
export function diceDragState(dice: readonly TeachingDie[]): CubeStructureState {
  const cubes = dice.map((die) => ({ id: die.id, position: die.position, color: CUBE_COLORS[0], faces: {} }));
  return { cubes, hiddenCubeIds: [], groups: [], origin: null, axesVisible: false, view: "angle", frame: cubeFrame(cubes), nextCubeId: 1, nextNumber: 1, hiddenEdgesVisible: false };
}

export function moveDiceByDrag(dice: readonly TeachingDie[], operation: CubeMoveOperation): TeachingDie[] | null {
  if (operation.ids.length !== 1 || !Number.isFinite(operation.distance) || Math.abs(operation.distance) < 1e-9) return null;
  const die = dice.find((item) => item.id === operation.ids[0]);
  if (!die) return null;
  const position = { ...die.position, [operation.axis]: die.position[operation.axis] + operation.distance };
  if (!canPlaceDie(dice, die.id, position)) return null;
  return dice.map((item) => item.id === die.id ? { ...item, position } : item);
}

/** 手动拖拽已展示中间帧，松手直接写终点，不再次启动位移动画。 */
export function commitDiceDrag(scene: DiceScene, operation: CubeMoveOperation): DiceScene | null {
  const dice = moveDiceByDrag(scene.dice, operation);
  return dice ? { ...scene, dice, puzzle: null } : null;
}
