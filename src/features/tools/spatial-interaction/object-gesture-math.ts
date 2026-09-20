import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";

export type SpatialMovePlane = "table" | "screen";
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

/** 手势开始时固定平面与抓取点，不根据最初几个像素猜轴。近乎侧看桌面时明确提示换视角。 */
export function spatialMoveProjection(point: SpatialPointerPoint, anchor: VoxelCoordinate, mode: SpatialMovePlane, camera: Camera, size: SpatialPointerViewport) {
  const ray = spatialPointerRay(point, camera, size).ray;
  const normal = mode === "table" ? new Vector3(0, 1, 0) : camera.getWorldDirection(new Vector3());
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
