import { FACE_OFFSETS, type Axis, type FaceDirection, type VoxelCoordinate } from "@/features/spatial-math/domain";
import type { CubeLabelStyle, CubeStructureState, StructureCube } from "./cube-structures-contract";

export interface CubeRotationOperation {
  readonly kind: "rotate";
  readonly ids: readonly string[];
  readonly axis: Axis;
  readonly turn: -1 | 1;
  readonly pivot: VoxelCoordinate;
  /** 拆开间隙只属于展示空间；完整保存旋转中心可确定性重放。 */
  readonly displayPivot: VoxelCoordinate;
}

/** 右手系整四分之一圈，不引入浮点格点误差。 */
export function rotateCubeVector(point: VoxelCoordinate, axis: Axis, turn: -1 | 1): VoxelCoordinate {
  if (axis === "x") return { x: point.x || 0, y: -turn * point.z || 0, z: turn * point.y || 0 };
  if (axis === "y") return { x: turn * point.z || 0, y: point.y || 0, z: -turn * point.x || 0 };
  return { x: -turn * point.y || 0, y: turn * point.x || 0, z: point.z || 0 };
}

export function rotateCubePoint(point: VoxelCoordinate, pivot: VoxelCoordinate, axis: Axis, turn: -1 | 1): VoxelCoordinate {
  const rotated = rotateCubeVector({ x: point.x - pivot.x, y: point.y - pivot.y, z: point.z - pivot.z }, axis, turn);
  return { x: pivot.x + rotated.x, y: pivot.y + rotated.y, z: pivot.z + rotated.z };
}

export function rotateCubeDirection(direction: FaceDirection, axis: Axis, turn: -1 | 1): FaceDirection {
  const point = rotateCubeVector(FACE_OFFSETS[direction], axis, turn);
  return (Object.keys(FACE_OFFSETS) as FaceDirection[]).find((candidate) => {
    const normal = FACE_OFFSETS[candidate];
    return normal.x === point.x && normal.y === point.y && normal.z === point.z;
  })!;
}

const FACE_RIGHT: Record<FaceDirection, VoxelCoordinate> = {
  "x+": { x: 0, y: 0, z: -1 }, "x-": { x: 0, y: 0, z: 1 },
  "y+": { x: 1, y: 0, z: 0 }, "y-": { x: 1, y: 0, z: 0 },
  "z+": { x: 1, y: 0, z: 0 }, "z-": { x: -1, y: 0, z: 0 },
};
const FACE_UP: Record<FaceDirection, VoxelCoordinate> = {
  "x+": { x: 0, y: 1, z: 0 }, "x-": { x: 0, y: 1, z: 0 },
  "y+": { x: 0, y: 0, z: -1 }, "y-": { x: 0, y: 0, z: 1 },
  "z+": { x: 0, y: 1, z: 0 }, "z-": { x: 0, y: 1, z: 0 },
};
const dot = (a: VoxelCoordinate, b: VoxelCoordinate) => a.x * b.x + a.y * b.y + a.z * b.z;

export function cubeLabelUp(label: Pick<CubeLabelStyle, "direction" | "quarterTurns">): VoxelCoordinate {
  const up = FACE_UP[label.direction];
  const right = FACE_RIGHT[label.direction];
  const q = label.quarterTurns ?? 0;
  return q === 0 ? up : q === 1 ? { x: -right.x || 0, y: -right.y || 0, z: -right.z || 0 }
    : q === 2 ? { x: -up.x || 0, y: -up.y || 0, z: -up.z || 0 } : right;
}

export function cubeLabelLaneDirection(label: Pick<CubeLabelStyle, "direction" | "laneDirection">): FaceDirection {
  return label.laneDirection ?? (label.direction[0] === "x" ? "z+" : "x+");
}

export function rotateCubeLabel<T extends CubeLabelStyle>(label: T, axis: Axis, turn: -1 | 1): T {
  const direction = rotateCubeDirection(label.direction, axis, turn);
  const result = { ...label, direction };
  if (label.placement !== "face") return result;
  const up = rotateCubeVector(cubeLabelUp(label), axis, turn);
  const upDot = dot(up, FACE_UP[direction]);
  const quarterTurns = upDot === 1 ? 0 : upDot === -1 ? 2 : dot(up, FACE_RIGHT[direction]) === -1 ? 1 : 3;
  const laneDirection = rotateCubeDirection(cubeLabelLaneDirection(label), axis, turn);
  if (quarterTurns) Object.assign(result, { quarterTurns }); else Reflect.deleteProperty(result, "quarterTurns");
  if (laneDirection !== cubeLabelLaneDirection({ direction })) Object.assign(result, { laneDirection }); else Reflect.deleteProperty(result, "laneDirection");
  return result;
}

const displayed = (cube: StructureCube): VoxelCoordinate => ({
  x: cube.position.x + (cube.displayOffset?.x ?? 0), y: cube.position.y + (cube.displayOffset?.y ?? 0), z: cube.position.z + (cube.displayOffset?.z ?? 0),
});

/** 以最靠近范围中心的稳定方块为转轴锚点；同距按 ID 选择，连续转动不会漂移。 */
export function cubeRotationOperation(state: CubeStructureState, ids: readonly string[], axis: Axis, turn: -1 | 1): CubeRotationOperation | null {
  const cubes = state.cubes.filter((cube) => ids.includes(cube.id));
  if (!cubes.length) return null;
  const middle = (points: readonly VoxelCoordinate[], key: Axis) => (Math.min(...points.map((point) => point[key])) + Math.max(...points.map((point) => point[key]))) / 2;
  const positions = cubes.map((cube) => cube.position);
  const center = { x: middle(positions, "x"), y: middle(positions, "y"), z: middle(positions, "z") };
  const distance = (cube: StructureCube) => (cube.position.x - center.x) ** 2 + (cube.position.y - center.y) ** 2 + (cube.position.z - center.z) ** 2;
  const anchor = [...cubes].sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const pivot = { ...anchor.position };
  const displayPivot = displayed(anchor);
  return { kind: "rotate", ids: cubes.map((cube) => cube.id), axis, turn, pivot, displayPivot };
}

/** 逻辑格与展示中心分开旋转：相同的拆开偏移保持不变，间隙不写入数学格。 */
export function rotatedStructureCube(cube: StructureCube, operation: CubeRotationOperation): StructureCube {
  const position = rotateCubePoint(cube.position, operation.pivot, operation.axis, operation.turn);
  const display = rotateCubePoint(displayed(cube), operation.displayPivot, operation.axis, operation.turn);
  const displayOffset = { x: display.x - position.x, y: display.y - position.y, z: display.z - position.z };
  const faces: StructureCube["faces"] = Object.fromEntries(Object.entries(cube.faces).map(([direction, color]) => [rotateCubeDirection(direction as FaceDirection, operation.axis, operation.turn), color]));
  return { ...cube, position, faces,
    ...(cube.displayOffset || Object.values(displayOffset).some((value) => value !== 0) ? { displayOffset } : {}),
    ...(cube.mark ? { mark: rotateCubeLabel(cube.mark, operation.axis, operation.turn) } : {}),
    ...(cube.numberLabel ? { numberLabel: rotateCubeLabel(cube.numberLabel, operation.axis, operation.turn) } : {}),
  };
}
