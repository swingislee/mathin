import { Quaternion, Vector3, type Camera } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import type { SpatialRigidPose } from "./rigid-motion";
import { spatialMoveBasis, spatialPointerRay, type SpatialPointerPoint, type SpatialPointerViewport, type SpatialStandardMovePlane } from "./object-gesture-math";

export type SpatialHandleConstraint = { kind: "plane"; plane: SpatialStandardMovePlane } | { kind: "axis-rotation"; axis: Axis; maxAngle?: number };
export interface SpatialTransformHandlesSpec { center: VoxelCoordinate; mode: "move" | "rotate"; radius: number; length?: number; maxAngle?: number }
export const SPATIAL_STANDARD_PLANES = ["table", "xy", "yz"] as const;
export const spatialAxisVector = (axis: Axis) => new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
const v = (p: VoxelCoordinate) => new Vector3(p.x, p.y, p.z);
export const rotationPlane = (axis: Axis): SpatialStandardMovePlane => axis === "x" ? "yz" : axis === "y" ? "table" : "xy";
export function planeHandleCorners(spec: SpatialTransformHandlesSpec, plane: SpatialStandardMovePlane) {
  const basis = spatialMoveBasis(plane), length = spec.length ?? 1.6;
  return [[0.36, 0.36], [0.7, 0.36], [0.7, 0.7], [0.36, 0.7]].map(([a, b]) => v(spec.center).addScaledVector(v(basis.horizontal), a * length).addScaledVector(v(basis.vertical), b * length));
}
export function rotationRingPoint(spec: SpatialTransformHandlesSpec, axis: Axis, angle: number) {
  const { horizontal, vertical } = spatialMoveBasis(rotationPlane(axis));
  return v(spec.center).addScaledVector(v(horizontal), Math.cos(angle) * spec.radius).addScaledVector(v(vertical), Math.sin(angle) * spec.radius);
}
export function handlePlaneFacing(plane: SpatialStandardMovePlane, camera: Camera) {
  return Math.abs(v(spatialMoveBasis(plane).normal).dot(camera.getWorldDirection(new Vector3())));
}
function screen(p: Vector3, camera: Camera, size: SpatialPointerViewport) {
  const n = p.clone().project(camera); return { x: size.left + (n.x + 1) * size.width / 2, y: size.top + (1 - n.y) * size.height / 2 };
}
function segmentDistance(p: SpatialPointerPoint, a: SpatialPointerPoint, b: SpatialPointerPoint) {
  const x = b.x - a.x, y = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y || 1)));
  return Math.hypot(p.x - a.x - t * x, p.y - a.y - t * y);
}
/** 所见即所得的屏幕命中；侧对平面时停用，不替用户换面或换轴。 */
export function pickSpatialTransformHandle(spec: SpatialTransformHandlesSpec, point: SpatialPointerPoint, camera: Camera, size: SpatialPointerViewport, touch = false): SpatialHandleConstraint | null {
  let best = Infinity, result: SpatialHandleConstraint | null = null;
  if (spec.mode === "move") {
    for (const plane of SPATIAL_STANDARD_PLANES) {
      if (handlePlaneFacing(plane, camera) < 0.18) continue;
      const vertices = planeHandleCorners(spec, plane).map((p) => screen(p, camera, size));
      const signs = vertices.map((a, i) => { const b = vertices[(i + 1) % 4]; return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x); });
      const inside = signs.every((n) => n >= 0) || signs.every((n) => n <= 0);
      const distance = inside ? 0 : Math.min(...vertices.map((a, i) => segmentDistance(point, a, vertices[(i + 1) % 4])));
      const center = vertices.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
      const score = distance + Math.hypot(point.x - center.x, point.y - center.y) * 0.001;
      if (distance <= (touch ? 9 : 3) && score < best) { best = score; result = { kind: "plane", plane }; }
    }
  } else for (const axis of ["x", "y", "z"] as const) {
    if (handlePlaneFacing(rotationPlane(axis), camera) < 0.18) continue;
    const points = Array.from({ length: 97 }, (_, i) => screen(rotationRingPoint(spec, axis, i * Math.PI / 48), camera, size));
    const distance = Math.min(...points.slice(1).map((b, i) => segmentDistance(point, points[i], b)));
    if (distance < (touch ? 18 : 8) && distance < best) { best = distance; result = { kind: "axis-rotation", axis, maxAngle: spec.maxAngle }; }
  }
  return result;
}
export function spatialRingVector(point: SpatialPointerPoint, center: VoxelCoordinate, axis: Axis, camera: Camera, size: SpatialPointerViewport) {
  const ray = spatialPointerRay(point, camera, size).ray, normal = spatialAxisVector(axis), denominator = ray.direction.dot(normal);
  if (Math.abs(denominator) < 0.12) return null;
  const distance = v(center).sub(ray.origin).dot(normal) / denominator;
  const radius = ray.at(distance, new Vector3()).sub(v(center));
  return radius.lengthSq() > 1e-8 ? radius.normalize() : null;
}
export function spatialRingAngle(from: Vector3, to: Vector3, axis: Axis) {
  return Math.atan2(spatialAxisVector(axis).dot(from.clone().cross(to)), from.dot(to));
}
export function rotateSpatialPose(source: SpatialRigidPose, pivot: VoxelCoordinate, axis: Axis, angle: number): SpatialRigidPose {
  const q = new Quaternion().setFromAxisAngle(spatialAxisVector(axis), angle), p = v(source.position).sub(v(pivot)).applyQuaternion(q).add(v(pivot));
  return { ...source, position: { x: p.x, y: p.y, z: p.z }, quaternion: q.multiply(new Quaternion(...source.quaternion)).normalize().toArray() };
}
