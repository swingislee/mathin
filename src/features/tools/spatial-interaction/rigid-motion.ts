import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { spatialActionProgress } from "./policy";

export interface SpatialRigidPose {
  id: string;
  position: VoxelCoordinate;
  quaternion: [number, number, number, number];
}
export function interpolateRigidPoses(from: readonly SpatialRigidPose[], to: readonly SpatialRigidPose[], progress: number): SpatialRigidPose[] {
  const t = spatialActionProgress(progress), previous = new Map(from.map((pose) => [pose.id, pose]));
  return to.map((pose) => {
    const start = previous.get(pose.id);
    if (!start || progress >= 1) return pose;
    const fromQ = new Quaternion(...start.quaternion), toQ = new Quaternion(...pose.quaternion);
    const delta = toQ.clone().multiply(fromQ.clone().invert());
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const sine = Math.hypot(delta.x, delta.y, delta.z);
    const fromPosition = new Vector3(start.position.x, start.position.y, start.position.z);
    const toPosition = new Vector3(pose.position.x, pose.position.y, pose.position.z);
    let position: Vector3;
    if (sine < 1e-7) position = fromPosition.lerp(toPosition, t);
    else {
      // 同一个刚体绕固定轴走圆弧；网格归一化造成的原点变化也不能逐块直线插值。
      const axis = new Vector3(delta.x, delta.y, delta.z).divideScalar(sine);
      const displacement = toPosition.sub(fromPosition.clone().applyQuaternion(delta));
      const along = displacement.dot(axis), perpendicular = displacement.clone().addScaledVector(axis, -along);
      const pivot = perpendicular.clone().addScaledVector(axis.clone().cross(perpendicular), delta.w / sine).multiplyScalar(0.5);
      position = fromPosition.sub(pivot).applyQuaternion(new Quaternion().slerp(delta, t)).add(pivot).addScaledVector(axis, along * t);
    }
    return { ...pose, quaternion: fromQ.slerp(toQ, t).toArray(), position: { x: position.x, y: position.y, z: position.z } };
  });
}
export function spatialBasisQuaternion(basis: readonly VoxelCoordinate[]): SpatialRigidPose["quaternion"] {
  const vectors = basis.map((v) => new Vector3(v.x, v.y, v.z));
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(vectors[0], vectors[1], vectors[2])).toArray();
}
/** 世界轴转动先乘当前姿态；不能直接累加 Euler 分量冒充世界轴。 */
export function spatialQuarterTurn(rotation: VoxelCoordinate, axis: Axis, turn: -1 | 1): VoxelCoordinate {
  const normal = new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
  const q = new Quaternion().setFromAxisAngle(normal, turn * Math.PI / 2)
    .multiply(new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z)));
  const euler = new Euler().setFromQuaternion(q);
  return { x: euler.x, y: euler.y, z: euler.z };
}
export function interpolateSpatialRotation(from: VoxelCoordinate, to: VoxelCoordinate, progress: number): VoxelCoordinate {
  const q = new Quaternion().setFromEuler(new Euler(from.x, from.y, from.z))
    .slerp(new Quaternion().setFromEuler(new Euler(to.x, to.y, to.z)), progress);
  const euler = new Euler().setFromQuaternion(q);
  return { x: euler.x, y: euler.y, z: euler.z };
}
