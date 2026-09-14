import { Vector3 } from "three";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { transformCubeNetWorkbenchModel } from "./cube-net-workbench-model";

export type CubeNetFaceOffsets = Readonly<Record<string, number>>;
export const CUBE_NET_FACE_REVEAL_DISTANCE = 0.95;
export const CUBE_NET_FACE_REVEAL_MS = 420;

/** 观察用移面始终从完整立方体求外法向，不改变铰链、剪口或折叠状态。 */
export function cubeNetRevealFaces(closed: PolyhedronFoldRenderModel, offsets: CubeNetFaceOffsets) {
  const center = closed.faces.reduce((sum, face) => sum.add(new Vector3(face.centroid.x, face.centroid.y, face.centroid.z)), new Vector3()).divideScalar(closed.faces.length);
  return closed.faces.map((face) => {
    const origin = new Vector3(face.centroid.x, face.centroid.y, face.centroid.z);
    const normal = origin.clone().sub(center).normalize();
    const offset = offsets[face.faceId] ?? 0;
    const translation = normal.clone().multiplyScalar(offset * CUBE_NET_FACE_REVEAL_DISTANCE);
    const u = new Vector3(face.vertices[1].position.x - face.vertices[0].position.x, face.vertices[1].position.y - face.vertices[0].position.y, face.vertices[1].position.z - face.vertices[0].position.z).normalize();
    const position = origin.clone().add(translation).addScaledVector(u, 0.24).addScaledVector(normal, offset > 0 ? 0.55 : 0.10);
    return { faceId: face.faceId, label: face.label, normal, translation, position, expanded: offset > 0,
      direction: normal.clone().multiplyScalar(offset > 0 ? -1 : 1) };
  });
}
export type CubeNetRevealFace = ReturnType<typeof cubeNetRevealFaces>[number];

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
