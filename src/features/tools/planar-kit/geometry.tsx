import type { PlanarPoint } from "./contract";

export function perpendicularFoot(vertex: PlanarPoint, baseA: PlanarPoint, baseB: PlanarPoint): PlanarPoint | null {
  const dx = baseB.x - baseA.x, dy = baseB.y - baseA.y, length2 = dx * dx + dy * dy;
  if (length2 < 1e-10) return null;
  const t = ((vertex.x - baseA.x) * dx + (vertex.y - baseA.y) * dy) / length2;
  return { x: baseA.x + t * dx, y: baseA.y + t * dy };
}
/** along / toward 为两条射线上的点；实际垂直才绘制标准直角折线。 */
export function rightAnglePoints(vertex: PlanarPoint, along: PlanarPoint, toward: PlanarPoint, size = 18) {
  const ax = along.x - vertex.x, ay = along.y - vertex.y, bx = toward.x - vertex.x, by = toward.y - vertex.y;
  const a = Math.hypot(ax, ay), b = Math.hypot(bx, by);
  if (a < 1e-8 || b < 1e-8 || Math.abs((ax * bx + ay * by) / (a * b)) > 1e-6) return null;
  const s = Math.min(size, a * .4, b * .4), u = { x: ax / a * s, y: ay / a * s }, v = { x: bx / b * s, y: by / b * s };
  return [{ x: vertex.x + u.x, y: vertex.y + u.y }, { x: vertex.x + u.x + v.x, y: vertex.y + u.y + v.y }, { x: vertex.x + v.x, y: vertex.y + v.y }];
}
export function RightAngleMark({ vertex, along, toward, size = 18 }: { vertex: PlanarPoint; along: PlanarPoint; toward: PlanarPoint; size?: number }) {
  const points = rightAnglePoints(vertex, along, toward, size);
  if (!points) return null;
  const path = points.map((p) => `${p.x},${p.y}`).join(" ");
  return <g data-right-angle="true" pointerEvents="none" fill="none" strokeLinejoin="miter">
    <polyline points={path} stroke="var(--paper)" strokeWidth="5" vectorEffect="non-scaling-stroke" />
    <polyline points={path} stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </g>;
}
export function HeightMark({ vertex, baseA, baseB, label }: { vertex: PlanarPoint; baseA: PlanarPoint; baseB: PlanarPoint; label?: string }) {
  const foot = perpendicularFoot(vertex, baseA, baseB);
  if (!foot) return null;
  const along = Math.hypot(baseB.x - foot.x, baseB.y - foot.y) > 20 ? baseB : baseA;
  return <g data-height-mark="true" pointerEvents="none">
    <path d={`M${baseA.x},${baseA.y}L${foot.x},${foot.y}M${vertex.x},${vertex.y}L${foot.x},${foot.y}`} fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
    <RightAngleMark vertex={foot} along={along} toward={vertex} />
    {label && <text x={(vertex.x + foot.x) / 2 - 14} y={(vertex.y + foot.y) / 2} textAnchor="end" paintOrder="stroke" stroke="var(--paper)" strokeWidth="5" fill="var(--ink)">{label}</text>}
  </g>;
}
