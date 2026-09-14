import { Matrix4 } from "three";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { transformCubeNetWorkbenchModel } from "./cube-net-workbench-model";
import type { CubeNetTeachingAnchor } from "./cube-net-teaching-session";
import type { CubeNetCutPoses } from "./cube-net-cutting";

/** 保留当前折叠及朝向，把整体 X/Z 中心移回原点，最低处落在 Y=0 桌面。 */
export function createCubeNetRecenter(model: PolyhedronFoldRenderModel, faceId: string, poses: CubeNetCutPoses = {}) {
  const delta = { x: -model.bounds.center.x, y: -model.bounds.min.y, z: -model.bounds.center.z };
  const durationMs = Math.hypot(delta.x, delta.y, delta.z) < 1e-7 ? 0 : 650;
  const sample = (elapsed: number) => {
    const progress = durationMs ? Math.max(0, Math.min(1, elapsed / durationMs)) : 1;
    const t = progress * progress * (3 - 2 * progress);
    return transformCubeNetWorkbenchModel(model, (p) => ({ x: p.x + delta.x * t, y: p.y + delta.y * t, z: p.z + delta.z * t }));
  };
  const target = sample(durationMs);
  const points = target.faces.find((face) => face.faceId === faceId)!.vertices.slice(0, 3).map((vertex) => vertex.position);
  const anchor: CubeNetTeachingAnchor = { faceId, vertices: [points[0], points[1], points[2]] };
  const translation = new Matrix4().makeTranslation(delta.x, delta.y, delta.z);
  const targetPoses = Object.fromEntries(model.faces.map((face) => [face.faceId,
    translation.clone().multiply(poses[face.faceId] ? new Matrix4().fromArray(poses[face.faceId]) : new Matrix4()).toArray()]));
  return { durationMs, sample, target, anchor, poses: targetPoses };
}
