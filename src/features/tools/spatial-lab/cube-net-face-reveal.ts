import { Vector3, type Camera } from "three";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { transformCubeNetWorkbenchModel } from "./cube-net-workbench-model";

export type CubeNetFaceOffsets = Readonly<Record<string, number>>;
export const CUBE_NET_FACE_REVEAL_DISTANCE = 0.95;
export const CUBE_NET_FACE_REVEAL_MS = 650;

/** 观察用移面从当前纸面顶点求外法向，不改变铰链、剪口或折叠状态。 */
export function cubeNetRevealFaces(closed: PolyhedronFoldRenderModel, offsets: CubeNetFaceOffsets) {
  return closed.faces.map((face) => {
    const origin = new Vector3(face.centroid.x, face.centroid.y, face.centroid.z);
    const [a, b, c] = face.vertices.slice(0, 3).map((vertex) => new Vector3(vertex.position.x, vertex.position.y, vertex.position.z));
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    const offset = offsets[face.faceId] ?? 0;
    const translation = normal.clone().multiplyScalar(offset * CUBE_NET_FACE_REVEAL_DISTANCE);
    const center = origin.clone().add(translation);
    const position = center.clone().addScaledVector(normal, 0.9);
    return { faceId: face.faceId, label: face.label, normal, translation, center, position, expanded: offset > 0,
      direction: normal.clone().multiplyScalar(offset > 0 ? -1 : 1) };
  });
}
export type CubeNetRevealFace = ReturnType<typeof cubeNetRevealFaces>[number];

/** 只将外法向投影为箭头朝向；位置和遮挡交给真实三维锚点。 */
export function cubeNetFaceArrowAngle(face: CubeNetRevealFace, camera: Camera, width: number, height: number) {
  const project = (point: Vector3) => { const result = point.clone().project(camera); return { x: (result.x + 1) * width / 2, y: (1 - result.y) * height / 2 }; };
  const center = project(face.center), away = project(face.position);
  const dx = away.x - center.x, dy = away.y - center.y;
  const angle = Math.hypot(dx, dy) < 1 ? -45 : Math.atan2(dy, dx) * 180 / Math.PI;
  return angle + (face.expanded ? 180 : 0);
}

export function revealCubeNetFaces(closed: PolyhedronFoldRenderModel, offsets: CubeNetFaceOffsets): PolyhedronFoldRenderModel {
  const faces = cubeNetRevealFaces(closed, offsets);
  return transformCubeNetWorkbenchModel(closed, (point, faceId) => {
    const offset = faces.find((face) => face.faceId === faceId)!.translation;
    return { x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z };
  });
}
export function sampleCubeNetFaceReveal(from: CubeNetFaceOffsets, to: CubeNetFaceOffsets, elapsedMs: number): CubeNetFaceOffsets {
  const progress = Math.max(0, Math.min(1, elapsedMs / CUBE_NET_FACE_REVEAL_MS));
  const eased = progress * progress * (3 - 2 * progress);
  return Object.fromEntries([...new Set([...Object.keys(from), ...Object.keys(to)])].map((id) => [id, (from[id] ?? 0) * (1 - eased) + (to[id] ?? 0) * eased]));
}
