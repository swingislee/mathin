import type { SolidEntity, SolidFeatureSelection, SolidVector } from "./solid-geometry-contract";

export interface SolidFace { id: string; surface: "plane" | "curved"; vertices: SolidVector[]; center: SolidVector; normal: SolidVector | null }
export interface SolidEdge { id: string; kind: "segment" | "circle"; points: SolidVector[]; faceIds: string[] }
export interface SolidVertex { id: string; position: SolidVector; faceIds: string[] }
export interface SolidTopology { faces: SolidFace[]; edges: SolidEdge[]; vertices: SolidVertex[] }
export interface SolidMeshData { vertices: SolidVector[]; faces: { id: string; indices: number[] }[] }
export const solidVector = (x = 0, y = 0, z = 0): SolidVector => ({ x, y, z });
const mean = (points: SolidVector[]) => points.reduce((a, p) => ({ x: a.x + p.x / points.length, y: a.y + p.y / points.length, z: a.z + p.z / points.length }), solidVector());
const cross = (a: SolidVector, b: SolidVector) => solidVector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const sub = (a: SolidVector, b: SolidVector) => solidVector(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: SolidVector, b: SolidVector) => a.x * b.x + a.y * b.y + a.z * b.z;
function normal(points: SolidVector[]) { const n = cross(sub(points[1], points[0]), sub(points[2], points[0])); const len = Math.hypot(n.x, n.y, n.z); return solidVector(n.x / len, n.y / len, n.z / len); }
export function solidCircle(radius: number, y: number, segments = 64): SolidVector[] {
  return Array.from({ length: segments }, (_, i) => solidVector(radius * Math.cos(i * Math.PI * 2 / segments), y, radius * Math.sin(i * Math.PI * 2 / segments)));
}
function polyhedron(entity: SolidEntity): SolidMeshData | null {
  const { width: w, height: h, depth: d } = entity.dimensions;
  if (entity.kind === "cube" || entity.kind === "cuboid") return { vertices: [solidVector(-w / 2, -h / 2, -d / 2), solidVector(w / 2, -h / 2, -d / 2), solidVector(w / 2, h / 2, -d / 2), solidVector(-w / 2, h / 2, -d / 2), solidVector(-w / 2, -h / 2, d / 2), solidVector(w / 2, -h / 2, d / 2), solidVector(w / 2, h / 2, d / 2), solidVector(-w / 2, h / 2, d / 2)], faces: [
    { id: "back", indices: [0, 3, 2, 1] }, { id: "front", indices: [4, 5, 6, 7] }, { id: "left", indices: [0, 4, 7, 3] }, { id: "right", indices: [1, 2, 6, 5] }, { id: "bottom", indices: [0, 1, 5, 4] }, { id: "top", indices: [3, 7, 6, 2] },
  ] };
  if (entity.kind === "triangular-prism") return { vertices: [solidVector(-w / 2, -h / 2, -d / 2), solidVector(w / 2, -h / 2, -d / 2), solidVector(0, h / 2, -d / 2), solidVector(-w / 2, -h / 2, d / 2), solidVector(w / 2, -h / 2, d / 2), solidVector(0, h / 2, d / 2)], faces: [
    { id: "back", indices: [0, 2, 1] }, { id: "front", indices: [3, 4, 5] }, { id: "bottom", indices: [0, 1, 4, 3] }, { id: "right", indices: [1, 2, 5, 4] }, { id: "left", indices: [2, 0, 3, 5] },
  ] };
  if (entity.kind === "square-pyramid") return { vertices: [solidVector(-w / 2, -h / 2, -w / 2), solidVector(w / 2, -h / 2, -w / 2), solidVector(w / 2, -h / 2, w / 2), solidVector(-w / 2, -h / 2, w / 2), solidVector(0, h / 2, 0)], faces: [
    { id: "bottom", indices: [0, 1, 2, 3] }, { id: "back", indices: [0, 4, 1] }, { id: "right", indices: [1, 4, 2] }, { id: "front", indices: [2, 4, 3] }, { id: "left", indices: [3, 4, 0] },
  ] };
  return null;
}
/** 语义拓扑不把圆周的渲染分段冒充棱，也不把球面三角网格冒充平面。 */
export function getSolidTopology(entity: SolidEntity): SolidTopology {
  const poly = polyhedron(entity);
  if (poly) {
    const edgeMap = new Map<string, SolidEdge>();
    const faces = poly.faces.map((face): SolidFace => {
      let points = face.indices.map((index) => poly.vertices[index]);
      const center = mean(points);
      if (dot(normal(points), center) < 0) points = points.toReversed();
      face.indices.forEach((v, i) => { const other = face.indices[(i + 1) % face.indices.length]; const key = [v, other].sort((a, b) => a - b).join("-");
        const edge = edgeMap.get(key); if (edge) edge.faceIds.push(face.id); else edgeMap.set(key, { id: `edge-${key}`, kind: "segment", points: [poly.vertices[v], poly.vertices[other]], faceIds: [face.id] }); });
      return { id: face.id, surface: "plane", vertices: points, center, normal: normal(points) };
    });
    return { faces, edges: [...edgeMap.values()], vertices: poly.vertices.map((position, i) => ({ id: `vertex-${i}`, position, faceIds: poly.faces.filter((face) => face.indices.includes(i)).map((face) => face.id) })) };
  }
  const { radius: r, height: h } = entity.dimensions;
  if (entity.kind === "sphere") return { faces: [{ id: "surface", surface: "curved", vertices: [], center: solidVector(), normal: null }], edges: [], vertices: [] };
  const bottom = solidCircle(r, -h / 2), top = solidCircle(r, h / 2);
  const faces: SolidFace[] = [{ id: "bottom", surface: "plane", vertices: bottom, center: solidVector(0, -h / 2), normal: solidVector(0, -1) }, { id: "surface", surface: "curved", vertices: [], center: solidVector(), normal: null }];
  const edges: SolidEdge[] = [{ id: "rim-bottom", kind: "circle", points: [...bottom, bottom[0]], faceIds: ["bottom", "surface"] }];
  if (entity.kind === "cylinder") { faces.push({ id: "top", surface: "plane", vertices: top.toReversed(), center: solidVector(0, h / 2), normal: solidVector(0, 1) }); edges.push({ id: "rim-top", kind: "circle", points: [...top, top[0]], faceIds: ["top", "surface"] }); }
  return { faces, edges, vertices: entity.kind === "cone" ? [{ id: "apex", position: solidVector(0, h / 2), faceIds: ["surface"] }] : [] };
}
/** 用于有限三角网格渲染/相交；曲面采样精度由调用者显式决定，数学量使用解析 getSolidMetrics。 */
export function getSolidMeshData(entity: SolidEntity, segments = 64): SolidMeshData {
  const poly = polyhedron(entity); if (poly) return poly;
  const n = Math.max(8, Math.min(128, Math.round(segments))), { radius: r, height: h } = entity.dimensions;
  if (entity.kind === "sphere") {
    const rings = Math.max(4, Math.round(n / 2)), vertices = [solidVector(0, -r, 0)];
    for (let j = 1; j < rings; j++) { const latitude = -Math.PI / 2 + j * Math.PI / rings; vertices.push(...solidCircle(r * Math.cos(latitude), r * Math.sin(latitude), n)); }
    const top = vertices.length; vertices.push(solidVector(0, r, 0));
    const faces: SolidMeshData["faces"] = [];
    for (let i = 0; i < n; i++) { faces.push({ id: "surface", indices: [0, 1 + i, 1 + (i + 1) % n] }); for (let j = 0; j < rings - 2; j++) { const a = 1 + j * n + i, b = 1 + j * n + (i + 1) % n; faces.push({ id: "surface", indices: [a, a + n, b + n, b] }); } faces.push({ id: "surface", indices: [top, 1 + (rings - 2) * n + (i + 1) % n, 1 + (rings - 2) * n + i] }); }
    return { vertices, faces };
  }
  const vertices = solidCircle(r, -h / 2, n);
  const faces: SolidMeshData["faces"] = [{ id: "bottom", indices: Array.from({ length: n }, (_, i) => i) }];
  if (entity.kind === "cone") { vertices.push(solidVector(0, h / 2)); for (let i = 0; i < n; i++) faces.push({ id: "surface", indices: [i, n, (i + 1) % n] }); }
  else { vertices.push(...solidCircle(r, h / 2, n)); faces.push({ id: "top", indices: Array.from({ length: n }, (_, i) => 2 * n - 1 - i) }); for (let i = 0; i < n; i++) faces.push({ id: "surface", indices: [i, n + i, n + (i + 1) % n, (i + 1) % n] }); }
  return { vertices, faces };
}
export function getSolidMetrics(entity: SolidEntity): { volume: number; surfaceArea: number; baseArea: number; height: number } {
  const { width: w, height: h, depth: d, radius: r } = entity.dimensions;
  switch (entity.kind) {
    case "cube": case "cuboid": return { volume: w * h * d, surfaceArea: 2 * (w * h + h * d + w * d), baseArea: w * d, height: h };
    case "triangular-prism": return { volume: w * h * d / 2, surfaceArea: w * h + d * (w + 2 * Math.hypot(h, w / 2)), baseArea: w * h / 2, height: d };
    case "square-pyramid": return { volume: w * w * h / 3, surfaceArea: w * w + 2 * w * Math.hypot(h, w / 2), baseArea: w * w, height: h };
    case "cylinder": return { volume: Math.PI * r * r * h, surfaceArea: 2 * Math.PI * r * (r + h), baseArea: Math.PI * r * r, height: h };
    case "cone": return { volume: Math.PI * r * r * h / 3, surfaceArea: Math.PI * r * (r + Math.hypot(r, h)), baseArea: Math.PI * r * r, height: h };
    case "sphere": return { volume: 4 / 3 * Math.PI * r ** 3, surfaceArea: 4 * Math.PI * r * r, baseArea: Math.PI * r * r, height: 2 * r };
  }
}
export function rotateSolidPoint(point: SolidVector, rotation: SolidVector): SolidVector {
  const a = solidVector(point.x * Math.cos(rotation.z) - point.y * Math.sin(rotation.z), point.x * Math.sin(rotation.z) + point.y * Math.cos(rotation.z), point.z);
  const b = solidVector(a.x * Math.cos(rotation.y) + a.z * Math.sin(rotation.y), a.y, -a.x * Math.sin(rotation.y) + a.z * Math.cos(rotation.y));
  return solidVector(b.x, b.y * Math.cos(rotation.x) - b.z * Math.sin(rotation.x), b.y * Math.sin(rotation.x) + b.z * Math.cos(rotation.x));
}
export function solidLocalToWorld(point: SolidVector, entity: SolidEntity): SolidVector { const p = rotateSolidPoint(point, entity.rotation); return solidVector(p.x + entity.position.x, p.y + entity.position.y, p.z + entity.position.z); }
export function getSolidBounds(entity: SolidEntity): { min: SolidVector; max: SolidVector; center: SolidVector; radius: number } {
  const { width: w, height: h, depth: d, radius: r } = entity.dimensions;
  const extents = entity.kind === "sphere" ? [r, r, r] : entity.kind === "cone" || entity.kind === "cylinder" ? [r, h / 2, r] : [w / 2, h / 2, d / 2];
  const points = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => solidLocalToWorld(solidVector(x * extents[0], y * extents[1], z * extents[2]), entity))));
  return { min: solidVector(...(["x", "y", "z"] as const).map((axis) => Math.min(...points.map((p) => p[axis]))) as [number, number, number]), max: solidVector(...(["x", "y", "z"] as const).map((axis) => Math.max(...points.map((p) => p[axis]))) as [number, number, number]), center: { ...entity.position }, radius: Math.hypot(...extents) };
}
export function getSolidsFrame(entities: readonly SolidEntity[]) { const bounds = entities.map(getSolidBounds); if (!bounds.length) return { center: solidVector(0, 1, 0), radius: 3 };
  const min = solidVector(...(["x", "y", "z"] as const).map((axis) => Math.min(...bounds.map((b) => b.min[axis]))) as [number, number, number]);
  const max = solidVector(...(["x", "y", "z"] as const).map((axis) => Math.max(...bounds.map((b) => b.max[axis]))) as [number, number, number]);
  return { center: mean([min, max]), radius: Math.max(2.4, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2) };
}
export function validSolidFeature(entity: SolidEntity, selection: SolidFeatureSelection): boolean {
  if (entity.id !== selection.entityId) return false; const topology = getSolidTopology(entity);
  return (selection.kind === "face" ? topology.faces : selection.kind === "edge" ? topology.edges : topology.vertices).some((part) => part.id === selection.id);
}
