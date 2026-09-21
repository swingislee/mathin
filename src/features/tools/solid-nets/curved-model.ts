import { Vector3 } from "three";
import { spatialActionProgress } from "../spatial-interaction/policy";
import type { CurvedNetSnapshot, CurvedPart, CurvedProgress } from "./curved-contract";

export function curvedSlant(s: Pick<CurvedNetSnapshot, "radius" | "height">) { return Math.hypot(s.radius, s.height); }
export function curvedSectorAngle(s: Pick<CurvedNetSnapshot, "radius" | "height">) { return 2 * Math.PI * s.radius / curvedSlant(s); }
/** 圆柱等距弯曲；材料坐标 u 为沿周长比例，v 为沿轴比例。 */
export function cylinderPaperPoint(s: CurvedNetSnapshot, u: number, v: number, roll = s.progress.side): Vector3 {
  const material = (u - 0.5) * 2 * Math.PI * s.radius, z = (v - 0.5) * s.height;
  if (roll < 1e-8) return new Vector3(material, 0, z);
  const a = roll * material / s.radius;
  return new Vector3(s.radius / roll * Math.sin(a), s.radius / roll * (1 - Math.cos(a)), z);
}
/** 扇形到圆锥的等距连续族，中央母线始终贴在 XZ 平面；不拉伸成一张假矩形。 */
export function conePaperPoint(s: CurvedNetSnapshot, u: number, v: number, roll = s.progress.side): Vector3 {
  const length = curvedSlant(s), rho = v * length, phi = (u - 0.5) * curvedSectorAngle(s);
  const k = 1 - roll * (1 - s.radius / length), c = Math.sqrt(Math.max(0, 1 - k * k)), t = phi / k;
  return new Vector3(rho * k * Math.sin(t), rho * k * c * (1 - Math.cos(t)), rho * (c * c + k * k * Math.cos(t)));
}
export function curvedCapAngle(s: CurvedNetSnapshot, part: CurvedPart) {
  return s.kind === "cone" ? -(Math.PI / 2 + Math.asin(s.radius / curvedSlant(s))) : part === "lower" ? Math.PI / 2 : -Math.PI / 2;
}
/** 圆盘绕与侧面相接的切点折起；u 是圆周角比例，v 是半径比例。 */
export function curvedPaperPoint(s: CurvedNetSnapshot, part: CurvedPart, u: number, v: number, progress = s.progress[part]): Vector3 {
  if (part === "side") return s.kind === "cylinder" ? cylinderPaperPoint(s, u, v, progress) : conePaperPoint(s, u, v, progress);
  const sign = s.kind === "cone" || part === "upper" ? 1 : -1;
  const pivotZ = s.kind === "cone" ? curvedSlant(s) : sign * s.height / 2;
  const point = new Vector3(Math.sin(u * Math.PI * 2) * v * s.radius, 0, sign * s.radius + Math.cos(u * Math.PI * 2) * v * s.radius);
  point.applyAxisAngle(new Vector3(1, 0, 0), curvedCapAngle(s, part) * progress); point.z += pivotZ;
  return point;
}
export interface CurvedPaperMesh { part: CurvedPart; positions: number[]; uv: number[]; outline: Vector3[]; linkedEdges: Vector3[][]; label: Vector3 }
export function curvedPaperMesh(s: CurvedNetSnapshot, part: CurvedPart, segments = 80): CurvedPaperMesh {
  const positions: number[] = [], uv: number[] = [], add = (u: number, v: number) => { positions.push(...curvedPaperPoint(s, part, u, v).toArray()); uv.push(u, v); };
  const rows = part === "side" && s.kind === "cylinder" ? 1 : 12;
  for (let j = 0; j < rows; j++) for (let i = 0; i < segments; i++) {
    const a = i / segments, b = (i + 1) / segments, c = j / rows, d = (j + 1) / rows;
    add(a, c); add(a, d); add(b, d); add(a, c); add(b, d); add(b, c);
  }
  const edge = (v: number) => Array.from({ length: segments + 1 }, (_, i) => curvedPaperPoint(s, part, i / segments, v));
  const outer = edge(1), inner = edge(0);
  const outline = part === "side" ? [...inner, ...outer.reverse(), inner[0]] : outer;
  const linkedEdges = part === "side" ? s.kind === "cylinder" ? [edge(0), edge(1)] : [edge(1)] : [edge(1)];
  return { part, positions, uv, outline, linkedEdges, label: curvedPaperPoint(s, part, 0.5, part === "side" ? 0.5 : 0) };
}
export function curvedParts(s: CurvedNetSnapshot): CurvedPart[] { return s.kind === "cone" ? ["side", "lower"] : ["side", "lower", "upper"]; }
/** 取完整过程的固定包围范围；卷展中不跟随每帧重新移动相机。 */
export function curvedNetFrame(kind: CurvedNetSnapshot["kind"], radius: number, height: number) {
  const dimensions = { kind, radius, height } as CurvedNetSnapshot, points: Vector3[] = [];
  for (const part of curvedParts(dimensions)) for (let q = 0; q <= 8; q++) for (let u = 0; u <= 32; u++) for (const v of [0, 1]) points.push(curvedPaperPoint(dimensions, part, u / 32, v, q / 8));
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  points.forEach((p) => { min.min(p); max.max(p); });
  const center = min.add(max).multiplyScalar(0.5);
  return { center: { x: center.x, y: center.y, z: center.z }, radius: Math.max(1.5, ...points.map((p) => p.distanceTo(center))) * 1.04 };
}
export function curvedClosedProgress(s: CurvedNetSnapshot): CurvedProgress { return { side: 1, lower: 1, upper: s.kind === "cone" ? 0 : 1 }; }
export function curvedMotionOrder(from: CurvedProgress, to: CurvedProgress): CurvedPart[] {
  const order: CurvedPart[] = to.side >= from.side ? ["side", "lower", "upper"] : ["upper", "lower", "side"];
  return order.filter((key) => Math.abs(from[key] - to[key]) > 1e-8);
}
/** 课堂播放只同步命令；晚加入按统一时间定位，不重头播放。 */
export function curvedNetAt(snapshot: CurvedNetSnapshot, now: number): CurvedNetSnapshot {
  if (!snapshot.motion) return snapshot;
  const { motion, progress: target } = snapshot, order = curvedMotionOrder(motion.from, target);
  const t = Math.max(0, Math.min(1, (now - motion.startedAt) / motion.durationMs));
  if (t >= 1 || !order.length) return { ...snapshot, motion: null };
  const progress = { ...motion.from };
  order.forEach((part, index) => { const fraction = spatialActionProgress(t * order.length - index); progress[part] += (target[part] - progress[part]) * fraction; });
  return { ...snapshot, progress, motion: null };
}
