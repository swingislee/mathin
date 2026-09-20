import { Quaternion } from "three";
import type { SpatialRigidPose } from "./rigid-motion";

/** 只在目标附近吸附；允许的朝向与碰撞约束由教具提供，手势过程保持自由。 */
export const SPATIAL_ROTATION_SNAP_LEVELS = ["free", "light", "standard", "strong"] as const;
export type SpatialRotationSnapLevel = (typeof SPATIAL_ROTATION_SNAP_LEVELS)[number];
export const SPATIAL_ROTATION_SNAP_DEGREES: Record<SpatialRotationSnapLevel, number | null> = { free: null, light: 15, standard: 30, strong: 45 };
export const DEFAULT_SPATIAL_ROTATION_SNAP: SpatialRotationSnapLevel = "standard";
export function spatialRotationSnapAngle(level: SpatialRotationSnapLevel): number | null {
  const degrees = SPATIAL_ROTATION_SNAP_DEGREES[level];
  return degrees === null ? null : degrees * Math.PI / 180;
}
export const SPATIAL_ROTATION_SNAP_ANGLE = spatialRotationSnapAngle(DEFAULT_SPATIAL_ROTATION_SNAP)!;
export function spatialRotationSnap(
  rotation: SpatialRigidPose["quaternion"],
  candidates: readonly SpatialRigidPose["quaternion"][],
  maxAngle: number | null = SPATIAL_ROTATION_SNAP_ANGLE,
): { index: number; angle: number } | null {
  if (maxAngle === null) return null;
  const q = new Quaternion(...rotation).normalize();
  let nearest: { index: number; angle: number } | null = null;
  candidates.forEach((candidate, index) => {
    const angle = q.angleTo(new Quaternion(...candidate));
    if (angle <= maxAngle + 1e-7 && (!nearest || angle < nearest.angle - 1e-7)) nearest = { index, angle };
  });
  return nearest;
}
