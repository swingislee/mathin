import { Vector3, type Camera } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { CUBE_MOVE_HANDLE_LENGTH } from "../spatial-lab/cube-structures-drag";

export interface SpatialToolbarHandles { center: VoxelCoordinate; axes: readonly Axis[] }
export interface SpatialScreenRect { left: number; top: number; right: number; bottom: number }
export type SpatialToolbarSide = "top" | "left" | "right" | "bottom";
export interface SpatialToolbarPlacement { x: number; y: number; side: SpatialToolbarSide }
const GAP = 12;

/** 投影实际模型边界和手柄热区；世界 Y 方向的偏移不能代表屏幕上的留白。 */
export function spatialToolbarFootprint(vertices: readonly VoxelCoordinate[], handles: SpatialToolbarHandles, camera: Camera, size: { width: number; height: number }): SpatialScreenRect | null {
  const points = [...vertices, ...handles.axes.flatMap((axis) => [handles.center, { ...handles.center, [axis]: handles.center[axis] + CUBE_MOVE_HANDLE_LENGTH }])];
  if (!points.length) return null;
  const rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const point of points) {
    const p = new Vector3(point.x, point.y, point.z);
    if (p.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) return null;
    p.project(camera);
    const x = (p.x + 1) * size.width / 2, y = (1 - p.y) * size.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    rect.left = Math.min(rect.left, x); rect.right = Math.max(rect.right, x);
    rect.top = Math.min(rect.top, y); rect.bottom = Math.max(rect.bottom, y);
  }
  // 覆盖触屏拾取热区、箭头端点和轴标签，尺寸不随相机缩放缩小。
  return { left: rect.left - 26, right: rect.right + 26, top: rect.top - 26, bottom: rect.bottom + 26 };
}

/** 在对象外寻找完整空位。没有空位时收起快捷栏，保留工作台侧栏入口。 */
export function spatialToolbarPlacement(footprint: SpatialScreenRect, size: { width: number; height: number }, toolbar: { width: number; height: number }, preferred: SpatialToolbarSide = "top", obstacles: readonly SpatialScreenRect[] = []): SpatialToolbarPlacement | null {
  // 为顶部视角栏、右侧操作栏和底部拼块栏留出边界；竖屏底栏也使用相同余量。
  const area = { left: 8, top: 56, right: size.width - 56, bottom: size.height - 56 };
  if (![...Object.values(footprint), size.width, size.height, toolbar.width, toolbar.height].every(Number.isFinite)) return null;
  if (toolbar.width <= 0 || toolbar.height <= 0 || toolbar.width > area.right - area.left || toolbar.height > area.bottom - area.top) return null;
  if (footprint.right < area.left || footprint.left > area.right || footprint.bottom < area.top || footprint.top > area.bottom) return null;
  const w = toolbar.width / 2, h = toolbar.height / 2;
  const x = Math.max(area.left + w, Math.min(area.right - w, (footprint.left + footprint.right) / 2));
  const y = Math.max(area.top + h, Math.min(area.bottom - h, (footprint.top + footprint.bottom) / 2));
  const candidates: Record<SpatialToolbarSide, SpatialToolbarPlacement> = {
    top: { x, y: footprint.top - GAP - h, side: "top" }, bottom: { x, y: footprint.bottom + GAP + h, side: "bottom" },
    left: { x: footprint.left - GAP - w, y, side: "left" }, right: { x: footprint.right + GAP + w, y, side: "right" },
  };
  // 横向任务条优先留在对象两侧，避免首选侧放不下时盖住同列相邻对象。
  const order: readonly SpatialToolbarSide[] = preferred === "left" || preferred === "right"
    ? [preferred, preferred === "left" ? "right" : "left", "top", "bottom"] : [preferred, "top", "left", "right", "bottom"];
  const blockers = obstacles.filter((rect) => Object.values(rect).every(Number.isFinite) && rect.right >= rect.left && rect.bottom >= rect.top);
  const clear = (p: SpatialToolbarPlacement) => p.x - w >= area.left && p.x + w <= area.right && p.y - h >= area.top && p.y + h <= area.bottom
    && blockers.every((rect) => p.x + w + GAP <= rect.left || p.x - w - GAP >= rect.right || p.y + h + GAP <= rect.top || p.y - h - GAP >= rect.bottom);
  for (const side of new Set(order)) {
    const p = candidates[side];
    if (clear(p)) return p;
    // 沿同一侧小幅错开文字或相邻材料；中心仍对着目标，不跳到舞台远端。
    const horizontal = side === "top" || side === "bottom";
    const min = horizontal ? Math.max(area.left + w, footprint.left) : Math.max(area.top + h, footprint.top);
    const max = horizontal ? Math.min(area.right - w, footprint.right) : Math.min(area.bottom - h, footprint.bottom);
    const shifts = [min, max, ...blockers.flatMap((rect) => horizontal ? [rect.left - GAP - w, rect.right + GAP + w] : [rect.top - GAP - h, rect.bottom + GAP + h])]
      .filter((value) => value >= min && value <= max).sort((a, b) => Math.abs(a - (horizontal ? p.x : p.y)) - Math.abs(b - (horizontal ? p.x : p.y)));
    for (const value of shifts) {
      const shifted = { ...p, ...(horizontal ? { x: value } : { y: value }) };
      if (clear(shifted)) return shifted;
    }
  }
  return null;
}
