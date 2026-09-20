import { Quaternion, Vector3, type Camera } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import type { SpatialPointerPoint, SpatialPointerViewport } from "./object-gesture-math";
import type { SpatialRigidPose } from "./rigid-motion";

export interface SpatialArcball { center: SpatialPointerPoint; radius: number; cameraQuaternion: [number, number, number, number] }
const vector = (p: VoxelCoordinate) => new Vector3(p.x, p.y, p.z);

/** 手势开始时锁定屏幕球心、投影尺寸和视角。球仅解释已命中对象的拖动，不占用空白拾取区。 */
export function spatialArcball(pivot: VoxelCoordinate, worldRadius: number, camera: Camera, viewport: SpatialPointerViewport): SpatialArcball {
  const q = camera.getWorldQuaternion(new Quaternion()), center = vector(pivot).project(camera);
  const edge = vector(pivot).add(new Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(worldRadius)).project(camera);
  return {
    center: { x: viewport.left + (center.x + 1) * viewport.width / 2, y: viewport.top + (1 - center.y) * viewport.height / 2 },
    radius: Math.max(48, Math.hypot((edge.x - center.x) * viewport.width / 2, (edge.y - center.y) * viewport.height / 2)),
    cameraQuaternion: q.toArray(),
  };
}
function spherePoint(point: SpatialPointerPoint, ball: SpatialArcball) {
  const p = new Vector3((point.x - ball.center.x) / ball.radius, (ball.center.y - point.y) / ball.radius, 0);
  const squared = p.lengthSq();
  if (squared > 1) return p.normalize();
  p.z = Math.sqrt(1 - squared); return p;
}

/** Shoemake Arcball：从起点到当前点计算总旋转；反向拖回即复原，不依赖帧数或逐帧欧拉角。 */
export function spatialArcballRotation(source: SpatialRigidPose, pivot: VoxelCoordinate, start: SpatialPointerPoint, end: SpatialPointerPoint, ball: SpatialArcball): SpatialRigidPose {
  const from = spherePoint(start, ball), to = spherePoint(end, ball), cross = new Vector3().crossVectors(from, to);
  const camera = new Quaternion(...ball.cameraQuaternion);
  const rotation = camera.clone().multiply(new Quaternion(cross.x, cross.y, cross.z, from.dot(to)).normalize()).multiply(camera.invert());
  const position = vector(source.position).sub(vector(pivot)).applyQuaternion(rotation).add(vector(pivot));
  return { ...source, position: { x: position.x, y: position.y, z: position.z }, quaternion: rotation.multiply(new Quaternion(...source.quaternion)).normalize().toArray() };
}
