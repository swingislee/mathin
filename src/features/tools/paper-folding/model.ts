import { Matrix4, Quaternion, Vector3 } from "three";
import type { PolyhedronFoldVector3 } from "@/features/spatial-math/domain";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeNetFaceBasis, transformCubeNetWorkbenchModel, type CubeNetWorkbenchHinge } from "../spatial-lab/cube-net-workbench-model";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import { paperAdjacencies, type PaperFoldingSnapshot, type PaperSquare } from "./contract";

const point = (vector: Vector3) => ({ x: vector.x, y: vector.y, z: vector.z });
const vector = (p: PolyhedronFoldVector3) => new Vector3(p.x, p.y, p.z);
const flatVertices = (square: PaperSquare) => [
  { x: square.x - 0.5, y: 0, z: square.z - 0.5 }, { x: square.x - 0.5, y: 0, z: square.z + 0.5 },
  { x: square.x + 0.5, y: 0, z: square.z + 0.5 }, { x: square.x + 0.5, y: 0, z: square.z - 0.5 },
];
function paperTree(snapshot: PaperFoldingSnapshot) {
  const edges = paperAdjacencies(snapshot.squares), seen = new Set([snapshot.squares[0].id]);
  const entries: { id: string; parent: PaperSquare; child: PaperSquare; depth: number }[] = [];
  const queue = [{ face: snapshot.squares[0], depth: 0 }];
  while (queue.length) {
    const { face, depth } = queue.shift()!;
    for (const edge of edges.filter((edge) => edge.a === face.id || edge.b === face.id)) {
      const childId = edge.a === face.id ? edge.b : edge.a;
      if (seen.has(childId)) continue;
      const child = snapshot.squares.find((square) => square.id === childId)!;
      seen.add(childId); entries.push({ id: edge.id, parent: face, child, depth: depth + 1 }); queue.push({ face: child, depth: depth + 1 });
    }
  }
  return entries;
}

/** 开口方格树的铰接运动学；不需要闭合多面体、合法展开图或目标答案。 */
export function resolvePaperFolding(snapshot: PaperFoldingSnapshot, selectedIds: readonly string[] = []) {
  const tree = paperTree(snapshot), matrices = new Map<string, Matrix4>([[snapshot.squares[0].id, new Matrix4()]]);
  const hinges: CubeNetWorkbenchHinge[] = [];
  for (const item of tree) {
    const dx = item.child.x - item.parent.x, dz = item.child.z - item.parent.z;
    const index = dx === -1 ? 0 : dz === 1 ? 1 : dx === 1 ? 2 : 3;
    const corners = flatVertices(item.parent), start = corners[index], end = corners[(index + 1) % 4];
    const axis = vector(end).sub(vector(start)).normalize();
    const parent = matrices.get(item.parent.id)!;
    const rotation = new Matrix4().makeTranslation(start.x, start.y, start.z)
      .multiply(new Matrix4().makeRotationAxis(axis, -(snapshot.angles[item.id] ?? 0) * Math.PI / 180))
      .multiply(new Matrix4().makeTranslation(-start.x, -start.y, -start.z));
    matrices.set(item.child.id, parent.clone().multiply(rotation));
    const moving = new Set([item.child.id]);
    for (const descendant of tree) if (moving.has(descendant.parent.id)) moving.add(descendant.child.id);
    hinges.push({ edgeId: item.id, parentFaceId: item.parent.id, faceId: item.child.id, label: `${item.parent.label}—${item.child.label}`,
      degrees: snapshot.angles[item.id] ?? 0, movingFaceIds: [...moving], direction: -1,
      start: point(vector(start).applyMatrix4(parent)), end: point(vector(end).applyMatrix4(parent)) });
  }
  const faces: PolyhedronFoldRenderFace[] = snapshot.squares.map((square) => {
    const transform = matrices.get(square.id)!;
    const vertices = flatVertices(square).map((p, index) => ({ vertexId: `${square.id}_${index}`, position: point(vector(p).applyMatrix4(transform)) }));
    const triangleVertexIndices = [[0, 1, 2], [0, 2, 3]] as const;
    return { faceId: square.id, label: snapshot.labelsVisible ? square.label : "", materialToken: square.color, selected: selectedIds.includes(square.id), colliding: false,
      vertices, triangleVertexIndices,
      trianglePositions: triangleVertexIndices.flatMap((indices) => indices.flatMap((index) => Object.values(vertices[index].position))),
      edgePositions: vertices.flatMap((vertex, index) => [...Object.values(vertex.position), ...Object.values(vertices[(index + 1) % 4].position)]),
      centroid: point(new Vector3(square.x, 0, square.z).applyMatrix4(transform)), opacity: 0.88 };
  });
  const flat = snapshot.squares.flatMap(flatVertices), min = { x: Math.min(...flat.map((p) => p.x)), y: 0, z: Math.min(...flat.map((p) => p.z)) };
  const max = { x: Math.max(...flat.map((p) => p.x)), y: 0, z: Math.max(...flat.map((p) => p.z)) };
  const center = { x: (min.x + max.x) / 2, y: 0, z: (min.z + max.z) / 2 };
  const bounds = { min, max, center, radius: Math.max(1.2, ...flat.map((p) => Math.hypot(p.x - center.x, p.z - center.z))) };
  const camera = cubeWorkbenchCamera(bounds, snapshot.view, "free-paper");
  const source: PolyhedronFoldRenderModel = { profile: "standard-4x3", sceneId: "free-paper", entityId: "paper", label: "Paper folding", progressMillionths: 0,
    background: "paper", lighting: "soft", showEdges: true, faces, bounds, displayTarget: center,
    camera: { ...camera, projection: "orthographic", zoom: 1, label: { zh: "自由拼纸", en: "Free paper folding" } } };
  const support = snapshot.anchor && faces.find((face) => face.faceId === snapshot.anchor!.faceId);
  const placement = support ? cubeNetFaceBasis(snapshot.anchor!.vertices).multiply(cubeNetFaceBasis(support.vertices.map((vertex) => vertex.position)).invert()) : new Matrix4();
  const place = (p: PolyhedronFoldVector3) => point(vector(p).applyMatrix4(placement));
  const model = transformCubeNetWorkbenchModel(source, place);
  return { model: { ...model, camera: source.camera, displayTarget: bounds.center }, frame: bounds,
    hinges: hinges.map((hinge) => ({ ...hinge, start: place(hinge.start), end: place(hinge.end) })) };
}

export function paperUnfoldMotion(snapshot: PaperFoldingSnapshot) {
  const order = paperTree(snapshot).sort((a, b) => b.depth - a.depth).filter((edge) => snapshot.angles[edge.id] !== 0).map((edge) => edge.id);
  const stepMs = 440, settleMs = snapshot.anchor ? 440 : 0;
  const flat = { ...snapshot, angles: Object.fromEntries(Object.keys(snapshot.angles).map((id) => [id, 0])) };
  const target = { ...flat, anchor: null };
  const anchoredRoot = resolvePaperFolding(flat).model.faces[0];
  const canonicalRoot = resolvePaperFolding(target).model.faces[0];
  const initialPlacement = cubeNetFaceBasis(anchoredRoot.vertices.map((vertex) => vertex.position)).multiply(cubeNetFaceBasis(canonicalRoot.vertices.map((vertex) => vertex.position)).invert());
  const translation = new Vector3(), orientation = new Quaternion();
  initialPlacement.decompose(translation, orientation, new Vector3());
  return { target, durationMs: Math.max(1, order.length * stepMs + settleMs), sample(elapsedMs: number): PaperFoldingSnapshot {
    const elapsed = Math.max(0, elapsedMs), angles = { ...snapshot.angles };
    for (const [index, id] of order.entries()) {
      const t = Math.max(0, Math.min(1, (elapsed - index * stepMs) / stepMs));
      angles[id] = snapshot.angles[id] * (1 - t * t * (3 - 2 * t));
    }
    if (!snapshot.anchor || elapsed < order.length * stepMs) return { ...snapshot, angles };
    const progress = Math.min(1, (elapsed - order.length * stepMs) / settleMs), t = progress * progress * (3 - 2 * progress);
    const matrix = new Matrix4().compose(translation.clone().multiplyScalar(1 - t), orientation.clone().slerp(new Quaternion(), t), new Vector3(1, 1, 1));
    const vertices = canonicalRoot.vertices.slice(0, 3).map((vertex) => point(vector(vertex.position).applyMatrix4(matrix))) as [PolyhedronFoldVector3, PolyhedronFoldVector3, PolyhedronFoldVector3];
    return { ...flat, anchor: progress === 1 ? null : { faceId: snapshot.squares[0].id, vertices } };
  } };
}

/** 展示端由前后两个权威快照重建过程；晚加入没有前态时直接展示完整当前现场。 */
export function paperSnapshotTransition(from: PaperFoldingSnapshot, to: PaperFoldingSnapshot) {
  const sameLayout = from.squares.length === to.squares.length && from.squares.every((face, index) => face.id === to.squares[index].id);
  if (!sameLayout) return null;
  const changed = Object.keys(to.angles).some((id) => from.angles[id] !== to.angles[id]);
  if (to.anchor === null && Object.values(to.angles).every((angle) => angle === 0) && (changed || from.anchor !== null)) {
    const motion = paperUnfoldMotion(from);
    return { durationMs: motion.durationMs, sample: (time: number) => ({ ...to, angles: motion.sample(time).angles, anchor: motion.sample(time).anchor }) };
  }
  if (!changed) return null;
  return { durationMs: 320, sample(time: number): PaperFoldingSnapshot {
    const progress = Math.max(0, Math.min(1, time / 320)), t = progress * progress * (3 - 2 * progress);
    return { ...to, angles: Object.fromEntries(Object.entries(to.angles).map(([id, value]) => [id, from.angles[id] + (value - from.angles[id]) * t])) };
  } };
}
