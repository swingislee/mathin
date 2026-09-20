import { Box3, Vector3, type Camera, type Ray } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { applyCubeOperation, cubeDisplayPosition, type CubeOperation, type CubeStructureState } from "./cube-structures-contract";
import { cubeDisplayPositions } from "./cube-structures-motion";

export interface CubeScreenPoint { readonly x: number; readonly y: number }
export type CubeMoveOperation = Extract<CubeOperation, { kind: "move" | "display-move" }>;
export const CUBE_DRAG_AXES = ["x", "y", "z"] as const;

/** 平面落点沿用已有语义步骤；先完整校验，再一次发布，避免只执行一半。 */
export function cubePlaneOperations(state: CubeStructureState, ids: readonly string[], kind: CubeMoveOperation["kind"], delta: VoxelCoordinate): CubeMoveOperation[] | null {
  const operations = CUBE_DRAG_AXES.filter((axis) => Math.abs(delta[axis]) > 1e-8).map((axis) => ({ kind, ids, axis, distance: delta[axis] }));
  if (operations.length > 2) return null;
  for (const ordered of [operations, [...operations].reverse()]) {
    let current = state, valid = true;
    for (const operation of ordered) { const next = applyCubeOperation(current, operation); if (next === current) { valid = false; break; } current = next; }
    if (valid) return ordered;
  }
  return null;
}

export function cubeMoveCenter(state: CubeStructureState, ids: readonly string[]): VoxelCoordinate | null {
  const cubes = state.cubes.filter((cube) => ids.includes(cube.id) && !state.hiddenCubeIds.includes(cube.id));
  if (!cubes.length) return null;
  const positions = cubes.map(cubeDisplayPosition);
  const middle = (axis: Axis) => (Math.min(...positions.map((p) => p[axis])) + Math.max(...positions.map((p) => p[axis]))) / 2;
  return { x: middle("x"), y: middle("y"), z: middle("z") };
}

export function cubeScreenPoint(position: VoxelCoordinate, camera: Camera, size: { width: number; height: number }): CubeScreenPoint {
  const point = new Vector3(position.x, position.y, position.z).project(camera);
  return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2 };
}

/** 使用当前相机与缩放投影轴向；朝向屏幕的轴交给视角切换或步数按钮。 */
export function cubeDragProjection(center: VoxelCoordinate, axis: Axis, camera: Camera, size: { width: number; height: number }): CubeScreenPoint | null {
  const from = cubeScreenPoint(center, camera, size);
  const to = cubeScreenPoint({ ...center, [axis]: center[axis] + 1 }, camera, size);
  const result = { x: to.x - from.x, y: to.y - from.y };
  return Math.hypot(result.x, result.y) >= 4 ? result : null;
}

export function cubeDragDistance(delta: CubeScreenPoint, projection: CubeScreenPoint): number {
  const lengthSquared = projection.x ** 2 + projection.y ** 2;
  return lengthSquared < 16 ? 0 : (delta.x * projection.x + delta.y * projection.y) / lengthSquared;
}

// 手柄与命中共用世界长度；相机缩放时两者自动同比例投影。
export const CUBE_MOVE_HANDLE_LENGTH = 1.6;

export function cubeDragHandleAxis(point: CubeScreenPoint, center: VoxelCoordinate, camera: Camera, size: { width: number; height: number }, axes: readonly Axis[] = CUBE_DRAG_AXES, hitRadius = 12): Axis | null {
  const from = cubeScreenPoint(center, camera, size);
  const length = CUBE_MOVE_HANDLE_LENGTH;
  let closest = hitRadius;
  let hit: Axis | null = null;
  for (const axis of axes) {
    const projection = cubeDragProjection(center, axis, camera, size);
    if (!projection) continue;
    const t = cubeDragDistance({ x: point.x - from.x, y: point.y - from.y }, projection);
    if (t < length * 0.2 || t > length + 0.15) continue;
    const distance = Math.hypot(point.x - from.x - projection.x * t, point.y - from.y - projection.y * t);
    if (distance < closest) { closest = distance; hit = axis; }
  }
  return hit;
}

/** 开启吸附时以被拖动块为锚点对齐单元格；整组选用同一位移，保留相对位置。 */
export function cubeDragOperation(kind: CubeMoveOperation["kind"], ids: readonly string[], axis: Axis, distance: number, gridAnchor?: number): CubeMoveOperation | null {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9 || (gridAnchor !== undefined && !Number.isFinite(gridAnchor))) return null;
  const scale = kind === "move" ? 1 : 2;
  const snapped = gridAnchor === undefined ? Math.sign(distance) * Math.round(Math.abs(distance) * scale) / scale
    : (distance > 0 ? Math.floor(gridAnchor + distance + 0.5) : Math.ceil(gridAnchor + distance - 0.5)) - gridAnchor;
  return snapped ? { kind, ids: [...ids], axis, distance: snapped } : null;
}

export function cubeDragPositions(state: CubeStructureState, ids: readonly string[], axis: Axis, distance: number) {
  return new Map([...cubeDisplayPositions(state.cubes)].map(([id, position]) => [id, ids.includes(id) ? { ...position, [axis]: position[axis] + distance } : position]));
}

/** 拖动沿用完整单位块命中，隐藏块不可选；组外实体仍遮挡后方的命中。 */
export function cubeDragHit(state: CubeStructureState, ray: Ray): string | null {
  let nearest = Infinity;
  let id: string | null = null;
  const point = new Vector3();
  for (const cube of state.cubes) {
    if (state.hiddenCubeIds.includes(cube.id)) continue;
    const p = cubeDisplayPosition(cube);
    const box = new Box3(new Vector3(p.x - 0.5, p.y - 0.5, p.z - 0.5), new Vector3(p.x + 0.5, p.y + 0.5, p.z + 0.5));
    if (!ray.intersectBox(box, point)) continue;
    const distance = ray.origin.distanceToSquared(point);
    if (distance < nearest) { nearest = distance; id = cube.id; }
  }
  return id;
}
