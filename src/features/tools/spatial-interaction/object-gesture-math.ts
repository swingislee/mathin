import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";

export const SPATIAL_MOVE_PLANES = ["table", "xy", "yz", "screen"] as const;
export type SpatialMovePlane = typeof SPATIAL_MOVE_PLANES[number];
export type SpatialObjectAction = "translate" | "rotate";
export interface SpatialPointerPoint { x: number; y: number }
export interface SpatialPointerViewport { left: number; top: number; width: number; height: number }
const vector = (p: VoxelCoordinate) => new Vector3(p.x, p.y, p.z);
const coordinate = (p: Vector3): VoxelCoordinate => ({ x: p.x, y: p.y, z: p.z });

export function spatialPointerRay(point: SpatialPointerPoint, camera: Camera, size: SpatialPointerViewport) {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2((point.x - size.left) / size.width * 2 - 1, 1 - (point.y - size.top) / size.height * 2), camera);
  return raycaster;
}

/** 手势开始时固定所选平面与抓取点；侧看该平面时提示换平面或视角。 */
export function spatialMoveProjection(point: SpatialPointerPoint, anchor: VoxelCoordinate, mode: SpatialMovePlane, camera: Camera, size: SpatialPointerViewport) {
  const ray = spatialPointerRay(point, camera, size).ray;
  const normal = mode === "screen" ? camera.getWorldDirection(new Vector3())
    : mode === "xy" ? new Vector3(0, 0, 1) : mode === "yz" ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  if (Math.abs(normal.dot(ray.direction)) < 0.12) return null;
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, vector(anchor));
  const start = ray.intersectPlane(plane, new Vector3());
  return start ? { plane, start } : null;
}
export function spatialMoveDelta(projection: NonNullable<ReturnType<typeof spatialMoveProjection>>, point: SpatialPointerPoint, camera: Camera, size: SpatialPointerViewport): VoxelCoordinate | null {
  const ray = spatialPointerRay(point, camera, size).ray;
  if (Math.abs(projection.plane.normal.dot(ray.direction)) < 0.12) return null;
  const next = ray.intersectPlane(projection.plane, new Vector3());
  return next ? coordinate(next.sub(projection.start)) : null;
}
