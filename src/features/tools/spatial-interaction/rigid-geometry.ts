import { Box3, Matrix4, Quaternion, Ray, Vector3 } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import type { SpatialRigidPose } from "./rigid-motion";

export function spatialRigidPoint(point: VoxelCoordinate, pose: SpatialRigidPose): VoxelCoordinate {
  const p = new Vector3(point.x, point.y, point.z).applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(pose.position.x, pose.position.y, pose.position.z));
  return { x: p.x, y: p.y, z: p.z };
}
export function spatialRigidAxes(quaternion: SpatialRigidPose["quaternion"]) {
  const q = new Quaternion(...quaternion);
  return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q));
}
/** 单位立方体 OBB 的 15 条分离轴；贴面允许，穿插拒绝。与 SQL 合同共用 1e-7 容差。 */
export function spatialUnitCubesOverlap(a: VoxelCoordinate, axesA: Vector3[], b: VoxelCoordinate, axesB: Vector3[]): boolean {
  const offset = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  if (offset.lengthSq() >= 3) return false;
  const axes = [...axesA, ...axesB, ...axesA.flatMap((u) => axesB.map((v) => new Vector3().crossVectors(u, v)))];
  return axes.every((axis) => {
    if (axis.lengthSq() < 1e-14) return true;
    axis = axis.clone().normalize();
    const radius = [...axesA, ...axesB].reduce((sum, v) => sum + Math.abs(axis.dot(v)) / 2, 0);
    return Math.abs(offset.dot(axis)) < radius - 1e-7;
  });
}

/** 在对象局部空间命中真实单元块，支持任意姿态；不使用旋转后的轴对齐包围盒冒充实体。 */
export function spatialPickRigidCells(ray: Ray, pose: SpatialRigidPose, cells: readonly VoxelCoordinate[]) {
  const matrix = new Matrix4().compose(new Vector3(pose.position.x, pose.position.y, pose.position.z), new Quaternion(...pose.quaternion), new Vector3(1, 1, 1));
  const local = ray.clone().applyMatrix4(matrix.clone().invert());
  let hit: { index: number; point: VoxelCoordinate; distance: number } | null = null;
  cells.forEach((p, index) => {
    const point = local.intersectBox(new Box3(new Vector3(p.x - 0.5, p.y - 0.5, p.z - 0.5), new Vector3(p.x + 0.5, p.y + 0.5, p.z + 0.5)), new Vector3());
    if (!point) return;
    point.applyMatrix4(matrix); const distance = point.distanceTo(ray.origin);
    if (!hit || distance < hit.distance) hit = { index, point: { x: point.x, y: point.y, z: point.z }, distance };
  });
  return hit as { index: number; point: VoxelCoordinate; distance: number } | null;
}
