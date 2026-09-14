import { Matrix4, Vector3 } from "three";
import type { PolyhedronSceneAdapterInput } from "@/features/spatial-math/domain";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { analyzeCubeNetCuts, type CubeNetCutPoses, type CubeNetCutSnapshot } from "./cube-net-cutting";
import { transformCubeNetWorkbenchModel } from "./cube-net-workbench-model";
import { CUBE_NET_UNFOLD_STEP_MS } from "./cube-net-unfold-motion";

export function cubeNetCutPoseModel(closed: PolyhedronFoldRenderModel, poses: CubeNetCutPoses) {
  const transforms = new Map(closed.faces.map((face) => [face.faceId, poses[face.faceId] ? new Matrix4().fromArray(poses[face.faceId]) : new Matrix4()]));
  return transformCubeNetWorkbenchModel(closed, (point, faceId) => {
    const result = new Vector3(point.x, point.y, point.z).applyMatrix4(transforms.get(faceId)!);
    return { x: result.x, y: result.y, z: result.z };
  });
}
function normal(face: PolyhedronFoldRenderFace) {
  const [a, b, c] = face.vertices.slice(0, 3).map((vertex) => new Vector3(vertex.position.x, vertex.position.y, vertex.position.z));
  return b.sub(a).cross(c.sub(a)).normalize();
}
export interface CubeNetCutMove {
  readonly edgeId: string;
  readonly faceId: string;
  readonly movingFaceIds: readonly string[];
  readonly start: Vector3;
  readonly axis: Vector3;
  readonly radians: number;
}

/** 一条保留棱成为桥边时，该侧就可独立展开；其余含环的纸面作为刚性整体保留。 */
export function cubeNetAvailableCutMoves(base: PolyhedronSceneAdapterInput, cuts: readonly string[], model: PolyhedronFoldRenderModel, bothSides = false): CubeNetCutMove[] {
  const analysis = analyzeCubeNetCuts(base, cuts);
  if (analysis.status === "disconnected") return [];
  const moves: CubeNetCutMove[] = [];
  for (const hinge of analysis.remaining) {
    const fixed = new Set([base.layout.rootFaceId]), queue = [base.layout.rootFaceId];
    for (let index = 0; index < queue.length; index++) for (const edge of analysis.remaining) {
      if (edge.edgeId === hinge.edgeId || !edge.faceIds.includes(queue[index])) continue;
      for (const faceId of edge.faceIds) if (!fixed.has(faceId)) { fixed.add(faceId); queue.push(faceId); }
    }
    if (fixed.size === model.faces.length) continue;
    const faceId = hinge.faceIds.find((id) => !fixed.has(id))!;
    const parentId = hinge.faceIds.find((id) => fixed.has(id))!;
    const face = model.faces.find((item) => item.faceId === faceId)!, parent = model.faces.find((item) => item.faceId === parentId)!;
    const [start, end] = hinge.vertexIds.map((id) => {
      const point = parent.vertices.find((vertex) => vertex.vertexId === id)!.position;
      return new Vector3(point.x, point.y, point.z);
    });
    const axis = end.sub(start).normalize(), from = normal(face), to = normal(parent);
    const radians = Math.atan2(axis.dot(from.clone().cross(to)), from.dot(to));
    if (Math.abs(radians) < 1e-6) continue;
    moves.push({ edgeId: hinge.edgeId, faceId, movingFaceIds: model.faces.filter((item) => !fixed.has(item.faceId)).map((item) => item.faceId), start, axis, radians });
    if (bothSides) moves.push({ edgeId: hinge.edgeId, faceId: parentId, movingFaceIds: [...fixed], start, axis, radians: -radians });
  }
  return moves.sort((a, b) => a.movingFaceIds.length - b.movingFaceIds.length || a.edgeId.localeCompare(b.edgeId));
}
function rotatedPoses(from: CubeNetCutPoses, move: CubeNetCutMove, fraction: number): CubeNetCutPoses {
  const { start, axis } = move;
  const rotation = new Matrix4().makeTranslation(start.x, start.y, start.z)
    .multiply(new Matrix4().makeRotationAxis(axis, move.radians * fraction))
    .multiply(new Matrix4().makeTranslation(-start.x, -start.y, -start.z));
  return { ...from, ...Object.fromEntries(move.movingFaceIds.map((faceId) => [faceId,
    rotation.clone().multiply(from[faceId] ? new Matrix4().fromArray(from[faceId]) : new Matrix4()).toArray(),
  ])) };
}

export function createCubeNetCutUnfoldMotion(base: PolyhedronSceneAdapterInput, closed: PolyhedronFoldRenderModel, snapshot: Pick<CubeNetCutSnapshot, "cuts" | "poses">, selection?: Pick<CubeNetCutMove, "edgeId" | "faceId">) {
  let poses = snapshot.poses;
  const steps: { move: CubeNetCutMove; from: CubeNetCutPoses; to: CubeNetCutPoses }[] = [];
  for (let index = 0; index < 5; index++) {
    const candidates = cubeNetAvailableCutMoves(base, snapshot.cuts, cubeNetCutPoseModel(closed, poses), true);
    const move = selection ? candidates.find((item) => item.edgeId === selection.edgeId && item.faceId === selection.faceId) : candidates[0];
    if (!move) break;
    const to = rotatedPoses(poses, move, 1);
    steps.push({ move, from: poses, to }); poses = to;
    if (selection) break;
  }
  const durationMs = steps.length * CUBE_NET_UNFOLD_STEP_MS;
  return { steps, durationMs, target: poses,
    sample(elapsedMs: number) {
      const elapsed = Math.min(durationMs, Math.max(0, elapsedMs)), index = Math.floor(elapsed / CUBE_NET_UNFOLD_STEP_MS);
      const active = steps[index];
      const progress = (elapsed - index * CUBE_NET_UNFOLD_STEP_MS) / CUBE_NET_UNFOLD_STEP_MS;
      const current = active ? rotatedPoses(active.from, active.move, progress * progress * (3 - 2 * progress)) : poses;
      const model = cubeNetCutPoseModel(closed, current);
      return { poses: current, model: { ...model, faces: model.faces.map((face) => ({ ...face, selected: active?.move.movingFaceIds.includes(face.faceId) ?? false })) },
        step: Math.min(index + 1, steps.length), total: steps.length };
    },
  };
}
