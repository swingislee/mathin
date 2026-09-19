import type { SolidEntity } from "./solid-geometry-contract";

export const SOLID_TRANSITION_MS = 320;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
/** 逐次教学操作从当前显示位置接续；末帧使用准确参数，不积累浮点位移。 */
export function interpolateSolidEntities(from: readonly SolidEntity[], to: readonly SolidEntity[], progress: number): SolidEntity[] {
  if (progress >= 1) return [...to];
  const t = 1 - (1 - Math.max(0, progress)) ** 3;
  return to.map((entity) => { const previous = from.find((item) => item.id === entity.id && item.kind === entity.kind); if (!previous) return entity;
    return { ...entity, position: { x: lerp(previous.position.x, entity.position.x, t), y: lerp(previous.position.y, entity.position.y, t), z: lerp(previous.position.z, entity.position.z, t) },
      rotation: { x: angle(previous.rotation.x, entity.rotation.x, t), y: angle(previous.rotation.y, entity.rotation.y, t), z: angle(previous.rotation.z, entity.rotation.z, t) },
      dimensions: { width: lerp(previous.dimensions.width, entity.dimensions.width, t), height: lerp(previous.dimensions.height, entity.dimensions.height, t), depth: lerp(previous.dimensions.depth, entity.dimensions.depth, t), radius: lerp(previous.dimensions.radius, entity.dimensions.radius, t) }, opacity: lerp(previous.opacity, entity.opacity, t) };
  });
}
