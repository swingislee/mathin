import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";

export const SPATIAL_MOVE_PLANES = ["table", "xy", "yz", "auto"] as const;
export type SpatialMovePlane = typeof SPATIAL_MOVE_PLANES[number];
export type SpatialStandardMovePlane = Exclude<SpatialMovePlane, "auto">;
export const SPATIAL_LOW_VIEW_ANGLE = { default: 20, min: 10, max: 35, step: 5 } as const;
export type SpatialObjectAction = "translate" | "rotate";
export interface SpatialPointerPoint { x: number; y: number }
export interface SpatialPointerViewport { left: number; top: number; width: number; height: number }
export interface SpatialMoveBasis { plane: SpatialStandardMovePlane; horizontal: VoxelCoordinate; vertical: VoxelCoordinate; normal: VoxelCoordinate }
export interface SpatialMoveViewInfo { plane: SpatialStandardMovePlane; elevation: number }
const vector = (p: VoxelCoordinate) => new Vector3(p.x, p.y, p.z);
const coordinate = (p: Vector3): VoxelCoordinate => ({ x: p.x, y: p.y, z: p.z });

/** 求交与方向提示共用三个标准平面，不生成任意斜面。 */
export function spatialMoveBasis(mode: SpatialStandardMovePlane): SpatialMoveBasis {
  const x = { x: 1, y: 0, z: 0 }, y = { x: 0, y: 1, z: 0 }, z = { x: 0, y: 0, z: 1 };
  return mode === "xy" ? { plane: mode, horizontal: x, vertical: y, normal: z }
    : mode === "yz" ? { plane: mode, horizontal: z, vertical: y, normal: x } : { plane: mode, horizontal: x, vertical: z, normal: y };
}
export function spatialViewElevation(camera: Camera) {
  return Math.asin(Math.min(1, Math.abs(camera.getWorldDirection(new Vector3()).y))) * 180 / Math.PI;
}
export function resolveSpatialMovePlane(mode: SpatialMovePlane, camera: Camera, lowViewAngle: number = SPATIAL_LOW_VIEW_ANGLE.default, previous?: SpatialStandardMovePlane): SpatialStandardMovePlane {
  if (mode !== "auto") return mode;
  const threshold = Math.max(SPATIAL_LOW_VIEW_ANGLE.min, Math.min(SPATIAL_LOW_VIEW_ANGLE.max, Number.isFinite(lowViewAngle) ? lowViewAngle : SPATIAL_LOW_VIEW_ANGLE.default));
  const elevation = spatialViewElevation(camera), direction = camera.getWorldDirection(new Vector3());
  // 接近平视才离开桌面；离开竖直平面时多留 4°，避免临界视角抖动。
  if (elevation > threshold + (previous === "xy" || previous === "yz" ? 4 : 0)) return "table";
  const x = Math.abs(direction.x), z = Math.abs(direction.z);
  // 两个竖直平面之间也保留小缓冲；默认选与画面更平行的那个。
  if (previous === "xy" && x - z < 0.12) return "xy";
  if (previous === "yz" && z - x < 0.12) return "yz";
  return z >= x ? "xy" : "yz";
}
/** 每个舞台独立持有；可视提示和起拖求交读取同一个带防抖的选面结果。 */
export function createSpatialMovePlaneResolver() {
  let previous: SpatialStandardMovePlane | undefined, previousMode: SpatialMovePlane | undefined, previousAngle: number | undefined;
  return (mode: SpatialMovePlane, camera: Camera, lowViewAngle: number = SPATIAL_LOW_VIEW_ANGLE.default) => {
    if (mode !== previousMode || lowViewAngle !== previousAngle) previous = undefined;
    previous = resolveSpatialMovePlane(mode, camera, lowViewAngle, previous);
    previousMode = mode; previousAngle = lowViewAngle;
    return previous;
  };
}

export function spatialPointerRay(point: SpatialPointerPoint, camera: Camera, size: SpatialPointerViewport) {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2((point.x - size.left) / size.width * 2 - 1, 1 - (point.y - size.top) / size.height * 2), camera);
  return raycaster;
}

/** 手势开始时固定所选平面与抓取点；侧看该平面时提示换平面或视角。 */
export function spatialMoveProjection(point: SpatialPointerPoint, anchor: VoxelCoordinate, mode: SpatialStandardMovePlane, camera: Camera, size: SpatialPointerViewport) {
  const ray = spatialPointerRay(point, camera, size).ray;
  const basis = spatialMoveBasis(mode), normal = vector(basis.normal);
  if (Math.abs(normal.dot(ray.direction)) < 0.12) return null;
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, vector(anchor));
  const start = ray.intersectPlane(plane, new Vector3());
  return start ? { plane, start, basis } : null;
}
export function spatialMoveDelta(projection: NonNullable<ReturnType<typeof spatialMoveProjection>>, point: SpatialPointerPoint, camera: Camera, size: SpatialPointerViewport): VoxelCoordinate | null {
  const ray = spatialPointerRay(point, camera, size).ray;
  if (Math.abs(projection.plane.normal.dot(ray.direction)) < 0.12) return null;
  const next = ray.intersectPlane(projection.plane, new Vector3());
  return next ? coordinate(next.sub(projection.start)) : null;
}
