import type { SolidEntity } from "./solid-geometry-contract";
import { Euler, Quaternion } from "three";
import { interpolateRigidPoses } from "../spatial-interaction/rigid-motion";
import { SPATIAL_ACTION_DURATION_MS } from "../spatial-interaction/policy";

export const SOLID_TRANSITION_MS = SPATIAL_ACTION_DURATION_MS;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 逐次教学操作从当前显示位置接续；末帧使用准确参数，不积累浮点位移。 */
export function interpolateSolidEntities(from: readonly SolidEntity[], to: readonly SolidEntity[], progress: number): SolidEntity[] {
  if (progress >= 1) return [...to];
  const t = 1 - (1 - Math.max(0, progress)) ** 3;
  return to.map((entity) => { const previous = from.find((item) => item.id === entity.id && item.kind === entity.kind); if (!previous) return entity;
    const pose = (value: SolidEntity) => ({ id: value.id, position: value.position, quaternion: new Quaternion().setFromEuler(new Euler(value.rotation.x, value.rotation.y, value.rotation.z)).toArray() });
    const [display] = interpolateRigidPoses([pose(previous)], [pose(entity)], progress);
    const rotation = new Euler().setFromQuaternion(new Quaternion(...display.quaternion));
    return { ...entity, position: display.position,
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      dimensions: { width: lerp(previous.dimensions.width, entity.dimensions.width, t), height: lerp(previous.dimensions.height, entity.dimensions.height, t), depth: lerp(previous.dimensions.depth, entity.dimensions.depth, t), radius: lerp(previous.dimensions.radius, entity.dimensions.radius, t) }, opacity: lerp(previous.opacity, entity.opacity, t) };
  });
}
