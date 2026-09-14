import type { PolyhedronFoldVector3 } from "@/features/spatial-math/domain";
import type { CubeNetWorkbenchHinge } from "./cube-net-workbench-model";

export interface CubeNetScreenPoint { readonly x: number; readonly y: number }
export interface CubeNetFoldDrag {
  readonly edgeId: string;
  readonly pointerStart: CubeNetScreenPoint;
  readonly projectedStart: CubeNetScreenPoint;
  readonly initialAngle: number;
  readonly samples: readonly { readonly degrees: number; readonly point: CubeNetScreenPoint }[];
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
  return {
    edgeId: hinge.edgeId, pointerStart: pointer, projectedStart: project(grabbed), initialAngle: angle,
    samples: Array.from({ length: 181 }, (_, index) => {
      const degrees = index - 90;
      const radians = (degrees - angle) * Math.PI / 180 * hinge.direction;
      const c = Math.cos(radians), s = Math.sin(radians);
      return { degrees, point: project({ x: pivot.x + radial.x * c + tangent.x * s, y: pivot.y + radial.y * c + tangent.y * s, z: pivot.z + radial.z * c + tangent.z * s }) };
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

export function finishCubeNetFoldDrag(angle: number): number {
  if (Math.abs(angle) <= 4) return 0;
  if (Math.abs(angle) >= 86) return Math.sign(angle) * 90;
  return angle;
}
