export type LegacySolidNetKind = "cuboid" | "triangular-prism";
export type SolidNetKind = "cube" | "square-pyramid" | LegacySolidNetKind;
export interface SolidNetDimensions { width: number; height: number; depth: number }
export interface SolidNetPoint { x: number; y: number; z: number }
export interface SolidNetFace { id: string; vertices: SolidNetPoint[] }
export interface SolidNetHinge {
  id: string; parentId: string; faceId: string; start: SolidNetPoint; end: SolidNetPoint; closedDegrees: number; depth: number;
}

const p = (x: number, z: number): SolidNetPoint => ({ x, y: 0, z });
const rectangle = (id: string, x0: number, x1: number, z0: number, z1: number): SolidNetFace => ({
  id, vertices: [p(x0, z0), p(x0, z1), p(x1, z1), p(x1, z0)],
});

/** 精确矩形/三角形铰接纸片；所有展开坐标直接位于 X–Z 平面。 */
export function solidNetGeometry(kind: SolidNetKind, dimensions: SolidNetDimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  if (kind === "square-pyramid") {
    // 正四棱锥的侧面斜高；从平纸折到锥顶的转角随锥高变化。
    const slant = Math.hypot(w / 2, h), closedDegrees = 90 + Math.atan2(w / 2, h) * 180 / Math.PI;
    const faces: SolidNetFace[] = [
      rectangle("base", x0, x1, z0, z1),
      { id: "left", vertices: [p(x0, z0), p(x0 - slant, 0), p(x0, z1)] },
      { id: "right", vertices: [p(x1, z1), p(x1 + slant, 0), p(x1, z0)] },
      { id: "front", vertices: [p(x0, z1), p(0, z1 + slant), p(x1, z1)] },
      { id: "back", vertices: [p(x1, z0), p(0, z0 - slant), p(x0, z0)] },
    ];
    const hinges: SolidNetHinge[] = [
      { id: "base-left", parentId: "base", faceId: "left", start: p(x0, z0), end: p(x0, z1), closedDegrees, depth: 1 },
      { id: "base-right", parentId: "base", faceId: "right", start: p(x1, z1), end: p(x1, z0), closedDegrees, depth: 1 },
      { id: "base-front", parentId: "base", faceId: "front", start: p(x0, z1), end: p(x1, z1), closedDegrees, depth: 1 },
      { id: "base-back", parentId: "base", faceId: "back", start: p(x1, z0), end: p(x0, z0), closedDegrees, depth: 1 },
    ];
    return { faces, hinges };
  }
  const rectangular = kind !== "triangular-prism";
  const side = rectangular ? h : Math.hypot(w / 2, h);
  const sideAngle = rectangular ? 90 : Math.acos(-w / 2 / side) * 180 / Math.PI;
  const faces: SolidNetFace[] = [
    rectangle("base", x0, x1, z0, z1),
    rectangle("left", x0 - side, x0, z0, z1),
    rectangle("right", x1, x1 + side, z0, z1),
  ];
  if (rectangular) {
    faces.push(rectangle("front", x0, x1, z1, z1 + h), rectangle("back", x0, x1, z0 - h, z0), rectangle("top", x0, x1, z1 + h, z1 + h + d));
  } else {
    faces.push({ id: "front", vertices: [p(x0, z1), p(0, z1 + h), p(x1, z1)] },
      { id: "back", vertices: [p(x0, z0), p(x1, z0), p(0, z0 - h)] });
  }
  const hinges: SolidNetHinge[] = [
    { id: "base-left", parentId: "base", faceId: "left", start: p(x0, z0), end: p(x0, z1), closedDegrees: sideAngle, depth: 1 },
    { id: "base-right", parentId: "base", faceId: "right", start: p(x1, z1), end: p(x1, z0), closedDegrees: sideAngle, depth: 1 },
    { id: "base-front", parentId: "base", faceId: "front", start: p(x0, z1), end: p(x1, z1), closedDegrees: 90, depth: 1 },
    { id: "base-back", parentId: "base", faceId: "back", start: p(x1, z0), end: p(x0, z0), closedDegrees: 90, depth: 1 },
  ];
  if (rectangular) hinges.push({ id: "front-top", parentId: "front", faceId: "top", start: p(x0, z1 + h), end: p(x1, z1 + h), closedDegrees: 90, depth: 2 });
  return { faces, hinges };
}

export function solidNetFaceArea(face: SolidNetFace) {
  return Math.abs(face.vertices.reduce((sum, point, index) => {
    const next = face.vertices[(index + 1) % face.vertices.length]; return sum + point.x * next.z - next.x * point.z;
  }, 0)) / 2;
}
