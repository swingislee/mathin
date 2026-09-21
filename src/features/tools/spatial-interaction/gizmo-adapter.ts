import { Euler, Quaternion, Vector3, type Raycaster } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import type { SpatialGestureTarget, SpatialObjectInteraction, SpatialObjectPreview } from "./object-gesture-controller";
import { rotateSpatialPose } from "./transform-handles";

export interface SpatialGizmoTranslation { delta: VoxelCoordinate; valid: boolean; apply: () => boolean }
export interface SpatialGizmoObject {
  id: string; center: VoxelCoordinate; radius: number;
  translate: (delta: VoxelCoordinate) => SpatialGizmoTranslation;
  rotate?: (axis: Axis, turn: -1 | 1) => { valid: boolean; apply: () => boolean };
}
/** 刚体本体沿 XZ 拖动，明确手柄覆盖约束；领域只提供命中对象和合法终点。 */
export function spatialGizmoInteraction(options: {
  key: object; selectedId: string | null; mode: "move" | "rotate"; enabled: boolean; showHandles?: boolean;
  objectFor: (id: string) => SpatialGizmoObject | null;
  pick: (raycaster: Raycaster) => { id: string; point: VoxelCoordinate } | null;
  onSelect: (id: string) => void;
  onPreview: (frame: SpatialObjectPreview | null) => void; onDragging: (active: boolean) => void; onUnavailable: () => void;
}): SpatialObjectInteraction {
  const targetFor = (id: string, point?: VoxelCoordinate): SpatialGestureTarget | null => {
    const object = options.objectFor(id); if (!object) return null;
    return { pose: { id, position: object.center, quaternion: [0, 0, 0, 1] }, pivot: object.center, grabPoint: point ?? object.center, radius: object.radius };
  };
  const selected = options.selectedId ? targetFor(options.selectedId) : null;
  return {
    key: options.key, enabled: options.enabled, plane: "table", freeRotation: false, selected,
    handles: selected && options.showHandles !== false ? { center: selected.pivot, radius: selected.radius!, mode: options.mode, maxAngle: Math.PI / 2 } : undefined,
    pick: (raycaster) => { const hit = options.pick(raycaster); return hit ? targetFor(hit.id, hit.point) : null; },
    onSelect: options.onSelect, onPreview: options.onPreview, onDragging: options.onDragging, onUnavailable: options.onUnavailable,
    resolve: (target, moved, action, constraint) => {
      const object = options.objectFor(target.pose.id), pose = target.pose;
      if (!object) return { pose, valid: false, apply: () => false };
      if (action === "rotate" && constraint?.kind === "axis-rotation") {
        const axis = constraint.axis, index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const angle = 2 * Math.atan2(moved.quaternion[index], moved.quaternion[3]);
        const turn = Math.round(angle / (Math.PI / 2));
        const landing = turn ? object.rotate?.(axis, turn > 0 ? 1 : -1) : { valid: true, apply: () => true };
        return { pose: rotateSpatialPose(pose, target.pivot, axis, turn * Math.PI / 2), valid: landing?.valid ?? false, apply: landing?.apply ?? (() => false), snapped: true };
      }
      if (action !== "translate") return { pose, valid: false, apply: () => false };
      const landing = object.translate({ x: moved.position.x - pose.position.x, y: moved.position.y - pose.position.y, z: moved.position.z - pose.position.z });
      const unchanged = Math.hypot(landing.delta.x, landing.delta.y, landing.delta.z) < 1e-8;
      return { pose: { ...pose, position: { x: pose.position.x + landing.delta.x, y: pose.position.y + landing.delta.y, z: pose.position.z + landing.delta.z } }, valid: landing.valid, apply: unchanged ? () => true : landing.apply };
    },
  };
}
export function spatialGizmoDelta(frame: SpatialObjectPreview) {
  return { x: frame.pose.position.x - frame.target.pose.position.x, y: frame.pose.position.y - frame.target.pose.position.y, z: frame.pose.position.z - frame.target.pose.position.z };
}
export function spatialGizmoPoint(frame: SpatialObjectPreview, point: VoxelCoordinate) {
  const c = frame.target.pivot, p = new Vector3(point.x - c.x, point.y - c.y, point.z - c.z).applyQuaternion(new Quaternion(...frame.pose.quaternion));
  return { x: p.x + frame.pose.position.x, y: p.y + frame.pose.position.y, z: p.z + frame.pose.position.z };
}
export function spatialGizmoEuler(frame: SpatialObjectPreview, rotation: VoxelCoordinate) {
  const q = new Quaternion(...frame.pose.quaternion).multiply(new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z)));
  const e = new Euler().setFromQuaternion(q); return { x: e.x, y: e.y, z: e.z };
}
export function snapSpatialTranslation(delta: VoxelCoordinate, step: number, position?: VoxelCoordinate, origin: Partial<VoxelCoordinate> = {}) {
  return Object.fromEntries((["x", "y", "z"] as const).map((axis) => {
    if (Math.abs(delta[axis]) < 1e-9) return [axis, 0]; // 未操作的轴保持不变。
    const offset = position ? position[axis] - (origin[axis] ?? 0) : 0;
    const scaled = (offset + delta[axis]) / step;
    return [axis, step > 0 ? (delta[axis] > 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)) * step - offset : delta[axis]];
  })) as unknown as VoxelCoordinate;
}
