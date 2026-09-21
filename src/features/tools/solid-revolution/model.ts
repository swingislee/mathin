import { newId } from "@/lib/uuid";
import type { SolidRevolutionInitial, SolidRevolutionSnapshot } from "./contract";

export interface RevolutionPoint { x: number; y: number; z: number }
export type RevolutionGeometry = Pick<SolidRevolutionInitial, "shape" | "axis" | "width" | "height">;
export const normalizeRevolutionAngle = (angle: number) => Math.round(Math.min(360, Math.max(0, Number.isFinite(angle) ? angle : 0)) * 1e6) / 1e6;
/** 选中的直角边竖直放置；另一直角边成为半径，保留两条边原本的长度。 */
export function revolutionDimensions(source: RevolutionGeometry) {
  return source.axis === "height" ? { radius: source.width, height: source.height } : { radius: source.height, height: source.width };
}
export function revolutionPoint(radius: number, height: number, degrees: number): RevolutionPoint {
  const angle = degrees * Math.PI / 180;
  return { x: radius * Math.cos(angle), y: height, z: -radius * Math.sin(angle) };
}
export function revolutionProfile(source: RevolutionGeometry, degrees = 0): RevolutionPoint[] {
  const { radius, height } = revolutionDimensions(source);
  return (source.shape === "rectangle" ? [[0, 0], [radius, 0], [radius, height], [0, height]] : [[0, 0], [radius, 0], [0, height]])
    .map(([r, y]) => revolutionPoint(r, y, degrees));
}
export function revolutionTrianglePositions(points: readonly RevolutionPoint[]) {
  const positions: number[] = [];
  for (let i = 1; i < points.length - 1; i++) for (const p of [points[0], points[i], points[i + 1]]) positions.push(p.x, p.y, p.z);
  return positions;
}
/** 解析尺寸生成有界扇形体：圆柱为扇柱，圆锥为扇锥；端面与原纸片共用同一截面。 */
export function revolutionSweepPositions(source: RevolutionGeometry, degrees: number, segments = 120): number[] {
  const angle = normalizeRevolutionAngle(degrees);
  if (angle === 0) return [];
  const { radius, height } = revolutionDimensions(source), count = Math.max(1, Math.ceil(segments * angle / 360));
  const positions: number[] = [];
  const triangle = (a: RevolutionPoint, b: RevolutionPoint, c: RevolutionPoint) => positions.push(...[a, b, c].flatMap((p) => [p.x, p.y, p.z]));
  const bottom = { x: 0, y: 0, z: 0 }, top = { x: 0, y: height, z: 0 };
  for (let i = 0; i < count; i++) {
    const a = revolutionPoint(radius, 0, angle * i / count), b = revolutionPoint(radius, 0, angle * (i + 1) / count);
    triangle(bottom, b, a);
    if (source.shape === "rectangle") {
      const c = { ...a, y: height }, d = { ...b, y: height };
      triangle(a, b, d); triangle(a, d, c); triangle(top, c, d);
    } else triangle(a, b, top);
  }
  if (angle < 360) {
    positions.push(...revolutionTrianglePositions(revolutionProfile(source)));
    positions.push(...revolutionTrianglePositions([...revolutionProfile(source, angle)].reverse()));
  }
  return positions;
}
export function revolutionVolume(source: RevolutionGeometry, angle = 360) {
  const { radius, height } = revolutionDimensions(source);
  return Math.PI * radius ** 2 * height * (source.shape === "rectangle" ? 1 : 1 / 3) * normalizeRevolutionAngle(angle) / 360;
}
export function revolutionAngleAt(snapshot: SolidRevolutionSnapshot, now: number) {
  const motion = snapshot.motion;
  if (!motion) return snapshot.angle;
  const progress = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.durationMs));
  return normalizeRevolutionAngle(motion.fromAngle + (motion.toAngle - motion.fromAngle) * progress);
}
export function revolutionPlaying(snapshot: SolidRevolutionSnapshot, now: number) {
  return !!snapshot.motion && now < snapshot.motion.startedAt + snapshot.motion.durationMs;
}
export function planRevolution(snapshot: SolidRevolutionSnapshot, target: number, now = Date.now(), durationMs?: number): SolidRevolutionSnapshot {
  const fromAngle = revolutionAngleAt(snapshot, now), toAngle = normalizeRevolutionAngle(target);
  if (fromAngle === toAngle) return { ...snapshot, angle: toAngle, motion: null };
  return { ...snapshot, angle: toAngle, motion: { id: newId(), fromAngle, toAngle, startedAt: now,
    durationMs: durationMs ?? Math.max(1, Math.abs(toAngle - fromAngle) / snapshot.speed * 1000) } };
}
export function pauseRevolution(snapshot: SolidRevolutionSnapshot, now = Date.now()): SolidRevolutionSnapshot {
  return { ...snapshot, angle: revolutionAngleAt(snapshot, now), motion: null };
}
export function resumeRevolution(snapshot: SolidRevolutionSnapshot, now = Date.now()): SolidRevolutionSnapshot {
  const paused = pauseRevolution(snapshot, now);
  return planRevolution(paused.angle >= 360 ? { ...paused, angle: 0 } : paused, 360, now);
}
