import { Matrix4, Quaternion, Vector3 } from "three";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeNetFaceBasis, transformCubeNetWorkbenchModel } from "./cube-net-workbench-model";
import type { CubeNetTeachingAnchor } from "./cube-net-teaching-session";

/** 先保留逐面动作的连贯性，再用一次刚性摆放落到默认 X–Z 桌面。 */
export function createCubeNetTableAlignment(from: PolyhedronFoldRenderModel, to: PolyhedronFoldRenderModel, faceId: string, preservePlanarPlacement = true) {
  const source = from.faces.find((face) => face.faceId === faceId)!, target = to.faces.find((face) => face.faceId === faceId)!;
  const sourceBasis = cubeNetFaceBasis(source.vertices.map((vertex) => vertex.position));
  const placement = cubeNetFaceBasis(target.vertices.map((vertex) => vertex.position)).multiply(sourceBasis.clone().invert());
  if (preservePlanarPlacement) {
    const normal = new Vector3().setFromMatrixColumn(sourceBasis, 2);
    const direction = new Vector3(0, normal.y > 1e-7 ? 1 : -1, 0);
    const turn = new Quaternion().setFromUnitVectors(normal, direction);
    const center = new Vector3(source.centroid.x, source.centroid.y, source.centroid.z);
    const offset = new Vector3(center.x, 0, center.z).sub(center.clone().applyQuaternion(turn));
    placement.compose(offset, turn, new Vector3(1, 1, 1));
  }
  const rotation = new Quaternion().setFromRotationMatrix(placement), translation = new Vector3().setFromMatrixPosition(placement);
  const durationMs = rotation.angleTo(new Quaternion()) < 1e-7 && translation.length() < 1e-7 ? 0 : 500;
  const finalPoints = source.vertices.slice(0, 3).map((vertex) => {
    const point = new Vector3(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(placement);
    return { x: point.x, y: point.y, z: point.z };
  });
  const anchor: CubeNetTeachingAnchor = { faceId, vertices: [finalPoints[0], finalPoints[1], finalPoints[2]] };
  return { durationMs, anchor, sample(elapsedMs: number) {
    const progress = durationMs === 0 ? 1 : Math.max(0, Math.min(1, elapsedMs / durationMs));
    const t = progress * progress * (3 - 2 * progress);
    const transform = new Matrix4().compose(translation.clone().multiplyScalar(t), new Quaternion().slerp(rotation, t), new Vector3(1, 1, 1));
    return transformCubeNetWorkbenchModel(from, (point) => {
      const result = new Vector3(point.x, point.y, point.z).applyMatrix4(transform);
      return { x: result.x, y: result.y, z: result.z };
    });
  } };
}
