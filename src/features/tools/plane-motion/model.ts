import type { PlanePoint } from "../planar-interaction/geometry";

export const MOTION_SCENES = ["translation", "rotation", "reflection", "pattern", "foldCut", "tiling", "reflectionPath", "rolling"] as const;
export type MotionSceneId = (typeof MOTION_SCENES)[number];
export interface PlaneAxis { point: PlanePoint; angle: number }
export interface PlanePiece { id: string; points: PlanePoint[]; offset: PlanePoint; angle: number }
export const degrees = (angle: number) => angle * Math.PI / 180;
export const clampProgress = (progress: number) => Math.min(1, Math.max(0, progress));
/** 以上一帧为参照跨越 atan2 的 ±180° 接缝；平移仍使用冻结起点。 */
export function unwrapAngle(angle: number, previous: number): number {
  return previous + ((angle - previous + 180) % 360 + 360) % 360 - 180;
}

/** 坐标使用舞台单位；绕心旋转保持每个顶点的距离，不以插值顶点替代刚体旋转。 */
export function rotatePoint(point: PlanePoint, center: PlanePoint, angle: number): PlanePoint {
  const radians = degrees(angle), x = point.x - center.x, y = point.y - center.y;
  return { x: center.x + x * Math.cos(radians) - y * Math.sin(radians), y: center.y + x * Math.sin(radians) + y * Math.cos(radians) };
}
export function translationFrame(points: readonly PlanePoint[], offset: PlanePoint, progress: number): PlanePoint[] {
  const t = clampProgress(progress);
  return points.map((point) => ({ x: point.x + offset.x * t, y: point.y + offset.y * t }));
}
export function rotationFrame(points: readonly PlanePoint[], center: PlanePoint, angle: number, progress: number): PlanePoint[] {
  return points.map((point) => rotatePoint(point, center, angle * clampProgress(progress)));
}
export function footOnAxis(point: PlanePoint, axis: PlaneAxis): PlanePoint {
  const ux = Math.cos(degrees(axis.angle)), uy = Math.sin(degrees(axis.angle));
  const distance = (point.x - axis.point.x) * ux + (point.y - axis.point.y) * uy;
  return { x: axis.point.x + ux * distance, y: axis.point.y + uy * distance };
}
export function reflectedPoint(point: PlanePoint, axis: PlaneAxis): PlanePoint {
  const foot = footOnAxis(point, axis);
  return { x: 2 * foot.x - point.x, y: 2 * foot.y - point.y };
}
/** 翻折投影：到轴的有向距离乘 cos(折角)，90° 为侧视，180° 精确落在镜像。 */
export function foldPoint(point: PlanePoint, axis: PlaneAxis, progress: number): PlanePoint {
  const foot = footOnAxis(point, axis), scale = Math.cos(Math.PI * clampProgress(progress));
  return { x: foot.x + (point.x - foot.x) * scale, y: foot.y + (point.y - foot.y) * scale };
}
export function reflectionFrame(points: readonly PlanePoint[], axis: PlaneAxis, progress: number): PlanePoint[] {
  return points.map((point) => foldPoint(point, axis, progress));
}
/** 以原纸片所在的一侧确定折向；拖动在折轴上的分量不改变折角。 */
export function dragFoldProgress(progress: number, delta: PlanePoint, axis: PlaneAxis, originalPoint: PlanePoint, span = 260): number {
  const normal = { x: -Math.sin(degrees(axis.angle)), y: Math.cos(degrees(axis.angle)) };
  const side = (originalPoint.x - axis.point.x) * normal.x + (originalPoint.y - axis.point.y) * normal.y;
  const direction = Math.abs(side) < 1e-8 ? -1 : -Math.sign(side);
  return clampProgress(progress + direction * (delta.x * normal.x + delta.y * normal.y) / span);
}
export interface PaperFoldLayer {
  key: string;
  right: boolean;
  corners: PlanePoint[];
  hole: { center: PlanePoint; rx: number; ry: number } | null;
}
/** 每层保留自己的剪孔，移动孔洞中能看到下方尚未被剪到的纸张。 */
export function paperFoldLayers(center: PlanePoint, hole: PlanePoint, radius: number, progress: number, twice: boolean, cut: boolean): PaperFoldLayer[] {
  const xPhase = twice ? Math.min(1, clampProgress(progress) * 2) : clampProgress(progress);
  const yPhase = twice ? Math.max(0, clampProgress(progress) * 2 - 1) : 0;
  return [false, true].flatMap((bottom) => [false, true].map((right) => {
    const x0 = center.x + (right ? 0 : -155), y0 = center.y + (bottom ? 0 : -155);
    const project = (point: PlanePoint) => {
      const first = right ? foldPoint(point, { point: center, angle: 90 }, xPhase) : point;
      return bottom ? foldPoint(first, { point: center, angle: 0 }, yPhase) : first;
    };
    const originalHole = { x: right ? 2 * center.x - hole.x : hole.x, y: bottom && twice ? 2 * center.y - hole.y : hole.y };
    return {
      key: `${bottom ? "bottom" : "top"}-${right ? "right" : "left"}`, right,
      corners: [{ x: x0, y: y0 }, { x: x0 + 155, y: y0 }, { x: x0 + 155, y: y0 + 155 }, { x: x0, y: y0 + 155 }].map(project),
      hole: cut && (!bottom || twice) ? { center: project(originalHole), rx: Math.abs((right ? Math.cos(Math.PI * xPhase) : 1) * radius), ry: Math.abs((bottom && twice ? Math.cos(Math.PI * yPhase) : 1) * radius) } : null,
    };
  }));
}
/** 复合路径按 even-odd 填充；孔是空白区域，不用背景色遮盖后面的层。 */
export function paperLayerPath(layer: PaperFoldLayer): string {
  const outline = `M ${layer.corners.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`, hole = layer.hole;
  if (!hole || hole.rx < 1e-8 || hole.ry < 1e-8) return outline;
  const { center, rx, ry } = hole;
  return `${outline} M ${center.x - rx} ${center.y} A ${rx} ${ry} 0 1 0 ${center.x + rx} ${center.y} A ${rx} ${ry} 0 1 0 ${center.x - rx} ${center.y} Z`;
}
/** 一次手势沿当前折段的法向移动；两段交接处由水平/垂直主方向选段。 */
export function dragPaperFoldProgress(progress: number, delta: PlanePoint, twice: boolean): number {
  if (!twice) return clampProgress(progress - delta.x / 300);
  const firstFold = progress < 0.5 - 1e-8 || (Math.abs(progress - 0.5) < 1e-8 && Math.abs(delta.x) >= Math.abs(delta.y));
  return firstFold ? Math.max(0, Math.min(0.5, progress - delta.x / 600)) : Math.max(0.5, Math.min(1, progress - delta.y / 600));
}
export function piecePoints(piece: PlanePiece): PlanePoint[] {
  return piece.points.map((point) => {
    const rotated = rotatePoint(point, { x: 0, y: 0 }, piece.angle);
    return { x: rotated.x + piece.offset.x, y: rotated.y + piece.offset.y };
  });
}
export function snapPieceToVertices(piece: PlanePiece, others: readonly PlanePiece[], threshold = 16): PlanePiece {
  let nearest: PlanePoint | null = null, distance = threshold;
  for (const point of piecePoints(piece)) for (const other of others) for (const vertex of piecePoints(other)) {
    const length = Math.hypot(point.x - vertex.x, point.y - vertex.y);
    if (length < distance) { distance = length; nearest = { x: vertex.x - point.x, y: vertex.y - point.y }; }
  }
  return nearest ? { ...piece, offset: { x: piece.offset.x + nearest.x, y: piece.offset.y + nearest.y } } : piece;
}
export function reflectionRoute(a: PlanePoint, b: PlanePoint, axis: PlaneAxis, contactDistance: number) {
  const contact = { x: axis.point.x + Math.cos(degrees(axis.angle)) * contactDistance, y: axis.point.y + Math.sin(degrees(axis.angle)) * contactDistance };
  const mirror = reflectedPoint(b, axis);
  const length = Math.hypot(a.x - contact.x, a.y - contact.y) + Math.hypot(b.x - contact.x, b.y - contact.y);
  return { a, b, contact, mirror, length, reflectedLength: Math.hypot(a.x - contact.x, a.y - contact.y) + Math.hypot(mirror.x - contact.x, mirror.y - contact.y) };
}
/** 圆心绕行角与自身转角分别计算。外滚 +(R+r)/r，内滚 -(R-r)/r。 */
export function rollingCircle(largeRadius: number, smallRadius: number, orbitAngle: number, inside: boolean, center: PlanePoint = { x: 0, y: 0 }) {
  if (largeRadius <= 0 || smallRadius <= 0 || (inside && smallRadius >= largeRadius)) throw new RangeError("The rolling radii must leave a positive orbit.");
  const orbitRadius = largeRadius + (inside ? -smallRadius : smallRadius);
  const angle = degrees(orbitAngle), rotation = (inside ? -1 : 1) * orbitRadius / smallRadius * orbitAngle;
  const movingCenter = { x: center.x + orbitRadius * Math.cos(angle), y: center.y + orbitRadius * Math.sin(angle) };
  const phase = degrees(rotation) + (inside ? 0 : Math.PI);
  const marker = { x: movingCenter.x + smallRadius * Math.cos(phase), y: movingCenter.y + smallRadius * Math.sin(phase) };
  const contact = { x: center.x + largeRadius * Math.cos(angle), y: center.y + largeRadius * Math.sin(angle) };
  return { center: movingCenter, marker, contact, orbitRadius, rotation, orbitAngle };
}
export function rollingTrace(largeRadius: number, smallRadius: number, orbitAngle: number, inside: boolean, center: PlanePoint, steps = 160): PlanePoint[] {
  return Array.from({ length: steps + 1 }, (_, index) => rollingCircle(largeRadius, smallRadius, orbitAngle * index / steps, inside, center).marker);
}
export function foldCutHoles(hole: PlanePoint, axis: PlaneAxis, twice: boolean): PlanePoint[] {
  const first = [hole, reflectedPoint(hole, axis)];
  if (!twice) return first;
  const crossAxis = { point: axis.point, angle: axis.angle + 90 };
  return [...first, ...first.map((point) => reflectedPoint(point, crossAxis))];
}
export function generatedPattern(points: readonly PlanePoint[], center: PlanePoint, copies: number, progress: number): PlanePoint[][] {
  const amount = Math.min(12, Math.max(1, Math.floor(copies))), visible = 1 + clampProgress(progress) * (amount - 1);
  return Array.from({ length: Math.min(amount, Math.ceil(visible)) }, (_, index) => rotationFrame(points, center, 360 / amount * index, Math.min(1, visible - index)));
}
