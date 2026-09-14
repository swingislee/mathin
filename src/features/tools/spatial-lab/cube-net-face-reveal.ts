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

/** 按钮位于面中心外法向的投影上；正对视线时分开入口，细引线始终对应面中心。 */
export function layoutCubeNetFaceArrows(faces: readonly CubeNetRevealFace[], camera: Camera, width: number, height: number) {
  const project = (point: Vector3) => { const result = point.clone().project(camera); return { x: (result.x + 1) * width / 2, y: (1 - result.y) * height / 2 }; };
  const view = camera.getWorldDirection(new Vector3());
  const result = faces.map((face) => {
    const center = project(face.center), away = project(face.position);
    let dx = away.x - center.x, dy = away.y - center.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) { const sign = face.normal.dot(view) < 0 ? 1 : -1; dx = sign / Math.sqrt(2); dy = sign / Math.sqrt(2); }
    else { dx /= length; dy /= length; }
    const gap = Math.max(64, length);
    return { faceId: face.faceId, x: center.x + dx * gap, y: center.y + dy * gap, center,
      angle: Math.atan2(dy, dx) * 180 / Math.PI + (face.expanded ? 180 : 0) };
  });
  const constrain = () => result.forEach((item) => { item.x = Math.max(30, Math.min(width - 74, item.x)); item.y = Math.max(80, Math.min(height - 60, item.y)); });
  constrain();
  for (let pass = 0; pass < 12; pass++) {
    for (let a = 0; a < result.length; a++) for (let b = a + 1; b < result.length; b++) {
      const left = result[a], right = result[b], dx = right.x - left.x, dy = right.y - left.y, distance = Math.hypot(dx, dy);
      if (distance >= 54) continue;
      const x = distance > 0.01 ? dx / distance : 1, y = distance > 0.01 ? dy / distance : 0;
      const shift = (54 - distance) / 2;
      left.x -= x * shift; left.y -= y * shift; right.x += x * shift; right.y += y * shift;
    }
    constrain();
  }
  return result;
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
