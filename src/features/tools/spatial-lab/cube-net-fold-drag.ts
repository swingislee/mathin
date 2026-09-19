import type { PolyhedronFoldVector3 } from "@/features/spatial-math/domain";
import type { PolyhedronFoldRenderFace } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import type { CubeNetWorkbenchHinge } from "./cube-net-workbench-model";
import type { CubeNetTeachingAnchor } from "./cube-net-teaching-session";

export interface CubeNetScreenPoint { readonly x: number; readonly y: number }
export interface CubeNetFoldDrag {
  readonly edgeId: string;
  readonly pointerStart: CubeNetScreenPoint;
  readonly projectedStart: CubeNetScreenPoint;
  readonly initialAngle: number;
  readonly minDegrees?: number;
  readonly maxDegrees?: number;
  readonly samples: readonly { readonly degrees: number; readonly point: CubeNetScreenPoint }[];
}
export interface CubeNetPaperSelection {
  readonly edgeId: string;
  readonly faceId: string;
  readonly movingFaceIds: readonly string[];
  readonly anchor: CubeNetTeachingAnchor;
}
export interface CubeNetPaperDrag extends CubeNetFoldDrag, CubeNetPaperSelection {}
export interface CubeNetFoldChange {
  readonly edgeId: string;
  readonly degrees: number;
  readonly anchor: CubeNetTeachingAnchor;
}

/** 按抓取位置就近选择连接边，抓取所在的一侧移动，另一侧只在这一次手势中作支撑。 */
export function cubeNetPaperSelection(
  face: PolyhedronFoldRenderFace, faces: readonly PolyhedronFoldRenderFace[], hinges: readonly CubeNetWorkbenchHinge[], grabbed: PolyhedronFoldVector3,
) {
  const candidates = hinges.filter((hinge) => hinge.faceId === face.faceId || hinge.parentFaceId === face.faceId).map((hinge) => {
    const forward = hinge.faceId === face.faceId;
    const movingFaceIds = forward ? hinge.movingFaceIds : faces.filter((item) => !hinge.movingFaceIds.includes(item.faceId)).map((item) => item.faceId);
    const axis = { x: hinge.end.x - hinge.start.x, y: hinge.end.y - hinge.start.y, z: hinge.end.z - hinge.start.z };
    const offset = { x: grabbed.x - hinge.start.x, y: grabbed.y - hinge.start.y, z: grabbed.z - hinge.start.z };
    const along = Math.max(0, Math.min(1, (offset.x * axis.x + offset.y * axis.y + offset.z * axis.z) / (axis.x ** 2 + axis.y ** 2 + axis.z ** 2)));
    const distance = (offset.x - along * axis.x) ** 2 + (offset.y - along * axis.y) ** 2 + (offset.z - along * axis.z) ** 2;
    return { hinge, forward, movingFaceIds, distance };
  }).sort((left, right) => Math.abs(left.distance - right.distance) > 1e-8
    ? left.distance - right.distance : left.movingFaceIds.length - right.movingFaceIds.length || left.hinge.edgeId.localeCompare(right.hinge.edgeId));
  const selected = candidates[0];
  if (!selected) return null;
  const { hinge, forward, movingFaceIds } = selected;
  const support = faces.find((item) => item.faceId === (forward ? hinge.parentFaceId : hinge.faceId))!;
  const selection: CubeNetPaperSelection = {
    edgeId: hinge.edgeId, faceId: face.faceId, movingFaceIds,
    anchor: { faceId: support.faceId, vertices: [support.vertices[0].position, support.vertices[1].position, support.vertices[2].position] },
  };
  return { selection, hinge: { ...hinge, direction: hinge.direction * (forward ? 1 : -1) } };
}

export function beginCubeNetPaperDrag(
  face: PolyhedronFoldRenderFace, faces: readonly PolyhedronFoldRenderFace[], hinges: readonly CubeNetWorkbenchHinge[], grabbed: PolyhedronFoldVector3,
  pointer: CubeNetScreenPoint, project: (point: PolyhedronFoldVector3) => CubeNetScreenPoint,
): CubeNetPaperDrag | null {
  const selected = cubeNetPaperSelection(face, faces, hinges, grabbed);
  if (!selected) return null;
  const { hinge, selection } = selected;
  const gesture = beginCubeNetFoldDrag(hinge, grabbed, hinge.degrees, pointer, project)
    ?? beginCubeNetFoldDrag(hinge, face.centroid, hinge.degrees, pointer, project);
  return gesture && { ...gesture, ...selection };
}

/** 捕获折痕轴与抓取点，投影真实圆弧；拖动不会变成与观察方向无关的横向滑杆。 */
export function beginCubeNetFoldDrag(
  hinge: CubeNetWorkbenchHinge, grabbed: PolyhedronFoldVector3, angle: number,
  pointer: CubeNetScreenPoint, project: (point: PolyhedronFoldVector3) => CubeNetScreenPoint,
): CubeNetFoldDrag | null {
  const axis = { x: hinge.end.x - hinge.start.x, y: hinge.end.y - hinge.start.y, z: hinge.end.z - hinge.start.z };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length < 1e-8) return null;
  axis.x /= length; axis.y /= length; axis.z /= length;
  const offset = { x: grabbed.x - hinge.start.x, y: grabbed.y - hinge.start.y, z: grabbed.z - hinge.start.z };
  const along = offset.x * axis.x + offset.y * axis.y + offset.z * axis.z;
  const pivot = { x: hinge.start.x + axis.x * along, y: hinge.start.y + axis.y * along, z: hinge.start.z + axis.z * along };
  const radial = { x: grabbed.x - pivot.x, y: grabbed.y - pivot.y, z: grabbed.z - pivot.z };
  if (Math.hypot(radial.x, radial.y, radial.z) < 0.05) return null;
  const tangent = { x: axis.y * radial.z - axis.z * radial.y, y: axis.z * radial.x - axis.x * radial.z, z: axis.x * radial.y - axis.y * radial.x };
  const minDegrees = hinge.minDegrees ?? -90, maxDegrees = hinge.maxDegrees ?? 90;
  if (!Number.isFinite(minDegrees) || !Number.isFinite(maxDegrees) || minDegrees < -180 || maxDegrees > 180 || minDegrees >= maxDegrees) return null;
  // 保留整度采样手感，同时包含三棱柱随底面尺寸变化的非整数闭合角。
  const degrees = [...new Set([minDegrees, ...Array.from({ length: Math.floor(maxDegrees) - Math.ceil(minDegrees) + 1 }, (_, index) => Math.ceil(minDegrees) + index), maxDegrees])];
  return {
    edgeId: hinge.edgeId, pointerStart: pointer, projectedStart: project(grabbed), initialAngle: angle,
    minDegrees, maxDegrees,
    samples: degrees.map((value) => {
      const radians = (value - angle) * Math.PI / 180 * hinge.direction;
      const c = Math.cos(radians), s = Math.sin(radians);
      return { degrees: value, point: project({ x: pivot.x + radial.x * c + tangent.x * s, y: pivot.y + radial.y * c + tangent.y * s, z: pivot.z + radial.z * c + tangent.z * s }) };
    }),
  };
}

export function updateCubeNetFoldDrag(drag: CubeNetFoldDrag, pointer: CubeNetScreenPoint, previousAngle: number): number {
  if (Math.hypot(pointer.x - drag.pointerStart.x, pointer.y - drag.pointerStart.y) < 3) return drag.initialAngle;
  const target = { x: drag.projectedStart.x + pointer.x - drag.pointerStart.x, y: drag.projectedStart.y + pointer.y - drag.pointerStart.y };
  let best = previousAngle, distance = Infinity;
  for (const sample of drag.samples) {
    const next = (sample.point.x - target.x) ** 2 + (sample.point.y - target.y) ** 2;
    // 俯视时正、反方向可能同投影：延续当前方向；从平面开始优先折起。
    const tied = Math.abs(next - distance) < 0.0001;
    const nearer = Math.abs(sample.degrees - previousAngle) < Math.abs(best - previousAngle);
    if (next < distance - 0.0001 || (tied && (nearer || (Math.abs(sample.degrees - previousAngle) === Math.abs(best - previousAngle) && sample.degrees > best)))) {
      distance = next; best = sample.degrees;
    }
  }
  return best;
}

export function finishCubeNetFoldDrag(angle: number): number;
export function finishCubeNetFoldDrag(angle: number, range: Pick<CubeNetFoldDrag, "minDegrees" | "maxDegrees">): number;
export function finishCubeNetFoldDrag(angle: number, range?: Pick<CubeNetFoldDrag, "minDegrees" | "maxDegrees">): number {
  const min = range?.minDegrees ?? -90, max = range?.maxDegrees ?? 90;
  if (Math.abs(angle) <= 4) return 0;
  if (angle <= min + 4) return min;
  if (angle >= max - 4) return max;
  return Math.max(min, Math.min(max, angle));
}
