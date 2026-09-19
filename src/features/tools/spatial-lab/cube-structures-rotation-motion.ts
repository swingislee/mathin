import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { applyCubeOperation, cubeDisplayPosition, type CubeHistory, type CubeStructureState } from "./cube-structures-contract";
import type { CubeDisplayPositions } from "./cube-structures-motion";
import type { CubeRotationOperation } from "./cube-structures-rotation";

export interface CubeRotationMotion {
  readonly source: CubeStructureState;
  readonly operation: CubeRotationOperation;
}
export interface CubeRotationFrame extends CubeRotationMotion { readonly angle: number }

/** 只从已提交的语义步骤识别旋转，重收同一快照、选择变化和拖动回执均不重播。 */
export function cubeRotationMotion(before: CubeStructureState, after: CubeStructureState, previous: CubeHistory | undefined, next: CubeHistory | undefined): CubeRotationMotion | null {
  if (!previous || !next) return null;
  const last = next.operations[next.cursor - 1];
  const previousLast = previous.operations[previous.cursor - 1];
  const advancing = next.cursor === previous.cursor + 1
    || (next.cursor === previous.cursor && JSON.stringify(last) !== JSON.stringify(previousLast));
  // Zod／传输可能重排 faces 的对象键；几何相等不依赖 JSON 字段插入顺序。
  const key = (state: CubeStructureState) => JSON.stringify(state.cubes, (_name, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  const sameCubes = (a: CubeStructureState, b: CubeStructureState) => key(a) === key(b);
  if (advancing && last?.kind === "rotate" && sameCubes(applyCubeOperation(before, last), after)) return { source: before, operation: last };
  if (previous.cursor === next.cursor + 1 && previousLast?.kind === "rotate" && sameCubes(applyCubeOperation(after, previousLast), before)) {
    return { source: before, operation: { ...previousLast, turn: previousLast.turn === 1 ? -1 : 1 } };
  }
  return null;
}

export function cubeRotationAngle(turn: -1 | 1, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return turn * Math.PI / 2 * t * t * (3 - 2 * t);
}

export function cubeRotationPointAt(point: VoxelCoordinate, frame: Pick<CubeRotationFrame, "operation" | "angle">): VoxelCoordinate {
  const { displayPivot: pivot, axis } = frame.operation;
  const x = point.x - pivot.x, y = point.y - pivot.y, z = point.z - pivot.z;
  const cosine = Math.cos(frame.angle), sine = Math.sin(frame.angle);
  const rotated = axis === "x" ? { x, y: y * cosine - z * sine, z: y * sine + z * cosine }
    : axis === "y" ? { x: x * cosine + z * sine, y, z: -x * sine + z * cosine }
      : { x: x * cosine - y * sine, y: x * sine + y * cosine, z };
  return { x: pivot.x + rotated.x, y: pivot.y + rotated.y, z: pivot.z + rotated.z };
}

/** 中间帧仅用于显示；所有中心共用同一角度，任意两块的距离始终不变。 */
export function cubeRotationPositions(motion: CubeRotationMotion, target: CubeDisplayPositions, progress: number): CubeDisplayPositions {
  if (progress >= 1) return target;
  const frame = { ...motion, angle: cubeRotationAngle(motion.operation.turn, progress) };
  const selected = new Set(motion.operation.ids);
  const positions = new Map(target);
  for (const cube of motion.source.cubes) if (selected.has(cube.id)) positions.set(cube.id, cubeRotationPointAt(cubeDisplayPosition(cube), frame));
  return positions;
}
