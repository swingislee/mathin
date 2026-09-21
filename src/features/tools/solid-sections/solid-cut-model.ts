import { Euler, Quaternion, Vector3 } from "three";
import type { SolidEntity, SolidVector } from "../solid-geometry/solid-geometry-contract";
import { getSolidTopology, rotateSolidPoint, solidLocalToWorld, type SolidMeshData } from "../solid-geometry/solid-geometry";
import { supportsSolidSection, type SolidSectionSettings } from "./solid-sections-contract";
import { sectionAdd as add, sectionCross as cross, sectionDot as dot, sectionScale as scale, sectionSubtract as sub, sectionPlaneBasis, solidSectionNormal, solidSectionPlane } from "./solid-sections";

export interface SolidCutPlane { normal: SolidVector; distance: number }
export interface SolidCutPieceMesh { mesh: SolidMeshData; center: SolidVector; volume: number; surfaceArea: number; cutArea: number }
const zero = { x: 0, y: 0, z: 0 };
const epsilon = 1e-8;
const same = (a: SolidVector, b: SolidVector) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < epsilon;
const mean = (points: readonly SolidVector[]) => scale(points.reduce(add, zero), 1 / points.length);
function unique(points: readonly SolidVector[]) { return points.filter((p, index) => !points.slice(0, index).some((q) => same(p, q))); }
export function solidPolygonArea(points: readonly SolidVector[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 1; i < points.length - 1; i++) { const n = cross(sub(points[i], points[0]), sub(points[i + 1], points[0])); area += Math.hypot(n.x, n.y, n.z) / 2; }
  return area;
}
/** 保留真实凸多面体的面，切口补为闭合平面；不依赖 GPU 裁剪或 AABB 体积。 */
export function splitSolidByPlane(entity: SolidEntity, plane: SolidCutPlane): [SolidCutPieceMesh, SolidCutPieceMesh] | null {
  if (!supportsSolidSection(entity.kind)) return null;
  const source = getSolidTopology(entity).faces;
  const all = unique(source.flatMap((face) => face.vertices));
  const distances = all.map((point) => dot(point, plane.normal) - plane.distance);
  if (Math.min(...distances) >= -epsilon || Math.max(...distances) <= epsilon) return null;
  const build = (sign: 1 | -1): SolidCutPieceMesh | null => {
    const polygons: { id: string; points: SolidVector[] }[] = [], intersections: SolidVector[] = [];
    for (const face of source) {
      const points: SolidVector[] = [];
      for (let i = 0; i < face.vertices.length; i++) {
        const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
        const da = (dot(a, plane.normal) - plane.distance) * sign, db = (dot(b, plane.normal) - plane.distance) * sign;
        if (da >= -epsilon) points.push(a);
        if (Math.abs(da) <= epsilon) intersections.push(a);
        if ((da > epsilon && db < -epsilon) || (da < -epsilon && db > epsilon)) {
          const hit = add(a, scale(sub(b, a), da / (da - db))); points.push(hit); intersections.push(hit);
        }
      }
      const clean = unique(points);
      if (clean.length >= 3 && solidPolygonArea(clean) > epsilon) polygons.push({ id: face.id, points: clean });
    }
    const cap = unique(intersections), outward = scale(plane.normal, -sign);
    if (cap.length < 3) return null;
    const capCenter = mean(cap), basis = sectionPlaneBasis(outward);
    cap.sort((a, b) => Math.atan2(dot(sub(a, capCenter), basis.v), dot(sub(a, capCenter), basis.u)) - Math.atan2(dot(sub(b, capCenter), basis.v), dot(sub(b, capCenter), basis.u)));
    polygons.push({ id: "cut", points: cap });
    const vertices = unique(polygons.flatMap((face) => face.points)), center = mean(vertices);
    let volume = 0;
    for (const face of polygons) for (let i = 1; i < face.points.length - 1; i++) volume += dot(sub(face.points[0], center), cross(sub(face.points[i], center), sub(face.points[i + 1], center))) / 6;
    if (volume <= epsilon) return null;
    return { center, volume, surfaceArea: polygons.reduce((sum, face) => sum + solidPolygonArea(face.points), 0), cutArea: solidPolygonArea(cap),
      mesh: { vertices: vertices.map((point) => sub(point, center)), faces: polygons.map((face) => ({ id: face.id, indices: face.points.map((point) => vertices.findIndex((vertex) => same(vertex, point))) })) } };
  };
  const positive = build(1), negative = build(-1);
  return positive && negative ? [positive, negative] : null;
}
/** 截面手柄在世界坐标操作，切块只保存相对原实体的切面，移动后仍可准确拼回。 */
export function solidCutPlaneFromSection(entity: SolidEntity, settings: SolidSectionSettings): SolidCutPlane {
  const world = solidSectionPlane(entity, solidSectionNormal(settings), settings.offset);
  const inverse = new Quaternion().setFromEuler(new Euler(entity.rotation.x, entity.rotation.y, entity.rotation.z)).invert();
  const n = new Vector3(world.normal.x, world.normal.y, world.normal.z).applyQuaternion(inverse);
  const origin = new Vector3(world.origin.x - entity.position.x, world.origin.y - entity.position.y, world.origin.z - entity.position.z).applyQuaternion(inverse);
  return { normal: { x: n.x, y: n.y, z: n.z }, distance: origin.dot(n) };
}
export function assembledCutPiecePosition(entity: SolidEntity, part: SolidCutPieceMesh): SolidVector { return solidLocalToWorld(part.center, entity); }
export function separatedCutPiecePosition(entity: SolidEntity, part: SolidCutPieceMesh, plane: SolidCutPlane, index: number): SolidVector {
  const distance = Math.max(entity.dimensions.width, entity.dimensions.height, entity.dimensions.depth) * 0.35;
  return add(assembledCutPiecePosition(entity, part), scale(rotateSolidPoint(plane.normal, entity.rotation), index === 0 ? distance : -distance));
}
