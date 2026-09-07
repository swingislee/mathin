import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { cubeDisplayPosition, type CubeStructureState, type StructureCube } from "./cube-structures-contract";

export type CubeDisplayPositions = ReadonlyMap<string, VoxelCoordinate>;

export function cubeDisplayPositions(cubes: readonly StructureCube[]): CubeDisplayPositions {
  return new Map(cubes.map((cube) => [cube.id, cubeDisplayPosition(cube)]));
}

export function cubeMotionDistance(from: CubeDisplayPositions, to: CubeDisplayPositions): number {
  let distance = 0;
  for (const [id, target] of to) {
    const start = from.get(id) ?? target;
    distance = Math.max(distance, Math.hypot(target.x - start.x, target.y - start.y, target.z - start.z));
  }
  return distance;
}

export function cubeMotionDuration(distance: number): number {
  return Math.min(950, 420 + distance * 45);
}

/** 只插值展示位置；语义状态直接提交终点，中间帧不会进入撤销或录制。 */
export function interpolateCubePositions(from: CubeDisplayPositions, to: CubeDisplayPositions, progress: number): CubeDisplayPositions {
  if (progress >= 1) return to;
  const t = Math.max(0, progress);
  const eased = t * t * (3 - 2 * t);
  const lerp = (a: number, b: number) => Math.round((a + (b - a) * eased) * 1e6) / 1e6;
  return new Map([...to].map(([id, target]) => {
    const start = from.get(id) ?? target;
    return [id, { x: lerp(start.x, target.x), y: lerp(start.y, target.y), z: lerp(start.z, target.z) }];
  }));
}

export function cubePresentationState(state: CubeStructureState, positions: CubeDisplayPositions): CubeStructureState {
  return { ...state, cubes: state.cubes.map((cube) => {
    const position = positions.get(cube.id) ?? cubeDisplayPosition(cube);
    return { ...cube, displayOffset: { x: position.x - cube.position.x, y: position.y - cube.position.y, z: position.z - cube.position.z } };
  }) };
}
