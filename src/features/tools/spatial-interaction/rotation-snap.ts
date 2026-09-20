import { Quaternion } from "three";
import type { SpatialRigidPose } from "./rigid-motion";

/** 只在目标附近吸附；允许的朝向与碰撞约束由教具提供，手势过程保持自由。 */
export const SPATIAL_ROTATION_SNAP_ANGLE = Math.PI / 12;
export function spatialRotationSnap(
  rotation: SpatialRigidPose["quaternion"],
  candidates: readonly SpatialRigidPose["quaternion"][],
  maxAngle = SPATIAL_ROTATION_SNAP_ANGLE,
): { index: number; angle: number } | null {
  const q = new Quaternion(...rotation).normalize();
  let nearest: { index: number; angle: number } | null = null;
  candidates.forEach((candidate, index) => {
    const angle = q.angleTo(new Quaternion(...candidate));
    if (angle <= maxAngle + 1e-7 && (!nearest || angle < nearest.angle - 1e-7)) nearest = { index, angle };
  });
  return nearest;
}
