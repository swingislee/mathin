import { Euler, Quaternion, Vector3 } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import type { SpatialObjectInteraction, SpatialObjectPreview } from "./object-gesture-controller";
import { rotateSpatialPose } from "./transform-handles";

export interface SpatialGizmoTranslation { delta: VoxelCoordinate; valid: boolean; apply: () => boolean }
/** 旧工具声明自己的终点合同；平面求交、旋转手势、回退和指针归属继续走同一控制器。 */
export function spatialGizmoInteraction(options: {
  key: object; id: string; center: VoxelCoordinate; radius: number; mode: "move" | "rotate"; enabled: boolean;
  translate: (delta: VoxelCoordinate) => SpatialGizmoTranslation;
  rotate?: (axis: Axis, turn: -1 | 1) => { valid: boolean; apply: () => boolean };
  onPreview: (frame: SpatialObjectPreview | null) => void; onDragging: (active: boolean) => void; onUnavailable: () => void;
}): SpatialObjectInteraction {
  const pose = { id: options.id, position: options.center, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
  return {
    key: options.key, enabled: options.enabled, plane: "table", selected: { pose, pivot: options.center, grabPoint: options.center, radius: options.radius },
    handles: { center: options.center, radius: options.radius, mode: options.mode, maxAngle: Math.PI / 2 },
    pick: () => null, onSelect: () => {}, onPreview: options.onPreview, onDragging: options.onDragging, onUnavailable: options.onUnavailable,
    resolve: (_target, moved, action, constraint) => {
      if (action === "rotate" && constraint?.kind === "axis-rotation") {
        const axis = constraint.axis, index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
        const angle = 2 * Math.atan2(moved.quaternion[index], moved.quaternion[3]);
        const turn = Math.round(angle / (Math.PI / 2));
        const landing = turn ? options.rotate?.(axis, turn > 0 ? 1 : -1) : { valid: true, apply: () => true };
        return { pose: rotateSpatialPose(pose, options.center, axis, turn * Math.PI / 2), valid: landing?.valid ?? false, apply: landing?.apply ?? (() => false), snapped: true };
      }
      const landing = options.translate({ x: moved.position.x - pose.position.x, y: moved.position.y - pose.position.y, z: moved.position.z - pose.position.z });
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
