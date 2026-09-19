import type { SolidEntity, SolidVector } from "../solid-geometry/solid-geometry-contract";
import { getSolidMeshData, rotateSolidPoint, solidLocalToWorld } from "../solid-geometry/solid-geometry";
import { supportsSolidSection, type SolidSectionSettings } from "./solid-sections-contract";

export interface SolidSectionPlane { normal: SolidVector; origin: SolidVector }
export interface SolidSectionResult {
  kind: "empty" | "point" | "segment" | "polygon";
  points: SolidVector[];
  area: number;
  crossesInterior: boolean;
}
export const sectionDot = (a: SolidVector, b: SolidVector) => a.x * b.x + a.y * b.y + a.z * b.z;
export const sectionAdd = (a: SolidVector, b: SolidVector): SolidVector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sectionScale = (v: SolidVector, k: number): SolidVector => ({ x: v.x * k, y: v.y * k, z: v.z * k });
export const sectionSubtract = (a: SolidVector, b: SolidVector): SolidVector => sectionAdd(a, sectionScale(b, -1));
export const sectionCross = (a: SolidVector, b: SolidVector): SolidVector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export function sectionUnit(vector: SolidVector): SolidVector {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error("A section plane requires a finite nonzero normal");
  return sectionScale(vector, 1 / length);
}
export function sectionPlaneBasis(normal: SolidVector) {
  const n = sectionUnit(normal);
  // 连续旋转基底，避免倾斜经过旧参考轴阈值时，切平面与正视图突然转过 90°。
  if (n.z < -0.999999) return { u: { x: 0, y: -1, z: 0 }, v: { x: -1, y: 0, z: 0 }, normal: n };
  const a = 1 / (1 + n.z), b = -n.x * n.y * a;
  return { u: { x: 1 - n.x * n.x * a, y: b, z: -n.x }, v: { x: b, y: 1 - n.y * n.y * a, z: -n.y }, normal: n };
}
export function solidSectionNormal(settings: Pick<SolidSectionSettings, "axis" | "tiltA" | "tiltB">): SolidVector {
  const radians = Math.PI / 180, rotation = { x: 0, y: 0, z: 0 };
  const tiltAxes = settings.axis === "x" ? ["y", "z"] as const : settings.axis === "y" ? ["x", "z"] as const : ["x", "y"] as const;
  rotation[tiltAxes[0]] = settings.tiltA * radians; rotation[tiltAxes[1]] = settings.tiltB * radians;
  return sectionUnit(rotateSolidPoint({ x: settings.axis === "x" ? 1 : 0, y: settings.axis === "y" ? 1 : 0, z: settings.axis === "z" ? 1 : 0 }, rotation));
}
/** 归一偏移以当前实体在法线上的最大投影距离为单位；±1.2 可移过整个实体。 */
export function solidSectionPlane(entity: SolidEntity, normal: SolidVector, offset: number): SolidSectionPlane {
  const n = sectionUnit(normal);
  const extent = Math.max(...getSolidMeshData(entity).vertices.map((vertex) => Math.abs(sectionDot(sectionSubtract(solidLocalToWorld(vertex, entity), entity.position), n))));
  return { normal: n, origin: sectionAdd(entity.position, sectionScale(n, extent * offset)) };
}
export const solidSectionDistance = (point: SolidVector, plane: SolidSectionPlane) => sectionDot(sectionSubtract(point, plane.origin), plane.normal);

/** 凸多面体真实棱与平面的交集。共面、过顶点和过棱保留各自的维度，不制造面积。 */
export function intersectSolidSection(entity: SolidEntity, plane: SolidSectionPlane): SolidSectionResult {
  const empty: SolidSectionResult = { kind: "empty", points: [], area: 0, crossesInterior: false };
  if (!supportsSolidSection(entity.kind)) return empty;
  const mesh = getSolidMeshData(entity), vertices = mesh.vertices.map((point) => solidLocalToWorld(point, entity));
  const n = sectionUnit(plane.normal), normalized = { ...plane, normal: n };
  const tolerance = Math.max(entity.dimensions.width, entity.dimensions.height, entity.dimensions.depth, 1) * 1e-8;
  const distances = vertices.map((point) => solidSectionDistance(point, normalized));
  const crossesInterior = Math.min(...distances) < -tolerance && Math.max(...distances) > tolerance;
  const points: SolidVector[] = [], visited = new Set<string>();
  const insert = (point: SolidVector) => { if (!points.some((other) => Math.hypot(...Object.values(sectionSubtract(point, other))) <= tolerance)) points.push(point); };
  for (const face of mesh.faces) for (let i = 0; i < face.indices.length; i++) {
    const a = face.indices[i], b = face.indices[(i + 1) % face.indices.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (visited.has(key)) continue; visited.add(key);
    const da = distances[a], db = distances[b];
    if (Math.abs(da) <= tolerance) insert(vertices[a]);
    if (Math.abs(db) <= tolerance) insert(vertices[b]);
    if (da < -tolerance && db > tolerance || da > tolerance && db < -tolerance) insert(sectionAdd(vertices[a], sectionScale(sectionSubtract(vertices[b], vertices[a]), da / (da - db))));
  }
  if (!points.length) return empty;
  if (points.length === 1) return { kind: "point", points, area: 0, crossesInterior };
  if (points.length === 2) return { kind: "segment", points, area: 0, crossesInterior };
  const center = sectionScale(points.reduce(sectionAdd, { x: 0, y: 0, z: 0 }), 1 / points.length), { u, v } = sectionPlaneBasis(n);
  points.sort((a, b) => Math.atan2(sectionDot(sectionSubtract(a, center), v), sectionDot(sectionSubtract(a, center), u)) - Math.atan2(sectionDot(sectionSubtract(b, center), v), sectionDot(sectionSubtract(b, center), u)));
  let cleaned = points;
  // 平面经过共线顶点时去掉中间点，正方形截面仍保留四条边。
  while (cleaned.length > 2) {
    const next = cleaned.filter((point, i) => {
      const before = sectionSubtract(point, cleaned[(i - 1 + cleaned.length) % cleaned.length]), after = sectionSubtract(cleaned[(i + 1) % cleaned.length], point);
      return Math.hypot(...Object.values(sectionCross(before, after))) > tolerance * (Math.hypot(...Object.values(before)) + Math.hypot(...Object.values(after)));
    });
    if (next.length === cleaned.length) break;
    if (next.length < 2) break;
    cleaned = next;
  }
  const area = Math.abs(cleaned.reduce((sum, point, i) => sum + sectionDot(sectionCross(sectionSubtract(point, center), sectionSubtract(cleaned[(i + 1) % cleaned.length], center)), n), 0)) / 2;
  if (area <= tolerance * tolerance) {
    const sorted = points.toSorted((a, b) => sectionDot(a, u) - sectionDot(b, u) || sectionDot(a, v) - sectionDot(b, v));
    return { kind: "segment", points: [sorted[0], sorted.at(-1)!], area: 0, crossesInterior };
  }
  return { kind: "polygon", points: cleaned, area, crossesInterior };
}
export function solidSectionPlaneCorners(entity: SolidEntity, plane: SolidSectionPlane): SolidVector[] {
  const { u, v } = sectionPlaneBasis(plane.normal);
  const radius = solidSectionGuideRadius(entity);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => sectionAdd(plane.origin, sectionAdd(sectionScale(u, radius * a), sectionScale(v, radius * b))));
}
export function solidSectionGuideRadius(entity: SolidEntity): number {
  return Math.max(...getSolidMeshData(entity).vertices.map((point) => Math.hypot(point.x, point.y, point.z))) * 1.12;
}
/** 同一平面基底用于平视预览；不改变舞台相机。 */
export function sectionFlatPoints(result: SolidSectionResult, normal: SolidVector): { x: number; y: number }[] {
  if (!result.points.length) return [];
  const { u, v } = sectionPlaneBasis(normal), center = sectionScale(result.points.reduce(sectionAdd, { x: 0, y: 0, z: 0 }), 1 / result.points.length);
  return result.points.map((point) => ({ x: sectionDot(sectionSubtract(point, center), u), y: sectionDot(sectionSubtract(point, center), v) }));
}
