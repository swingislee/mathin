/** 平面舞台共用坐标：起拖时锁定屏幕矩阵，不因重绘改变手势方向。 */
export interface PlanePoint { x: number; y: number }
export interface PlaneMatrix { a: number; b: number; c: number; d: number; e: number; f: number }
export function planePointFromClient(point: PlanePoint, matrix: PlaneMatrix): PlanePoint | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null;
  const x = point.x - matrix.e, y = point.y - matrix.f;
  return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant };
}
export function polygonArea(points: readonly PlanePoint[]): number {
  return Math.abs(points.reduce((sum, p, index) => {
    const next = points[(index + 1) % points.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0)) / 2;
}
export function translatePolygon(points: readonly PlanePoint[], offset: PlanePoint): PlanePoint[] {
  return points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
}
export function interpolatePlanePoint(from: PlanePoint, to: PlanePoint, progress: number): PlanePoint {
  const t = Math.min(1, Math.max(0, progress));
  const eased = t * t * (3 - 2 * t);
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
}
